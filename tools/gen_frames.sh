#!/bin/sh
# Rebuilds frames/ from hooks/creatures.ts. Needs bun and Pillow (PYTHON=path/to/python3).
set -e
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
bun tools/dump.ts "$tmp/dump.json"
rm -f frames/*.png
"${PYTHON:-python3}" -I tools/gen_frames.py "$tmp/dump.json" frames
rm -rf "$tmp"
ls frames | wc -l
