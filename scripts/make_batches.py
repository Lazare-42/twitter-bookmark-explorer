#!/usr/bin/env python3
import json, os, glob

d = json.load(open('data/compact.json'))
os.makedirs('data/batches', exist_ok=True)
os.makedirs('data/cls', exist_ok=True)

BATCH = 12
batches = [d[i:i+BATCH] for i in range(0, len(d), BATCH)]
for n, batch in enumerate(batches):
    items = []
    for x in batch:
        imgs = sorted(glob.glob(f"data/media/{x['id']}_*.jpg"))
        imgs = [os.path.abspath(p) for p in imgs if os.path.getsize(p) > 1000]
        items.append({
            'id': x['id'],
            'author': x['screen_name'],
            'text': x['text'][:800],
            'images': imgs,
        })
    json.dump(items, open(f'data/batches/{n:03d}.json', 'w'), ensure_ascii=False)
print(len(batches), 'batches')
