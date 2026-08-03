#!/usr/bin/env python3
"""Incremental ingest, step 2: build pass-1 batches (run after media download).

Usage: ingest_batches.py <run_dir>
"""
import json, os, sys, glob

run_dir = sys.argv[1]
new = json.load(open(f'{run_dir}/new.json'))

BATCH = 12
items = []
for x in new:
    imgs = sorted(glob.glob(f"data/media/{x['id']}_*.jpg"))
    imgs = [os.path.abspath(p) for p in imgs if os.path.getsize(p) > 1000]
    items.append({'id': x['id'], 'author': x['screen_name'],
                  'text': x['text'][:800], 'images': imgs,
                  'links': x.get('links') or []})
for n in range(0, len(items), BATCH):
    json.dump(items[n:n + BATCH],
              open(f'{run_dir}/batches/{n // BATCH:03d}.json', 'w'),
              ensure_ascii=False)
print((len(items) + BATCH - 1) // BATCH, 'batches')
