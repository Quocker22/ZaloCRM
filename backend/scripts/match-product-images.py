#!/usr/bin/env python3
"""Match KB product names to crawled website product images (by fuzzy name).
Conservative: only emit a match we're confident enough to send proactively.
Writes product-images/_kb_match.json = { kb_name: {web, file, score} }.
"""
import json, re, unicodedata, os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMGDIR = os.path.join(BASE, 'product-images')
STOP = {'led', 'nguon', 'day', 'bong', 'cai', 'tam', 'cuon', 'thanh', 'mau',
        'trang', 'do', 'xanh', 'vang', 'am', 'duc', 'keo', 'vo', 'sac', 'don'}


def norm(s):
    s = unicodedata.normalize('NFD', s.lower())
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    s = re.sub(r'\([^)]*\)', ' ', s)
    s = re.sub(r'[^a-z0-9]+', ' ', s)
    return [t for t in s.split() if len(t) >= 2]


def real_codes(tokens):
    # model codes: >=3 chars, has a digit, not a plain unit like 12v/1m/5a
    return set(t for t in tokens
               if len(t) >= 3 and any(c.isdigit() for c in t)
               and not re.fullmatch(r'\d+[mvaw]', t))


def main():
    with open('/private/tmp/claude-501/-Users-dinhvietquoc-Documents-workspaces-gmaps-scraper-zalocrm/28fb67df-e33e-48b0-8fbe-9ac9956dc4cb/scratchpad/ledmap_full.json') as f:
        web = json.load(f)
    with open(os.path.join(IMGDIR, '_manifest.json')) as f:
        manifest = json.load(f)
    name2file = {m['name']: m['file'] for m in manifest}
    web_norm = [(n, norm(n), name2file.get(n)) for n, _ in web]

    with open('/tmp/kb_names.txt') as f:
        kb = [l.strip() for l in f if l.strip()]

    matches = {}
    for kbname in kb:
        kt = norm(kbname); ks = set(kt); kc = real_codes(kt)
        if not ks:
            continue
        best = None; best_score = 0
        for wname, wt, wfile in web_norm:
            if not wt or not wfile:
                continue
            ws = set(wt); wc = real_codes(wt)
            # if either side has a real model-code, they must share one (blocks 5054 vs 5730)
            if (kc or wc) and not (kc & wc):
                continue
            inter = len(ks & ws)
            if inter == 0:
                continue
            score = inter / max(len(ks), len(ws))
            meaningful = len((ks - STOP) & (ws - STOP))
            if score > best_score:
                best_score = score; best = (wname, wfile, meaningful)
        if not best:
            continue
        wname, wfile, meaningful = best
        wc = real_codes(norm(wname))
        # accept if high overlap, OR (shared real model-code AND decent overlap AND meaningful token).
        # The code-share path still needs score>=0.45 so a shared generic code like "3840"
        # (refresh rate) can't glue P3 to P4.
        if best_score >= 0.7 or (kc and (kc & wc) and best_score >= 0.45 and meaningful >= 1):
            matches[kbname] = {'web': wname, 'file': wfile, 'score': round(best_score, 2)}

    with open(os.path.join(IMGDIR, '_kb_match.json'), 'w') as f:
        json.dump(matches, f, ensure_ascii=False)
    print('matched %d / %d KB names (%d%%)' % (len(matches), len(kb), 100 * len(matches) // len(kb)))
    bad = [(k, matches[k]['web']) for k in matches if '5054' in k.lower() and '5730' in matches[k]['web'].lower()]
    print('bad 5054->5730:', bad or 'NONE')
    for k in list(matches)[:6]:
        print('  %s -> %s (s=%s)' % (k[:38], matches[k]['web'][:38], matches[k]['score']))


if __name__ == '__main__':
    main()
