#!/usr/bin/env python3
"""Download short descriptions for Watch Log's offline movie & TV database (run in Terminal on your Mac).

    python3 fetch_watchlog_descriptions.py ~/Downloads

It reads ~/Downloads/watchlog-database.json.gz to see which titles need one, then:
  1. TV shows: TVMaze's public show index (free, no key; about 300 pages, a few minutes). Text is CC BY-SA, credited in the app.
  2. Everything else with 200+ IMDb votes (and shows TVMaze didn't have): TMDB, one request per title, using your TMDB key.
     About an hour the first time; it asks for the key (nothing is saved) or reads it from the TMDB_KEY environment variable.

Downloads are kept in ~/Downloads/watchlog-descriptions.json.gz, and the descriptions are written into
watchlog-database.json.gz itself: import that in Watch Log (Backup > Replace with a newer file). Run it again any time:
titles it already has are skipped, so later runs only fetch new titles. Ctrl-C is safe; progress is saved as it goes.
(build_watchlog_db.py also picks the descriptions file up automatically when you rebuild.)

IMDb, TVMaze and TMDB data are for personal use: keep these files OUT of the public repo.
"""
import getpass, gzip, html, json, os, re, sys, threading, time, urllib.error, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

MIN_VOTES = 200
CHUNK = 1000                 # descriptions per d.N line (the app's DESC_CHUNK)
TVMAZE = os.environ.get('TVMAZE_BASE', 'https://api.tvmaze.com')
TMDB = os.environ.get('TMDB_BASE', 'https://api.themoviedb.org/3')
UA = {'User-Agent': 'goobs-watchlog-descriptions/1 (personal use)'}


def get_json(url, headers=None, tries=6):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={**UA, **(headers or {})}), timeout=30) as r:
                return json.loads(r.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            if e.code == 404: return None
            if e.code in (401, 403): raise SystemExit('TMDB refused the key (HTTP %d). Check it and run again.' % e.code)
            if e.code == 429 or e.code >= 500: time.sleep(min(30, 2 ** i)); continue
            raise
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            time.sleep(min(30, 2 ** i))
    return None


def clean(s):
    s = html.unescape(re.sub(r'<[^>]+>', ' ', s or ''))
    return re.sub(r'\s+', ' ', s).strip()[:1200]


def load_db(path):
    """the titles in the database: tt id -> (kind, votes)"""
    with gzip.open(path, 'rt', encoding='utf-8') as f:
        head = json.loads(f.readline())
        if head.get('format') != 'goobs-watchlog-ref' or head.get('v') != 2: raise SystemExit('That isn\'t a Watch Log database (v2) file.')
        cols = {}
        for line in f:
            k, v = line.split('\t', 1)
            if k in ('t.id', 't.k', 't.v'): cols[k] = json.loads(v)
    return {'tt%07d' % i: (k, v) for i, k, v in zip(cols['t.id'], cols['t.k'], cols['t.v'])}


def short(d):
    """two sentences, at most about 320 characters (same rule as build_watchlog_db.py)"""
    d = (d or '').strip(); m = re.match(r'^(.+?[.!?])(\s+.+?[.!?])?(\s|$)', d)
    d = (m.group(0) if m else d).strip()
    return d if len(d) <= 320 else d[:317].rsplit(' ', 1)[0] + '\u2026'


def add_to_db(db_path, cache):
    """write the descriptions into the database file itself, so it can be imported right away: a t.ds line (where each
    one came from) and d.0, d.1, ... lines of 1,000 titles each, which the app stores one at a time (little memory)"""
    tvm, tmdb = cache.get('tvmaze') or {}, cache.get('tmdb') or {}
    with gzip.open(db_path, 'rt', encoding='utf-8') as f: lines = f.read().split('\n')
    ids = next(json.loads(l.split('\t', 1)[1]) for l in lines if l.startswith('t.id\t'))
    td, tds = [], []
    for i in ids:
        t = 'tt%07d' % i
        d, src = (tvm.get(t), 1) if tvm.get(t) else (tmdb.get(t), 2) if tmdb.get(t) else ('', 0)
        td.append(short(d) if d else ''); tds.append(src)
    keep = [l for l in lines if l and not l.startswith(('t.d\t', 't.ds\t', 'd.'))]
    keep += ['t.ds\t' + json.dumps(tds, separators=(',', ':'))]
    keep += ['d.%d\t' % k + json.dumps(td[k * CHUNK:(k + 1) * CHUNK], ensure_ascii=False, separators=(',', ':')) for k in range((len(td) + CHUNK - 1) // CHUNK)]
    tmp = db_path + '.tmp'
    with gzip.open(tmp, 'wt', encoding='utf-8', compresslevel=9) as f: f.write('\n'.join(keep) + '\n')
    os.replace(tmp, db_path)
    return sum(1 for x in tds if x)


def main():
    if len(sys.argv) < 2: sys.exit(__doc__)
    folder = os.path.expanduser(sys.argv[1])
    db_path, out_path = os.path.join(folder, 'watchlog-database.json.gz'), os.path.join(folder, 'watchlog-descriptions.json.gz')
    if not os.path.exists(db_path): sys.exit('Put watchlog-database.json.gz in %s first.' % folder)
    titles = load_db(db_path)
    print('database: %s titles' % format(len(titles), ','))
    cache = {'v': 1, 'tvmaze': {}, 'tmdb': {}}
    if os.path.exists(out_path):
        with gzip.open(out_path, 'rt', encoding='utf-8') as f: cache.update(json.load(f))
    lock = threading.Lock()

    def save():
        with lock:
            tmp = out_path + '.tmp'
            with gzip.open(tmp, 'wt', encoding='utf-8') as f: json.dump(cache, f, ensure_ascii=False, separators=(',', ':'))
            os.replace(tmp, out_path)

    # 1. TVMaze: every show it knows, with its IMDb id
    if not cache.get('tvmaze_done_at') or time.time() - cache.get('tvmaze_done_at', 0) > 25 * 86400:
        page, n = 0, 0
        while True:
            shows = get_json('%s/shows?page=%d' % (TVMAZE, page))
            if not shows: break
            for s in shows:
                tt = ((s.get('externals') or {}).get('imdb') or '')
                if tt in titles and s.get('summary'): cache['tvmaze'][tt] = clean(s['summary']); n += 1
            page += 1
            print('\rTVMaze: page %d, %s shows matched' % (page, format(len(cache['tvmaze']), ',')), end='', flush=True)
            time.sleep(0.55)                                   # TVMaze allows about 20 requests per 10 seconds
        cache['tvmaze_done_at'] = time.time(); save(); print()

    # 2. TMDB for the rest (200+ votes)
    todo = [tt for tt, (k, v) in titles.items() if v >= MIN_VOTES and tt not in cache['tvmaze'] and tt not in cache['tmdb']]
    print('TMDB: %s titles to look up' % format(len(todo), ','))
    if todo:
        key = os.environ.get('TMDB_KEY') or getpass.getpass('TMDB key (API key or Read Access Token; not saved): ').strip()
        if not key: sys.exit('No key: stopping. TV descriptions from TVMaze are saved.')
        bearer = key.startswith('eyJ')
        hdr = {'Authorization': 'Bearer ' + key} if bearer else {}
        rate, last = 1 / 35, [0.0]                             # about 35 requests a second, under TMDB's limit
        def one(tt):
            with lock:
                wait = last[0] + rate - time.time()
                last[0] = max(time.time(), last[0] + rate)
            if wait > 0: time.sleep(wait)
            q = {'external_source': 'imdb_id', 'language': 'en-US'}
            if not bearer: q['api_key'] = key
            j = get_json('%s/find/%s?%s' % (TMDB, tt, urllib.parse.urlencode(q)), hdr) or {}
            hit = (j.get('movie_results') or j.get('tv_results') or [{}])[0]
            with lock: cache['tmdb'][tt] = clean(hit.get('overview'))
        t0, done = time.time(), 0
        try:
            with ThreadPoolExecutor(8) as ex:
                for i in range(0, len(todo), 400):            # in batches, so Ctrl-C stops within seconds
                    chunk = todo[i:i + 400]
                    list(ex.map(one, chunk)); done += len(chunk)
                    el = time.time() - t0
                    print('\rTMDB: %s of %s  (about %d min left)   ' % (format(done, ','), format(len(todo), ','), (len(todo) - done) * el / done / 60), end='', flush=True)
                    if (i // 400) % 8 == 7: save()
        except KeyboardInterrupt:
            print('\nStopped. Progress saved; run again to continue.')
        save(); print()
    if not todo and os.path.exists(out_path): print('Nothing new to fetch; rewriting the database with the saved descriptions.')
    n = add_to_db(db_path, cache)
    print('Done: %s titles now have a description. Updated %s (%.1f MB): import it in Watch Log (Backup > Replace with a newer file).'
          % (format(n, ','), db_path, os.path.getsize(db_path) / 1e6))


if __name__ == '__main__':
    main()
