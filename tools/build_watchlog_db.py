#!/usr/bin/env python3
"""Build Watch Log's offline movie & TV database from IMDb's non-commercial datasets.

IMDb's data is licensed for personal, non-commercial use: keep the output file on your own devices and
OUT of this (public) repository. Only this script lives in the repo.

1. Download these five files from https://datasets.imdbws.com/ into one folder:
     title.basics.tsv.gz  title.principals.tsv.gz  name.basics.tsv.gz  title.ratings.tsv.gz  title.episode.tsv.gz
2. Run:   python3 build_watchlog_db.py <that folder> [output file]
   Output defaults to <that folder>/watchlog-database.json.gz  (about 40 MB; takes a few minutes)
3. In Watch Log: Backup tab -> Offline movie & TV database -> Import database file.

What is kept (vote counts are IMDb votes; see KEEP below):
File: gzip text, a JSON header line, then one line per column (t = titles, p = people, most-known first;
c = credits grouped by title).

  movies, TV movies, direct-to-video movies, TV specials, TV series and miniseries above a vote floor
  (lower for the last two years, so new releases are in); for each, IMDb's principal cast with characters,
  people appearing as themselves (documentaries, reality), and directors; for series, also everyone credited
  in the series' episodes (guest and recurring roles) with an episode count. Plus everyone's filmography:
  any other title they were in (main cast), however few votes it has (see FILMO_* below). Actors whose IMDb
  "known for" titles include a kept movie or special they aren't credited on are added to its cast.
"""
import gzip, json, math, os, shutil, subprocess, sys, datetime, collections

KIND = {'movie': 0, 'tvSeries': 1, 'tvMiniSeries': 2, 'tvMovie': 3, 'video': 4, 'tvSpecial': 5}
#            normal floor, before-1976 floor
KEEP = {'movie': (300, 800), 'tvSeries': (50, 50), 'tvMiniSeries': (50, 50), 'tvMovie': (100, 300), 'video': (300, 800), 'tvSpecial': (300, 800)}
RECENT_FLOOR = 50             # titles from this year and last year: still collecting votes
GUEST_MIN_VOTES = 100         # series whose episode casts are included ...
GUEST_ONE_EP_VOTES = 2000     # ... and one-episode guest roles only for series with at least this many votes
# Filmographies: everything else someone was in (as principal cast), however few votes it has, for anyone who is
# in the cast of a kept title with at least FILMO_PERSON_VOTES votes (or in 2+ episodes of such a series).
FILMO_PERSON_VOTES = 2000
FILMO_MIN_VOTES = {'tvSeries': 5, 'tvMiniSeries': 5, 'tvMovie': 5, 'movie': 20, 'video': 20, 'tvSpecial': 20}
N = lambda s: None if s == '\\N' else s


def keep_title(ty, year, votes, this_year):
    lo, old = KEEP[ty]
    if year >= this_year - 1: return votes >= min(lo, RECENT_FLOOR)
    return votes >= (lo if year >= 1976 else old)


def lines(path):
    """text lines of a .tsv.gz, header skipped (uses the system gzip when there is one: much faster)"""
    if shutil.which('gzip'):
        p = subprocess.Popen(['gzip', '-dc', path], stdout=subprocess.PIPE, bufsize=1 << 20)
        f = (l.decode('utf-8') for l in p.stdout)
    else:
        f = gzip.open(path, 'rt', encoding='utf-8')
    next(f)
    yield from f


SELF = ('self', 'himself', 'herself', 'themselves', 'themself')
def chars(s, cat):
    s = N(s); a = []
    if s:
        try: a = json.loads(s)
        except Exception: a = []
    a = [x.strip() for x in a if isinstance(x, str) and x.strip()]
    if cat != 'self': a = [x for x in a if x.lower() not in SELF]
    out = ' / '.join(a)[:120]
    return out or ('Self' if cat == 'self' else '')


def build(src, out_path):
    say = lambda m: print(m, flush=True)
    this_year = datetime.date.today().year
    votes = {}
    for line in lines(os.path.join(src, 'title.ratings.tsv.gz')):
        tc, r, v = line.rstrip('\n').split('\t'); votes[tc] = (round(float(r) * 10), int(v))
    say(f'ratings: {len(votes):,}')

    titles, tix, series_ok, one_ep, extra = [], {}, set(), set(), {}
    for line in lines(os.path.join(src, 'title.basics.tsv.gz')):
        a = line.rstrip('\n').split('\t')
        tc, ty = a[0], a[1]
        if ty not in KIND or a[4] != '0' or tc not in votes or not N(a[5]): continue
        y = int(a[5]); r, v = votes[tc]
        if not keep_title(ty, y, v, this_year):
            if v >= FILMO_MIN_VOTES[ty]: extra[tc] = [tc, KIND[ty], a[2], y, int(a[6]) if N(a[6]) else 0, a[8].split(',') if N(a[8]) else [], r, v]
            continue
        tix[tc] = len(titles)
        titles.append([tc, KIND[ty], a[2], y, int(a[6]) if N(a[6]) else 0, a[8].split(',') if N(a[8]) else [], r, v])
        if ty in ('tvSeries', 'tvMiniSeries') and v >= GUEST_MIN_VOTES: series_ok.add(tc)
        if ty in ('tvSeries', 'tvMiniSeries') and v >= GUEST_ONE_EP_VOTES: one_ep.add(len(titles) - 1)
    del votes
    say(f'titles kept: {len(titles):,} ({len(series_ok):,} series with episode casts); {len(extra):,} more if someone known is in them')

    ep_parent = {}
    for line in lines(os.path.join(src, 'title.episode.tsv.gz')):
        e, p, sn, _ = line.split('\t', 3)
        if p in series_ok: ep_parent[e] = (tix[p], int(sn) if sn.isdigit() and 0 < int(sn) < 1000 else 0)
    say(f'episodes of those series: {len(ep_parent):,}')

    rows = collections.defaultdict(list)               # title idx -> [ordering, nconst, role, character, episodes, seasons]
    guest = {}                                          # (series idx, nconst) -> [episodes, character(s), first season, last season]
    for line in lines(os.path.join(src, 'title.principals.tsv.gz')):
        tc, rest = line.split('\t', 1)
        ti = tix.get(tc)
        if ti is not None:
            o, nc, cat, job, ch = rest.rstrip('\n').split('\t')
            if cat in ('actor', 'actress', 'self'): rows[ti].append([int(o), nc, 0, chars(ch, cat), 0, 0])
            elif cat == 'director': rows[ti].append([int(o), nc, 1, '', 0, 0])
            continue
        ep = ep_parent.get(tc)
        if ep is not None:
            si, sn = ep
            o, nc, cat, job, ch = rest.rstrip('\n').split('\t')
            if cat in ('actor', 'actress'):
                g, c = guest.get((si, nc)), chars(ch, cat)
                if g is None: guest[(si, nc)] = [1, c, sn, sn]
                else:
                    g[0] += 1
                    if sn and (not g[2] or sn < g[2]): g[2] = sn
                    if sn > g[3]: g[3] = sn
                    if c and c not in g[1].split(' / ') and g[1].count(' / ') < 1: g[1] = (g[1] + ' / ' + c if g[1] else c)[:120]
    del ep_parent
    say(f'principal credits: {sum(map(len, rows.values())):,}; episode credits (person x series): {len(guest):,}')

    # filmographies: the other titles of people in the kept titles' casts
    known = set()
    for ti, rs in rows.items():
        if titles[ti][7] >= FILMO_PERSON_VOTES: known.update(r[1] for r in rs if r[2] == 0)
    for (si, nc), g in guest.items():
        if g[0] > 1 and titles[si][7] >= FILMO_PERSON_VOTES: known.add(nc)
    say(f'people whose whole filmography is kept: {len(known):,}')
    buf, cur, added = [], None, 0
    def flush():
        nonlocal added
        if cur is not None and any(r[2] == 0 and r[1] in known for r in buf):
            tix[cur] = len(titles); titles.append(extra[cur]); rows[tix[cur]] = buf[:]; added += 1
    for line in lines(os.path.join(src, 'title.principals.tsv.gz')):
        tc, rest = line.split('\t', 1)
        if tc not in extra: continue
        if tc != cur: flush(); buf, cur = [], tc
        o, nc, cat, job, ch = rest.rstrip('\n').split('\t')
        if cat in ('actor', 'actress', 'self'): buf.append([int(o), nc, 0, chars(ch, cat), 0, 0])
        elif cat == 'director': buf.append([int(o), nc, 1, '', 0, 0])
    flush(); del extra, known
    say(f'filmography titles added: {added:,}')

    # "known for": IMDb's people file names up to four titles each person is known for. An actor missing from one of
    # those titles' principal cast (IMDb's list is sometimes incomplete) is added to its cast, after the principals.
    credited = {(ti, r[1]) for ti, rs in rows.items() for r in rs}
    in_db = {r[1] for rs in rows.values() for r in rs} | {nc for (si, nc), g in guest.items() if g[0] > 1 or si in one_ep}   # only people already in the database
    kf_added = 0
    for line in lines(os.path.join(src, 'name.basics.tsv.gz')):
        a = line.rstrip('\n').split('\t')
        if len(a) < 6 or not N(a[5]) or a[4].split(',')[0] not in ('actor', 'actress'): continue   # acting is their main job
        nc = a[0]
        for tc in a[5].split(','):
            ti = tix.get(tc)
            if ti is None or (ti, nc) in credited or nc not in in_db: continue
            if titles[ti][1] in (1, 2): continue        # series: their episode casts already cover this
            rows.setdefault(ti, []).append([900, nc, 3, '', 0, 0]); credited.add((ti, nc)); kf_added += 1   # role 3: more cast
    del credited, in_db
    say(f'cast added from people\'s "known for" titles: {kf_added:,}')

    def merged(rs):   # one row per person and role (IMDb lists several characters as several rows)
        out, at = [], {}
        for o, nc, role, ch, e, ss in sorted(rs):
            k = (nc, role)
            if k in at:
                r = out[at[k]]
                if ch and ch not in r[3].split(' / '): r[3] = (r[3] + ' / ' + ch if r[3] else ch)[:120]
                continue
            at[k] = len(out); out.append([o, nc, role, ch, e, ss])
        return out
    rows = {ti: merged(v) for ti, v in rows.items()}

    # episode casts: add the episode count to a main-cast credit, or add a guest credit after the main cast
    gl = collections.defaultdict(list)
    for (si, nc), (eps, ch, sa, sb) in guest.items():
        if eps > 1 or si in one_ep: gl[si].append((nc, eps, ch, sa * 1000 + sb if sa else 0))
    del guest
    for si, gs in gl.items():
        main = {r[1]: r for r in rows.get(si, []) if r[2] == 0}
        extra = []
        for nc, eps, ch, ss in gs:
            if nc in main:
                main[nc][4] = eps; main[nc][5] = ss
                if not main[nc][3] and ch: main[nc][3] = ch
            else: extra.append([1_000_000 - eps, nc, 2, ch, eps, ss])      # role 2: episode cast only
        extra.sort()
        rows.setdefault(si, []).extend(extra)
    del gl

    keep = [i for i in range(len(titles)) if any(r[2] != 1 for r in rows.get(i, []))]   # titles with at least one person on screen
    remap = {old: new for new, old in enumerate(keep)}
    titles = [titles[i] for i in keep]
    rows = {remap[i]: v for i, v in rows.items() if i in remap}

    fame, needed = collections.Counter(), set()
    for ti, rs in rows.items():
        v, rank = titles[ti][7], 0
        for o, nc, role, ch, e, ss in rs:
            needed.add(nc)
            if role == 1: fame[nc] += v * 0.3
            elif role == 0: fame[nc] += v / (1 + 0.35 * rank); rank += 1
            elif role == 2: fame[nc] += v * min(e, 20) / 400       # guest roles count a little
            else: fame[nc] += v / 200                               # "known for" cast
    people = {}
    for line in lines(os.path.join(src, 'name.basics.tsv.gz')):
        nc, rest = line.split('\t', 1)
        if nc in needed:
            a = rest.rstrip('\n').split('\t')
            people[nc] = [a[0], int(a[1]) if N(a[1]) else 0, int(a[2]) if N(a[2]) else 0]
    pl = sorted(people, key=lambda nc: (-fame[nc], nc))      # most-known first: the app relies on this order
    pix = {nc: i for i, nc in enumerate(pl)}

    gen = sorted({g for t in titles for g in t[5]})
    gi = {g: i for i, g in enumerate(gen)}
    ct, cp, cr, cc, ce, cs = [], [], [], [], [], []
    for ti in range(len(titles)):
        for o, nc, role, ch, e, ss in rows.get(ti, []):
            if nc in pix: ct.append(ti); cp.append(pix[nc]); cr.append(role); cc.append(ch); ce.append(e); cs.append(ss)

    # v2 file: a header line, then one line per column ("t.n<TAB>[...]"), so the app can unpack it a column at a time
    head = {'format': 'goobs-watchlog-ref', 'v': 2, 'built': datetime.date.today().isoformat(),
            'src': 'IMDb non-commercial datasets (personal, non-commercial use only)', 'g': gen}
    cols = [
        ('t.id', [int(t[0][2:]) for t in titles]), ('t.k', [t[1] for t in titles]), ('t.n', [t[2] for t in titles]), ('t.y', [t[3] for t in titles]),
        ('t.e', [t[4] for t in titles]), ('t.r', [t[6] for t in titles]), ('t.v', [t[7] for t in titles]),
        ('t.g', [sum(1 << gi[g] for g in t[5]) for t in titles]),
        ('p.id', [int(nc[2:]) for nc in pl]), ('p.n', [people[nc][0] for nc in pl]), ('p.b', [people[nc][1] for nc in pl]),
        ('p.d', [people[nc][2] for nc in pl]), ('p.f', [round(math.log10(1 + fame[nc]) * 100) for nc in pl]),
        # r: 0 cast, 1 director, 2 episode cast only, 3 more cast (from "known for"); e: episodes (series); s: first*1000 + last season
        ('c.t', ct), ('c.p', cp), ('c.r', cr), ('c.ch', cc), ('c.e', ce), ('c.s', cs)]
    size = 0
    with gzip.open(out_path, 'wb', compresslevel=9) as f:
        for line in [json.dumps(head, ensure_ascii=False, separators=(',', ':'))] + [k + '\t' + json.dumps(v, ensure_ascii=False, separators=(',', ':')) for k, v in cols]:
            b_ = (line + '\n').encode('utf-8'); size += len(b_); f.write(b_)
    g = sum(1 for e in ce if e)
    say(f'done: {len(titles):,} titles, {len(pl):,} people, {len(ct):,} credits ({g:,} with episode counts) '
        f'-> {out_path} ({os.path.getsize(out_path) / 1e6:.1f} MB; {size / 1e6:.0f} MB unzipped)')


if __name__ == '__main__':
    if len(sys.argv) < 2: sys.exit(__doc__)
    src = sys.argv[1]
    build(src, sys.argv[2] if len(sys.argv) > 2 else os.path.join(src, 'watchlog-database.json.gz'))
