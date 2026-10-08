#!/usr/bin/env python3
"""Mobile texture set: client/public/assets/textures/mobile/ from the full set in .../pbr/.

The mobile look is a cleaner, flatter, painted version of the same materials — designed to read at phone size and to
cost a fraction of the memory: albedo 256 x 256 (from 512), smoothed so per-pixel noise doesn't shimmer when
minified, saturation nudged up a little; normal maps 128 x 128 and flattened toward neutral so lighting stays soft.
About 1/10 of the memory of the full set. Run after tools/art/make_textures.py:

    python3 tools/art/make_mobile_textures.py
"""
import json, os
from PIL import Image, ImageEnhance, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'client', 'public', 'assets', 'textures', 'pbr')
OUT = os.path.join(ROOT, 'client', 'public', 'assets', 'textures', 'mobile')
os.makedirs(OUT, exist_ok=True)
ALBEDO, NORMAL = 256, 128
FLATTEN = 0.55            # how much of the normal map's tilt survives (0 = flat)

count = 0
for name in sorted(os.listdir(SRC)):
    if not name.endswith('.jpg'):
        continue
    im = Image.open(os.path.join(SRC, name)).convert('RGB')
    if name.endswith('_n.jpg'):
        im = im.resize((NORMAL, NORMAL), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.6))
        px = im.load()
        for y in range(NORMAL):
            for x in range(NORMAL):
                r, g, b = px[x, y]
                r = int(128 + (r - 128) * FLATTEN); g = int(128 + (g - 128) * FLATTEN)
                px[x, y] = (r, g, max(b, 200))
        im.save(os.path.join(OUT, name), quality=88)
    else:
        im = im.resize((ALBEDO, ALBEDO), Image.LANCZOS)
        im = im.filter(ImageFilter.SMOOTH_MORE)
        im = ImageEnhance.Color(im).enhance(1.08)
        im = ImageEnhance.Contrast(im).enhance(0.94)
        im.save(os.path.join(OUT, name), quality=86)
    count += 1

manifest = os.path.join(SRC, 'manifest.json')
if os.path.exists(manifest):
    data = json.load(open(manifest))
    data = {'set': 'mobile', 'albedo': ALBEDO, 'normal': NORMAL, 'source': 'pbr', 'textures': data.get('textures', data)}
    json.dump(data, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=1)
print(f'{count} mobile textures -> {OUT}')
