# python3 -I tools/gen_frames.py dump.json frames/ : one RGBA PNG per frame in the dump, blown up UP times
# with nearest-neighbour so the terminal's smooth scaling shrinks it a little instead of blurring it up.
import json, os, sys
from PIL import Image

CLEAR = 0x02000000
SHADOW = 0x03000000
UP = 4
data = json.load(open(sys.argv[1]))
W, H = data.pop('__size')
os.makedirs(sys.argv[2], exist_ok=True)
for name, px in data.items():
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    im.putdata([(0, 0, 0, 0) if p == CLEAR else (0, 0, 0, 72) if p == SHADOW else ((p >> 16) & 255, (p >> 8) & 255, p & 255, 255) for p in px])
    im.resize((W * UP, H * UP), Image.NEAREST).save(os.path.join(sys.argv[2], name), optimize=True)
