#!/usr/bin/env python3
"""Merge compact.json + data/cls/*.json → frontend/data/enriched.json."""
import json, glob

compact = json.load(open('data/compact.json'))
cls = {}
for f in sorted(glob.glob('data/cls/*.json')):
    for x in json.load(open(f)):
        cls[x['id']] = x

VALID = {'ai','dev','investing','business','geopolitics','france','health',
         'culture','humor','career','travel','science','books','other'}
missing = 0
out = []
for b in compact:
    c = cls.get(b['id'])
    if not c:
        missing += 1
        c = {'theme': 'other', 'is_book': False, 'books': [], 'summary': ''}
    theme = c.get('theme', 'other')
    if theme not in VALID:
        theme = 'other'
    books = [bk for bk in (c.get('books') or [])
             if isinstance(bk, dict) and bk.get('title')]
    out.append({**b,
                'theme': theme,
                'is_book': bool(c.get('is_book')) or bool(books),
                'books': books,
                'summary': c.get('summary') or ''})

json.dump(out, open('frontend/data/enriched.json', 'w'), ensure_ascii=False)
n_books = sum(1 for x in out if x['is_book'])
print(f"{len(out)} bookmarks, {missing} unclassified, {n_books} book recs")
