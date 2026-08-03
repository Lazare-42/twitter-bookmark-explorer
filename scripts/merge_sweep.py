#!/usr/bin/env python3
"""Merge second-pass book sweep (data/cls2/*) into frontend/data/enriched.json."""
import json, glob

enr = json.load(open('frontend/data/enriched.json'))
byid = {x['id']: x for x in enr}

added = 0
for f in sorted(glob.glob('data/cls2/*.json')):
    for x in json.load(open(f)):
        if not (x.get('is_book') and x.get('books')):
            continue
        b = byid.get(x['id'])
        if b is None or b['is_book']:
            continue
        books = [bk for bk in x['books'] if isinstance(bk, dict) and bk.get('title')]
        if not books:
            continue
        b['is_book'] = True
        b['books'] = books
        added += 1

json.dump(enr, open('frontend/data/enriched.json', 'w'), ensure_ascii=False)
n = sum(1 for x in enr if x['is_book'])
titles = {bk['title'].lower() for x in enr for bk in x['books']}
print(f"sweep added {added} book tweets → total {n} book recs, {len(titles)} distinct titles")
