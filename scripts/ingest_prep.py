#!/usr/bin/env python3
"""Incremental ingest, step 1: extract NEW bookmarks from a raw export.

Usage: ingest_prep.py <export.json> <run_dir>

- Diffs the export against frontend/data/enriched.json (source of truth for
  processed ids) — only unseen bookmark ids are processed.
- Appends the new compact records to data/compact.json.
- Writes <run_dir>/new.json, a curl config for their media
  (<run_dir>/curl_cfg.txt → data/media/), and pass-1 batches in
  <run_dir>/batches/.
Exits 3 when the export contains nothing new.
"""
import json, os, sys

export_path, run_dir = sys.argv[1], sys.argv[2]
os.makedirs(f'{run_dir}/batches', exist_ok=True)
os.makedirs(f'{run_dir}/cls', exist_ok=True)
os.makedirs('data/media', exist_ok=True)

raw = json.load(open(export_path))
enriched = json.load(open('frontend/data/enriched.json'))
seen = {x['id'] for x in enriched}


def tweet_links(b):
    m = b.get('metadata', {})
    out = []
    for u in (m.get('legacy', {}).get('entities', {}) or {}).get('urls', []):
        if u.get('expanded_url'):
            out.append(u['expanded_url'])
    try:
        es = m['note_tweet']['note_tweet_results']['result']['entity_set']
        for u in es.get('urls', []):
            if u.get('expanded_url'):
                out.append(u['expanded_url'])
    except Exception:
        pass
    return out


def compact(b):
    m = b.get('metadata', {})
    long_text = None
    try:
        long_text = m['note_tweet']['note_tweet_results']['result']['text']
    except Exception:
        pass
    return {
        'id': b['id'], 'created_at': b['created_at'],
        'text': long_text or b.get('full_text') or '',
        'screen_name': b.get('screen_name'), 'name': b.get('name'),
        'avatar': b.get('profile_image_url'), 'url': b.get('url'),
        'media': [{'type': x.get('type'), 'thumb': x.get('thumbnail'),
                   'orig': x.get('original')} for x in (b.get('media') or [])],
        'quoted': b.get('quoted_status'),
        'likes': b.get('favorite_count'), 'views': b.get('views_count'),
        'links': tweet_links(b),
    }


new = [compact(b) for b in raw if b['id'] not in seen]
if not new:
    print('no new bookmarks in export')
    sys.exit(3)

comp = json.load(open('data/compact.json'))
comp_ids = {x['id'] for x in comp}
comp.extend(x for x in new if x['id'] not in comp_ids)
json.dump(comp, open('data/compact.json', 'w'), ensure_ascii=False, indent=0)
json.dump(new, open(f'{run_dir}/new.json', 'w'), ensure_ascii=False)

# media: photos (small) + video/gif preview thumbs, max 2 per tweet
with open(f'{run_dir}/curl_cfg.txt', 'w') as f:
    for x in new:
        for i, m in enumerate(x['media'][:2]):
            if not m['thumb']:
                continue
            if m['type'] == 'photo':
                url = m['thumb'].replace('name=thumb', 'name=small')
                path = f"data/media/{x['id']}_{i}.jpg"
            else:
                url = m['thumb']
                path = f"data/media/{x['id']}_v{i}.jpg"
            if not os.path.exists(path):
                f.write(f'url = "{url}"\noutput = "{path}"\n')

watermark = max(x['created_at'] for x in new)
print(f"{len(new)} new bookmarks (newest: {watermark})")
