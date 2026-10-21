#!/usr/bin/env python3
"""Build Watch Log's offline movie & TV database from IMDb's non-commercial datasets.

IMDb's data is licensed for personal, non-commercial use: keep the output file on your own devices and
OUT of this (public) repository. Only this script lives in the repo.

1. Download these five files from https://datasets.imdbws.com/ into one folder:
     title.basics.tsv.gz  title.principals.tsv.gz  name.basics.tsv.gz  title.ratings.tsv.gz  title.episode.tsv.gz
2. Run:   python3 build_watchlog_db.py <that folder> [output file]
   Output defaults to <that folder>/watchlog-database.json.gz  (about 20 MB; takes a few minutes)
3. In Watch Log: Backup tab -> Offline movie & TV database -> Import database file.

What is kept (vote counts are IMDb votes; see KEEP below):
File columns: t = titles, p = people (most-known first), c = credits grouped by title.

  movies, TV movies, direct-to-video movies, TV specials, TV series and miniseries above a vote floor
  (lower for the last two years, so new releases are in); for each, IMDb's principal cast with characters,
  people appearing as themselves (documentaries, reality), and directors; for series, also everyone credited
  in the series' episodes (guest and recurring roles) with an episode count.
"""
import gzip, json, math, os, shutil, subprocess, sys, datetime, collections

KIND = {'movie': 0, 'tvSeries': 1, 'tvMiniSeries': 2, 'tvMovie': 3, 'video': 4, 'tvSpecial': 5}
#            normal floor, before-1976 floor
KEEP = {'movie': (700, 1500), 'tvSeries': (250, 250), 'tvMiniSeries': (250, 250), 'tvMovie': (200, 600), 'video': (700, 1500), 'tvSpecial': (700, 1500)}
RECENT_FLOOR = 100            # titles from this year and last year: still collecting votes
GUEST_MIN_VOTES = 500         # series whose episode casts are included ...
GUEST_ONE_EP_VOTES = 8000     # ... and one-episode guest roles only for series with at least this many votes
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

    titles, tix, series_ok, one_ep = [], {}, set(), set()
    for line in lines(os.path.join(src, 'title.basics.tsv.gz')):
        a = line.rstrip('\n').split('\t')
        tc, ty = a[0], a[1]
        if ty not in KIND or a[4] != '0' or tc not in votes or not N(a[5]): continue
        y = int(a[5]); r, v = votes[tc]
        if not keep_title(ty, y, v, this_year): continue
        tix[tc] = len(titles)
        titles.append([tc, KIND[ty], a[2], y, int(a[6]) if N(a[6]) else 0, a[8].split(',') if N(a[8]) else [], r, v])
        if ty in ('tvSeries', 'tvMiniSeries') and v >= GUEST_MIN_VOTES: series_ok.add(tc)
        if ty in ('tvSeries', 'tvMiniSeries') and v >= GUEST_ONE_EP_VOTES: one_ep.add(len(titles) - 1)
    del votes
    say(f'titles kept: {len(titles):,} ({len(series_ok):,} series with episode casts)')

    ep_parent = {}
    for line in lines(os.path.join(src, 'title.episode.tsv.gz')):
        e, p, _ = line.split('\t', 2)
        if p in series_ok: ep_parent[e] = tix[p]
    say(f'episodes of those series: {len(ep_parent):,}')

    rows = collections.defaultdict(list)               # title idx -> [ordering, nconst, role, character, episodes]
    guest = {}                                          # (series idx, nconst) -> [episodes, character(s)]
    for line in lines(os.path.join(src, 'title.principals.tsv.gz')):
        tc, rest = line.split('\t', 1)
        ti = tix.get(tc)
        if ti is not None:
            o, nc, cat, job, ch = rest.rstrip('\n').split('\t')
            if cat in ('actor', 'actress', 'self'): rows[ti].append([int(o), nc, 0, chars(ch, cat), 0])
            elif cat == 'director': rows[ti].append([int(o), nc, 1, '', 0])
            continue
        si = ep_parent.get(tc)
        if si is not None:
            o, nc, cat, job, ch = rest.rstrip('\n').split('\t')
            if cat in ('actor', 'actress'):
                g, c = guest.get((si, nc)), chars(ch, cat)
                if g is None: guest[(si, nc)] = [1, c]
                else:
                    g[0] += 1
                    if c and c not in g[1].split(' / ') and g[1].count(' / ') < 1: g[1] = (g[1] + ' / ' + c if g[1] else c)[:120]
    del ep_parent
    say(f'principal credits: {sum(map(len, rows.values())):,}; episode credits (person x series): {len(guest):,}')

    def merged(rs):   # one row per person and role (IMDb lists several characters as several rows)
        out, at = [], {}
        for o, nc, role, ch, e in sorted(rs):
            k = (nc, role)
            if k in at:
                r = out[at[k]]
                if ch and ch not in r[3].split(' / '): r[3] = (r[3] + ' / ' + ch if r[3] else ch)[:120]
                continue
            at[k] = len(out); out.append([o, nc, role, ch, e])
        return out
    rows = {ti: merged(v) for ti, v in rows.items()}

    # episode casts: add the episode count to a main-cast credit, or add a guest credit after the main cast
    gl = collections.defaultdict(list)
    for (si, nc), (eps, ch) in guest.items():
        if eps > 1 or si in one_ep: gl[si].append((nc, eps, ch))
    del guest
    for si, gs in gl.items():
        main = {r[1]: r for r in rows.get(si, []) if r[2] == 0}
        extra = []
        for nc, eps, ch in gs:
            if nc in main:
                main[nc][4] = eps
                if not main[nc][3] and ch: main[nc][3] = ch
            else: extra.append([1_000_000 - eps, nc, 2, ch, eps])      # role 2: episode cast only
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
        for o, nc, role, ch, e in rs:
            needed.add(nc)
            if role == 1: fame[nc] += v * 0.3
            elif role == 0: fame[nc] += v / (1 + 0.35 * rank); rank += 1
            else: fame[nc] += v * min(e, 20) / 400       # guest roles count a little
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
    ct, cp, cr, cc, ce = [], [], [], [], []
    for ti in range(len(titles)):
        for o, nc, role, ch, e in rows.get(ti, []):
            if nc in pix: ct.append(ti); cp.append(pix[nc]); cr.append(role); cc.append(ch); ce.append(e)

    out = {
        'format': 'goobs-watchlog-ref', 'v': 1, 'built': datetime.date.today().isoformat(),
        'src': 'IMDb non-commercial datasets (personal, non-commercial use only)',
        'g': gen,
        't': {'id': [int(t[0][2:]) for t in titles], 'k': [t[1] for t in titles], 'n': [t[2] for t in titles], 'y': [t[3] for t in titles],
              'e': [t[4] for t in titles], 'r': [t[6] for t in titles], 'v': [t[7] for t in titles],
              'g': [sum(1 << gi[g] for g in t[5]) for t in titles]},
        'p': {'id': [int(nc[2:]) for nc in pl], 'n': [people[nc][0] for nc in pl], 'b': [people[nc][1] for nc in pl],
              'd': [people[nc][2] for nc in pl], 'f': [round(math.log10(1 + fame[nc]) * 100) for nc in pl]},
        'c': {'t': ct, 'p': cp, 'r': cr, 'ch': cc, 'e': ce},   # r: 0 cast, 1 director, 2 episode cast only; e: episodes (series)
    }
    raw = json.dumps(out, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    with gzip.open(out_path, 'wb', compresslevel=9) as f: f.write(raw)
    g = sum(1 for e in ce if e)
    say(f'done: {len(titles):,} titles, {len(pl):,} people, {len(ct):,} credits ({g:,} with episode counts) '
        f'-> {out_path} ({os.path.getsize(out_path) / 1e6:.1f} MB; {len(raw) / 1e6:.0f} MB unzipped)')


if __name__ == '__main__':
    if len(sys.argv) < 2: sys.exit(__doc__)
    src = sys.argv[1]
    build(src, sys.argv[2] if len(sys.argv) > 2 else os.path.join(src, 'watchlog-database.json.gz'))
