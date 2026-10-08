#!/usr/bin/env python3
"""Generate PLACEHOLDER 2D art for every character: field sprite atlas, back-shot cut-in layers, portrait.

v3 (present day): the squad are modern tactical operators (helmets with goggles / comms headsets, plate
carriers with pouches, gloves, knee pads, muted colours, cyan team accents); the hostiles are "the Syndicate",
a modern criminal crew (hoodies, jackets, coveralls, riot gear, red team accents). Every body part is a vector
shape rasterised at 4x, shaded as a soft volume ("inflated" from its silhouette: distance transform → normal →
key light from the upper left, rim light, thin dark edge) and downsampled, so the placeholders read like
illustrated units rather than pixel art. Weapons are drawn from side-profile part lists in their own
(along-barrel, up) frame, so one definition serves every facing, pose, the cut-in and the "down" pose.

Replace any PNG with real art of the same size and keep the JSON manifests' layout — the client reads only
the manifests (client/public/assets/characters/<art>/field.json, cutin.json) so frame counts, sizes and
anchors can change without code changes. Run:  python3 tools/art/make_placeholders.py
    ONLY=<id>   regenerate one character (manifest.json is left untouched)
    --sheet     also write docs/characters-contact-sheet.png (idle s/sw, aim, fire, portrait, cut-in)
"""
import json, math, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'client', 'public', 'assets', 'characters')
FW, FH = 128, 192           # frame size in the atlas
S = 4                       # supersampling
FACINGS = ['s', 'sw', 'w', 'nw', 'n', 'ne', 'e', 'se']          # rows; screen-relative ('s' faces the camera)
THETA = {'s': 0, 'sw': 45, 'w': 90, 'nw': 135, 'n': 180, 'ne': -135, 'e': -90, 'se': -45}
# clip -> frames, fps, loop (columns are laid out in this order)
CLIPS = [('idle', 2, 2, True), ('walk', 4, 8, True), ('aim', 1, 1, True), ('fire', 2, 12, False), ('throw', 2, 6, False),
         ('hit', 1, 1, False), ('down', 1, 1, True), ('stacked', 1, 1, True), ('hunker', 1, 1, True)]
TEAM = {'player': (70, 214, 255), 'enemy': (255, 84, 70)}

# Palette helpers ------------------------------------------------------------------------------------------
BLK = (44, 46, 50)          # polymer / black furniture
GUN = (70, 74, 82)          # gun metal
STEEL = (120, 124, 130)
FDE = (152, 130, 96)        # flat dark earth furniture
WOOD = (132, 86, 50)
DENIM = (64, 84, 118)

# Character kits. head / torso / legs / weapon select drawing routines below; colours are the costume.
#   bulk widens the build; big=True also makes the unit taller in the world (manifest worldHeight).
CHARS = {
    # --- player squad: XCOM-style operators ---------------------------------------------------------------
    'vanguard':   dict(team='player', letter='V', rank=2, bulk=1.0, skin=(214, 168, 132), hair=(58, 44, 34),
                       top=(92, 100, 90), pants=(84, 90, 78), boots=(62, 52, 42), gloves=(54, 52, 48),
                       gear=(140, 122, 92), helm=(126, 112, 86),
                       head='fast', torso='carrier', legs='tactical', weapon='shotgun'),
    'grenadier':  dict(team='player', letter='G', rank=3, bulk=1.12, skin=(150, 104, 74), hair=(30, 24, 22),
                       top=(100, 104, 82), pants=(90, 94, 74), boots=(56, 48, 40), gloves=(50, 50, 46),
                       gear=(80, 92, 66), helm=(86, 94, 72),
                       head='fast_heavy', torso='heavy', legs='tactical', weapon='lmg', back='pack'),
    'marksman':   dict(team='player', letter='M', rank=2, bulk=0.96, skin=(232, 196, 164), hair=(150, 104, 60),
                       top=(146, 132, 102), pants=(112, 104, 82), boots=(92, 74, 54), gloves=(84, 74, 58),
                       gear=(98, 94, 72), helm=(134, 122, 92), wrap=(98, 108, 70),
                       head='boonie', torso='rig', legs='tactical', weapon='sniper'),
    'warden':     dict(team='player', letter='W', rank=3, bulk=1.1, skin=(196, 150, 112), hair=(40, 30, 26),
                       top=(64, 70, 80), pants=(60, 64, 72), boots=(42, 40, 40), gloves=(40, 40, 42),
                       gear=(50, 54, 60), helm=(66, 72, 82),
                       head='visor', torso='heavy', legs='tactical', weapon='carbine', shield='ballistic'),
    # --- the Syndicate: modern criminal crew ---------------------------------------------------------------
    'cultist':    dict(team='enemy', letter='C', bulk=1.0, skin=(196, 146, 108), hair=(30, 26, 24),
                       top=(70, 70, 76), pants=DENIM, boots=(226, 224, 218), gloves=None, gear=(34, 34, 38),
                       head='balaclava', torso='hoodie', legs='jeans', shoes='sneaker', weapon='ak'),
    'archer':     dict(team='enemy', letter='A', bulk=0.98, skin=(232, 192, 160), hair=(110, 74, 44),
                       top=(116, 94, 66), shirt=(196, 192, 182), pants=(54, 64, 86), boots=(86, 64, 44), gloves=None,
                       head='cap', torso='jacket', legs='jeans', weapon='hunting'),
    'pyromancer': dict(team='enemy', letter='P', bulk=1.04, skin=(190, 140, 100), hair=(40, 30, 26),
                       top=(160, 104, 58), pants=(160, 104, 58), boots=(50, 42, 36), gloves=(84, 66, 48),
                       gear=(42, 44, 46), helm=(54, 54, 58),
                       head='gasmask', torso='coveralls', legs='work', weapon='flamer', back='tanks'),
    'brute':      dict(team='enemy', letter='B', bulk=1.26, big=True, skin=(176, 124, 92), hair=(36, 28, 24),
                       top=(42, 38, 36), shirt=(96, 94, 92), pants=(60, 60, 58), boots=(44, 38, 34), gloves=None,
                       head='bald', torso='leather', legs='cargo', weapon='sledge', bare_arms=True),
    'guard':      dict(team='enemy', letter='O', bulk=1.1, skin=(222, 180, 146), hair=(60, 44, 34),
                       top=(46, 48, 52), pants=(42, 44, 48), boots=(30, 30, 32), gloves=(34, 34, 36),
                       gear=(38, 40, 44), helm=(36, 38, 42),
                       head='riot', torso='riot', legs='riot', weapon='carbine_r', shield='riot'),
}
GK = 1.3                    # weapon scale in the field atlas (gun units → px)
LIGHT = np.array([-0.55, -0.65, 0.52]); LIGHT = LIGHT / np.linalg.norm(LIGHT)
try:
    SMALL = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 18)
    BIG = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 22)
except OSError:
    SMALL = BIG = ImageFont.load_default()


# ------------------------------------------------------------------------------------------------ painter
class Canvas:
    """RGBA float canvas at supersampled resolution; shapes are given in final-frame units."""
    def __init__(self, w, h, scale=S):
        self.w, self.h, self.s = w, h, scale
        self.img = np.zeros((h * scale, w * scale, 4), dtype=np.float32)

    def _mask(self, kind, geom, width=0):
        s = self.s
        xs = [p[0] for p in geom] if kind in ('poly', 'line') else [geom[0], geom[2]]
        ys = [p[1] for p in geom] if kind in ('poly', 'line') else [geom[1], geom[3]]
        pad = width / 2 + 3
        x0 = max(0, int((min(xs) - pad) * s)); y0 = max(0, int((min(ys) - pad) * s))
        x1 = min(self.w * s, int((max(xs) + pad) * s) + 1); y1 = min(self.h * s, int((max(ys) + pad) * s) + 1)
        if x1 <= x0 or y1 <= y0:
            return None, (0, 0)
        m = Image.new('L', (x1 - x0, y1 - y0), 0)
        d = ImageDraw.Draw(m)
        tr = lambda p: ((p[0] * s - x0), (p[1] * s - y0))
        if kind == 'poly':
            d.polygon([tr(p) for p in geom], fill=255)
        elif kind == 'ellipse':
            a, b = tr((geom[0], geom[1])), tr((geom[2], geom[3]))
            d.ellipse([min(a[0], b[0]), min(a[1], b[1]), max(a[0], b[0]), max(a[1], b[1])], fill=255)
        elif kind == 'line':
            pts = [tr(p) for p in geom]
            d.line(pts, fill=255, width=max(1, int(width * s)), joint='curve')
            r = width * s / 2
            for p in (pts[0], pts[-1]):
                d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=255)
        return np.asarray(m, dtype=np.float32) / 255.0, (x0, y0)

    def shape(self, kind, geom, color, width=0, gloss=0.25, flat=False, alpha=1.0, edge=0.55, soft=1.0):
        mask, (x0, y0) = self._mask(kind, geom, width)
        if mask is None or mask.max() <= 0:
            return
        col = np.array(color[:3], dtype=np.float32) / 255.0
        if flat:
            rgb = np.ones(mask.shape + (3,), np.float32) * col
        else:
            # Inflate the silhouette into a soft volume and light it.
            dist = ndimage.distance_transform_edt(mask > 0.5)
            r = max(2.0, dist.max())
            h = np.sqrt(np.clip(dist / r, 0, 1)) * r * 0.9 * soft
            if r > 10:      # soften the medial-axis ridges a distance transform leaves on big shapes
                h = ndimage.gaussian_filter(h, sigma=r * 0.18) * (mask > 0.5)
            gy, gx = np.gradient(h)
            n = np.dstack([-gx, -gy, np.ones_like(h) * 1.2])
            n /= np.linalg.norm(n, axis=2, keepdims=True)
            diff = np.clip((n * LIGHT).sum(2), 0, 1)
            shade_ = 0.52 + 0.62 * diff
            spec = diff ** 18 * gloss
            rim = np.clip(1 - dist / (2.2 * self.s), 0, 1) * np.clip(-(n[..., 0] * 0.8 + n[..., 1] * 0.3), 0, 1) * 0.35
            rgb = col * shade_[..., None] + spec[..., None] + rim[..., None] * np.array([0.55, 0.75, 1.0])
            # Thin dark edge.
            inner = ndimage.binary_erosion(mask > 0.5, iterations=max(1, self.s // 2 + 1))
            edge_m = (mask > 0.5) & ~inner
            rgb[edge_m] *= edge
        a = mask * alpha
        region = self.img[y0:y0 + mask.shape[0], x0:x0 + mask.shape[1]]
        region[..., :3] = region[..., :3] * (1 - a[..., None]) + np.clip(rgb, 0, 1) * a[..., None]
        region[..., 3] = region[..., 3] * (1 - a) + a

    def poly(self, pts, color, **k): self.shape('poly', pts, color, **k)
    def ellipse(self, box, color, **k): self.shape('ellipse', box, color, **k)
    def line(self, pts, color, width, **k): self.shape('line', pts, color, width=width, **k)
    def circle(self, x, y, r, color, **k): self.shape('ellipse', (x - r, y - r, x + r, y + r), color, **k)
    def oval(self, x, y, rx, ry, color, **k): self.shape('ellipse', (x - rx, y - ry, x + rx, y + ry), color, **k)

    def glow(self, cx, cy, r, color, strength=1.0):
        s = self.s
        yy, xx = np.mgrid[0:self.h * s, 0:self.w * s]
        d = np.hypot(xx - cx * s, yy - cy * s) / (r * s)
        a = np.clip(1 - d, 0, 1) ** 2 * strength
        col = np.array(color, np.float32) / 255.0
        self.img[..., :3] = np.clip(self.img[..., :3] + col * a[..., None], 0, 1)
        self.img[..., 3] = np.clip(self.img[..., 3] + a * 0.9, 0, 1)

    def image(self):
        im = Image.fromarray((np.clip(self.img, 0, 1) * 255).astype(np.uint8), 'RGBA')
        return im.resize((self.w, self.h), Image.LANCZOS)


def band(cv, a, c, t0, t1, w, col, gloss=0.3, flat=False):
    """A sleeve band (armband, forearm guard, patch) between fractions t0..t1 of segment a→c, square ends."""
    dx, dy = c[0] - a[0], c[1] - a[1]
    L = math.hypot(dx, dy) or 1
    nx, ny = -dy / L * w / 2, dx / L * w / 2
    p0 = (a[0] + dx * t0, a[1] + dy * t0); p1 = (a[0] + dx * t1, a[1] + dy * t1)
    cv.poly([(p0[0] + nx, p0[1] + ny), (p1[0] + nx, p1[1] + ny), (p1[0] - nx, p1[1] - ny), (p0[0] - nx, p0[1] - ny)], col, gloss=gloss, flat=flat)


def shade(c, k): return tuple(max(0, min(255, int(v * k))) for v in c[:3])
def mix(a, b, t): return tuple(int(a[i] * (1 - t) + b[i] * t) for i in range(3))


# ------------------------------------------------------------------------------------------------ weapons
# Side profiles in gun units (≈ px at field scale): u runs along the barrel (0 = pistol grip, − toward the
# butt, + toward the muzzle), v is "up" on the gun. Each part: (kind, geometry, colour, options).
#   kind 'p' polygon [(u, v)...], 'l' polyline [(u, v)...] + width, 'o' oval (u, v, ru, rv).
def _ar(stock, mag, furn, muzzle_len=31, optic='red', supp=False):
    parts = [('p', [(-16, -1.5), (-16, 5), (-13, 5.2), (-6, 3.6), (-6, 0.6)], stock, {}),
             ('p', [(-6, 4.2), (10, 4.2), (10, -0.2), (-6, -0.2)], BLK, {'gloss': 0.4}),
             ('p', [(-3.5, 0), (0, 0), (-2, -6.5), (-5.5, -6.5)], BLK, {}),
             ('p', [(3, 0), (7, 0), (8.5, -8.5), (4.5, -9)], mag, {}),
             ('p', [(10, 4), (24, 4), (24, -0.2), (10, -0.2)], furn, {'gloss': 0.3}),
             ('l', [(24, 2), (muzzle_len, 2)], GUN, {'w': 1.8, 'gloss': 0.8})]
    if supp:
        parts.append(('l', [(23, 2), (muzzle_len, 2)], (34, 36, 40), {'w': 4.2, 'gloss': 0.6}))
    if optic == 'red':
        parts += [('p', [(0, 4), (7, 4), (7, 7.6), (0, 7.6)], BLK, {'gloss': 0.5})]
    return parts


WEAPONS = {
    # Assault: combat shotgun with tan pump.
    'shotgun': dict(muzzle=33, support=17, stock=17, parts=[
        ('p', [(-17, -2), (-17, 5), (-14, 5.4), (-5, 3.8), (-5, 0)], BLK, {}),
        ('p', [(-5, 4.6), (9, 4.6), (9, -0.6), (-5, -0.6)], BLK, {'gloss': 0.4}),
        ('p', [(-3.5, -0.4), (0, -0.4), (-2, -6.5), (-5.5, -6.5)], BLK, {}),
        ('l', [(8, 3.4), (33, 3.4)], GUN, {'w': 2.6, 'gloss': 0.8}),
        ('l', [(8, 0.6), (27, 0.6)], BLK, {'w': 2.8}),
        ('p', [(12, 2.8), (22, 2.8), (22, -1.8), (12, -1.8)], FDE, {'gloss': 0.3}),
        ('p', [(1, 4.4), (5, 4.4), (5, 6.4), (1, 6.4)], BLK, {})]),
    # Grenadier: heavy rifle with drum and under-barrel launcher.
    'lmg': dict(muzzle=38, support=21, stock=17, heavy=True, parts=[
        ('p', [(-17, -2), (-17, 5.6), (-13, 6), (-6, 4.2), (-6, 0)], FDE, {}),
        ('p', [(-6, 5.2), (14, 5.2), (14, -0.6), (-6, -0.6)], BLK, {'gloss': 0.4}),
        ('p', [(-3.5, -0.4), (0, -0.4), (-2, -6.5), (-5.5, -6.5)], BLK, {}),
        ('o', (6, -5.5, 5, 5.5), BLK, {'gloss': 0.5}),
        ('p', [(14, 4.8), (28, 4.8), (28, -0.4), (14, -0.4)], BLK, {}),
        ('l', [(13, -2.6), (27, -2.6)], (92, 98, 72), {'w': 4.4, 'gloss': 0.4}),
        ('l', [(28, 2.4), (38, 2.4)], GUN, {'w': 2.2, 'gloss': 0.8}),
        ('p', [(0, 5), (9, 5), (9, 8.6), (0, 8.6)], BLK, {'gloss': 0.5})]),
    # Sharpshooter: long bolt rifle with big scope and muzzle brake.
    'sniper': dict(muzzle=48, support=15, stock=20, parts=[
        ('p', [(-20, -2), (-20, 5), (-17, 6.4), (-8, 6.4), (-5, 3), (-5, -1), (-12, -1.5)], FDE, {}),
        ('p', [(-5, 3.6), (9, 3.6), (9, -0.6), (-5, -0.6)], BLK, {'gloss': 0.4}),
        ('p', [(-3.5, -0.6), (0, -0.6), (-2, -6.5), (-5.5, -6.5)], FDE, {}),
        ('p', [(3, -0.6), (7, -0.6), (7, -4.5), (3, -4.5)], BLK, {}),
        ('p', [(9, 3.4), (25, 3.4), (25, -0.8), (9, -0.8)], FDE, {'gloss': 0.3}),
        ('l', [(24, 1.6), (45, 1.6)], GUN, {'w': 1.9, 'gloss': 0.9}),
        ('p', [(44, 3), (48.5, 3), (48.5, 0.2), (44, 0.2)], BLK, {}),
        ('l', [(21, -0.8), (33, -2)], BLK, {'w': 1.2}),
        ('l', [(-4, 7.6), (12, 7.6)], BLK, {'w': 3, 'gloss': 0.6}),
        ('p', [(10, 6), (15.5, 5.4), (15.5, 10.2), (10, 9.4)], BLK, {'gloss': 0.6}),
        ('p', [(-6, 6.4), (-3, 6.2), (-3, 9), (-6, 8.8)], BLK, {}),
        ('p', [(2, 3.6), (4, 3.6), (4, 6.2), (2, 6.2)], GUN, {})]),
    # Breacher: suppressed carbine.
    'carbine': dict(muzzle=35, support=16, stock=16, parts=_ar(BLK, BLK, BLK, muzzle_len=35, supp=True)),
    # Riot Guard: black carbine with red-dot.
    'carbine_r': dict(muzzle=31, support=16, stock=16, parts=_ar(BLK, BLK, (52, 54, 58))),
    # Gunman: AK pattern with wood furniture and curved mag.
    'ak': dict(muzzle=33, support=14, stock=18, parts=[
        ('p', [(-18, -1.5), (-18, 4.8), (-6, 3.6), (-6, 0.4)], WOOD, {'gloss': 0.4}),
        ('p', [(-6, 4.2), (9, 4.2), (9, -0.2), (-6, -0.2)], GUN, {'gloss': 0.5}),
        ('p', [(-3.5, 0), (0, 0), (-2, -6.5), (-5.5, -6.5)], shade(WOOD, 0.7), {}),
        ('p', [(3, 0), (7.5, 0), (10, -5), (13, -9), (8.5, -10.5), (5.5, -5)], (60, 46, 36), {}),
        ('p', [(9, 4), (20, 4), (20, -0.2), (9, -0.2)], WOOD, {'gloss': 0.4}),
        ('l', [(9, 5.4), (22, 5.4)], GUN, {'w': 1.6}),
        ('l', [(20, 2), (33, 2)], GUN, {'w': 1.8, 'gloss': 0.8}),
        ('p', [(28, 2.4), (29.6, 2.4), (29.6, 5.6), (28, 5.6)], GUN, {})]),
    # Lookout: scoped hunting rifle.
    'hunting': dict(muzzle=42, support=13, stock=18, parts=[
        ('p', [(-18, -2.5), (-18, 5), (-14, 5.4), (-6, 3.4), (-3, -0.6), (-10, -2.5)], WOOD, {'gloss': 0.45}),
        ('p', [(-4, 3.6), (8, 3.6), (8, -0.2), (-4, -0.2)], GUN, {'gloss': 0.5}),
        ('p', [(6, 3.2), (22, 3.2), (21, -0.6), (6, -0.6)], WOOD, {'gloss': 0.45}),
        ('l', [(20, 1.8), (42, 1.8)], GUN, {'w': 1.8, 'gloss': 0.9}),
        ('l', [(-2, 7.2), (12, 7.2)], BLK, {'w': 2.6, 'gloss': 0.6}),
        ('p', [(10, 5.8), (14.5, 5.2), (14.5, 9.6), (10, 8.8)], BLK, {'gloss': 0.6}),
        ('l', [(2, 3.6), (2, 6)], GUN, {'w': 1.2})]),
    # Arsonist: flamethrower wand (hose runs to the tanks on the back).
    'flamer': dict(muzzle=35, support=15, stock=8, flame=True, parts=[
        ('l', [(-8, 2), (24, 2)], GUN, {'w': 4, 'gloss': 0.7}),
        ('p', [(-3.5, -0.4), (0, -0.4), (-2, -6.5), (-5.5, -6.5)], BLK, {}),
        ('p', [(-2, 5), (6, 5), (6, -0.6), (-2, -0.6)], (150, 40, 34), {'gloss': 0.5}),
        ('p', [(13, 0), (16.5, 0), (15.5, -6), (12, -6)], BLK, {}),
        ('p', [(23, 4.6), (34, 3.6), (34, 0.4), (23, -0.6)], (52, 54, 58), {'gloss': 0.6}),
        ('l', [(4, 5.4), (20, 5.4)], (90, 94, 100), {'w': 1.2})]),
    # Enforcer: sledgehammer (red fibreglass handle).
    'sledge': dict(muzzle=42, support=16, stock=14, melee=True, parts=[
        ('l', [(-14, 0), (38, 0)], (170, 46, 38), {'w': 3.2, 'gloss': 0.5}),
        ('l', [(-14, 0), (-3, 0)], BLK, {'w': 3.8}),
        ('p', [(36, -8), (45, -8.5), (45, 9.5), (36, 9)], (98, 100, 106), {'gloss': 0.8})]),
}


def gun_frame(d, fore, k):
    """(origin-free) mapping helpers: along-barrel vector and the 'up' perpendicular on screen."""
    px, py = d[1], -d[0]
    if py > 0:
        px, py = -px, -py
    return (d[0] * fore * k, d[1] * fore * k), (px * k, py * k)


def gun_pt(o, ua, va, u, v): return (o[0] + u * ua[0] + v * va[0], o[1] + u * ua[1] + v * va[1])


def draw_gun(cv, kind, o, d, fore=1.0, k=1.0):
    ua, va = gun_frame(d, fore, k)
    P = lambda u, v: gun_pt(o, ua, va, u, v)
    for part, geom, col, opt in WEAPONS[kind]['parts']:
        g = opt.get('gloss', 0.25)
        if part == 'p':
            cv.poly([P(u, v) for u, v in geom], col, gloss=g)
        elif part == 'l':
            cv.line([P(u, v) for u, v in geom], col, opt['w'] * k, gloss=g)
        else:
            u, v, ru, rv = geom
            pts = [P(u + ru * math.cos(t), v + rv * math.sin(t)) for t in np.linspace(0, 2 * math.pi, 20, endpoint=False)]
            cv.poly(pts, col, gloss=g)
    return P


# ------------------------------------------------------------------------------------------------ heads
def draw_head(cv, ch, x, y, r, hx, cz, team, lying=False):
    """Head + headgear centred at (x, y), radius r; hx = screen-sideways facing, cz = toward-camera facing."""
    face_vis = cz > -0.25
    fo = 0.42 * r * hx                       # how far facial features shift toward the facing side
    skin, hair, kind = ch['skin'], ch['hair'], ch['head']
    helm, gear = ch.get('helm', (60, 60, 60)), ch.get('gear', (40, 40, 40))
    sgn = 1 if hx >= 0 else -1
    prof = abs(cz) < 0.55

    def ears():
        for side in (-1, 1):
            if prof and side == sgn:
                continue
            ex = x + side * r * 0.9 * (abs(cz) if not prof else 0) - (hx * r * 0.18 if prof else 0)
            cv.oval(ex, y + r * 0.12, r * 0.2, r * 0.26, shade(skin, 0.92))

    def skull(col, **k): cv.ellipse((x - r * 0.92, y - r, x + r * 0.92, y + r * 1.04), col, **k)

    def face(eyes=True, mouth=True, brows=True):
        if not face_vis:
            return
        if prof:      # nose bump
            cv.poly([(x + hx * r * 0.82, y - r * 0.05), (x + hx * r * 1.06, y + r * 0.32), (x + hx * r * 0.8, y + r * 0.42)], shade(skin, 0.95), gloss=0.1)
        for ex in (-0.36, 0.36):
            if prof and ex * hx < 0:
                continue
            ox = x + ex * r * (0.45 + 0.55 * abs(cz)) + fo
            if eyes:
                cv.oval(ox, y + r * 0.08, r * 0.11, r * 0.13, (34, 28, 28), flat=True)
            if brows:
                cv.line([(ox - r * 0.17, y - r * 0.16), (ox + r * 0.17, y - r * 0.2)], shade(hair, 0.8), r * 0.09, flat=True)
        if mouth:
            cv.line([(x + fo - r * 0.18 * abs(cz), y + r * 0.58), (x + fo + r * 0.18 * abs(cz), y + r * 0.58)], shade(skin, 0.55), r * 0.07, flat=True)

    def headset():
        for side in (-1, 1):
            if prof and side == sgn:
                continue
            ex = x + side * r * 0.92 * (abs(cz) if not prof else 0) - (hx * r * 0.12 if prof else 0)
            cv.oval(ex, y + r * 0.12, r * 0.26, r * 0.32, shade(helm, 0.5), gloss=0.4)
        if face_vis and not prof:     # boom mic
            cv.line([(x - sgn * r * 0.9, y + r * 0.3), (x - sgn * r * 0.5 + fo, y + r * 0.62)], (36, 36, 38), r * 0.09)

    def strobe():
        cv.oval(x - hx * r * 0.5, y - r * 1.1, r * 0.16, r * 0.12, team, flat=True)

    if kind in ('fast', 'fast_heavy'):
        ears(); skull(skin)
        if kind == 'fast_heavy' and face_vis:     # lower-face mask under goggles
            face(eyes=False, mouth=False)
            cv.poly([(x - r * 0.88 + fo * 0.3, y + r * 0.2), (x + r * 0.88 + fo * 0.3, y + r * 0.2), (x + r * 0.6 + fo, y + r * 1.0), (x - r * 0.6 + fo, y + r * 1.0)], shade(ch['gear'], 0.8), gloss=0.1)
        else:
            face()
        dome_w = 1.12 if kind == 'fast_heavy' else 1.06
        cv.ellipse((x - r * dome_w, y - r * 1.24, x + r * dome_w, y + r * 0.22), helm, gloss=0.55)
        cv.line([(x - r * dome_w * 0.98, y - r * 0.1), (x + r * dome_w * 0.98, y - r * 0.1)], shade(helm, 0.7), r * 0.14)
        headset()
        if face_vis:
            gy = y + r * 0.06 if kind == 'fast_heavy' else y - r * 0.62
            cv.line([(x - r * 0.95, gy), (x + r * 0.95, gy)], (36, 36, 38), r * 0.16)
            for ex in (-0.32, 0.32):
                if prof and ex * hx < 0:
                    continue
                cv.oval(x + ex * r * (0.4 + 0.6 * abs(cz)) + fo, gy, r * 0.26 * (0.6 + 0.4 * abs(cz)), r * 0.2, mix((30, 40, 46), team, 0.45), gloss=0.9)
            if kind == 'fast':      # NVG shroud
                cv.poly([(x + fo - r * 0.18, y - r * 1.06), (x + fo + r * 0.18, y - r * 1.06), (x + fo + r * 0.16, y - r * 0.82), (x + fo - r * 0.16, y - r * 0.82)], (38, 38, 40))
        else:
            cv.poly([(x - r * 0.3, y - r * 0.85), (x + r * 0.3, y - r * 0.85), (x + r * 0.3, y - r * 0.5), (x - r * 0.3, y - r * 0.5)], shade(helm, 0.8))
            cv.line([(x - r * 0.95, y - r * 0.6), (x + r * 0.95, y - r * 0.6)], (36, 36, 38), r * 0.14)
        strobe()
    elif kind == 'boonie':
        ears(); skull(skin)
        if not face_vis:
            cv.ellipse((x - r * 0.9, y - r * 0.6, x + r * 0.9, y + r * 0.7), hair)
        face()
        headset()
        cv.ellipse((x - r * 1.6, y - r * 0.62, x + r * 1.6, y - r * 0.04), shade(helm, 0.9), gloss=0.2)
        cv.ellipse((x - r * 0.92, y - r * 1.3, x + r * 0.92, y - r * 0.18), helm, gloss=0.2)
        cv.line([(x - r * 0.9, y - r * 0.38), (x + r * 0.9, y - r * 0.38)], shade(helm, 0.7), r * 0.14)
        cv.oval(x - hx * r * 0.6 - (0 if prof else r * 0.55), y - r * 0.75, r * 0.2, r * 0.13, team, flat=True)
    elif kind == 'visor':
        ears(); skull(skin); face()
        cv.ellipse((x - r * 1.14, y - r * 1.28, x + r * 1.14, y + r * 0.42), helm, gloss=0.6)
        for side in (-1, 1):     # ear armour
            if prof and side == sgn:
                continue
            ex = x + side * r * 0.92 * (abs(cz) if not prof else 0) - (hx * r * 0.15 if prof else 0)
            cv.oval(ex, y + r * 0.2, r * 0.38, r * 0.48, shade(helm, 0.85), gloss=0.4)
        if face_vis:
            vx = x + fo * 0.9
            vw = r * (0.6 + 0.3 * abs(cz))
            cv.poly([(vx - vw, y - r * 0.42), (vx + vw, y - r * 0.42), (vx + vw * 0.9, y + r * 0.9), (vx, y + r * 1.04), (vx - vw * 0.9, y + r * 0.9)], (36, 46, 54), gloss=0.9, alpha=0.86)
            cv.line([(vx - vw * 0.6, y - r * 0.24), (vx + vw * 0.2, y - r * 0.24)], team, r * 0.1, flat=True, alpha=0.9)
        cv.line([(x - r * 1.1, y - r * 0.44), (x + r * 1.1, y - r * 0.44)], shade(helm, 0.65), r * 0.16)
        strobe()
    elif kind == 'balaclava':
        skull(gear, gloss=0.1)
        if face_vis:
            cv.oval(x + fo, y + r * 0.08, r * 0.62 * (0.6 + 0.4 * abs(cz)), r * 0.24, skin, gloss=0.1)
            face(mouth=False, brows=False)
    elif kind == 'cap':
        ears(); skull(skin)
        if not face_vis:
            cv.ellipse((x - r * 0.9, y - r * 0.5, x + r * 0.9, y + r * 0.8), hair)
        face()
        if face_vis:      # sunglasses
            cv.line([(x + fo - r * 0.55 * (0.4 + 0.6 * abs(cz)), y + r * 0.06), (x + fo + r * 0.55 * (0.4 + 0.6 * abs(cz)), y + r * 0.06)], (24, 24, 28), r * 0.26, gloss=0.9)
        cv.ellipse((x - r * 0.98, y - r * 1.2, x + r * 0.98, y - r * 0.16), team, gloss=0.3)
        if face_vis and not prof:
            cv.ellipse((x + fo - r * 0.8, y - r * 0.48, x + fo + r * 0.8, y - r * 0.1), shade(team, 0.75), gloss=0.2)
        elif face_vis or prof:
            cv.poly([(x + hx * r * 0.4, y - r * 0.4), (x + hx * r * 1.55, y - r * 0.22), (x + hx * r * 1.5, y - r * 0.08), (x + hx * r * 0.4, y - r * 0.18)], shade(team, 0.75), gloss=0.2)
        else:
            cv.oval(x, y - r * 0.32, r * 0.24, r * 0.12, (40, 40, 44), flat=True)
    elif kind == 'gasmask':
        ears(); skull(skin)
        cv.ellipse((x - r * 0.98, y - r * 1.2, x + r * 0.98, y - r * 0.05), helm, gloss=0.05)       # beanie
        cv.line([(x - r * 0.96, y - r * 0.3), (x + r * 0.96, y - r * 0.3)], shade(helm, 1.2), r * 0.28, gloss=0.05)
        if face_vis:
            mw = r * (0.62 + 0.25 * abs(cz))
            cv.ellipse((x + fo * 0.8 - mw, y - r * 0.22, x + fo * 0.8 + mw, y + r * 1.0), gear, gloss=0.5)
            for ex in (-0.36, 0.36):
                if prof and ex * hx < 0:
                    continue
                ox = x + ex * r * (0.45 + 0.55 * abs(cz)) + fo
                cv.circle(ox, y + r * 0.16, r * 0.21, (24, 24, 26))
                cv.circle(ox, y + r * 0.16, r * 0.15, mix((60, 30, 30), team, 0.65), gloss=0.9)
            fx_ = x + fo * 1.35
            cv.oval(fx_, y + r * 0.78, r * 0.3 * (0.6 + 0.4 * abs(cz)) + r * 0.12 * (1 - abs(cz)), r * 0.3, (78, 80, 84), gloss=0.6)
            cv.oval(fx_ + hx * r * 0.12, y + r * 0.78, r * 0.16, r * 0.16, (40, 40, 42), flat=True)
        else:
            cv.line([(x - r * 0.9, y + r * 0.15), (x + r * 0.9, y + r * 0.15)], (34, 34, 36), r * 0.16)
    elif kind == 'bald':
        ears(); skull(skin, gloss=0.5)
        cv.ellipse((x - r * 0.88, y - r * 1.0, x + r * 0.88, y - r * 0.25), hair, alpha=0.32, flat=True)
        if face_vis:
            cv.poly([(x + fo - r * 0.75, y + r * 0.3), (x + fo + r * 0.75, y + r * 0.3), (x + fo + r * 0.5, y + r * 0.95), (x + fo, y + r * 1.1), (x + fo - r * 0.5, y + r * 0.95)], hair, gloss=0.05)
            cv.line([(x + fo - r * 0.55 * (0.4 + 0.6 * abs(cz)), y + r * 0.06), (x + fo + r * 0.55 * (0.4 + 0.6 * abs(cz)), y + r * 0.06)], (22, 22, 26), r * 0.24, gloss=0.9)
            face(eyes=False, mouth=False)
    elif kind == 'riot':
        ears(); skull(skin); face()
        cv.ellipse((x - r * 1.16, y - r * 1.3, x + r * 1.16, y + r * 0.5), helm, gloss=0.7)
        cv.line([(x - r * 1.14, y - r * 0.34), (x + r * 1.14, y - r * 0.34)], team, r * 0.16, flat=True)
        if face_vis:
            vx = x + fo * 0.9
            vw = r * (0.95 + 0.15 * abs(cz))
            cv.poly([(vx - vw, y - r * 0.55), (vx + vw, y - r * 0.55), (vx + vw * 0.95, y + r * 1.1), (vx - vw * 0.95, y + r * 1.1)], (176, 196, 210), gloss=1.0, alpha=0.32, edge=0.3)
            cv.line([(vx - vw, y - r * 0.55), (vx + vw, y - r * 0.55)], (24, 24, 26), r * 0.14)
        else:
            cv.poly([(x - r * 0.9, y + r * 0.2), (x + r * 0.9, y + r * 0.2), (x + r * 0.8, y + r * 1.1), (x - r * 0.8, y + r * 1.1)], shade(helm, 0.85))


# ------------------------------------------------------------------------------------------------ figure
def draw_figure(cv, ch, facing, clip, frame):
    if clip == 'down':
        return draw_down(cv, ch)
    th = math.radians(THETA[facing])
    hx = -math.sin(th)          # screen-left/right component of facing (−1 left … +1 right)
    cz = math.cos(th)           # toward-camera component (+1 faces the viewer)
    sgn = 1 if hx >= 0 else -1
    b = ch['bulk']
    tall = 1.08 if ch.get('big') else 1.0
    team = TEAM[ch['team']]
    player = ch['team'] == 'player'
    W = WEAPONS[ch['weapon']]
    melee = W.get('melee')
    cx, ground = FW / 2, FH - 10
    crouch = {'stacked': 14, 'hunker': 26}.get(clip, 0)
    bob = 1.5 if (clip == 'idle' and frame == 1) else (1.0 if clip == 'walk' and frame % 2 == 1 else 0)
    lean = -6 * sgn if clip == 'hit' else (2.5 * hx if clip in ('aim', 'fire') and not melee else 0)
    recoil = -3 * hx if (clip == 'fire' and frame == 0 and not melee) else 0
    if melee and clip == 'fire':
        lean = (6 if frame == 0 else 4) * hx

    hip_y = ground - 70 * tall + crouch + bob
    sh_y = ground - 124 * tall + crouch * 1.25 + bob
    hr = 12.4 * (1 + (b - 1) * 0.35) * tall
    head_y = sh_y - 17 * tall - (b - 1) * 4
    tw = 23.5 * b * (0.6 + 0.4 * abs(cz))           # half torso width at the shoulders
    shw = min(1.0, abs(cz) * 1.45)                  # how far apart the shoulders read (0 in profile)
    leg_off = 9 * b * abs(cz) + 2
    sx = cx + lean + recoil
    hxo = sx + 2 * hx + (3 * hx if clip in ('aim', 'fire') and not melee else 0)   # head leans into the stock
    shield_kind = ch.get('shield')
    sleeve = ch['top']
    glove = ch['gloves'] or ch['skin']
    facing_away = cz < -0.35
    prof = abs(cz) < 0.6

    # ---------------------------------------------------------------- weapon placement (shared by arms)
    raised = clip in ('aim', 'fire', 'stacked')
    fore = 0.45 + 0.55 * abs(hx)
    dxs = hx if abs(hx) > 0.05 else 0.35
    if melee:
        if clip in ('aim', 'stacked'):
            d = (-0.5 * sgn, -1.0); grip = (sx + 4 * hx, sh_y + 10)
        elif clip == 'fire' and frame == 0:
            d = (sgn * 1.0, 0.4); grip = (sx + 12 * hx, sh_y + 18)
        elif clip == 'fire':
            d = (sgn * 0.45, 1.0); grip = (sx + 12 * hx, sh_y + 30)
        else:
            d = (dxs * 0.55, 1.0); grip = (sx + 6 * hx + 3 * cz, sh_y + 26)
        fore_w = 0.7 + 0.3 * abs(hx)
    else:
        if raised:
            d = (dxs, 0.16 * cz - 0.04 + (0.32 if clip == 'stacked' else 0))
        elif clip == 'hunker':
            d = (dxs * 0.8, 0.75)
        else:
            d = None
        fore_w = fore
        if raised:
            n_ = math.hypot(*d); d = (d[0] / n_, d[1] / n_)
            pocket = (sx + hx * tw * 0.35 - (0 if prof else 4 * cz), sh_y + (7 if clip != 'stacked' else 9))
            grip = (pocket[0] + d[0] * W['stock'] * fore_w * GK, pocket[1] + d[1] * W['stock'] * fore_w * GK)
            if W.get('flame'):      # flamethrowers are fired from the hip, leaving room for the jet
                d = (d[0], d[1] + 0.12); n_ = math.hypot(*d); d = (d[0] / n_, d[1] / n_)
                grip = (sx - hx * 5 - (0 if prof else 6 * cz), hip_y - 14)
        else:
            # low ready: the weapon lies across the body, muzzle down toward the off side / forward
            ds = sgn if abs(hx) > 0.3 else 1
            d = (ds * 0.8, 0.6) if clip != 'hunker' else (ds * 0.86, 0.5)
            fore_w = 0.74 + 0.26 * abs(hx)
            grip = (sx - ds * 8 * abs(cz) + 3 * hx, sh_y + (30 if clip != 'hunker' else 24))
    n_ = math.hypot(*d); d = (d[0] / n_, d[1] / n_)
    # keep the weapon inside the frame
    k = GK if not (W.get('flame') and raised) else GK * 0.85
    mx = grip[0] + d[0] * W['muzzle'] * fore_w * k
    if mx > FW - 3:
        k = max(0.8 * GK, (FW - 3 - grip[0]) / (d[0] * W['muzzle'] * fore_w))
    elif mx < 3:
        k = max(0.8 * GK, (grip[0] - 3) / (-d[0] * W['muzzle'] * fore_w))
    ua, va = gun_frame(d, fore_w, k)
    GP = lambda u, v: gun_pt(grip, ua, va, u, v)
    tip = GP(W['muzzle'], 2)
    weapon_front = cz > -0.35

    def weapon(front):
        if weapon_front != front:
            return
        draw_gun(cv, ch['weapon'], grip, d, fore_w, k)
        if W.get('flame'):
            cv.glow(tip[0], tip[1], 3.5, (255, 150, 60), 0.9)

    def hose():
        """Flamethrower hose from the back tanks to the wand; painted behind the body so it reads as slung."""
        if not W.get('flame'):
            return
        hose_end = GP(-8, 2)
        tank = (sx - hx * tw * 0.7 + (6 * sgn if not prof else 0), hip_y - 8)
        cv.line([tank, ((tank[0] + hose_end[0]) / 2, max(tank[1], hose_end[1]) + 6), hose_end], (30, 30, 32), 3.4, gloss=0.5)

    # ---------------------------------------------------------------- limbs
    def leg(side):
        hipx = sx + side * leg_off
        phase = [0, 1, 0, -1][frame % 4] if clip == 'walk' else 0
        fwd = phase * 14 * side
        knee = (hipx + fwd * 0.5 * hx + side * 1.2, hip_y + 33 * tall - crouch * 0.4 - abs(fwd) * 0.15)
        foot = (hipx + fwd * hx * 0.9 + (crouch * 0.4 * hx), ground - 4 - (abs(fwd) * 0.18 if phase else 0))
        if crouch:
            knee = (hipx + 11 * hx * (1 if side * sgn > 0 else 0.5) + side * 2, hip_y + 17)
            if clip == 'hunker' and side * sgn < 0:
                foot = (hipx - 6 * hx, ground - 3)
        pc = ch['pants']
        cv.line([(hipx, hip_y), knee], pc, 17 * b)
        cv.line([knee, foot], shade(pc, 0.95), 13.5 * b)
        legs = ch['legs']
        if legs == 'tactical' and not facing_away:       # knee pads + thigh pocket
            cv.oval(knee[0] + 1.5 * hx, knee[1] + 1, 5.6 * b, 5, shade(pc, 0.62), gloss=0.35)
            mid = ((hipx + knee[0]) / 2 + side * 3.5 * abs(cz) - 1.5 * hx, (hip_y + knee[1]) / 2)
            cv.poly([(mid[0] - 3.5, mid[1] - 4), (mid[0] + 3.5, mid[1] - 4), (mid[0] + 3.5, mid[1] + 5), (mid[0] - 3.5, mid[1] + 5)], shade(pc, 0.85), gloss=0.1)
        elif legs == 'riot':
            shin = ((knee[0] + foot[0]) / 2, (knee[1] + foot[1]) / 2 - 2)
            cv.poly([(shin[0] - 6 * b, knee[1] - 4), (shin[0] + 6 * b, knee[1] - 4), (shin[0] + 5 * b, foot[1] - 8), (shin[0] - 5 * b, foot[1] - 8)], (28, 28, 30), gloss=0.7)
        elif legs == 'jeans' and not facing_away:
            cv.line([(hipx + side * 4 * abs(cz) - hx * 2, hip_y + 4), (knee[0] + side * 3 * abs(cz), knee[1])], shade(pc, 1.18), 1.2, flat=True, alpha=0.6)
        elif legs == 'cargo':
            mid = ((hipx + knee[0]) / 2 + side * 4 * abs(cz), (hip_y + knee[1]) / 2)
            cv.poly([(mid[0] - 4, mid[1] - 4), (mid[0] + 4, mid[1] - 4), (mid[0] + 4, mid[1] + 6), (mid[0] - 4, mid[1] + 6)], shade(pc, 0.82))
        bx = foot[0] + 4 * hx
        boot = ch['boots']
        if ch.get('shoes') == 'sneaker':
            cv.poly([(bx - 7, foot[1] - 5), (bx + 7, foot[1] - 5), (bx + 8 + 6 * hx, foot[1] + 3), (bx - 8 + 6 * hx, foot[1] + 3)], boot, gloss=0.3)
            cv.line([(bx - 7 + 6 * hx, foot[1] + 3.4), (bx + 7 + 6 * hx, foot[1] + 3.4)], team, 2.0, flat=True)
        else:
            cv.poly([(bx - 7.5, foot[1] - 9), (bx + 7.5, foot[1] - 9), (bx + 8.5 + 5 * hx, foot[1] + 2), (bx - 8.5 + 5 * hx, foot[1] + 2)], boot, gloss=0.35)
            cv.line([(bx - 8.5 + 5 * hx, foot[1] + 3), (bx + 8.5 + 5 * hx, foot[1] + 3)], shade(boot, 0.5), 2.2)

    support_side = 1 if d[0] > 0.05 else (-1 if d[0] < -0.05 else sgn)
    trig_side = -support_side

    def arm(side, hand, front_hand=True, item=None):
        shx = sx + side * (tw - 1) * shw - hx * 2
        sh = (shx, sh_y + 3)
        dx, dy = hand[0] - sh[0], hand[1] - sh[1]
        L = math.hypot(dx, dy) or 1
        bend = max(0, 34 - L) * 0.55 + 4
        elbow = ((sh[0] + hand[0]) / 2 + side * bend * 0.8 * (0.4 + 0.6 * abs(cz)) - hx * 2,
                 (sh[1] + hand[1]) / 2 + bend * 0.6 + 3)
        upper_col = sleeve if not ch.get('bare_arms') else ch['skin']
        lower_col = sleeve if not ch.get('bare_arms') else ch['skin']
        cv.line([sh, elbow], upper_col, 12 * b)
        if ch.get('bare_arms'):     # t-shirt sleeve
            cv.line([sh, (sh[0] + (elbow[0] - sh[0]) * 0.35, sh[1] + (elbow[1] - sh[1]) * 0.35)], ch['shirt'], 13.5 * b)
        cv.line([elbow, hand], lower_col, 10.5 * b)
        # Syndicate: red armband on the off-hand upper arm
        if not player and side == support_side:
            band(cv, sh, elbow, 0.3, 0.48, 13 * b, team)
        if ch['torso'] == 'riot':     # forearm guard
            band(cv, elbow, hand, 0.2, 0.8, 12 * b, (28, 28, 30), gloss=0.7)
        if item == 'grenade':
            cv.circle(hand[0], hand[1] - 4, 4.6, (84, 96, 66), gloss=0.7)
            cv.line([(hand[0] + 2, hand[1] - 8), (hand[0] + 4, hand[1] - 3)], STEEL, 1.4)
        elif item == 'molotov':
            cv.line([(hand[0], hand[1] + 2), (hand[0] + 1, hand[1] - 9)], (70, 120, 70), 5.2, gloss=0.9)
            cv.line([(hand[0] + 1, hand[1] - 9), (hand[0] + 2, hand[1] - 14)], (210, 196, 170), 2.4)
            cv.glow(hand[0] + 2, hand[1] - 16, 6, (255, 150, 50), 0.8)
        cv.circle(hand[0], hand[1], 4.3 * b, glove, gloss=0.3)

    def arms(front):
        for side in (-1, 1):
            near = (side * hx) <= 0 if prof else True
            draw_front = near if prof else cz > -0.35
            if draw_front != front:
                continue
            if clip == 'throw' and side == trig_side and not melee:
                hand = (sx + side * (tw - 1) * shw + 6 * hx - side * 2, sh_y - (28 if frame == 0 else 6))
                arm(side, hand, item='grenade' if player else 'molotov')
                continue
            if side == trig_side:
                hand = GP(-2, -3.5)
            elif shield_kind:
                hand = shield_pos()[0], shield_pos()[1] + 6
            else:
                hand = GP(W['support'], 0)
            arm(side, hand)

    def shoulders(front):
        for side in (-1, 1):
            near = (side * hx) <= 0 if prof else True
            if near != front:
                continue
            px = sx + side * (tw - 1) * shw - hx * 2
            col = sleeve if not ch.get('bare_arms') else ch['shirt']
            if ch['torso'] in ('heavy', 'riot'):
                col = ch['gear'] if ch['torso'] == 'heavy' else (30, 30, 32)
                cv.ellipse((px - 10.5 * b, sh_y - 6, px + 10.5 * b, sh_y + 10), col, gloss=0.6)
            else:
                cv.ellipse((px - 9 * b, sh_y - 4, px + 9 * b, sh_y + 9), col, gloss=0.3)
            if player and (not prof or near):     # squad shoulder patch
                ox = px + side * 3.5 * b * shw - hx * 1.5
                cv.poly([(ox - 3.2, sh_y), (ox + 3.2, sh_y), (ox + 3.2, sh_y + 4.6), (ox - 3.2, sh_y + 4.6)], team, flat=True)

    # ---------------------------------------------------------------- torso
    def torso():
        top, bottom = sh_y - 2, hip_y + 6
        o = 2.5 * hx
        T, G = ch['top'], ch.get('gear', ch['top'])
        kind = ch['torso']
        base = [(sx - tw * 0.72, top - 3), (sx + tw * 0.72, top - 3), (sx + tw, top + 5), (sx + tw * 0.84, bottom), (sx - tw * 0.84, bottom), (sx - tw, top + 5)]
        if kind == 'hoodie':
            base = [(sx - tw * 0.72, top - 3), (sx + tw * 0.72, top - 3), (sx + tw * 1.02, top + 5), (sx + tw * 0.92, bottom + 4), (sx - tw * 0.92, bottom + 4), (sx - tw * 1.02, top + 5)]
        if kind == 'leather' or kind == 'jacket':
            cv.poly(base, ch['shirt'])
        else:
            cv.poly(base, T)
        front = not facing_away
        # belt
        if kind not in ('hoodie',):
            belt = (40, 38, 36) if kind != 'coveralls' else shade(T, 0.75)
            cv.poly([(sx - tw * 0.86, bottom - 8), (sx + tw * 0.86, bottom - 8), (sx + tw * 0.86, bottom - 2), (sx - tw * 0.86, bottom - 2)], belt, gloss=0.3)
            if front and kind not in ('coveralls',):
                cv.poly([(sx + o - 2.5, bottom - 8), (sx + o + 2.5, bottom - 8), (sx + o + 2.5, bottom - 2), (sx + o - 2.5, bottom - 2)], (150, 146, 136), gloss=0.8)
        if kind in ('carrier', 'heavy', 'rig'):
            if kind != 'rig':
                vw = tw * (0.82 if kind == 'carrier' else 0.9)
                vt, vb = top + 2, bottom - 9
                cv.poly([(sx - vw + o, vt), (sx + vw + o, vt), (sx + vw * 0.98 + o, vb), (sx - vw * 0.98 + o, vb)], G, gloss=0.35)
                if front:
                    # mag pouches on the cummerbund + admin pouch + IR patch
                    n = 3
                    pw = vw * 2 * 0.9 / n
                    for i in range(n):
                        px0 = sx - vw * 0.9 + o + i * pw + 0.6
                        cv.poly([(px0, vb - 15), (px0 + pw - 1.2, vb - 15), (px0 + pw - 1.2, vb - 1), (px0, vb - 1)], shade(G, 1.12), gloss=0.25)
                        cv.line([(px0 + 0.5, vb - 14), (px0 + pw - 1.7, vb - 14)], shade(G, 0.7), 2.2)
                    cv.poly([(sx - vw * 0.42 + o * 1.3, vt + 13), (sx + vw * 0.42 + o * 1.3, vt + 13), (sx + vw * 0.42 + o * 1.3, vt + 23), (sx - vw * 0.42 + o * 1.3, vt + 23)], shade(G, 0.88), gloss=0.2)
                    cv.poly([(sx - vw * 0.62 + o * 1.3, vt + 4), (sx - vw * 0.08 + o * 1.3, vt + 4), (sx - vw * 0.08 + o * 1.3, vt + 10), (sx - vw * 0.62 + o * 1.3, vt + 10)], team, flat=True)
                    if kind == 'heavy':
                        for gx_ in (0.25, 0.62):
                            cv.circle(sx + vw * gx_ + o * 1.3, vt + 7, 3.6, (84, 96, 66), gloss=0.7)
                        cv.poly([(sx - vw * 0.5 + o, bottom - 3), (sx + vw * 0.5 + o, bottom - 3), (sx + vw * 0.35 + o, bottom + 9), (sx - vw * 0.35 + o, bottom + 9)], shade(G, 0.95), gloss=0.3)
                else:
                    cv.poly([(sx - vw * 0.3, vt + 3), (sx + vw * 0.3, vt + 3), (sx + vw * 0.3, vt + 7), (sx - vw * 0.3, vt + 7)], shade(G, 0.7))
                    cv.poly([(sx - vw * 0.45, vt + 12), (sx + vw * 0.45, vt + 12), (sx + vw * 0.45, vt + 18), (sx - vw * 0.45, vt + 18)], team, flat=True, alpha=0.9)
                    cv.poly([(sx - vw * 0.5, vt + 22), (sx + vw * 0.5, vt + 22), (sx + vw * 0.45, vb - 4), (sx - vw * 0.45, vb - 4)], shade(G, 1.1), gloss=0.2)
            else:
                # chest rig over a field jacket + ghillie wrap across the shoulders
                if front:
                    for sd in (-1, 1):
                        cv.line([(sx + sd * tw * 0.55 + o, top), (sx - sd * tw * 0.3 + o, top + 18)], shade(G, 0.8), 3)
                    cv.poly([(sx - tw * 0.78 + o, top + 16), (sx + tw * 0.78 + o, top + 16), (sx + tw * 0.76 + o, top + 30), (sx - tw * 0.76 + o, top + 30)], G, gloss=0.3)
                    for i in range(4):
                        px0 = sx - tw * 0.74 + o + i * tw * 0.37
                        cv.line([(px0 + 1, top + 17), (px0 + tw * 0.37 - 1, top + 17)], shade(G, 0.68), 2.4)
                    cv.poly([(sx - tw * 0.6 + o, top + 6), (sx - tw * 0.2 + o, top + 6), (sx - tw * 0.2 + o, top + 12), (sx - tw * 0.6 + o, top + 12)], team, flat=True)
                else:
                    for sd in (-1, 1):
                        cv.line([(sx + sd * tw * 0.55, top), (sx - sd * tw * 0.4, top + 26)], shade(G, 0.8), 3)
                    cv.poly([(sx - tw * 0.3, top + 8), (sx + tw * 0.3, top + 8), (sx + tw * 0.3, top + 13), (sx - tw * 0.3, top + 13)], team, flat=True)
                wrap = ch['wrap']
                pts = [(sx - tw * 1.05, top + 6), (sx - tw * 0.6, top - 4), (sx + tw * 0.6, top - 4), (sx + tw * 1.05, top + 6)]
                fr = 10
                for i in range(fr + 1):
                    t = i / fr
                    xx = sx + tw * 1.05 - t * tw * 2.1
                    pts.append((xx, top + (12 if i % 2 == 0 else 6) + 3 * math.sin(i * 1.7)))
                cv.poly(pts, wrap, gloss=0.05)
                for i in range(6):
                    xx = sx - tw * 0.8 + i * tw * 0.32
                    cv.line([(xx, top + 1), (xx + 1.5, top + 9)], shade(wrap, 0.75), 1.2, flat=True, alpha=0.7)
        elif kind == 'hoodie':
            if front:
                cv.poly([(sx - tw * 0.55 + o, bottom - 20), (sx + tw * 0.55 + o, bottom - 20), (sx + tw * 0.68 + o, bottom - 4), (sx - tw * 0.68 + o, bottom - 4)], shade(T, 0.85), gloss=0.1)
                for sd in (-3, 3):
                    cv.line([(sx + sd + o, top + 1), (sx + sd * 1.2 + o, top + 14)], (210, 206, 200), 1.2, flat=True)
            else:
                cv.poly([(sx - tw * 0.62, top - 2), (sx + tw * 0.62, top - 2), (sx + tw * 0.48, top + 18), (sx, top + 22), (sx - tw * 0.48, top + 18)], shade(T, 1.08))
            cv.poly([(sx - tw * 0.92, bottom), (sx + tw * 0.92, bottom), (sx + tw * 0.92, bottom + 5), (sx - tw * 0.92, bottom + 5)], shade(T, 0.78), gloss=0.1)
        elif kind == 'jacket':
            if front:
                for sd in (-1, 1):
                    cv.poly([(sx + sd * tw * 0.98, top + 4), (sx + sd * tw * 0.72, top - 3), (sx + sd * tw * 0.16 + o, top - 1), (sx + sd * tw * 0.14 + o, bottom - 8), (sx + sd * tw * 0.86, bottom - 8)], T, gloss=0.2)
                    cv.poly([(sx + sd * tw * 0.7, top - 3), (sx + sd * tw * 0.16 + o, top - 1), (sx + sd * tw * 0.3 + o, top + 11)], shade(T, 0.75))
                    cv.poly([(sx + sd * tw * 0.66 + o, top + 9), (sx + sd * tw * 0.3 + o, top + 9), (sx + sd * tw * 0.3 + o, top + 17), (sx + sd * tw * 0.66 + o, top + 17)], shade(T, 0.88), gloss=0.1)
            else:
                cv.poly(base[:-1] + [(sx - tw, top + 5)], T, gloss=0.2)
                cv.poly([(sx - tw * 0.72, top - 3), (sx + tw * 0.72, top - 3), (sx + tw * 0.6, top + 4), (sx - tw * 0.6, top + 4)], shade(T, 0.75))
            cv.poly([(sx - tw * 0.86, bottom - 8), (sx + tw * 0.86, bottom - 8), (sx + tw * 0.86, bottom - 3), (sx - tw * 0.86, bottom - 3)], shade(T, 0.8))
        elif kind == 'coveralls':
            if front:
                cv.line([(sx + o, top), (sx + o, bottom - 8)], shade(T, 0.7), 1.4, flat=True)
                cv.poly([(sx - tw * 0.6 + o, top + 8), (sx - tw * 0.15 + o, top + 8), (sx - tw * 0.15 + o, top + 17), (sx - tw * 0.6 + o, top + 17)], shade(T, 0.86), gloss=0.1)
                cv.poly([(sx + tw * 0.2 + o, top + 9), (sx + tw * 0.62 + o, top + 9), (sx + tw * 0.62 + o, top + 13), (sx + tw * 0.2 + o, top + 13)], (220, 216, 206), flat=True)
                for sd in (-1, 1):
                    cv.poly([(sx + sd * tw * 0.7, top - 3), (sx + sd * tw * 0.1 + o, top - 1), (sx + sd * tw * 0.25 + o, top + 7)], shade(T, 0.8))
        elif kind == 'leather':
            if front:
                for sd in (-1, 1):
                    cv.poly([(sx + sd * tw * 1.0, top + 4), (sx + sd * tw * 0.72, top - 3), (sx + sd * tw * 0.3 + o, top - 2), (sx + sd * tw * 0.22 + o, bottom - 8), (sx + sd * tw * 0.86, bottom - 8)], T, gloss=0.75)
                cv.line([(sx + o - tw * 0.18, top + 4), (sx + o + tw * 0.18, top + 4)], team, 3, flat=True)
            else:
                cv.poly(base, T, gloss=0.75)
                cv.shape('poly', [(sx - tw * 0.7 + i * tw * 0.14, top + 4 + 4 * math.cos((i - 5) / 5 * 1.2)) for i in range(11)] +
                         [(sx + tw * 0.62 - i * tw * 0.124, top + 9 + 4 * math.cos((5 - i) / 5 * 1.2)) for i in range(11)], team, flat=True)
                cv.circle(sx, top + 22, tw * 0.3, shade(team, 0.85), flat=True)
                cv.circle(sx, top + 22, tw * 0.18, T, flat=True)
        elif kind == 'riot':
            cv.poly([(sx - tw * 0.86 + o, top + 1), (sx + tw * 0.86 + o, top + 1), (sx + tw * 0.8 + o, top + 22), (sx - tw * 0.8 + o, top + 22)], (30, 30, 32), gloss=0.7)
            for i in range(3):
                yy = top + 24 + i * 6.5
                cv.poly([(sx - tw * 0.72 + o, yy), (sx + tw * 0.72 + o, yy), (sx + tw * 0.7 + o, yy + 5.5), (sx - tw * 0.7 + o, yy + 5.5)], (34, 34, 36), gloss=0.6)
            if front:
                cv.line([(sx - tw * 0.6 + o, top + 9), (sx + tw * 0.6 + o, top + 9)], team, 2.6, flat=True)

    def collar():
        if ch['torso'] == 'hoodie' and not facing_away:
            cv.ellipse((sx - tw * 0.62, sh_y - 9, sx + tw * 0.62, sh_y + 5), shade(ch['top'], 1.05))
        if ch['torso'] == 'rig' and not facing_away:   # shemagh
            cv.ellipse((hxo - 9, sh_y - 8, hxo + 9, sh_y + 3), shade(ch['wrap'], 1.15), gloss=0.05)

    def neck():
        nc = ch['skin'] if ch['head'] not in ('balaclava', 'riot') else ch['gear']
        cv.poly([(hxo - 5 * b, head_y + hr * 0.7), (hxo + 5 * b, head_y + hr * 0.7), (hxo + 5.5 * b, sh_y + 1), (hxo - 5.5 * b, sh_y + 1)], shade(nc, 0.86))

    # ---------------------------------------------------------------- back gear & shield
    def back_gear(front):
        kind = ch.get('back')
        if not kind or (facing_away != front):
            return
        off = -hx * tw * 0.75 if not facing_away else 0
        if kind == 'pack':
            pw = tw * (0.78 if not prof else 0.5)
            px = sx + off
            col = shade(ch['gear'], 1.08)
            cv.poly([(px - pw, sh_y - 7), (px + pw, sh_y - 7), (px + pw * 1.04, hip_y - 6), (px - pw * 1.04, hip_y - 6)], col, gloss=0.25)
            if facing_away:
                cv.poly([(px - pw * 0.8, sh_y + 14), (px + pw * 0.8, sh_y + 14), (px + pw * 0.8, hip_y - 12), (px - pw * 0.8, hip_y - 12)], shade(col, 1.1), gloss=0.2)
                cv.ellipse((px - pw * 0.9, sh_y - 13, px + pw * 0.9, sh_y + 1), shade(col, 0.95), gloss=0.2)
                cv.poly([(px - 6, sh_y + 2), (px + 6, sh_y + 2), (px + 6, sh_y + 7), (px - 6, sh_y + 7)], team, flat=True)
        elif kind == 'tanks':
            tw2 = 6.5 * b
            for sd in ((-1, 1) if not prof else (0,)):
                tx = sx + off + sd * tw2 * 1.05
                cv.poly([(tx - tw2, sh_y - 8), (tx + tw2, sh_y - 8), (tx + tw2, hip_y + 2), (tx - tw2, hip_y + 2)], STEEL, gloss=0.8)
                cv.ellipse((tx - tw2, sh_y - 13, tx + tw2, sh_y - 3), STEEL, gloss=0.9)
                cv.line([(tx - tw2 + 0.5, sh_y + 8), (tx + tw2 - 0.5, sh_y + 8)], team, 3.5, flat=True)
                cv.circle(tx, sh_y - 11, 2.2, (40, 40, 42))

    def shield_pos():
        side = support_side
        px = sx + side * tw * 0.62 * abs(cz) + hx * (tw * 0.95 + 5)
        return px, sh_y + 26 + (4 if clip == 'hunker' else 0)

    def shield(front):
        if not shield_kind:
            return
        if (cz > -0.2) != front:
            return
        px, py = shield_pos()
        w = 4 + 13 * abs(cz)
        top_, bot = py - 34, py + 36
        if clip == 'hunker':
            bot = min(bot, ground - 2)
        if shield_kind == 'ballistic':
            cv.poly([(px - w, top_ + 3), (px - w + 3, top_), (px + w - 3, top_), (px + w, top_ + 3), (px + w, bot), (px - w, bot)], (52, 56, 62), gloss=0.5)
            if cz > -0.2:
                vw = w * 0.55
                cv.poly([(px - vw, top_ + 7), (px + vw, top_ + 7), (px + vw, top_ + 13), (px - vw, top_ + 13)], (24, 30, 36), gloss=1.0)
                cv.line([(px - w + 2, top_ + 20), (px + w - 2, top_ + 20)], team, 3, flat=True)
                cv.line([(px - w + 2, bot - 6), (px + w - 2, bot - 6)], shade((52, 56, 62), 0.75), 2)
        else:
            cv.poly([(px - w, top_ + 4), (px - w + 4, top_), (px + w - 4, top_), (px + w, top_ + 4), (px + w, bot), (px - w, bot)], (180, 198, 212), gloss=1.0, alpha=0.38, edge=0.4)
            cv.line([(px - w, top_ + 4), (px - w + 4, top_), (px + w - 4, top_), (px + w, top_ + 4), (px + w, bot), (px - w, bot), (px - w, top_ + 4)], (30, 30, 34), 1.6)
            if cz > -0.2:
                cv.line([(px - w + 2, top_ + 6), (px + w - 2, top_ + 6)], team, 3, flat=True)
                cv.line([(px - w * 0.5, top_ + 12), (px - w * 0.2, top_ + 42)], (255, 255, 255), 1.4, flat=True, alpha=0.35)

    # ---------------------------------------------------------------- paint order
    back_gear(False)
    hose()
    weapon(False); arms(False); shield(False)
    for side in ((-1, 1) if hx >= 0 else (1, -1)):
        leg(side)
    shoulders(False)
    torso()
    collar()
    back_gear(True)
    shoulders(True)
    neck()
    draw_head(cv, ch, hxo, head_y, hr, hx, cz, team)
    weapon(True)
    arms(True)
    shield(True)
    if clip == 'fire':
        if W.get('flame'):
            L = 40 if frame == 0 else 28
            ex, ey = tip[0] + d[0] * L * fore_w, tip[1] + d[1] * L * fore_w
            pxp, pyp = -d[1], d[0]
            sp = 13 if frame == 0 else 9
            cv.poly([tip, (ex + pxp * sp, ey + pyp * sp), (ex - pxp * sp, ey - pyp * sp)], (255, 140, 40), flat=True, alpha=0.75)
            cv.poly([tip, (ex * 0.7 + tip[0] * 0.3 + pxp * sp * 0.4, ey * 0.7 + tip[1] * 0.3 + pyp * sp * 0.4),
                     (ex * 0.7 + tip[0] * 0.3 - pxp * sp * 0.4, ey * 0.7 + tip[1] * 0.3 - pyp * sp * 0.4)], (255, 230, 140), flat=True, alpha=0.85)
            cv.glow((tip[0] + ex) / 2, (tip[1] + ey) / 2, 22, (255, 120, 30), 0.7)
        elif not melee and frame == 0:
            cv.glow(tip[0] + 4 * d[0], tip[1] + 4 * d[1], 13, (255, 210, 120), 1.0)
            cv.poly([(tip[0] + d[0] * 12, tip[1] + d[1] * 12), (tip[0] - d[1] * 4, tip[1] + d[0] * 4), (tip[0] + d[1] * 4, tip[1] - d[0] * 4)], (255, 236, 170), flat=True, alpha=0.9)
    if clip == 'hit':
        cv.glow(sx, sh_y + 20, 26, (255, 60, 50), 0.35)


def draw_down(cv, ch, scale=1.0):
    """Lying on the ground (wounded / dead), seen from the camera."""
    b = ch['bulk']
    g, cx = FH - 10, FW / 2
    team = TEAM[ch['team']]
    T, P = ch['top'], ch['pants']
    if ch.get('back') == 'tanks':
        cv.poly([(cx - 30, g - 26), (cx + 4, g - 26), (cx + 4, g - 14), (cx - 30, g - 14)], STEEL, gloss=0.8)
    elif ch.get('back') == 'pack':
        cv.poly([(cx - 28, g - 25), (cx + 2, g - 25), (cx + 2, g - 12), (cx - 28, g - 12)], shade(ch['gear'], 1.05))
    draw_gun(cv, ch['weapon'], (cx + 14, g - 26), (0.98, 0.18), 1.0, 0.85)
    if ch.get('shield'):
        col = (52, 56, 62) if ch['shield'] == 'ballistic' else (180, 198, 212)
        cv.poly([(cx - 52, g - 2), (cx - 30, g - 14), (cx + 8, g - 10), (cx - 12, g + 4)], col, alpha=1.0 if ch['shield'] == 'ballistic' else 0.45, gloss=0.6)
    cv.line([(cx + 2, g - 14), (cx + 26, g - 16), (cx + 46, g - 12)], P, 12 * b)
    cv.line([(cx + 2, g - 6), (cx + 26, g - 4), (cx + 46, g - 2)], shade(P, 0.92), 12 * b)
    for yy in (g - 12, g - 2):
        cv.poly([(cx + 44, yy - 7), (cx + 52, yy - 8), (cx + 54, yy + 5), (cx + 45, yy + 5)], ch['boots'], gloss=0.35)
    body = [(cx - 34, g - 22 * b), (cx + 6, g - 21 * b), (cx + 8, g - 1), (cx - 34, g)]
    cv.poly(body, T if ch['torso'] not in ('leather', 'jacket') else ch['shirt'])
    if ch['torso'] in ('carrier', 'heavy', 'riot'):
        col = ch['gear'] if ch['torso'] != 'riot' else (30, 30, 32)
        cv.poly([(cx - 28, g - 20 * b), (cx + 2, g - 19 * b), (cx + 3, g - 3), (cx - 28, g - 2)], col, gloss=0.4)
    elif ch['torso'] in ('leather', 'jacket'):
        cv.poly([(cx - 30, g - 21 * b), (cx - 12, g - 21 * b), (cx - 14, g - 1), (cx - 30, g)], T, gloss=0.6 if ch['torso'] == 'leather' else 0.2)
        cv.poly([(cx - 6, g - 21 * b), (cx + 6, g - 21 * b), (cx + 8, g - 1), (cx - 4, g - 1)], T, gloss=0.6 if ch['torso'] == 'leather' else 0.2)
    elif ch['torso'] == 'rig':
        cv.poly([(cx - 30, g - 22), (cx - 4, g - 22), (cx - 4, g - 15), (cx - 30, g - 15)], ch['wrap'])
    arm_col = T if not ch.get('bare_arms') else ch['skin']
    cv.line([(cx - 22, g - 4), (cx - 6, g + 2), (cx + 12, g + 1)], arm_col, 9 * b)
    band(cv, (cx - 22, g - 4), (cx - 6, g + 2), 0.3, 0.55, 10 * b, team, flat=ch['team'] == 'player')
    cv.circle(cx + 13, g + 1, 4.4, ch['gloves'] or ch['skin'])
    draw_head(cv, ch, cx - 44, g - 13, 10.5, -0.35, 0.85, team)


# ------------------------------------------------------------------------------------------------ outputs
def make_field(name, ch):
    cols = sum(c[1] for c in CLIPS)
    atlas = Image.new('RGBA', (FW * cols, FH * len(FACINGS)), (0, 0, 0, 0))
    clips, col0 = {}, 0
    for clip, frames, fps, loop in CLIPS:
        clips[clip] = {'column': col0, 'frames': frames, 'fps': fps, 'loop': loop}
        for f in range(frames):
            for r, facing in enumerate(FACINGS):
                cv = Canvas(FW, FH)
                draw_figure(cv, ch, facing, clip, f)
                atlas.paste(cv.image(), ((col0 + f) * FW, r * FH))
        col0 += frames
    path = os.path.join(OUT, name)
    os.makedirs(path, exist_ok=True)
    atlas.save(os.path.join(path, 'field.png'), optimize=True)
    manifest = {'placeholder': True, 'image': 'field.png', 'frameWidth': FW, 'frameHeight': FH, 'columns': cols, 'rows': len(FACINGS),
                'facings': FACINGS, 'mirror': {}, 'anchor': [0.5, 10 / FH], 'worldHeight': 2.55 if ch.get('big') else 2.4, 'clips': clips,
                'events': {'fire': {'frame': 0, 'event': 'muzzle'}, 'throw': {'frame': 1, 'event': 'release'}}}
    with open(os.path.join(path, 'field.json'), 'w') as f:
        json.dump(manifest, f, indent=1)


def make_cutin(name, ch):
    """Back-shot layers (512 x 768): the character from behind, over the right shoulder, aiming upper right."""
    W_, H = 512, 768
    team = TEAM[ch['team']]
    T, G = ch['top'], ch.get('gear', ch['top'])
    b = min(ch['bulk'], 1.15)
    kind = ch['torso']
    Wd = WEAPONS[ch['weapon']]
    layers = {}
    tw = 130 * b
    cxb = 222

    # back: things on the far side of the body (shield, far arm)
    back = Canvas(W_, H, 2)
    back.line([(cxb - tw + 30, 330), (cxb - tw - 10, 470), (cxb - tw + 50, 560)], T if not ch.get('bare_arms') else ch['skin'], 46)
    if ch.get('shield') == 'ballistic':
        back.poly([(20, 340), (40, 320), (170, 320), (186, 340), (186, 700), (20, 700)], (52, 56, 62), gloss=0.5)
        back.line([(28, 420), (178, 420)], team, 14, flat=True)
    elif ch.get('shield') == 'riot':
        back.poly([(20, 340), (40, 320), (170, 320), (186, 340), (186, 720), (20, 720)], (180, 198, 212), gloss=1.0, alpha=0.4, edge=0.4)
        back.line([(20, 340), (40, 320), (170, 320), (186, 340), (186, 720), (20, 720), (20, 340)], (30, 30, 34), 6)
        back.line([(28, 350), (178, 350)], team, 12, flat=True)
    layers['back'] = back.image()

    # body: torso from behind, back gear, head from behind
    body = Canvas(W_, H, 2)
    torso_c = T
    body.poly([(cxb - tw * 0.72, 280), (cxb + tw * 0.72, 276), (cxb + tw, 320), (cxb + tw * 0.86, 768), (cxb - tw * 0.86, 768), (cxb - tw, 324)], torso_c)
    if kind in ('carrier', 'heavy'):
        body.poly([(cxb - tw * 0.82, 300), (cxb + tw * 0.82, 296), (cxb + tw * 0.8, 640), (cxb - tw * 0.8, 646)], G, gloss=0.35)
        body.poly([(cxb - 40, 316), (cxb + 40, 314), (cxb + 40, 336), (cxb - 40, 338)], shade(G, 0.7))
        body.poly([(cxb - 60, 370), (cxb + 60, 366), (cxb + 60, 400), (cxb - 60, 404)], team, flat=True)
        body.poly([(cxb - 80, 430), (cxb + 80, 426), (cxb + 76, 600), (cxb - 76, 604)], shade(G, 1.1), gloss=0.2)
    elif kind == 'rig':
        for sd in (-1, 1):
            body.line([(cxb + sd * tw * 0.55, 290), (cxb - sd * tw * 0.4, 470)], shade(G, 0.8), 18)
        body.poly([(cxb - 50, 352), (cxb + 50, 348), (cxb + 50, 378), (cxb - 50, 382)], team, flat=True)
    elif kind == 'hoodie':
        body.poly([(cxb - 100, 284), (cxb + 100, 280), (cxb + 80, 400), (cxb, 430), (cxb - 80, 404)], shade(T, 1.08))
    elif kind == 'leather':
        body.poly([(cxb - tw * 0.72, 280), (cxb + tw * 0.72, 276), (cxb + tw, 320), (cxb + tw * 0.86, 768), (cxb - tw * 0.86, 768), (cxb - tw, 324)], T, gloss=0.75)
        body.shape('poly', [(cxb - 110 + i * 22, 330 + 30 * math.cos((i - 5) / 5 * 1.2)) for i in range(11)] +
                   [(cxb + 100 - i * 20, 360 + 30 * math.cos((5 - i) / 5 * 1.2)) for i in range(11)], team, flat=True)
        body.circle(cxb, 470, 56, shade(team, 0.85), flat=True); body.circle(cxb, 470, 34, T, flat=True)
    elif kind == 'jacket':
        body.poly([(cxb - 92, 284), (cxb + 92, 280), (cxb + 80, 320), (cxb - 80, 324)], shade(T, 0.75))
    elif kind == 'riot':
        body.poly([(cxb - tw * 0.84, 296), (cxb + tw * 0.84, 292), (cxb + tw * 0.8, 520), (cxb - tw * 0.8, 524)], (30, 30, 32), gloss=0.7)
        for i in range(3):
            body.poly([(cxb - tw * 0.72, 530 + i * 50), (cxb + tw * 0.72, 528 + i * 50), (cxb + tw * 0.7, 572 + i * 50), (cxb - tw * 0.7, 574 + i * 50)], (34, 34, 36), gloss=0.6)
        body.line([(cxb - 100, 340), (cxb + 100, 336)], team, 14, flat=True)
    elif kind == 'coveralls':
        body.poly([(cxb - 80, 420), (cxb + 80, 416), (cxb + 80, 436), (cxb - 80, 440)], (220, 216, 206), flat=True)
    if ch.get('back') == 'pack':
        body.poly([(cxb - 110, 290), (cxb + 110, 286), (cxb + 116, 700), (cxb - 116, 704)], shade(G, 1.08), gloss=0.25)
        body.ellipse((cxb - 104, 254, cxb + 104, 330), shade(G, 0.95), gloss=0.2)
        body.poly([(cxb - 80, 380), (cxb + 80, 376), (cxb + 80, 600), (cxb - 80, 604)], shade(G, 1.18), gloss=0.2)
        body.poly([(cxb - 34, 330), (cxb + 34, 328), (cxb + 34, 356), (cxb - 34, 358)], team, flat=True)
    elif ch.get('back') == 'tanks':
        for sd in (-1, 1):
            tx = cxb + sd * 62
            body.poly([(tx - 54, 280), (tx + 54, 280), (tx + 54, 720), (tx - 54, 720)], STEEL, gloss=0.8)
            body.ellipse((tx - 54, 236, tx + 54, 320), STEEL, gloss=0.9)
            body.line([(tx - 52, 400), (tx + 52, 400)], team, 26, flat=True)
            body.circle(tx, 256, 16, (40, 40, 42))
    sh_col = ch['gear'] if kind == 'heavy' else ((30, 30, 32) if kind == 'riot' else (ch['shirt'] if ch.get('bare_arms') else T))
    body.ellipse((cxb - tw - 44, 270, cxb - tw + 60, 360), sh_col, gloss=0.5)
    body.ellipse((cxb + tw - 60, 262, cxb + tw + 44, 352), sh_col, gloss=0.5)
    nc = ch['skin'] if ch['head'] not in ('balaclava', 'riot') else ch['gear']
    body.poly([(cxb - 34, 220), (cxb + 34, 220), (cxb + 38, 292), (cxb - 38, 292)], shade(nc, 0.86))
    if kind == 'hoodie':
        body.ellipse((cxb - 96, 250, cxb + 96, 318), shade(T, 1.05))
    draw_head(body, ch, cxb, 176, 74, 0.28, -0.9, team)
    layers['body'] = body.image()

    # arm: right (trigger) arm + weapon, and the support arm reaching past the head to the fore-end
    arm = Canvas(W_, H, 2)
    sleeve = T if not ch.get('bare_arms') else ch['skin']
    glove = ch['gloves'] or ch['skin']
    melee = Wd.get('melee')
    a = math.radians(-30 if not melee else -66)
    d = (math.cos(a), math.sin(a))
    k = 5.3 if not melee else 5.6
    grip = (cxb + tw + 22, 300) if not melee else (cxb + tw + 30, 380)
    ua, va = gun_frame(d, 1.0, k)
    GP = lambda u, v: gun_pt(grip, ua, va, u, v)
    sup = GP(Wd['support'], 0)
    if not ch.get('shield'):
        arm.line([(cxb + 84, 236), ((cxb + 84 + sup[0]) / 2, (236 + sup[1]) / 2 + 18), sup], sleeve, 40)
    if ch['weapon'] == 'flamer':
        arm.line([(cxb + 96, 330), (470, 420), GP(-8, 2)], (30, 30, 32), 16, gloss=0.5)
    draw_gun(arm, ch['weapon'], grip, d, 1.0, k)
    rs = (cxb + tw - 18, 312)
    hand = GP(-2, -3.5)
    elbow = (rs[0] + 62, rs[1] + 92)
    arm.line([rs, elbow], sleeve, 56)
    if ch.get('bare_arms'):
        band(arm, rs, elbow, 0.0, 0.35, 64, ch['shirt'])
    if ch['team'] == 'player':
        band(arm, rs, elbow, 0.12, 0.3, 30, team, flat=True)
    arm.line([elbow, hand], sleeve, 46)
    arm.circle(hand[0], hand[1], 23, glove, gloss=0.3)
    if not ch.get('shield'):
        arm.circle(sup[0], sup[1], 22, glove, gloss=0.3)
    layers['arm'] = arm.image()

    fx = Canvas(W_, H, 1)
    tip = GP(Wd['muzzle'], 2)
    if Wd.get('flame'):
        for i, (rr, c) in enumerate(((140, (255, 110, 30)), (90, (255, 170, 60)), (50, (255, 230, 150)))):
            fx.glow(min(W_ - 20, tip[0] + 40 - i * 20), max(20, tip[1] - 30 + i * 15), rr, c, 1.0)
    elif not Wd.get('melee'):
        fx.glow(min(W_ - 30, tip[0]), max(30, tip[1]), 90, (255, 200, 120), 1.0)
    else:
        fx.glow(min(W_ - 40, tip[0]), max(40, tip[1]), 70, (255, 240, 220), 0.5)
    layers['fx'] = fx.image()
    path = os.path.join(OUT, name, 'cutin')
    os.makedirs(path, exist_ok=True)
    for kk, im in layers.items():
        im.save(os.path.join(path, f'{kk}.png'), optimize=True)
    manifest = {'placeholder': True, 'width': W_, 'height': H,
                # Paint order back-to-front; parallax is how far each layer drifts during the push-in.
                'layers': [{'id': 'back', 'image': 'cutin/back.png', 'parallax': 0.4}, {'id': 'body', 'image': 'cutin/body.png', 'parallax': 0.7},
                           {'id': 'arm', 'image': 'cutin/arm.png', 'parallax': 1.0}, {'id': 'fx', 'image': 'cutin/fx.png', 'parallax': 1.2, 'blend': 'screen'}],
                'anchor': 'lower-left', 'screenHeight': 0.62}
    with open(os.path.join(OUT, name, 'cutin.json'), 'w') as f:
        json.dump(manifest, f, indent=1)


def make_portrait(name, ch):
    """128 x 128 head-and-shoulders, near-front view, on a team-tinted gradient, with a rank / crew mark."""
    cv = Canvas(128, 128, 4)
    team = TEAM[ch['team']]
    yy = np.linspace(0, 1, 128 * 4)[:, None]
    bg = (np.array(shade(team, 0.2)) * (1 - yy) + np.array(shade(team, 0.05)) * yy) / 255.0
    cv.img[..., :3] = bg[:, None, :] * np.ones((1, 128 * 4, 1))
    cv.img[..., 3] = 1
    T, G = ch['top'], ch.get('gear', ch['top'])
    kind = ch['torso']
    b = min(ch['bulk'], 1.15)
    if ch.get('back') == 'tanks':
        for sd in (-1, 1):
            cv.poly([(64 + sd * 34 - 11, 70), (64 + sd * 34 + 11, 70), (64 + sd * 34 + 11, 128), (64 + sd * 34 - 11, 128)], STEEL, gloss=0.8)
            cv.ellipse((64 + sd * 34 - 11, 62, 64 + sd * 34 + 11, 78), STEEL, gloss=0.9)
    if ch.get('shield'):
        col = (52, 56, 62) if ch['shield'] == 'ballistic' else (180, 198, 212)
        cv.poly([(2, 92), (8, 86), (30, 86), (30, 128), (2, 128)], col, gloss=0.6, alpha=1.0 if ch['shield'] == 'ballistic' else 0.45)
    w = 50 * b
    cv.poly([(64 - w * 0.6, 92), (64 + w * 0.6, 92), (64 + w, 104), (64 + w * 1.05, 128), (64 - w * 1.05, 128), (64 - w, 104)],
            ch['shirt'] if kind in ('leather', 'jacket') else T)
    for sd in (-1, 1):
        sc = G if kind == 'heavy' else ((30, 30, 32) if kind == 'riot' else (ch['shirt'] if ch.get('bare_arms') else T))
        cv.ellipse((64 + sd * w * 0.86 - 15, 94, 64 + sd * w * 0.86 + 15, 122), sc, gloss=0.5)
    if kind in ('carrier', 'heavy'):
        cv.poly([(64 - w * 0.66, 100), (64 + w * 0.66, 100), (64 + w * 0.68, 128), (64 - w * 0.68, 128)], G, gloss=0.35)
        for sd in (-1, 1):
            cv.line([(64 + sd * w * 0.52, 98), (64 + sd * w * 0.52, 106)], shade(G, 0.8), 6)
        cv.poly([(64 - w * 0.56, 108), (64 - w * 0.14, 108), (64 - w * 0.14, 115), (64 - w * 0.56, 115)], team, flat=True)
        cv.poly([(64 + w * 0.06, 112), (64 + w * 0.56, 112), (64 + w * 0.56, 128), (64 + w * 0.06, 128)], shade(G, 0.88))
        if kind == 'heavy':
            cv.circle(64 + w * 0.22, 108, 4.5, (84, 96, 66), gloss=0.7); cv.circle(64 + w * 0.42, 108, 4.5, (84, 96, 66), gloss=0.7)
    elif kind == 'rig':
        cv.poly([(64 - w * 0.62, 116), (64 + w * 0.62, 116), (64 + w * 0.62, 128), (64 - w * 0.62, 128)], G, gloss=0.3)
        cv.poly([(64 - w * 0.5, 104), (64 - w * 0.16, 104), (64 - w * 0.16, 110), (64 - w * 0.5, 110)], team, flat=True)
        cv.ellipse((36, 84, 92, 104), shade(ch['wrap'], 1.15), gloss=0.05)
    elif kind == 'hoodie':
        cv.ellipse((34, 82, 94, 104), shade(T, 1.05))
        for sd in (-4, 4):
            cv.line([(64 + sd, 100), (64 + sd * 1.3, 124)], (210, 206, 200), 1.6, flat=True)
    elif kind == 'jacket':
        for sd in (-1, 1):
            cv.poly([(64 + sd * w, 104), (64 + sd * w * 0.6, 92), (64 + sd * 8, 94), (64 + sd * 10, 128), (64 + sd * w * 1.05, 128)], T, gloss=0.2)
            cv.poly([(64 + sd * w * 0.6, 92), (64 + sd * 8, 94), (64 + sd * 16, 112)], shade(T, 0.75))
    elif kind == 'coveralls':
        cv.line([(64, 98), (64, 128)], shade(T, 0.7), 1.6, flat=True)
        for sd in (-1, 1):
            cv.poly([(64 + sd * w * 0.6, 92), (64 + sd * 4, 94), (64 + sd * 12, 106)], shade(T, 0.8))
        cv.poly([(64 + 12, 108), (64 + 34, 108), (64 + 34, 113), (64 + 12, 113)], (220, 216, 206), flat=True)
    elif kind == 'leather':
        for sd in (-1, 1):
            cv.poly([(64 + sd * w, 104), (64 + sd * w * 0.6, 92), (64 + sd * 14, 94), (64 + sd * 12, 128), (64 + sd * w * 1.05, 128)], T, gloss=0.75)
        cv.line([(64 + 16, 118), (64 + 30, 118)], team, 3, flat=True)
    elif kind == 'riot':
        cv.poly([(64 - w * 0.7, 98), (64 + w * 0.7, 98), (64 + w * 0.7, 128), (64 - w * 0.7, 128)], (30, 30, 32), gloss=0.7)
        cv.line([(64 - w * 0.6, 108), (64 + w * 0.6, 108)], team, 3.2, flat=True)
    if ch['team'] == 'enemy':
        band(cv, (64 - w * 0.86, 96), (64 - w * 0.98, 128), 0.45, 0.75, 27, team)
    nc = ch['skin'] if ch['head'] not in ('balaclava', 'riot') else ch['gear']
    cv.poly([(55, 74), (73, 74), (76, 96), (52, 96)], shade(nc, 0.85))
    draw_head(cv, ch, 64, 56, 25, 0.12, 0.97, team)
    im = cv.image()
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, 127, 4], fill=team + (255,))
    # rank chevrons (squad) / crew diamond (Syndicate) in the lower right
    if ch['team'] == 'player':
        for i in range(ch.get('rank', 1)):
            y0 = 112 - i * 6
            d.line([(108, y0), (114, y0 - 5), (120, y0)], fill=team + (255,), width=2)
    else:
        d.polygon([(114, 106), (120, 113), (114, 120), (108, 113)], fill=team + (255,))
    im.save(os.path.join(OUT, name, 'portrait.png'), optimize=True)


def make_contact_sheet(names):
    """docs/characters-contact-sheet.png: per character idle s, idle sw, aim e, fire w, hunker se, down, portrait, cut-in."""
    picks = [('s', 'idle', 0), ('sw', 'idle', 0), ('e', 'aim', 0), ('w', 'fire', 0), ('n', 'walk', 1), ('se', 'hunker', 0), ('s', 'down', 0)]
    cell_w, row_h, label_w = FW, FH + 8, 150
    cut_w = 140
    W_ = label_w + cell_w * len(picks) + 140 + cut_w + 20
    sheet = Image.new('RGBA', (W_, row_h * len(names) + 30), (54, 58, 62, 255))
    d = ImageDraw.Draw(sheet)
    hdr = ['idle s', 'idle sw', 'aim e', 'fire w', 'walk n', 'hunker se', 'down', 'portrait', 'cut-in']
    for i, h in enumerate(hdr):
        x = label_w + i * cell_w + 8 if i < len(picks) else (label_w + cell_w * len(picks) + 8 if i == len(picks) else label_w + cell_w * len(picks) + 148)
        d.text((x, 6), h, font=SMALL, fill=(200, 204, 208, 255))
    for i, n in enumerate(names):
        m = json.load(open(os.path.join(OUT, n, 'field.json')))
        a = Image.open(os.path.join(OUT, n, 'field.png'))
        y = 30 + i * row_h
        d.rectangle([0, y, W_, y + row_h - 4], fill=(62, 66, 71, 255) if i % 2 else (56, 60, 64, 255))
        unit_names = {'vanguard': 'Assault', 'grenadier': 'Grenadier', 'marksman': 'Sharpshooter', 'warden': 'Breacher', 'cultist': 'Gunman',
                      'archer': 'Lookout', 'pyromancer': 'Arsonist', 'brute': 'Enforcer', 'guard': 'Riot Guard'}
        d.text((10, y + 70), unit_names.get(n, n), font=BIG, fill=TEAM[CHARS[n]['team']] + (255,))
        d.text((10, y + 100), n, font=SMALL, fill=(170, 174, 178, 255))
        for j, (f, c, fr) in enumerate(picks):
            col = m['clips'][c]['column'] + fr
            r = m['facings'].index(f)
            sheet.alpha_composite(a.crop((col * FW, r * FH, col * FW + FW, r * FH + FH)), (label_w + j * cell_w, y))
        p = Image.open(os.path.join(OUT, n, 'portrait.png')).convert('RGBA')
        sheet.alpha_composite(p, (label_w + cell_w * len(picks) + 4, y + 34))
        cut = Image.new('RGBA', (512, 768), (30, 32, 36, 255))
        cm = json.load(open(os.path.join(OUT, n, 'cutin.json')))
        for layer in cm['layers']:
            cut.alpha_composite(Image.open(os.path.join(OUT, n, layer['image'])).convert('RGBA'))
        cut = cut.resize((int(512 * (row_h - 12) / 768), row_h - 12), Image.LANCZOS)
        sheet.alpha_composite(cut, (label_w + cell_w * len(picks) + 144, y + 2))
    out = os.path.join(ROOT, 'docs', 'characters-contact-sheet.png')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    sheet.convert('RGB').save(out, optimize=True)
    print('contact sheet:', out)


def main():
    os.makedirs(OUT, exist_ok=True)
    index = {}
    only = os.environ.get('ONLY')
    for name, ch in CHARS.items():
        if only and name != only:
            continue
        make_field(name, ch); make_cutin(name, ch); make_portrait(name, ch)
        index[name] = {'field': f'{name}/field.json', 'cutin': f'{name}/cutin.json', 'portrait': f'{name}/portrait.png', 'team': ch['team'], 'placeholder': True}
        print('placeholder art:', name)
    if not only:
        with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
            json.dump({'version': 'characters-v2', 'characters': index}, f, indent=1)
    if '--sheet' in sys.argv:
        make_contact_sheet(list(CHARS) if not only else [only])


if __name__ == '__main__':
    main()
