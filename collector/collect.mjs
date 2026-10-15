#!/usr/bin/env node
// Houston Events collector.
// Node 20+, no dependencies. Run by GitHub Actions: `node collector/collect.mjs`.
// Reads  collector/sources.json  and the previous  houston/data/events.json,
// writes houston/data/events.json + houston/data/status.json (data contract v1).
//
// Env: TICKETMASTER_API_KEY, SEATGEEK_CLIENT_ID (either may be missing: that source
// is skipped with error "key not configured" and its previous events are carried over).
//
// Write policy (to keep git history quiet):
//  * events.json is rewritten only when its content changes, ignoring `generatedAt`,
//    `lastSeen` and `sources[].lastChecked` (those are refreshed whenever a write happens).
//  * status.json is rewritten when its content changes ignoring timestamps
//    (`generatedAt`, `lastAttempt`, `lastSuccess`), when events.json was written,
//    or when the last write is older than `statusHeartbeatHours` (default 24) so the
//    app can still tell "collector alive" from "collector dead".

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const TZ = 'America/Chicago';
export const USER_AGENT = 'GoobsHoustonEvents/1.0 (personal, non-commercial)';
export const SCHEMA_VERSION = 1;
const DAY_MS = 86400000;
const HOUR_MS = 3600000;
export const CATEGORIES = ['music', 'theater', 'comedy', 'festival', 'market', 'food', 'exhibition', 'sports', 'family', 'community', 'other'];
const STATUSES = ['scheduled', 'canceled', 'postponed', 'rescheduled'];

// ---------------------------------------------------------------- time helpers
//#region time
const dtfCache = new Map();
function dtf(tz) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    dtfCache.set(tz, f);
  }
  return f;
}
const pad = (n, w = 2) => String(n).padStart(w, '0');

/** Wall-clock parts of an instant in a zone. */
export function partsInZone(ms, tz = TZ) {
  const p = {};
  for (const x of dtf(tz).formatToParts(new Date(ms))) p[x.type] = x.value;
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
}
/** UTC offset in minutes of a zone at an instant (e.g. -300 for CDT). */
export function offsetMinutes(ms, tz = TZ) {
  const t = Math.floor(ms / 1000) * 1000;
  const p = partsInZone(t, tz);
  return (Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - t) / 60000;
}
/**
 * Convert wall-clock fields in a zone to an instant (ms). DST-safe:
 * ambiguous times (fall back) resolve to the earlier instant (first occurrence, CDT);
 * nonexistent times (spring forward gap) resolve using the pre-transition offset (shift forward).
 */
export function zonedToInstant(y, mo, d, h = 0, mi = 0, s = 0, tz = TZ) {
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  const o1 = offsetMinutes(wall - DAY_MS, tz);
  const o2 = offsetMinutes(wall + DAY_MS, tz);
  const cands = [];
  for (const o of new Set([o1, o2])) {
    const ms = wall - o * 60000;
    if (offsetMinutes(ms, tz) === o) cands.push(ms);
  }
  if (cands.length) return Math.min(...cands);
  return wall - o1 * 60000;
}
/** ISO-8601 string with explicit offset for an instant, rendered in `tz` (default Central). */
export function isoInZone(ms, tz = TZ) {
  const t = Math.floor(ms / 1000) * 1000;
  const p = partsInZone(t, tz);
  const off = offsetMinutes(t, tz);
  const sign = off < 0 ? '-' : '+';
  const a = Math.abs(off);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}
/** 'YYYY-MM-DD' + optional 'HH:mm[:ss]' in tz -> Central ISO string with offset. */
export function localIso(dateStr, timeStr = null, tz = TZ) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  let h = 0, mi = 0, s = 0;
  if (timeStr) [h, mi, s = 0] = timeStr.split(':').map(Number);
  return isoInZone(zonedToInstant(y, mo, d, h, mi, s, tz), TZ);
}
export function ymdStr(y, mo, d) { return `${y}-${pad(mo)}-${pad(d)}`; }
export function addDaysYmd(dateStr, n) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d + n));
  return ymdStr(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
export function centralDateOf(ms) { const p = partsInZone(ms, TZ); return ymdStr(p.y, p.mo, p.d); }
export function startOfCentralDay(ms) { const p = partsInZone(ms, TZ); return zonedToInstant(p.y, p.mo, p.d, 0, 0, 0, TZ); }
export function validTz(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}
/** Effective end of an event in ms (used to drop past events). */
export function effectiveEndMs(e) {
  if (e.end) return Date.parse(e.end);
  const s = Date.parse(e.start);
  return e.allDay ? s + DAY_MS : s + 3 * HOUR_MS;
}
//#endregion

// ---------------------------------------------------------------- text helpers
//#region text
const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', ndash: '–', mdash: '—',
  rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', copy: '©', reg: '®', trade: '™', eacute: 'é', egrave: 'è',
  aacute: 'á', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', Eacute: 'É', uuml: 'ü', ouml: 'ö', auml: 'ä',
};
export function decodeEntities(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, g) => {
    if (g[0] === '#') {
      const code = g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      try { return String.fromCodePoint(code); } catch { return m; }
    }
    return Object.prototype.hasOwnProperty.call(NAMED, g) ? NAMED[g] : m;
  });
}
export function stripHtml(s) {
  if (s == null) return '';
  let t = String(s);
  t = t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ');
  t = t.replace(/<br\s*\/?>|<\/(p|li|div|h[1-6]|tr)>/gi, ' ');
  t = t.replace(/<[^>]*>/g, ' ');
  t = decodeEntities(t);
  return t.replace(/\s+/g, ' ').trim();
}
/** Clean text from a source and cap at max chars (word boundary + ellipsis). null if empty. */
export function condense(text, max = 300) {
  const t = stripHtml(text);
  if (!t) return null;
  if (t.length <= max) return t;
  let cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  if (sp > max * 0.6) cut = cut.slice(0, sp);
  return cut.replace(/[\s,;:.\-–—]+$/, '') + '…';
}
export function cleanTitle(s) {
  let t = stripHtml(s);
  // some venue feeds append the date/time to the title: "Mrs. Doubtfire – 10/14/2026 7:30 PM"
  t = t.replace(/\s*[–—-]\s*\d{1,2}\/\d{1,2}\/\d{2,4}(\s+\d{1,2}:\d{2}\s*[AaPp][Mm])?\s*$/, '');
  return t.trim();
}
const NOISE = new Set(['tickets', 'live', 'presents', 'tour']);
export function normalizeTitle(t) {
  const s = String(t ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/['\u2018\u2019`]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9\s]/g, ' ');
  return s.split(/\s+/).filter((w) => w && !NOISE.has(w)).join(' ');
}
const VENUE_STOP = new Set(['the', 'of', 'at', 'and', 'a', 'for']);
const VENUE_GENERIC = new Set(['theater', 'center', 'hall', 'arena', 'park', 'stadium', 'room', 'house', 'club', 'bar', 'grill', 'lounge', 'pavilion', 'auditorium', 'museum', 'library', 'garden', 'gardens']);
export function venueTokens(name) {
  const s = String(name ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/['\u2018\u2019`]/g, '').replace(/theatre/g, 'theater').replace(/centre/g, 'center').replace(/&/g, ' ').replace(/[^a-z0-9\s]/g, ' ');
  return s.split(/\s+/).filter((w) => w && !VENUE_STOP.has(w));
}
export function hash16(s) { return crypto.createHash('sha1').update(s).digest('hex').slice(0, 16); }
export function sanitizeError(e) {
  const msg = String(e && e.message ? e.message : e);
  return msg.replace(/(apikey|api_key|client_id|client_secret|key|token)=[^&\s"')]+/gi, '$1=***').replace(/\s+/g, ' ').slice(0, 200);
}
const toNum = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
//#endregion

// ---------------------------------------------------------------- categories
//#region category
export function categoryFromText(text) {
  const t = String(text ?? '').toLowerCase();
  const rules = [
    ['comedy', /\b(comedy|comedian|stand[- ]?up|improv)\b/],
    ['festival', /\b(festival|fest|fair|parade|carnival|mardi gras|celebration)\b/],
    ['market', /\b(farmers?'?s? market|market|bazaar|flea|craft show|artisan|pop[- ]?up shop)\b/],
    ['food', /\b(food|wine|beer|tasting|brunch|dinner|culinary|taco|bbq|barbecue|cook[- ]?off|chef|brewery|crawfish|restaurant week)\b/],
    ['exhibition', /\b(exhibit|exhibits|exhibition|exhibitions|gallery|art show|installation)\b/],
    ['music', /\b(concert|music|band|symphony|orchestra|jazz|blues|choir|recital|dj|singer|songwriter)\b/],
    ['theater', /\b(theat(er|re)|musical|broadway|play|opera|ballet|dance|cirque|magic show)\b/],
    ['sports', /\b(sports?|football|basketball|baseball|soccer|hockey|marathon|5k|10k|race|wrestling|mma|boxing|tournament|rodeo)\b/],
    ['family', /\b(family|families|kids?|children|storytime|toddler|youth|tyke|tykes)\b/],
    ['community', /\b(community|volunteer|meeting|workshop|class|lecture|talk|civic|town hall|seminar|walk|yoga|wellness)\b/],
  ];
  for (const [cat, re] of rules) if (re.test(t)) return cat;
  return null;
}
/** Ticketmaster classification -> app category. */
export function tmCategory(ev) {
  const cl = (ev.classifications || []).find((c) => c.primary) || (ev.classifications || [])[0] || {};
  const seg = String(cl.segment?.name || '').toLowerCase();
  const genre = String(cl.genre?.name || '').toLowerCase();
  const sub = String(cl.subGenre?.name || '').toLowerCase();
  const g = `${genre} ${sub}`;
  if (seg === 'music') return 'music';
  if (seg === 'sports') return 'sports';
  if (seg === 'film') return 'other';
  if (seg === 'arts & theatre' || seg === 'arts and theatre') {
    if (/comedy|humor/.test(g)) return 'comedy';
    if (/fine art|museum|gallery/.test(g)) return 'exhibition';
    if (/children|family/.test(g)) return 'family';
    if (/fair|festival/.test(g)) return 'festival';
    return 'theater';
  }
  if (seg === 'miscellaneous' || seg === 'undefined' || seg === 'family' || seg === '') {
    if (/fairs?\s*&?\s*festivals?|festival/.test(g)) return 'festival';
    if (/family|children/.test(g) || seg === 'family') return 'family';
    if (/food|drink|wine|beer/.test(g)) return 'food';
    if (/comedy/.test(g)) return 'comedy';
    if (/community|civic|expo|convention|lecture|seminar/.test(g)) return 'community';
    if (/market/.test(g)) return 'market';
    return categoryFromText(ev.name) || 'other';
  }
  return categoryFromText(`${seg} ${g} ${ev.name}`) || 'other';
}
/** SeatGeek type/taxonomies -> app category. */
export function sgCategory(ev) {
  const type = String(ev.type || '').toLowerCase();
  const tax = (ev.taxonomies || []).map((t) => String(t.name || '').toLowerCase()).join(' ');
  const all = `${type} ${tax}`;
  if (/comedy/.test(all)) return 'comedy';
  if (/music_festival|festival/.test(all)) return 'festival';
  if (/family|circus|cirque|kids|children|disney|ice_show|monster_truck/.test(all)) return 'family';
  if (/theater|theatre|broadway|musical|opera|dance|ballet|play/.test(all)) return 'theater';
  if (/concert|music|band|classical|orchestra|symphony|rap|hip|rock|country|pop|jazz|dj/.test(all)) return 'music';
  if (/sports|nfl|nba|mlb|nhl|mls|wnba|ncaa|soccer|football|basketball|baseball|hockey|rodeo|wrestling|boxing|mma|racing|motorsport|golf|tennis|rugby|lacrosse/.test(all)) return 'sports';
  return categoryFromText(ev.title || ev.short_title) || 'other';
}
//#endregion

// ---------------------------------------------------------------- event construction
//#region event
export function fmtMoney(n) {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}
/** Build a price object from published numbers only. Returns null if nothing known. */
export function makePrice(min, max, currency = 'USD', text = null) {
  min = toNum(min); max = toNum(max);
  if (min == null && max == null) return text ? { min: null, max: null, currency, free: null, text } : null;
  if (min == null) min = max;
  if (max == null) max = min;
  if (min > max) [min, max] = [max, min];
  const free = min === 0 && max === 0 ? true : min > 0 ? false : null;
  let t = text;
  if (!t) {
    if (free) t = 'Free';
    else if (currency === 'USD') t = min === max ? fmtMoney(min) : `${fmtMoney(min)}–${fmtMoney(max)}`;
    else t = min === max ? `${min} ${currency}` : `${min}–${max} ${currency}`;
  }
  return { min, max, currency, free, text: t };
}
export function makeVenue(v = {}) {
  return {
    name: v.name ? String(v.name).trim() : '',
    address: v.address ? String(v.address).trim() : null,
    city: v.city ? String(v.city).trim() : null,
    neighborhood: v.neighborhood ? String(v.neighborhood).trim() : null,
    lat: toNum(v.lat),
    lon: toNum(v.lon),
  };
}
/** One-source listing in contract shape (id/firstSeen/lastSeen/removed finalised later). */
export function makeListing(o) {
  const status = STATUSES.includes(o.status) ? o.status : 'scheduled';
  return {
    id: '',
    title: o.title,
    category: CATEGORIES.includes(o.category) ? o.category : 'other',
    start: o.start,
    end: o.end || null,
    allDay: !!o.allDay,
    venue: makeVenue(o.venue),
    price: o.price || null,
    description: o.description ? condense(o.description, 300) : null,
    status,
    series: o.series || null,
    sources: [{
      id: o.source.id, name: o.source.name, url: o.source.url || null, ticketUrl: o.source.ticketUrl || null,
      lastChecked: o.source.lastChecked || null, sourceEventId: o.source.sourceEventId == null ? null : String(o.source.sourceEventId),
    }],
    firstSeen: null, lastSeen: null, removed: false,
  };
}
//#endregion

// ---------------------------------------------------------------- HTTP
//#region http
export const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * GET with retry/backoff on 429/5xx/network errors. Throws a short sanitized error when exhausted.
 * opts: { fetchImpl, sleep, retries (default 4), baseDelayMs (default 1000), responseType: 'json'|'text', headers }
 */
export async function httpGet(url, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const sleep = opts.sleep || defaultSleep;
  const retries = opts.retries ?? 4;
  const base = opts.baseDelayMs ?? 1000;
  const headers = { 'User-Agent': USER_AGENT, Accept: opts.responseType === 'text' ? 'text/calendar, text/plain, */*' : 'application/json', ...(opts.headers || {}) };
  let lastErr = 'unknown error';
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res;
    try {
      const init = { headers };
      if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) init.signal = AbortSignal.timeout(opts.timeoutMs ?? 30000);
      res = await fetchImpl(url, init);
    } catch (e) {
      lastErr = `network error: ${sanitizeError(e)}`;
      if (attempt < retries) { await sleep(Math.min(base * 2 ** attempt, 30000)); continue; }
      break;
    }
    if (res.status === 429 || (res.status >= 500 && res.status <= 504)) {
      lastErr = `HTTP ${res.status}`;
      if (attempt < retries) {
        let wait = Math.min(base * 2 ** attempt, 30000);
        const ra = res.headers && typeof res.headers.get === 'function' ? Number(res.headers.get('retry-after')) : NaN;
        if (Number.isFinite(ra) && ra > 0) wait = Math.min(ra * 1000, 60000);
        await sleep(wait);
        continue;
      }
      break;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    try {
      return opts.responseType === 'text' ? await res.text() : await res.json();
    } catch (e) {
      throw new Error(`bad response body: ${sanitizeError(e)}`);
    }
  }
  throw new Error(`${lastErr} after ${retries} retries`);
}
function makeThrottle(delayMs, sleep) {
  let first = true;
  return async () => { if (!first && delayMs > 0) await sleep(delayMs); first = false; };
}
//#endregion

// ---------------------------------------------------------------- Ticketmaster
//#region ticketmaster
export const TM_URL = 'https://app.ticketmaster.com/discovery/v2/events.json';
const TM_STATUS = { onsale: 'scheduled', offsale: 'scheduled', canceled: 'canceled', cancelled: 'canceled', postponed: 'postponed', rescheduled: 'rescheduled' };

export function mapTicketmasterEvent(ev, nowIso) {
  if (!ev || !ev.id || !ev.name) return null;
  if (ev.test === true) return null;
  const name = cleanTitle(ev.name);
  if (/^parking\b|\bparking (pass|only)\b/i.test(name)) return null;
  const st = ev.dates?.start || {};
  if (st.dateTBD || st.dateTBA || (!st.localDate && !st.dateTime)) return null;
  const hasTime = !!(st.localTime || st.dateTime) && !st.noSpecificTime && !st.timeTBA;
  let start;
  if (hasTime && st.dateTime) start = isoInZone(Date.parse(st.dateTime), TZ);
  else if (hasTime && st.localDate) start = localIso(st.localDate, st.localTime);
  else start = localIso(st.localDate || st.dateTime.slice(0, 10), null);
  let end = null;
  const en = ev.dates?.end;
  if (en && (en.dateTime || en.localDate)) {
    if (!en.noSpecificTime && en.dateTime) end = isoInZone(Date.parse(en.dateTime), TZ);
    else if (!en.noSpecificTime && en.localDate && en.localTime) end = localIso(en.localDate, en.localTime);
    else if (en.localDate && en.localDate > start.slice(0, 10)) end = localIso(en.localDate, '23:59:59');
    if (end && Date.parse(end) <= Date.parse(start)) end = null;
  }
  const venue = ev._embedded?.venues?.[0] || {};
  const pr = (ev.priceRanges || []).find((p) => p.type === 'standard') || (ev.priceRanges || [])[0];
  const price = pr ? makePrice(pr.min, pr.max, pr.currency || 'USD') : null;
  const code = String(ev.dates?.status?.code || '').toLowerCase();
  const url = ev.url || null;
  return makeListing({
    title: name,
    category: tmCategory(ev),
    start, end, allDay: !hasTime,
    venue: {
      name: venue.name, address: venue.address?.line1, city: venue.city?.name,
      lat: venue.location?.latitude, lon: venue.location?.longitude,
    },
    price,
    description: ev.info || ev.pleaseNote || null,
    status: TM_STATUS[code] || 'scheduled',
    source: { id: 'ticketmaster', name: 'Ticketmaster', url, ticketUrl: url, lastChecked: nowIso, sourceEventId: ev.id },
  });
}

const tmStamp = (ms) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Fetch every Ticketmaster event for the window, slicing to dodge the deep-paging limit. */
export async function collectTicketmaster({ apiKey, cfg, window, fetchImpl, sleep, nowIso, log = () => {} }) {
  const size = 200;
  const throttle = makeThrottle(cfg.ticketmaster?.requestDelayMs ?? 250, sleep);
  const maxRequests = cfg.ticketmaster?.maxRequests ?? 600;
  let requests = 0;
  const byId = new Map();
  async function page(s, e, n) {
    if (++requests > maxRequests) throw new Error(`request budget exceeded (${maxRequests})`);
    await throttle();
    const q = new URLSearchParams({
      apikey: apiKey, latlong: `${cfg.center.lat},${cfg.center.lon}`, radius: String(cfg.radiusMiles), unit: 'miles',
      startDateTime: tmStamp(s), endDateTime: tmStamp(e), sort: 'date,asc', size: String(size), page: String(n), locale: '*',
    });
    return httpGet(`${TM_URL}?${q}`, { fetchImpl, sleep });
  }
  const take = (json) => {
    for (const ev of json?._embedded?.events || []) if (ev && ev.id && !byId.has(ev.id)) byId.set(ev.id, ev);
  };
  async function slice(s, e) {
    const first = await page(s, e, 0);
    const total = first?.page?.totalElements ?? (first?._embedded?.events || []).length;
    if (total > 1000 && e - s > HOUR_MS) {
      const mid = s + Math.floor((e - s) / 2000) * 1000;
      await slice(s, mid);
      await slice(mid + 1000, e);
      return;
    }
    take(first);
    const totalPages = Math.ceil(total / size);
    const lastPage = Math.min(totalPages, Math.floor(999 / size) + 1) - 1; // size*page < 1000
    for (let n = 1; n <= lastPage; n++) take(await page(s, e, n));
  }
  const SLICE = 7 * DAY_MS;
  for (let s = window.startMs; s < window.endMs; s += SLICE) {
    const e = Math.min(s + SLICE - 1000, window.endMs);
    await slice(s, e);
  }
  log(`ticketmaster: ${byId.size} raw events in ${requests} requests`);
  const events = [];
  for (const ev of byId.values()) {
    const m = mapTicketmasterEvent(ev, nowIso);
    if (m) events.push(m);
  }
  return events;
}
//#endregion

// ---------------------------------------------------------------- SeatGeek
//#region seatgeek
export const SG_URL = 'https://api.seatgeek.com/2/events';

export function mapSeatGeekEvent(ev, nowIso) {
  if (!ev || ev.id == null || !(ev.title || ev.short_title) || !ev.datetime_local) return null;
  if (/^parking\b/i.test(ev.title || '') || String(ev.type || '').toLowerCase() === 'parking') return null;
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}(?::\d{2})?))?/.exec(ev.datetime_local);
  if (!m) return null;
  const v = ev.venue || {};
  const tz = v.timezone && validTz(v.timezone) ? v.timezone : TZ;
  const allDay = !!ev.time_tbd || !!ev.datetime_tbd || !m[2];
  let start;
  if (allDay) start = localIso(m[1], null, tz);
  else {
    const [y, mo, d] = m[1].split('-').map(Number);
    const [h, mi, s = 0] = m[2].split(':').map(Number);
    start = isoInZone(zonedToInstant(y, mo, d, h, mi, s, tz), TZ);
  }
  if (allDay && tz !== TZ) start = localIso(m[1], null, TZ);
  const sraw = String(ev.status || '').toLowerCase();
  let status = 'scheduled';
  if (/cancel/.test(sraw)) status = 'canceled';
  else if (/postpone/.test(sraw)) status = 'postponed';
  else if (/resched/.test(sraw)) status = 'rescheduled';
  const url = ev.url || null;
  return makeListing({
    title: cleanTitle(ev.title || ev.short_title),
    category: sgCategory(ev),
    start, end: null, allDay,
    venue: {
      name: v.name, address: [v.address, v.extended_address].filter(Boolean).join(', ') || null,
      city: v.city || (v.display_location ? String(v.display_location).split(',')[0] : null),
      lat: v.location?.lat, lon: v.location?.lon,
    },
    price: null, // SeatGeek stats are resale prices: never used
    description: ev.description || null,
    status,
    source: { id: 'seatgeek', name: 'SeatGeek', url, ticketUrl: url, lastChecked: nowIso, sourceEventId: ev.id },
  });
}

export async function collectSeatGeek({ clientId, cfg, window, fetchImpl, sleep, nowIso, log = () => {} }) {
  const perPage = 100;
  const throttle = makeThrottle(cfg.seatgeek?.requestDelayMs ?? 250, sleep);
  const maxRequests = cfg.seatgeek?.maxRequests ?? 400;
  let requests = 0;
  const byId = new Map();
  const startDate = centralDateOf(window.startMs);
  const endDate = centralDateOf(window.endMs);
  const SLICE_DAYS = 30;
  for (let ds = startDate; ds <= endDate; ds = addDaysYmd(ds, SLICE_DAYS)) {
    const de = addDaysYmd(ds, SLICE_DAYS); // exclusive
    for (let pg = 1; ; pg++) {
      if (++requests > maxRequests) throw new Error(`request budget exceeded (${maxRequests})`);
      await throttle();
      const q = new URLSearchParams({
        client_id: clientId, lat: String(cfg.center.lat), lon: String(cfg.center.lon), range: `${cfg.radiusMiles}mi`,
        per_page: String(perPage), page: String(pg), sort: 'datetime_local.asc',
        'datetime_local.gte': ds, 'datetime_local.lt': de,
      });
      const json = await httpGet(`${SG_URL}?${q}`, { fetchImpl, sleep });
      for (const ev of json?.events || []) if (ev && ev.id != null && !byId.has(ev.id)) byId.set(ev.id, ev);
      const total = json?.meta?.total ?? 0;
      const per = json?.meta?.per_page || perPage;
      if (!(json?.events || []).length || pg * per >= total) break;
    }
  }
  log(`seatgeek: ${byId.size} raw events in ${requests} requests`);
  const events = [];
  for (const ev of byId.values()) {
    const m = mapSeatGeekEvent(ev, nowIso);
    if (m) events.push(m);
  }
  return events;
}
//#endregion

// ---------------------------------------------------------------- ICS parser
//#region ics
const WIN_TZ = {
  'central standard time': 'America/Chicago', 'central daylight time': 'America/Chicago', 'us central standard time': 'America/Chicago',
  'eastern standard time': 'America/New_York', 'mountain standard time': 'America/Denver', 'pacific standard time': 'America/Los_Angeles',
  'utc': 'UTC', 'greenwich standard time': 'UTC',
};
const DOW = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const DOW_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function unfoldIcs(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '');
}
function splitUnquoted(s, sep) {
  const out = []; let cur = ''; let q = false;
  for (const c of s) {
    if (c === '"') { q = !q; cur += c; } else if (c === sep && !q) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}
export function parseContentLine(line) {
  let colon = -1; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') q = !q;
    else if (c === ':' && !q) { colon = i; break; }
  }
  if (colon < 1) return null;
  const parts = splitUnquoted(line.slice(0, colon), ';');
  const name = parts.shift().toUpperCase();
  if (!/^[A-Z0-9-]+$/.test(name)) return null;
  const params = {};
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name, params, value: line.slice(colon + 1) };
}
export function unescapeIcsText(s) {
  return String(s ?? '').replace(/\\([nN,;\\])/g, (m, c) => (c === 'n' || c === 'N' ? '\n' : c));
}
export function mapTzid(tzid, fallback = TZ) {
  if (!tzid) return fallback;
  let t = String(tzid).trim();
  const w = WIN_TZ[t.toLowerCase()];
  if (w) return w;
  const i = t.indexOf('America/');
  if (i > 0) t = t.slice(i);
  return validTz(t) ? t : fallback;
}
/** Parse an iCalendar date or date-time value into wall fields. */
export function parseIcsDate(value, params = {}, defaultTz = TZ) {
  const v = String(value).trim();
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (m && (params.VALUE === 'DATE' || !params.VALUE || params.VALUE === 'DATE')) {
    return { kind: 'date', y: +m[1], mo: +m[2], d: +m[3], h: 0, mi: 0, s: 0, tz: defaultTz };
  }
  m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (!m) return null;
  const utc = m[7] === 'Z';
  return { kind: 'datetime', y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5], s: +m[6], tz: utc ? 'UTC' : mapTzid(params.TZID, defaultTz) };
}
function dateToMs(dt) { return zonedToInstant(dt.y, dt.mo, dt.d, dt.h, dt.mi, dt.s, dt.tz); }
export function parseIcsDuration(v) {
  const m = /^([+-]?)P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(v).trim());
  if (!m) return null;
  const ms = (+(m[2] || 0)) * 7 * DAY_MS + (+(m[3] || 0)) * DAY_MS + (+(m[4] || 0)) * HOUR_MS + (+(m[5] || 0)) * 60000 + (+(m[6] || 0)) * 1000;
  return m[1] === '-' ? -ms : ms;
}
/** Parse text into raw VEVENTs: [{ props: {NAME: [{params,value}]}}]. Ignores VALARM/VTIMEZONE contents. */
export function parseIcs(text) {
  const lines = unfoldIcs(text).split('\n');
  const events = [];
  let cur = null; let depth = 0; let skipDepth = 0;
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const l = parseContentLine(raw);
    if (!l) continue;
    if (l.name === 'BEGIN') {
      if (cur && skipDepth) { skipDepth++; continue; }
      if (l.value === 'VEVENT' && !cur) { cur = { props: {} }; continue; }
      if (cur) { skipDepth = 1; continue; }
      depth++;
      continue;
    }
    if (l.name === 'END') {
      if (cur && skipDepth) { skipDepth--; continue; }
      if (cur && l.value === 'VEVENT') { events.push(cur); cur = null; continue; }
      if (!cur && depth) depth--;
      continue;
    }
    if (cur && !skipDepth) (cur.props[l.name] ||= []).push({ params: l.params, value: l.value });
  }
  return events;
}
const prop = (ev, n) => (ev.props[n] && ev.props[n][0]) || null;

function parseRrule(s) {
  const r = {};
  for (const part of String(s).split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) r[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  return r;
}
const dayNum = (y, mo, d) => Math.floor(Date.UTC(y, mo - 1, d) / DAY_MS);
const fromDayNum = (n) => { const t = new Date(n * DAY_MS); return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() }; };
const dowOfDayNum = (n) => new Date(n * DAY_MS).getUTCDay();
const dim = (y, mo) => new Date(Date.UTC(y, mo, 0)).getUTCDate();

function parseByday(s) {
  return String(s || '').split(',').filter(Boolean).map((x) => {
    const m = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(x.trim());
    return m ? { ord: m[1] ? +m[1] : 0, dow: DOW.indexOf(m[2].toUpperCase()) } : null;
  }).filter(Boolean);
}
const ordinal = (n) => { const a = Math.abs(n); const s = ['th', 'st', 'nd', 'rd']; const v = a % 100; return a + (s[(v - 20) % 10] || s[v] || s[0]); };
const plural = (arr) => (arr.length <= 1 ? arr[0] || '' : arr.length === 2 ? `${arr[0]} and ${arr[1]}` : `${arr.slice(0, -1).join(', ')} and ${arr[arr.length - 1]}`);

export function rruleLabel(rule, start) {
  const iv = +(rule.INTERVAL || 1);
  const bd = parseByday(rule.BYDAY);
  const startDow = dowOfDayNum(dayNum(start.y, start.mo, start.d));
  if (rule.FREQ === 'DAILY') return iv === 1 ? 'Daily' : `Every ${iv} days`;
  if (rule.FREQ === 'WEEKLY') {
    const days = (bd.length ? bd.map((b) => b.dow) : [startDow]);
    const names = [...new Set(days)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => `${DOW_NAME[d]}s`);
    return `${iv === 1 ? 'Weekly' : `Every ${iv} weeks`} on ${plural(names)}`;
  }
  if (rule.FREQ === 'MONTHLY') {
    const pre = iv === 1 ? 'Monthly' : `Every ${iv} months`;
    if (bd.length) {
      const parts = bd.map((b) => (b.ord === 0 ? `${DOW_NAME[b.dow]}s` : b.ord === -1 ? `last ${DOW_NAME[b.dow]}` : `${ordinal(b.ord)} ${DOW_NAME[b.dow]}`));
      return bd.every((b) => b.ord !== 0) ? `${pre} on the ${plural(parts)}` : `${pre} on ${plural(parts)}`;
    }
    const md = rule.BYMONTHDAY ? rule.BYMONTHDAY.split(',').map(Number) : [start.d];
    return `${pre} on the ${plural(md.map((n) => (n === -1 ? 'last day' : ordinal(n))))}`;
  }
  return 'Recurring';
}

function* genRuleDates(rule, start) {
  const iv = Math.max(1, +(rule.INTERVAL || 1));
  const startN = dayNum(start.y, start.mo, start.d);
  const bd = parseByday(rule.BYDAY);
  if (rule.FREQ === 'DAILY') {
    for (let n = startN; ; n += iv) yield fromDayNum(n);
  } else if (rule.FREQ === 'WEEKLY') {
    const wkst = Math.max(0, DOW.indexOf((rule.WKST || 'MO').toUpperCase()));
    const days = bd.length ? [...new Set(bd.map((b) => b.dow))] : [dowOfDayNum(startN)];
    const weekBase = startN - ((dowOfDayNum(startN) - wkst + 7) % 7);
    for (let w = 0; ; w++) {
      const wb = weekBase + w * iv * 7;
      const ds = days.map((dw) => wb + ((dw - wkst + 7) % 7)).sort((a, b) => a - b);
      for (const n of ds) if (n >= startN) yield fromDayNum(n);
    }
  } else if (rule.FREQ === 'MONTHLY') {
    const mds = rule.BYMONTHDAY ? rule.BYMONTHDAY.split(',').map(Number).filter(Number.isFinite) : null;
    for (let m = 0; ; m += iv) {
      const mi0 = start.mo - 1 + m;
      const y = start.y + Math.floor(mi0 / 12);
      const mo = (mi0 % 12) + 1;
      const n = dim(y, mo);
      const days = [];
      if (bd.length) {
        for (const b of bd) {
          const all = [];
          for (let d = 1; d <= n; d++) if (dowOfDayNum(dayNum(y, mo, d)) === b.dow) all.push(d);
          if (b.ord === 0) days.push(...all);
          else if (b.ord > 0 && all[b.ord - 1]) days.push(all[b.ord - 1]);
          else if (b.ord < 0 && all[all.length + b.ord]) days.push(all[all.length + b.ord]);
        }
      } else if (mds) {
        for (const md of mds) { const d = md > 0 ? md : n + md + 1; if (d >= 1 && d <= n) days.push(d); }
      } else if (start.d <= n) days.push(start.d);
      days.sort((a, b) => a - b);
      for (const d of days) if (dayNum(y, mo, d) >= startN) yield { y, mo, d };
    }
  }
}
const SUPPORTED_FREQ = new Set(['DAILY', 'WEEKLY', 'MONTHLY']);
const UNSUPPORTED_PARTS = ['BYSETPOS', 'BYWEEKNO', 'BYYEARDAY', 'BYHOUR', 'BYMINUTE', 'BYSECOND'];

/**
 * Expand one VEVENT into occurrences within [fromMs, toMs].
 * Returns { occurrences: [{startMs,endMs|null,allDay,startYmd,endYmd|null,recurrenceKey}], rule|null, warnings: [] }.
 */
export function expandVevent(ev, { fromMs, toMs, defaultTz = TZ, overrides = null }) {
  const warnings = [];
  const ds = prop(ev, 'DTSTART');
  if (!ds) return { occurrences: [], rule: null, warnings: ['missing DTSTART'] };
  const start = parseIcsDate(ds.value, ds.params, defaultTz);
  if (!start) return { occurrences: [], rule: null, warnings: [`bad DTSTART ${ds.value}`] };
  const allDay = start.kind === 'date';
  const de = prop(ev, 'DTEND');
  const dur = prop(ev, 'DURATION');
  let endDt = de ? parseIcsDate(de.value, de.params, defaultTz) : null;
  const startMs = dateToMs(start);
  let durMs = null; let spanDays = 0;
  if (allDay) {
    if (endDt && endDt.kind === 'date') spanDays = Math.max(0, dayNum(endDt.y, endDt.mo, endDt.d) - dayNum(start.y, start.mo, start.d) - 1);
    else if (dur) { const d = parseIcsDuration(dur.value); if (d) spanDays = Math.max(0, Math.round(d / DAY_MS) - 1); }
  } else if (endDt) {
    durMs = dateToMs(endDt) - startMs;
    if (durMs < 0) durMs = null;
  } else if (dur) {
    const d = parseIcsDuration(dur.value);
    if (d != null && d >= 0) durMs = d;
  }
  const exSet = new Set();
  for (const x of ev.props.EXDATE || []) {
    for (const v of String(x.value).split(',')) {
      const d = parseIcsDate(v, x.params, start.tz);
      if (!d) continue;
      if (d.kind === 'date') exSet.add(`D${ymdStr(d.y, d.mo, d.d)}`); else exSet.add(`T${dateToMs(d)}`);
    }
  }
  const mk = (st) => {
    const sMs = allDay ? zonedToInstant(st.y, st.mo, st.d, 0, 0, 0, TZ) : zonedToInstant(st.y, st.mo, st.d, start.h, start.mi, start.s, start.tz);
    const sYmd = ymdStr(st.y, st.mo, st.d);
    let eMs = null; let eYmd = null;
    if (allDay) { if (spanDays > 0) eYmd = addDaysYmd(sYmd, spanDays); } else if (durMs) eMs = sMs + durMs;
    return { startMs: sMs, endMs: eMs, allDay, startYmd: sYmd, endYmd: eYmd, startTz: start.tz };
  };
  const inWindow = (o) => {
    const last = o.allDay ? zonedToInstant(...ymdParts(o.endYmd || o.startYmd), 23, 59, 59, TZ) : (o.endMs ?? o.startMs);
    return last >= fromMs && o.startMs <= toMs;
  };
  const excluded = (o) => exSet.has(`T${o.startMs}`) || exSet.has(`D${o.startYmd}`) ||
    (!o.allDay && exSet.has(`D${centralDateOfZone(o.startMs, start.tz)}`));
  const overridden = (o) => overrides && (overrides.has(`T${o.startMs}`) || overrides.has(`D${o.startYmd}`));

  const rr = prop(ev, 'RRULE');
  if (!rr) {
    const o = mk(start);
    return { occurrences: inWindow(o) && !excluded(o) ? [{ ...o, recurrenceKey: null }] : [], rule: null, warnings };
  }
  const rule = parseRrule(rr.value);
  if (!SUPPORTED_FREQ.has(rule.FREQ) || UNSUPPORTED_PARTS.some((k) => k in rule)) {
    warnings.push(`unsupported RRULE ${rr.value}: only first occurrence used`);
    const o = mk(start);
    return { occurrences: inWindow(o) && !excluded(o) ? [{ ...o, recurrenceKey: null }] : [], rule: null, warnings };
  }
  let untilMs = null; let untilYmd = null;
  if (rule.UNTIL) {
    const u = parseIcsDate(rule.UNTIL, {}, start.tz);
    if (u) { if (u.kind === 'date') untilYmd = ymdStr(u.y, u.mo, u.d); else untilMs = dateToMs(u); }
  }
  const countLimit = rule.COUNT ? +rule.COUNT : Infinity;
  const occ = [];
  let count = 0; let iter = 0;
  for (const st of genRuleDates(rule, start)) {
    if (++iter > 6000) { warnings.push('RRULE iteration cap hit'); break; }
    if (count >= countLimit) break;
    count++;
    const o = mk(st);
    if (untilMs != null && o.startMs > untilMs) break;
    if (untilYmd != null && o.startYmd > untilYmd) break;
    if (o.startMs > toMs) break;
    if (excluded(o) || overridden(o)) continue;
    if (inWindow(o)) occ.push({ ...o, recurrenceKey: o.startMs });
  }
  return { occurrences: occ, rule, startFields: start, warnings };
}
function ymdParts(s) { return s.split('-').map(Number); }
function centralDateOfZone(ms, tz) { const p = partsInZone(ms, tz); return ymdStr(p.y, p.mo, p.d); }

/** "Name, 123 Main St, Houston, TX 77002" -> { name, address, city } */
export function parseLocation(loc) {
  const t = stripHtml(unescapeIcsText(loc || ''));
  if (!t) return {};
  const parts = t.split(/\s*,\s*/).filter(Boolean);
  if (parts.length === 1) return /^\d+\s/.test(parts[0]) ? { address: parts[0] } : { name: parts[0] };
  let name = null; let i = 0;
  if (!/^\d+\s/.test(parts[0])) { name = parts[0]; i = 1; }
  const address = parts[i] && /^\d+\s/.test(parts[i]) ? parts[i] : null;
  let city = null;
  const stIdx = parts.findIndex((p, idx) => idx > i - 1 && /^(TX|Texas)(\s+\d{5}(-\d{4})?)?$/i.test(p));
  if (stIdx > 0 && parts[stIdx - 1] !== address && parts[stIdx - 1] !== name) city = parts[stIdx - 1];
  else if (parts.length >= 3 && !address) city = null;
  return { name, address, city };
}

/** Map an ICS document to contract listings for a feed definition. */
export function mapIcs(text, feed, { fromMs, toMs, nowIso }) {
  const raw = parseIcs(text);
  const warnings = [];
  const overrides = new Map(); // uid -> Set of keys
  for (const ev of raw) {
    const rid = prop(ev, 'RECURRENCE-ID');
    const uid = prop(ev, 'UID')?.value;
    if (rid && uid) {
      const d = parseIcsDate(rid.value, rid.params, feed.timezone || TZ);
      if (d) {
        if (!overrides.has(uid)) overrides.set(uid, new Set());
        overrides.get(uid).add(d.kind === 'date' ? `D${ymdStr(d.y, d.mo, d.d)}` : `T${dateToMs(d)}`);
      }
    }
  }
  const out = [];
  for (const ev of raw) {
    const uid = prop(ev, 'UID')?.value || null;
    const summary = prop(ev, 'SUMMARY');
    if (!summary) continue;
    const { occurrences, rule, startFields, warnings: w } = expandVevent(ev, {
      fromMs, toMs, defaultTz: feed.timezone || TZ, overrides: uid ? overrides.get(uid) || null : null,
    });
    warnings.push(...w);
    const title = cleanTitle(unescapeIcsText(summary.value));
    if (!title) continue;
    const loc = parseLocation(prop(ev, 'LOCATION')?.value);
    const fb = feed.venue || {};
    const geo = prop(ev, 'GEO')?.value?.split(';').map(Number);
    const venue = {
      name: loc.name || fb.name || null,
      address: loc.address || fb.address || null,
      city: loc.city || fb.city || feed.city || null,
      lat: geo && Number.isFinite(geo[0]) ? geo[0] : fb.lat ?? null,
      lon: geo && Number.isFinite(geo[1]) ? geo[1] : fb.lon ?? null,
    };
    if (feed.venueOverride) Object.assign(venue, feed.venueOverride);
    const cats = (prop(ev, 'CATEGORIES')?.value || '');
    const category = categoryFromText(`${unescapeIcsText(cats)} ${title}`) || feed.category || 'other';
    const url = (prop(ev, 'URL')?.value || '').trim() || feed.homepage || feed.url;
    const description = condense(unescapeIcsText(prop(ev, 'DESCRIPTION')?.value || ''), 300);
    const st = String(prop(ev, 'STATUS')?.value || '').toUpperCase();
    const status = st === 'CANCELLED' || st === 'CANCELED' ? 'canceled' : 'scheduled';
    const series = rule && uid ? { id: hash16(`series|${feed.id}|${uid}`), label: rruleLabel(rule, startFields) } : null;
    for (const o of occurrences) {
      const startIso = o.allDay ? localIso(o.startYmd, null) : isoInZone(o.startMs, TZ);
      let endIso = null;
      if (o.allDay) { if (o.endYmd) endIso = localIso(o.endYmd, '23:59:59'); } else if (o.endMs && o.endMs > o.startMs) endIso = isoInZone(o.endMs, TZ);
      out.push(makeListing({
        title, category, start: startIso, end: endIso, allDay: o.allDay, venue, price: null, description, status, series,
        source: {
          id: feed.id, name: feed.name, url, ticketUrl: null, lastChecked: nowIso,
          sourceEventId: `${uid || title}${o.recurrenceKey != null ? `@${startIso}` : ''}${!uid && o.recurrenceKey == null ? `@${startIso}` : ''}`,
        },
      }));
    }
  }
  return { listings: out, warnings };
}
//#endregion

// ---------------------------------------------------------------- Tribe Events REST
//#region tribe
export function parseTribeCost(ev) {
  const cost = stripHtml(ev.cost || '');
  const vals = (ev.cost_details?.values || []).map(Number).filter(Number.isFinite);
  const cur = ev.cost_details?.currency_code || 'USD';
  if (cost && /^(free|no charge|no cost|free admission|free!?)$/i.test(cost)) return makePrice(0, 0, cur, 'Free');
  if (vals.length) return makePrice(Math.min(...vals), Math.max(...vals), cur);
  const nums = [...cost.matchAll(/\$\s*(\d+(?:[.,]\d{1,2})?)/g)].map((m) => Number(m[1].replace(',', '')));
  if (nums.length) return makePrice(Math.min(...nums), Math.max(...nums), 'USD');
  if (cost && cost.length <= 60) return makePrice(null, null, cur, cost);
  return null;
}
export function mapTribeEvent(ev, feed, nowIso) {
  if (!ev || !ev.id || !ev.title || !ev.start_date) return null;
  if (ev.status && ev.status !== 'publish') return null;
  if (ev.hide_from_listings) return null;
  const tz = ev.timezone && validTz(ev.timezone) ? ev.timezone : TZ;
  const sm = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?/.exec(ev.start_date);
  if (!sm) return null;
  const em = ev.end_date ? /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?/.exec(ev.end_date) : null;
  const toIso = (m) => {
    const [y, mo, d] = m[1].split('-').map(Number);
    const [h, mi] = m[2].split(':').map(Number);
    return isoInZone(zonedToInstant(y, mo, d, h, mi, +(m[3] || 0), tz), TZ);
  };
  const allDay = !!ev.all_day;
  let start; let end = null;
  if (allDay) {
    start = localIso(sm[1], null, tz);
    if (em && em[1] > sm[1]) {
      // Tribe all-day events end at 23:59 of the last day
      end = localIso(em[1], '23:59:59', tz);
    }
  } else {
    start = toIso(sm);
    if (em) { end = toIso(em); if (Date.parse(end) <= Date.parse(start)) end = null; }
  }
  const v = Array.isArray(ev.venue) ? {} : (ev.venue || {});
  const fb = feed.venue || {};
  const venue = {
    name: stripHtml(v.venue) || fb.name || null,
    address: stripHtml(v.address) || fb.address || null,
    city: stripHtml(v.city) || fb.city || feed.city || null,
    lat: v.geo_lat ?? fb.lat ?? null, lon: v.geo_lng ?? fb.lon ?? null,
  };
  if (feed.venueOverride) Object.assign(venue, feed.venueOverride);
  const title = cleanTitle(ev.title);
  if (!title) return null;
  const catNames = (ev.categories || []).map((c) => c.name).filter(Boolean).join(' ');
  const category = categoryFromText(`${catNames} ${title}`) || feed.category || 'other';
  let status = 'scheduled';
  if (/^[\s\[(*]*(cancel+ed)\b/i.test(title)) status = 'canceled';
  else if (/^[\s\[(*]*postponed\b/i.test(title)) status = 'postponed';
  return makeListing({
    title, category, start, end, allDay, venue,
    price: parseTribeCost(ev),
    description: ev.excerpt || ev.description || null,
    status,
    source: { id: feed.id, name: feed.name, url: ev.url || feed.homepage || null, ticketUrl: ev.website || null, lastChecked: nowIso, sourceEventId: ev.id },
  });
}
export async function collectTribe({ feed, window, fetchImpl, sleep, nowIso, log = () => {} }) {
  const base = String(feed.url).replace(/\/+$/, '');
  const throttle = makeThrottle(feed.requestDelayMs ?? 300, sleep);
  const maxPages = feed.maxPages ?? 40;
  const events = [];
  const seen = new Set();
  let totalPages = 1;
  for (let pg = 1; pg <= totalPages && pg <= maxPages; pg++) {
    await throttle();
    const q = new URLSearchParams({
      start_date: centralDateOf(window.startMs), end_date: centralDateOf(window.endMs), per_page: '50', page: String(pg),
    });
    const json = await httpGet(`${base}/wp-json/tribe/events/v1/events?${q}`, { fetchImpl, sleep });
    if (!json || !Array.isArray(json.events)) throw new Error('not a Tribe Events response');
    totalPages = Number(json.total_pages) || 1;
    for (const ev of json.events) {
      if (!ev || seen.has(ev.id)) continue;
      seen.add(ev.id);
      const m = mapTribeEvent(ev, feed, nowIso);
      if (m) events.push(m);
    }
  }
  log(`${feed.id}: ${events.length} events`);
  return events;
}
export async function collectIcs({ feed, window, fetchImpl, sleep, nowIso, log = () => {} }) {
  const text = await httpGet(feed.url, { fetchImpl, sleep, responseType: 'text' });
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('not an iCalendar response');
  const { listings, warnings } = mapIcs(text, feed, { fromMs: window.startMs, toMs: window.endMs, nowIso });
  for (const w of warnings) log(`${feed.id}: ${w}`);
  log(`${feed.id}: ${listings.length} events`);
  return listings;
}
//#endregion

// ---------------------------------------------------------------- series detection (feeds without RRULE)
//#region series
function nthWeekdayInMonth(dateStr) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  return Math.floor((d - 1) / 7) + 1;
}
/** Group same-title/venue occurrences from one source and label a series only when the dates are strictly regular. */
export function detectSeries(listings) {
  const groups = new Map();
  for (const e of listings) {
    if (e.series) continue;
    const key = `${e.sources[0].id}|${normalizeTitle(e.title)}|${venueTokens(e.venue.name).join(' ')}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  for (const [key, evs] of groups) {
    const dates = [...new Set(evs.map((e) => e.start.slice(0, 10)))].sort();
    if (dates.length < 3) continue;
    const gaps = [];
    for (let i = 1; i < dates.length; i++) {
      const a = ymdParts(dates[i - 1]); const b = ymdParts(dates[i]);
      gaps.push(dayNum(...b) - dayNum(...a));
    }
    const dows = dates.map((d) => dowOfDayNum(dayNum(...ymdParts(d))));
    const sameDow = dows.every((x) => x === dows[0]);
    let label = null;
    if (gaps.every((g) => g === 1)) label = 'Daily';
    else if (sameDow && gaps.every((g) => g === 7)) label = `Weekly on ${DOW_NAME[dows[0]]}s`;
    else if (sameDow && gaps.every((g) => g === 14)) label = `Every 2 weeks on ${DOW_NAME[dows[0]]}s`;
    else if (sameDow && gaps.every((g) => g >= 28 && g <= 35) && dates.every((d) => nthWeekdayInMonth(d) === nthWeekdayInMonth(dates[0]))) {
      label = `Monthly on the ${ordinal(nthWeekdayInMonth(dates[0]))} ${DOW_NAME[dows[0]]}`;
    } else if (gaps.every((g) => g >= 28 && g <= 31) && dates.every((d) => d.slice(8) === dates[0].slice(8))) {
      label = `Monthly on the ${ordinal(+dates[0].slice(8))}`;
    }
    if (!label) continue;
    const series = { id: hash16(`series|${key}`), label };
    for (const e of evs) e.series = series;
  }
  return listings;
}
//#endregion

// ---------------------------------------------------------------- dedupe / merge
//#region merge
export function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8; const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(lat2 - lat1); const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
const SIDE_WORDS = new Set(['vs', 'v', 'at']);
export function titlesMatch(a, b) {
  const na = normalizeTitle(a); const nb = normalizeTitle(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = na.split(' '); const tb = nb.split(' ');
  // same words in a different order, ignoring "vs"/"at" (sports: "A vs B" / "B at A")
  const sa = [...new Set(ta.filter((w) => !SIDE_WORDS.has(w)))].sort().join(' ');
  const sb = [...new Set(tb.filter((w) => !SIDE_WORDS.has(w)))].sort().join(' ');
  if (sa && sa === sb) return true;
  const [short, long] = ta.length <= tb.length ? [na, nb] : [nb, na];
  if (!` ${long} `.includes(` ${short} `)) return false;
  const setA = new Set(ta); const setB = new Set(tb);
  let inter = 0; for (const w of setA) if (setB.has(w)) inter++;
  return inter / Math.max(setA.size, setB.size) >= 0.8;
}
export function venuesMatch(a, b) {
  if (a.lat != null && a.lon != null && b.lat != null && b.lon != null &&
      haversineMiles(a.lat, a.lon, b.lat, b.lon) <= 0.3) return true;
  const ta = venueTokens(a.name); const tb = venueTokens(b.name);
  if (!ta.length || !tb.length) return false;
  const sb = new Set(tb);
  const inter = [...new Set(ta)].filter((w) => sb.has(w));
  if (!inter.length || !inter.some((w) => !VENUE_GENERIC.has(w))) return false;
  return inter.length / Math.min(new Set(ta).size, sb.size) >= 0.6;
}
const SEVERITY = { canceled: 3, postponed: 2, rescheduled: 1, scheduled: 0 };
const priceEmpty = (p) => !p || (p.min == null && p.max == null && p.free == null && !p.text);
function absorb(base, other) {
  base.sources.push(...other.sources);
  if (!base.end && other.end && !base.allDay === !other.allDay) base.end = other.end;
  const bv = base.venue; const ov = other.venue;
  for (const k of ['name', 'address', 'city', 'neighborhood', 'lat', 'lon']) {
    if ((bv[k] == null || bv[k] === '') && ov[k] != null && ov[k] !== '') bv[k] = ov[k];
  }
  if (priceEmpty(base.price) && !priceEmpty(other.price)) base.price = other.price;
  if (!base.description && other.description) base.description = other.description;
  if (!base.series && other.series) base.series = other.series;
  if (base.category === 'other' && other.category !== 'other') base.category = other.category;
  if (SEVERITY[other.status] > SEVERITY[base.status]) base.status = other.status;
}
const TIME_TOL_MS = 3 * HOUR_MS;
/**
 * Merge listings from several sources. groups: [{ trust, events }] where lower trust number = more trustworthy
 * (official venue feed 0 > ticketmaster 1 > seatgeek 2). Listings from the same source never merge with each other.
 */
export function mergeListings(groups) {
  const ordered = groups.map((g, i) => ({ ...g, i })).sort((a, b) => a.trust - b.trust || a.i - b.i);
  const merged = [];
  const byDate = new Map();
  for (const g of ordered) {
    for (const ev of g.events) {
      const sid = ev.sources[0].id;
      const date = ev.start.slice(0, 10);
      const pool = byDate.get(date) || [];
      let best = null; let bestDiff = Infinity;
      for (const m of pool) {
        if (m.sources.some((s) => s.id === sid)) continue;
        if (!titlesMatch(m.title, ev.title)) continue;
        if (!venuesMatch(m.venue, ev.venue)) continue;
        let diff = 0;
        if (!m.allDay && !ev.allDay) {
          diff = Math.abs(Date.parse(m.start) - Date.parse(ev.start));
          if (diff > TIME_TOL_MS) continue;
        }
        if (diff < bestDiff) { best = m; bestDiff = diff; }
      }
      if (best) absorb(best, ev);
      else { merged.push(ev); pool.push(ev); byDate.set(date, pool); }
    }
  }
  return merged;
}
/** Stable id = hash of normalized title + venue + start date. Collisions (same title/venue/day) add the start time. */
export function assignIds(events) {
  const base = (e, extra = '') => hash16(`${normalizeTitle(e.title)}|${venueTokens(e.venue.name).join(' ')}|${e.start.slice(0, 10)}${extra}`);
  const groups = new Map();
  for (const e of events) { e.id = base(e); if (!groups.has(e.id)) groups.set(e.id, []); groups.get(e.id).push(e); }
  for (const evs of groups.values()) {
    if (evs.length < 2) continue;
    for (const e of evs) e.id = base(e, `|${e.start.slice(11, 16)}`);
    const again = new Map();
    for (const e of evs) { if (!again.has(e.id)) again.set(e.id, []); again.get(e.id).push(e); }
    for (const dup of again.values()) {
      if (dup.length < 2) continue;
      dup.sort((a, b) => String(a.sources[0].sourceEventId).localeCompare(String(b.sources[0].sourceEventId)));
      dup.forEach((e) => { e.id = base(e, `|${e.start.slice(11, 16)}|${e.sources[0].id}:${e.sources[0].sourceEventId}`); });
    }
  }
  return events;
}
//#endregion

// ---------------------------------------------------------------- reconcile with previous run
//#region reconcile
export const REMOVED_KEEP_MS = 7 * DAY_MS;
const srcKey = (s) => `${s.id}|${s.sourceEventId}`;
/**
 * current: merged events from sources that succeeded this run (firstSeen/lastSeen already = now).
 * Previous events: matched by id or shared (source id, sourceEventId); carried over if any of their sources FAILED;
 * marked removed only if all their (still configured) sources succeeded and none lists them any more.
 */
export function reconcile({ prevEvents, current, okIds, failedIds, nowIso }) {
  const nowMs = Date.parse(nowIso);
  const byId = new Map(); const byKey = new Map();
  for (const n of current) { byId.set(n.id, n); for (const s of n.sources) byKey.set(srcKey(s), n); }
  const out = [...current];
  for (const p of prevEvents || []) {
    if (!p || !p.start || !Array.isArray(p.sources)) continue;
    if (effectiveEndMs(p) < nowMs) continue; // already over: drop quietly
    let n = byId.get(p.id);
    if (!n) for (const s of p.sources) { n = byKey.get(srcKey(s)); if (n) break; }
    if (n) {
      if (p.firstSeen && (!n.firstSeen || p.firstSeen < n.firstSeen)) n.firstSeen = p.firstSeen;
      for (const s of p.sources) {
        if (failedIds.has(s.id) && !n.sources.some((x) => srcKey(x) === srcKey(s))) n.sources.push(s);
      }
      continue;
    }
    const failed = p.sources.filter((s) => failedIds.has(s.id));
    const ok = p.sources.filter((s) => okIds.has(s.id));
    if (failed.length) { out.push(p); continue; }
    if (ok.length) {
      const removedAt = p.removedAt || nowIso;
      if (p.removed && nowMs - Date.parse(removedAt) > REMOVED_KEEP_MS) continue;
      out.push({ ...p, removed: true, removedAt });
    }
    // else: its sources are no longer configured -> drop
  }
  return out;
}
//#endregion

// ---------------------------------------------------------------- output
//#region output
export function sortEvents(events) {
  return events.sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
export function comparableEvents(doc) {
  return JSON.stringify({
    schemaVersion: doc?.schemaVersion,
    events: (doc?.events || []).map((e) => ({ ...e, lastSeen: undefined, sources: (e.sources || []).map((s) => ({ ...s, lastChecked: undefined })) })),
  });
}
export function comparableStatus(doc) {
  return JSON.stringify({
    schemaVersion: doc?.schemaVersion, demo: doc?.demo,
    sources: (doc?.sources || []).map((s) => ({ ...s, lastAttempt: undefined, lastSuccess: undefined })),
  });
}
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`);
  fs.renameSync(tmp, file);
}
//#endregion

// ---------------------------------------------------------------- config
//#region config
export function validateConfig(cfg) {
  const errs = [];
  if (!cfg || typeof cfg !== 'object') throw new Error('sources.json: not an object');
  if (!(Number.isFinite(cfg.center?.lat) && Number.isFinite(cfg.center?.lon))) errs.push('center.lat/lon must be numbers');
  if (!(cfg.radiusMiles > 0 && cfg.radiusMiles <= 200)) errs.push('radiusMiles must be 1..200');
  if (!(Number.isInteger(cfg.lookaheadDays) && cfg.lookaheadDays >= 1 && cfg.lookaheadDays <= 730)) errs.push('lookaheadDays must be an integer 1..730');
  if (!Array.isArray(cfg.feeds)) errs.push('feeds must be an array');
  else {
    const ids = new Set();
    for (const f of cfg.feeds) {
      if (!f.id || !/^[a-z0-9-]+$/.test(f.id)) errs.push(`feed id invalid: ${f.id}`);
      else if (ids.has(f.id) || f.id === 'ticketmaster' || f.id === 'seatgeek') errs.push(`feed id duplicate/reserved: ${f.id}`);
      ids.add(f.id);
      if (!['ics', 'tribe'].includes(f.type)) errs.push(`feed ${f.id}: type must be ics or tribe`);
      if (!/^https:\/\//.test(f.url || '')) errs.push(`feed ${f.id}: url must be https`);
      if (!f.name) errs.push(`feed ${f.id}: name required`);
    }
  }
  if (errs.length) throw new Error(`sources.json invalid: ${errs.join('; ')}`);
  return cfg;
}
export function loadConfig(file) {
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  return validateConfig(cfg);
}
//#endregion

// ---------------------------------------------------------------- main
//#region main
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..');

/**
 * Run the collector. All I/O is injectable for tests:
 * opts: { env, fetchImpl, sleep, now (ms), sourcesPath, dataDir, log }
 */
export async function main(opts = {}) {
  const env = opts.env || process.env;
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const sleep = opts.sleep || defaultSleep;
  const log = opts.log || ((m) => console.log(m));
  const nowMs = opts.now ?? Date.now();
  const nowIso = new Date(Math.floor(nowMs / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const sourcesPath = opts.sourcesPath || path.join(HERE, 'sources.json');
  const dataDir = opts.dataDir || path.join(REPO_ROOT, 'houston', 'data');
  const eventsPath = path.join(dataDir, 'events.json');
  const statusPath = path.join(dataDir, 'status.json');
  const cfg = loadConfig(sourcesPath);

  const window = { startMs: startOfCentralDay(nowMs), endMs: nowMs + cfg.lookaheadDays * DAY_MS };
  const prevDoc = readJson(eventsPath);
  const prevStatus = readJson(statusPath);
  const prevEvents = Array.isArray(prevDoc?.events) ? prevDoc.events : [];
  const prevSrc = new Map((prevStatus?.sources || []).map((s) => [s.id, s]));

  // ----- define sources
  const defs = [];
  if (cfg.ticketmaster?.enabled !== false) {
    defs.push({
      id: 'ticketmaster', name: 'Ticketmaster', trust: 1,
      run: async () => {
        if (!env.TICKETMASTER_API_KEY) throw Object.assign(new Error('key not configured'), { keyMissing: true });
        return collectTicketmaster({ apiKey: env.TICKETMASTER_API_KEY, cfg, window, fetchImpl, sleep, nowIso, log });
      },
    });
  }
  if (cfg.seatgeek?.enabled !== false) {
    defs.push({
      id: 'seatgeek', name: 'SeatGeek', trust: 2,
      run: async () => {
        if (!env.SEATGEEK_CLIENT_ID) throw Object.assign(new Error('key not configured'), { keyMissing: true });
        return collectSeatGeek({ clientId: env.SEATGEEK_CLIENT_ID, cfg, window, fetchImpl, sleep, nowIso, log });
      },
    });
  }
  for (const f of cfg.feeds) {
    if (f.enabled === false) continue;
    defs.push({
      id: f.id, name: f.name, trust: 0,
      run: () => (f.type === 'ics' ? collectIcs : collectTribe)({ feed: f, window, fetchImpl, sleep, nowIso, log }),
    });
  }

  // ----- run (a failing source never breaks the run)
  const results = [];
  for (const d of defs) {
    const prevCount = prevEvents.filter((e) => (e.sources || []).some((s) => s.id === d.id)).length;
    try {
      let events = await d.run();
      // keep only the window; drop duplicates of the same source event id
      const seen = new Set();
      events = events.filter((e) => {
        const k = `${e.sources[0].id}|${e.sources[0].sourceEventId}`;
        if (seen.has(k)) return false; seen.add(k);
        return effectiveEndMs(e) >= nowMs && Date.parse(e.start) <= window.endMs + DAY_MS;
      });
      if (events.length === 0 && prevCount >= 5) throw new Error('empty result (suspicious: previous run had events)');
      results.push({ ...d, ok: true, error: null, events });
      log(`${d.id}: ok, ${events.length} events`);
    } catch (e) {
      const msg = e.keyMissing ? 'key not configured' : sanitizeError(e);
      results.push({ ...d, ok: false, error: msg, events: [] });
      log(`${d.id}: FAILED (${msg})`);
    }
  }

  const okIds = new Set(results.filter((r) => r.ok).map((r) => r.id));
  const failedIds = new Set(results.filter((r) => !r.ok).map((r) => r.id));

  // ----- series (feeds), merge, ids
  for (const r of results) if (r.ok && r.trust === 0) detectSeries(r.events);
  const merged = mergeListings(results.filter((r) => r.ok).map((r) => ({ trust: r.trust, events: r.events })));
  assignIds(merged);
  for (const e of merged) {
    e.sources.sort((a, b) => {
      const ta = results.find((r) => r.id === a.id)?.trust ?? 9; const tb = results.find((r) => r.id === b.id)?.trust ?? 9;
      return ta - tb || a.id.localeCompare(b.id);
    });
    e.firstSeen = nowIso; e.lastSeen = nowIso; e.removed = false;
  }
  const finalEvents = sortEvents(reconcile({ prevEvents, current: merged, okIds, failedIds, nowIso }));

  // ----- status
  const sources = results.map((r) => {
    const p = prevSrc.get(r.id) || {};
    const count = r.ok ? r.events.length : finalEvents.filter((e) => e.sources.some((s) => s.id === r.id)).length;
    const lastSuccess = r.ok ? nowIso : p.lastSuccess || null;
    return {
      id: r.id, name: r.name, ok: r.ok, lastAttempt: nowIso, lastSuccess, count,
      error: r.ok ? null : r.error, stale: !r.ok && lastSuccess !== null,
    };
  });
  const everSucceeded = sources.some((s) => s.lastSuccess);
  const statusDoc = { schemaVersion: SCHEMA_VERSION, generatedAt: nowIso, demo: !everSucceeded, sources };

  // ----- write only when something meaningful changed
  const eventsDoc = { schemaVersion: SCHEMA_VERSION, generatedAt: nowIso, events: finalEvents };
  const anySuccess = okIds.size > 0;
  let eventsChanged = comparableEvents(eventsDoc) !== comparableEvents(prevDoc);
  if (!eventsChanged && prevDoc && prevDoc.generatedAt == null && anySuccess) eventsChanged = true;
  if (!anySuccess && finalEvents.length === 0 && !prevEvents.length) eventsChanged = false; // nothing was ever collected: leave the placeholder alone
  // lastSeen/lastChecked refresh only on a write; on a no-op run keep the file untouched
  const written = { events: false, status: false };
  if (eventsChanged) { writeJsonAtomic(eventsPath, eventsDoc); written.events = true; }
  const heartbeatMs = (cfg.statusHeartbeatHours ?? 24) * HOUR_MS;
  const lastStatusAt = prevStatus?.generatedAt ? Date.parse(prevStatus.generatedAt) : 0;
  const statusChanged = comparableStatus(statusDoc) !== comparableStatus(prevStatus) || nowMs - lastStatusAt >= heartbeatMs;
  if (statusChanged || written.events) {
    // when only a heartbeat/changed write happens, keep timestamps of untouched sources truthful
    writeJsonAtomic(statusPath, statusDoc); written.status = true;
  }
  log(`events: ${finalEvents.length} (${written.events ? 'written' : 'unchanged'}), status: ${written.status ? 'written' : 'unchanged'}`);
  return { eventsDoc, statusDoc, written, results };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main().then((r) => {
    const failed = r.statusDoc.sources.filter((s) => !s.ok);
    for (const s of failed) console.log(`::warning::Houston events source ${s.id} failed: ${s.error}`);
  }).catch((e) => {
    console.error(`FATAL: ${sanitizeError(e)}`);
    process.exit(1);
  });
}
//#endregion
