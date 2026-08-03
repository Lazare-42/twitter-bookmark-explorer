#!/usr/bin/env python3
"""Incremental ingest, step 3: merge a run's classification into enriched.json.

Usage:
  ingest_merge.py pass1 <run_dir>   # merge <run_dir>/cls/* for the run's new
                                    # tweets, then build book-sweep batches in
                                    # <run_dir>/batches2 for unflagged ones
  ingest_merge.py sweep <run_dir>   # merge <run_dir>/cls2/* book finds, update
                                    # data/state.json watermark
"""
import json, os, sys, glob

mode, run_dir = sys.argv[1], sys.argv[2]
enriched = json.load(open('frontend/data/enriched.json'))
byid = {x['id']: x for x in enriched}
new = json.load(open(f'{run_dir}/new.json'))

VALID = {'ai','dev','investing','business','geopolitics','france','health',
         'culture','humor','career','travel','science','books','other'}

if mode == 'pass1':
    cls = {}
    for f in sorted(glob.glob(f'{run_dir}/cls/*.json')):
        for x in json.load(open(f)):
            cls[x['id']] = x
    added = 0
    for b in new:
        if b['id'] in byid:
            continue
        c = cls.get(b['id']) or {'theme': 'other', 'is_book': False,
                                 'books': [], 'summary': ''}
        theme = c.get('theme', 'other')
        books = [bk for bk in (c.get('books') or [])
                 if isinstance(bk, dict) and bk.get('title')]
        enriched.append({**b,
                         'theme': theme if theme in VALID else 'other',
                         'is_book': bool(c.get('is_book')) or bool(books),
                         'books': books,
                         'summary': c.get('summary') or ''})
        added += 1
    json.dump(enriched, open('frontend/data/enriched.json', 'w'),
              ensure_ascii=False)
    # book-sweep batches for the new tweets that pass 1 left unflagged
    os.makedirs(f'{run_dir}/batches2', exist_ok=True)
    os.makedirs(f'{run_dir}/cls2', exist_ok=True)
    byid = {x['id']: x for x in enriched}
    items = []
    for b in new:
        e = byid[b['id']]
        if e['is_book']:
            continue
        imgs = [os.path.abspath(p)
                for p in sorted(glob.glob(f"data/media/{b['id']}_*.jpg"))
                if os.path.getsize(p) > 1000]
        items.append({'id': b['id'], 'text': b['text'][:500], 'images': imgs})
    B = 15
    for n in range(0, len(items), B):
        json.dump(items[n:n + B],
                  open(f'{run_dir}/batches2/{n // B:03d}.json', 'w'),
                  ensure_ascii=False)
    print(f"merged {added} new tweets; sweep batches: {(len(items)+B-1)//B}")

elif mode == 'sweep':
    added = 0
    for f in sorted(glob.glob(f'{run_dir}/cls2/*.json')):
        for x in json.load(open(f)):
            b = byid.get(x['id'])
            if b is None or b['is_book']:
                continue
            books = [bk for bk in (x.get('books') or [])
                     if isinstance(bk, dict) and bk.get('title')]
            if x.get('is_book') and books:
                b['is_book'] = True
                b['books'] = books
                added += 1
    json.dump(enriched, open('frontend/data/enriched.json', 'w'),
              ensure_ascii=False)
    state = {'last_created_at': max(x['created_at'] for x in enriched),
             'total': len(enriched),
             'book_recs': sum(1 for x in enriched if x['is_book']),
             'distinct_titles': len({bk['title'].lower()
                                     for x in enriched for bk in x['books']}),
             'last_run': os.path.basename(run_dir)}
    json.dump(state, open('data/state.json', 'w'), indent=2)
    print(f"sweep added {added}; state: {state}")
