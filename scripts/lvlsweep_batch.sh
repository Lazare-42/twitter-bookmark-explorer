#!/usr/bin/env bash
# One-off sweep: find images showing a staged levels-framework of AI usage/organization.
set -u
n="$1"
in="data/lvlsweep/batches/${n}.json"
out="data/lvlsweep/cls/${n}.json"
[ -s "$out" ] && exit 0

PROMPT='Input: JSON array of tweets with id, text, and "images" (local file paths). Read EVERY image with the Read tool.

We are hunting for ONE specific kind of content: a STAGED FRAMEWORK OF LEVELS of working with AI / AI in organizations — e.g. diagrams or lists like "Level 1: use AI as tool → Level 2: build workflows → Level 3: AI as collaborator/teammate → Level 4: orchestrate agents → Level 5: AI-native org", maturity ladders, adoption stages, autonomy levels, org charts of humans+agents.

For each tweet output match=true ONLY if its text or an image shows such a staged/leveled framework, with "evidence": one sentence naming the levels seen. Otherwise match=false.

Output ONLY raw JSON array: [{"id":"...","match":false,"evidence":""}]. No fences.'

result=$(cat "$in" | claude -p "$PROMPT" --model claude-haiku-4-5-20251001 --allowedTools "Read" --output-format text 2>/dev/null)
result=$(printf '%s' "$result" | sed -e 's/^```json//' -e 's/^```//' -e 's/```$//')
printf '%s' "$result" | python3 -c '
import json,sys
raw=sys.stdin.read()
s=raw[raw.find("["):raw.rfind("]")+1]
data=json.loads(s)
assert isinstance(data,list)
print(json.dumps(data,ensure_ascii=False))
' > "$out.tmp" 2>/dev/null && mv "$out.tmp" "$out" || { rm -f "$out.tmp"; echo "FAIL $n"; exit 1; }
echo "OK $n"
