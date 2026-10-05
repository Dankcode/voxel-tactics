#!/usr/bin/env python3
"""Generate PLACEHOLDER 2D art for every character (field sprite atlas, back-shot cut-in layers, portrait).

Replace any PNG with real art of the same size and keep the JSON manifests' layout — the client reads only
the manifests (client/public/assets/characters/<art>/field.json, cutin.json) so frame counts, sizes and
anchors can change without code changes. Run:  python3 tools/art/make_placeholders.py
"""
import json, math, os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'client', 'public', 'assets', 'characters')
FW, FH = 64, 96
FACINGS = ['s', 'sw', 'w', 'nw', 'n', 'ne', 'e', 'se']          # rows; screen-relative ('s' faces the camera)
# clip -> number of frames (columns are laid out in this order)
CLIPS = [('idle', 2, 2, True), ('walk', 4, 8, True), ('aim', 1, 1, True), ('fire', 2, 12, False), ('throw', 2, 6, False),
         ('hit', 1, 1, False), ('down', 1, 1, True), ('stacked', 1, 1, True), ('hunker', 1, 1, True)]
CHARS = {
    'vanguard':   dict(color=(208, 106, 58),  team='player', weapon='blunderbuss', letter='V'),
    'grenadier':  dict(color=(111, 127, 58),  team='player', weapon='repeater', letter='G'),
    'marksman':   dict(color=(58, 111, 168),  team='player', weapon='longrifle', letter='M'),
    'warden':     dict(color=(154, 163, 173), team='player', weapon='crossbow', letter='W', shield=True),
    'cultist':    dict(color=(122, 42, 42),   team='enemy',  weapon='musket', letter='C'),
    'archer':     dict(color=(79, 107, 42),   team='enemy',  weapon='bow', letter='A'),
    'pyromancer': dict(color=(194, 66, 31),   team='enemy',  weapon='lance', letter='P'),
    'brute':      dict(color=(90, 61, 43),    team='enemy',  weapon='maul', letter='B', big=True),
    'guard':      dict(color=(122, 112, 100), team='enemy',  weapon='musket', letter='O', shield=True),
}
TEAM = {'player': (64, 220, 230), 'enemy': (240, 70, 70)}
DIRV = {'s': (0, 1), 'sw': (-0.7, 0.7), 'w': (-1, 0), 'nw': (-0.7, -0.7), 'n': (0, -1), 'ne': (0.7, -0.7), 'e': (1, 0), 'se': (0.7, 0.7)}
INK = (24, 20, 18, 255)
try:
    FONT = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 14)
    SMALL = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 18)
    BIG = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 40)
except OSError:
    FONT = SMALL = BIG = ImageFont.load_default()

def shade(c, k): return tuple(max(0, min(255, int(v * k))) for v in c[:3]) + (255,)

def draw_figure(d, ox, oy, ch, facing, clip, frame):
    col = ch['color']; team = TEAM[ch['team']]
    dx, dy = DIRV[facing]
    back = facing in ('n', 'ne', 'nw')
    scale = 1.12 if ch.get('big') else 1.0
    cx = ox + FW // 2
    base = oy + FH - 6
    crouch = 14 if clip in ('stacked', 'hunker') else 0
    if clip == 'down':
        # lying figure
        d.ellipse([ox + 6, base - 14, ox + FW - 6, base - 2], fill=shade(col, 0.8), outline=INK, width=2)
        d.ellipse([ox + 4, base - 16, ox + 18, base - 4], fill=(230, 190, 160, 255), outline=INK, width=2)
        d.line([ox + 20, base - 8, ox + FW - 10, base - 8], fill=shade(col, 0.5), width=2)
        return
    lean = -4 if clip == 'hit' else 0
    step = [0, 3, 0, -3][frame % 4] if clip == 'walk' else 0
    bob = 1 if (clip == 'idle' and frame == 1) else 0
    # legs
    lh = int(26 * scale) - crouch // 2
    d.rectangle([cx - 9 + step, base - lh, cx - 2 + step, base], fill=shade(col, 0.45), outline=INK, width=1)
    d.rectangle([cx + 2 - step, base - lh, cx + 9 - step, base], fill=shade(col, 0.45), outline=INK, width=1)
    # torso
    th = int(30 * scale)
    top = base - lh - th + bob + crouch // 2
    d.rounded_rectangle([cx - 13 + lean, top, cx + 13 + lean, base - lh + 2], radius=6, fill=shade(col, 1.0 if not back else 0.85), outline=INK, width=2)
    d.rectangle([cx - 13 + lean, top + 2, cx + 13 + lean, top + 6], fill=team + (255,))     # team band
    if not back:
        d.text((cx - 5 + lean, top + 8), ch['letter'], font=FONT, fill=(255, 255, 255, 230))
    # head
    hr = int(10 * scale)
    hy = top - hr - 1
    d.ellipse([cx - hr + lean, hy - hr, cx + hr + lean, hy + hr], fill=(232, 194, 160, 255), outline=INK, width=2)
    if back:
        d.chord([cx - hr + lean, hy - hr, cx + hr + lean, hy + hr], 180, 360, fill=shade(col, 0.4))
        d.ellipse([cx - hr + lean, hy - hr + 4, cx + hr + lean, hy + hr], fill=shade(col, 0.35), outline=INK, width=2)
    else:
        ex = int(dx * 4)
        d.ellipse([cx - 5 + ex + lean, hy - 2, cx - 2 + ex + lean, hy + 2], fill=INK)
        if abs(dx) < 0.9:
            d.ellipse([cx + 2 + ex + lean, hy - 2, cx + 5 + ex + lean, hy + 2], fill=INK)
    # weapon: points along the facing; raised when aiming/firing
    raised = clip in ('aim', 'fire')
    wl = {'longrifle': 34, 'repeater': 26, 'blunderbuss': 20, 'musket': 28, 'crossbow': 20, 'bow': 22, 'lance': 30, 'maul': 26}[ch['weapon']]
    wx0, wy0 = cx + lean + int(dx * 6), top + (8 if raised else 16)
    wx1, wy1 = wx0 + int(dx * wl) + (8 if dx == 0 else 0), wy0 + int(dy * wl * 0.45) - (6 if raised else -2)
    if ch['weapon'] == 'bow':
        d.arc([wx1 - 8, wy1 - 14, wx1 + 8, wy1 + 14], 270, 90, fill=(120, 80, 40, 255), width=3)
    elif ch['weapon'] == 'maul':
        d.line([wx0, wy0, wx1, wy1 - 10], fill=(110, 80, 50, 255), width=4)
        d.rectangle([wx1 - 7, wy1 - 18, wx1 + 7, wy1 - 6], fill=(90, 90, 96, 255), outline=INK)
    else:
        d.line([wx0, wy0, wx1, wy1], fill=(70, 55, 45, 255), width=4 if ch['weapon'] in ('blunderbuss', 'repeater') else 3)
    if clip == 'fire' and frame == 0:
        d.ellipse([wx1 - 7, wy1 - 7, wx1 + 7, wy1 + 7], fill=(255, 230, 120, 230))
    if clip == 'throw':
        ay = top - (12 if frame == 0 else 4)
        d.line([cx + 8, top + 6, cx + 14, ay], fill=shade(col, 0.8), width=4)
        d.ellipse([cx + 10, ay - 6, cx + 20, ay + 4], fill=(240, 120, 60, 255), outline=INK)
    if ch.get('shield') and not back:
        sx = cx - 16 - int(dx * 4) + lean
        d.rounded_rectangle([sx - 6, top + 2, sx + 8, top + 26], radius=4, fill=(150, 150, 160, 255), outline=INK, width=2)
    if clip == 'hunker':
        d.line([cx - 10, hy + 2, cx + 10, hy - 4], fill=shade(col, 0.6), width=4)
    if clip == 'hit':
        d.line([cx - 14, top + 4, cx + 14, top + 22], fill=(255, 60, 60, 255), width=3)

def make_field(name, ch):
    cols = sum(c[1] for c in CLIPS)
    img = Image.new('RGBA', (FW * cols, FH * len(FACINGS)), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    clips, col0 = {}, 0
    for clip, frames, fps, loop in CLIPS:
        clips[clip] = {'column': col0, 'frames': frames, 'fps': fps, 'loop': loop}
        for f in range(frames):
            for r, facing in enumerate(FACINGS):
                draw_figure(d, (col0 + f) * FW, r * FH, ch, facing, clip, f)
        col0 += frames
    path = os.path.join(OUT, name)
    os.makedirs(path, exist_ok=True)
    img.save(os.path.join(path, 'field.png'))
    manifest = {'placeholder': True, 'image': 'field.png', 'frameWidth': FW, 'frameHeight': FH, 'columns': cols, 'rows': len(FACINGS),
                'facings': FACINGS, 'mirror': {}, 'anchor': [0.5, 0.06], 'worldHeight': 2.05 if ch.get('big') else 1.9, 'clips': clips,
                'events': {'fire': {'frame': 0, 'event': 'muzzle'}, 'throw': {'frame': 1, 'event': 'release'}}}
    with open(os.path.join(path, 'field.json'), 'w') as f:
        json.dump(manifest, f, indent=1)

def make_cutin(name, ch):
    W, H = 512, 768
    col = ch['color']; team = TEAM[ch['team']]
    layers = {}
    # back: cape / hair mass
    back = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(back)
    d.polygon([(150, 260), (370, 250), (430, 760), (90, 760)], fill=shade(col, 0.45), outline=INK)
    d.ellipse([190, 70, 330, 230], fill=shade(col, 0.3), outline=INK, width=4)
    layers['back'] = back
    # body: shoulders and torso seen from behind
    body = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(body)
    d.rounded_rectangle([140, 230, 380, 620], radius=60, fill=shade(col, 0.95), outline=INK, width=5)
    d.rectangle([140, 250, 380, 275], fill=team + (255,))
    d.ellipse([205, 110, 315, 230], fill=(220, 180, 150, 255), outline=INK, width=4)
    d.chord([205, 110, 315, 230], 180, 360, fill=shade(col, 0.3))
    d.text((170, 640), f'PLACEHOLDER\n{name} — back shot', font=SMALL, fill=(255, 255, 255, 200))
    layers['body'] = body
    # arm + weapon reaching toward the target (upper right)
    arm = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(arm)
    d.line([(350, 300), (470, 200)], fill=shade(col, 0.8), width=36)
    d.line([(400, 250), (W, 120)], fill=(60, 48, 40, 255), width=18 if ch['weapon'] != 'longrifle' else 12)
    layers['arm'] = arm
    # fx: muzzle glow / element ring
    fx = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(fx)
    for r, a in ((70, 60), (45, 120), (22, 220)):
        d.ellipse([W - 40 - r, 120 - r, W - 40 + r, 120 + r], fill=(255, 220, 140, a))
    layers['fx'] = fx
    path = os.path.join(OUT, name, 'cutin')
    os.makedirs(path, exist_ok=True)
    for k, im in layers.items():
        im.save(os.path.join(path, f'{k}.png'))
    manifest = {'placeholder': True, 'width': W, 'height': H,
                # Paint order back-to-front; parallax is how far each layer drifts during the push-in.
                'layers': [{'id': 'back', 'image': 'cutin/back.png', 'parallax': 0.4}, {'id': 'body', 'image': 'cutin/body.png', 'parallax': 0.7},
                           {'id': 'arm', 'image': 'cutin/arm.png', 'parallax': 1.0}, {'id': 'fx', 'image': 'cutin/fx.png', 'parallax': 1.2, 'blend': 'screen'}],
                'anchor': 'lower-left', 'screenHeight': 0.62}
    with open(os.path.join(OUT, name, 'cutin.json'), 'w') as f:
        json.dump(manifest, f, indent=1)

def make_portrait(name, ch):
    im = Image.new('RGBA', (128, 128), shade(ch['color'], 0.35)); d = ImageDraw.Draw(im)
    d.rounded_rectangle([24, 78, 104, 140], radius=18, fill=shade(ch['color'], 1.0), outline=INK, width=3)
    d.ellipse([36, 22, 92, 82], fill=(232, 194, 160, 255), outline=INK, width=3)
    d.ellipse([50, 46, 56, 54], fill=INK); d.ellipse([72, 46, 78, 54], fill=INK)
    d.rectangle([0, 0, 127, 10], fill=TEAM[ch['team']] + (255,))
    d.text((6, 100), ch['letter'], font=BIG, fill=(255, 255, 255, 200))
    im.save(os.path.join(OUT, name, 'portrait.png'))

def main():
    os.makedirs(OUT, exist_ok=True)
    index = {}
    for name, ch in CHARS.items():
        make_field(name, ch); make_cutin(name, ch); make_portrait(name, ch)
        index[name] = {'field': f'{name}/field.json', 'cutin': f'{name}/cutin.json', 'portrait': f'{name}/portrait.png', 'team': ch['team'], 'placeholder': True}
        print('placeholder art:', name)
    with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
        json.dump({'version': 'characters-v1', 'characters': index}, f, indent=1)

if __name__ == '__main__':
    main()
