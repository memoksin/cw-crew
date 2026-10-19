# python3 -I tools/gen_frames.py dump.json frames/ : one PNG per frame in the dump, blown up UP times
# with nearest-neighbour so the terminal's smooth scaling shrinks it a little instead of blurring it up.
# Opaque, on the crew pane's card colour (CARD in hooks/scene.ts): an Image's cells show the terminal's
# own background, so a transparent frame would cut a hole in its card.
import json, os, sys
from PIL import Image

CLEAR = 0x02000000
SHADOW = 0x03000000
UP = 4
CARD = (0x20, 0x22, 0x2b)
data = json.load(open(sys.argv[1]))
W, H = data.pop('__size')
os.makedirs(sys.argv[2], exist_ok=True)
for name, px in data.items():
    shade = tuple(round(c * (1 - 72 / 255)) for c in CARD)
    im = Image.new('RGB', (W, H), CARD)
    im.putdata([CARD if p == CLEAR else shade if p == SHADOW else ((p >> 16) & 255, (p >> 8) & 255, p & 255) for p in px])
    im.resize((W * UP, H * UP), Image.NEAREST).save(os.path.join(sys.argv[2], name), optimize=True)
