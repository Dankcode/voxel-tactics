#!/usr/bin/env python3
"""Generate PLACEHOLDER 2D art for every character: field sprite atlas, back-shot cut-in layers, portrait.

v2 (smooth, painted look): every body part is a vector shape rasterised at 4x, shaded as a soft volume
("inflated" from its silhouette: distance transform → normal → key light from the upper left, rim light,
thin dark edge) and downsampled, so the placeholders read like modern illustrated units instead of pixel art.

Replace any PNG with real art of the same size and keep the JSON manifests' layout — the client reads only
the manifests (client/public/assets/characters/<art>/field.json, cutin.json) so frame counts, sizes and
anchors can change without code changes. Run:  python3 tools/art/make_placeholders.py
"""
import json, math, os
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
CHARS = {
    'vanguard':   dict(team='player', armor=(196, 112, 64), cloth=(62, 70, 78), head='helmet', weapon='blunderbuss', letter='V'),
    'grenadier':  dict(team='player', armor=(112, 128, 72), cloth=(70, 66, 54), head='helmet', weapon='repeater', letter='G', pack=True),
    'marksman':   dict(team='player', armor=(70, 112, 160), cloth=(46, 54, 66), head='cap', weapon='longrifle', letter='M', cape=True),
    'warden':     dict(team='player', armor=(168, 176, 186), cloth=(64, 70, 84), head='helmet', weapon='crossbow', letter='W', shield=True),
    'cultist':    dict(team='enemy', armor=(120, 44, 44), cloth=(52, 34, 34), head='hood', weapon='musket', letter='C', robe=True),
    'archer':     dict(team='enemy', armor=(86, 108, 52), cloth=(58, 50, 36), head='hood', weapon='bow', letter='A'),
    'pyromancer': dict(team='enemy', armor=(196, 76, 36), cloth=(60, 30, 24), head='hood', weapon='lance', letter='P', robe=True),
    'brute':      dict(team='enemy', armor=(104, 76, 56), cloth=(58, 44, 34), head='bare', weapon='maul', letter='B', big=True),
    'guard':      dict(team='enemy', armor=(130, 122, 112), cloth=(70, 40, 40), head='helmet', weapon='musket', letter='O', shield=True),
}
SKIN = (226, 186, 152)
LIGHT = np.array([-0.55, -0.65, 0.52]); LIGHT = LIGHT / np.linalg.norm(LIGHT)
try:
    FONT = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 15 * S)
    SMALL = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 18)
    BIG = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 44)
except OSError:
    FONT = SMALL = BIG = ImageFont.load_default()


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
            d.ellipse([a[0], a[1], b[0], b[1]], fill=255)
        elif kind == 'line':
            pts = [tr(p) for p in geom]
            d.line(pts, fill=255, width=max(1, int(width * s)), joint='curve')
            r = width * s / 2
            for p in (pts[0], pts[-1]):
                d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=255)
        return np.asarray(m, dtype=np.float32) / 255.0, (x0, y0)

    def shape(self, kind, geom, color, width=0, gloss=0.25, flat=False, alpha=1.0, edge=0.55, soft=1.0):
        mask, (x0, y0) = self._mask(kind, geom, width)
        if mask is None:
            return
        col = np.array(color[:3], dtype=np.float32) / 255.0
        if flat:
            rgb = np.ones(mask.shape + (3,), np.float32) * col
        else:
            # Inflate the silhouette into a soft volume and light it.
            dist = ndimage.distance_transform_edt(mask > 0.5)
            r = max(2.0, dist.max())
            h = np.sqrt(np.clip(dist / r, 0, 1)) * r * 0.9 * soft
            gy, gx = np.gradient(h)
            n = np.dstack([-gx, -gy, np.ones_like(h) * 1.2])
            n /= np.linalg.norm(n, axis=2, keepdims=True)
            diff = np.clip((n * LIGHT).sum(2), 0, 1)
            shade = 0.52 + 0.62 * diff
            spec = np.clip((n * LIGHT).sum(2), 0, 1) ** 18 * gloss
            rim = np.clip(1 - dist / (2.2 * self.s), 0, 1) * np.clip(-(n[..., 0] * 0.8 + n[..., 1] * 0.3), 0, 1) * 0.35
            rgb = col * shade[..., None] + spec[..., None] + rim[..., None] * np.array([0.55, 0.75, 1.0])
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


def shade(c, k): return tuple(max(0, min(255, int(v * k))) for v in c[:3])


# ------------------------------------------------------------------------------------------------ figure
WEAPON_LEN = {'longrifle': 62, 'repeater': 48, 'blunderbuss': 40, 'musket': 54, 'crossbow': 38, 'bow': 40, 'lance': 56, 'maul': 46}


def draw_figure(cv, ch, facing, clip, frame):
    th = math.radians(THETA[facing])
    hx = -math.sin(th)          # screen-left/right component of facing (−1 left … +1 right)
    cz = math.cos(th)           # toward-camera component (+1 faces the viewer)
    big = 1.12 if ch.get('big') else 1.0
    armor, cloth, team = ch['armor'], ch['cloth'], TEAM[ch['team']]
    cx, ground = FW / 2, FH - 10
    crouch = {'stacked': 16, 'hunker': 24}.get(clip, 0)
    bob = 1.5 if (clip == 'idle' and frame == 1) else 0
    lean = -6 if clip == 'hit' else (3 * hx if clip in ('aim', 'fire') else 0)
    recoil = -3 * hx if (clip == 'fire' and frame == 0) else 0

    if clip == 'down':
        # Lying on the ground, seen from the camera.
        cv.ellipse((cx - 44, ground - 22, cx + 34, ground - 4), shade(armor, 0.85))
        cv.ellipse((cx - 50, ground - 26, cx - 28, ground - 6), SKIN if ch['head'] == 'bare' else shade(armor, 0.6))
        cv.line([(cx + 30, ground - 12), (cx + 52, ground - 10)], shade(cloth, 1.0), 8)
        cv.line([(cx - 10, ground - 6), (cx + 22, ground + 2)], (70, 56, 44), 5)
        return

    hip_y = ground - 70 * big + crouch + bob
    sh_y = ground - 124 * big + crouch * 1.3 + bob
    head_y = sh_y - 18 * big
    tw = 23 * big * (0.64 + 0.36 * abs(cz))          # half torso width
    leg_off = 10 * big * abs(cz) + 2
    sx = cx + lean + recoil

    # walk cycle: legs swing in the facing direction on screen
    phase = [0, 1, 0, -1][frame % 4] if clip == 'walk' else 0
    swing = phase * 14

    def leg(side):
        hipx = sx + side * leg_off
        fwd = swing * side
        knee = (hipx + fwd * 0.5 * hx + side * 1.5, hip_y + 34 * big - crouch * 0.4 - abs(fwd) * 0.15)
        foot = (hipx + fwd * hx * 0.9 + (crouch * 0.4 * hx), ground - 4 - (abs(fwd) * 0.18 if phase else 0))
        if crouch:
            knee = (hipx + 10 * hx * (1 if side > 0 else 0.6) + side * 2, hip_y + 18)
        cv.line([(hipx, hip_y), knee, foot], shade(cloth, 1.0), 16 * big)
        cv.ellipse((knee[0] - 5, knee[1] - 4, knee[0] + 5, knee[1] + 4), shade(armor, 0.7), gloss=0.4)
        bx = foot[0] + 4 * hx
        cv.poly([(bx - 8, foot[1] - 8), (bx + 8, foot[1] - 8), (bx + 9 + 5 * hx, foot[1] + 4), (bx - 9 + 5 * hx, foot[1] + 4)], (40, 36, 34), gloss=0.35)

    def torso():
        top, bottom = sh_y - 2, hip_y + 6
        if ch.get('robe'):
            cv.poly([(sx - tw, top + 4), (sx + tw, top + 4), (sx + tw * 1.25, ground - 16 + crouch * 0.2), (sx - tw * 1.25, ground - 16 + crouch * 0.2)], shade(cloth, 1.1))
        cv.poly([(sx - tw, top + 2), (sx + tw, top + 2), (sx + tw * 0.86, bottom), (sx - tw * 0.86, bottom)], shade(cloth, 1.0))
        # armour vest
        cv.poly([(sx - tw * 0.92, top + 4), (sx + tw * 0.92, top + 4), (sx + tw * 0.78, bottom - 10), (sx - tw * 0.78, bottom - 10)], armor, gloss=0.45)
        if cz > -0.3:
            cv.poly([(sx - tw * 0.8, top + 10), (sx + tw * 0.8, top + 10), (sx + tw * 0.76, top + 15), (sx - tw * 0.76, top + 15)], team, flat=True)
            cv.ellipse((sx - 7 + 12 * hx, bottom - 26, sx + 5 + 12 * hx, bottom - 14), shade(cloth, 0.8))
        else:
            cv.poly([(sx - tw * 0.8, top + 10), (sx + tw * 0.8, top + 10), (sx + tw * 0.76, top + 14), (sx - tw * 0.76, top + 14)], shade(team, 0.75), flat=True)
        cv.poly([(sx - tw * 0.86, bottom - 10), (sx + tw * 0.86, bottom - 10), (sx + tw * 0.86, bottom - 3), (sx - tw * 0.86, bottom - 3)], (52, 42, 34), gloss=0.2)
        if ch.get('pack') or cz < -0.3:
            if cz < 0.2:
                cv.poly([(sx - tw * 0.7 + 4 * hx, top + 8), (sx + tw * 0.7 + 4 * hx, top + 8), (sx + tw * 0.62 + 4 * hx, bottom - 14), (sx - tw * 0.62 + 4 * hx, bottom - 14)], shade(cloth, 1.25), gloss=0.2)

    def shoulders(front):
        for side in (-1, 1):
            # in profile only the near shoulder is in front
            near = (side * hx) <= 0 if abs(cz) < 0.6 else True
            if near != front:
                continue
            px = sx + side * (tw + 1)
            cv.ellipse((px - 10 * big, sh_y - 5, px + 10 * big, sh_y + 8), shade(armor, 0.95), gloss=0.5)

    def head():
        hr = 14.5 * big
        hy = head_y
        hxo = sx + 2 * hx
        cv.poly([(hxo - 5, hy + hr - 2), (hxo + 5, hy + hr - 2), (hxo + 5, sh_y + 2), (hxo - 5, sh_y + 2)], shade(SKIN, 0.85))
        if ch['head'] == 'hood':
            cv.ellipse((hxo - hr - 3, hy - hr - 4, hxo + hr + 3, hy + hr + 4), shade(cloth, 1.15))
            if cz > -0.2:
                cv.ellipse((hxo - hr * 0.62 + 4 * hx, hy - hr * 0.45, hxo + hr * 0.62 + 4 * hx, hy + hr * 0.75), (26, 20, 20), flat=True)
                for ex in (-4, 4):
                    if abs(cz) > 0.4 or ex * hx > 0:
                        cv.ellipse((hxo + ex + 4 * hx - 1.6, hy - 1, hxo + ex + 4 * hx + 1.6, hy + 2), team, flat=True)
            return
        face_vis = cz > -0.25
        cv.ellipse((hxo - hr, hy - hr, hxo + hr, hy + hr), SKIN if face_vis else shade(cloth, 0.7))
        if face_vis:
            for ex in (-4.5, 4.5):
                if abs(cz) > 0.4 or ex * hx > 0:
                    ox = hxo + ex * (0.5 + 0.5 * abs(cz)) + 5 * hx
                    cv.ellipse((ox - 1.6, hy - 1, ox + 1.6, hy + 2.6), (30, 26, 26), flat=True)
        if ch['head'] == 'helmet':
            cv.ellipse((hxo - hr - 2, hy - hr - 4, hxo + hr + 2, hy + hr * 0.55), shade(armor, 0.8), gloss=0.6)
            cv.poly([(hxo - hr - 3, hy - 1), (hxo + hr + 3, hy - 1), (hxo + hr + 3, hy + 2), (hxo - hr - 3, hy + 2)], shade(armor, 0.6))
            if face_vis:
                cv.poly([(hxo - hr * 0.8 + 3 * hx, hy - 2), (hxo + hr * 0.8 + 3 * hx, hy - 2), (hxo + hr * 0.7 + 3 * hx, hy + 1), (hxo - hr * 0.7 + 3 * hx, hy + 1)], team, flat=True)
        elif ch['head'] == 'cap':
            cv.ellipse((hxo - hr - 1, hy - hr - 3, hxo + hr + 1, hy + 1), shade(cloth, 1.2))
            cv.poly([(hxo - 2 + 8 * hx, hy - 3), (hxo + 12 * hx + 10 * (1 if hx >= 0 else -1) * (1 - abs(cz)) , hy - 2), (hxo + 8 * hx, hy + 1)], shade(cloth, 0.9))
        elif ch['head'] == 'bare':
            cv.ellipse((hxo - hr, hy - hr - 1, hxo + hr, hy - hr * 0.2), (60, 40, 30))

    def weapon(front):
        wl = WEAPON_LEN[ch['weapon']] * big
        raised = clip in ('aim', 'fire') or (clip == 'stacked')
        gx, gy = sx + 6 * hx + 4 * cz, sh_y + (16 if raised else 30)
        if clip == 'hunker':
            gy = sh_y + 26
        dxs = hx if abs(hx) > 0.05 else 0.35
        if raised:
            dirx, diry = dxs, 0.18 * cz - 0.05
        else:
            dirx, diry = dxs * 0.75, 0.55 + 0.1 * cz
        n = math.hypot(dirx, diry); dirx, diry = dirx / n, diry / n
        # foreshorten weapons pointing at / away from the camera
        fore = 0.45 + 0.55 * abs(hx)
        tip = (gx + dirx * wl * fore, gy + diry * wl * fore)
        butt = (gx - dirx * 14 * fore, gy - diry * 14 * fore)
        is_front = cz > -0.35
        if is_front != front:
            return tip
        kind = ch['weapon']
        if kind == 'bow':
            cv.line([(tip[0] - 2, tip[1] - 26), (tip[0] + 6 * dirx, tip[1]), (tip[0] - 2, tip[1] + 26)], (122, 82, 44), 3.5)
            cv.line([(tip[0] - 2, tip[1] - 26), (tip[0] - 2, tip[1] + 26)], (220, 220, 210), 1.2, flat=True)
        elif kind == 'maul':
            cv.line([butt, tip], (110, 80, 50), 5)
            cv.poly([(tip[0] - 9, tip[1] - 9), (tip[0] + 9, tip[1] - 9), (tip[0] + 9, tip[1] + 9), (tip[0] - 9, tip[1] + 9)], (96, 98, 106), gloss=0.7)
        elif kind == 'lance':
            cv.line([butt, tip], (82, 62, 48), 5)
            cv.ellipse((tip[0] - 5, tip[1] - 5, tip[0] + 5, tip[1] + 5), (255, 140, 40), gloss=0.8)
            cv.glow(tip[0], tip[1], 10, (255, 120, 30), 0.6)
        else:
            stock = (92, 64, 42)
            metal = (70, 74, 82)
            mid = (gx + dirx * wl * fore * 0.35, gy + diry * wl * fore * 0.35)
            cv.line([butt, mid], stock, 7 if kind in ('blunderbuss', 'repeater') else 6, gloss=0.3)
            cv.line([mid, tip], metal, 5 if kind != 'blunderbuss' else 6, gloss=0.8)
            if kind == 'blunderbuss':
                cv.ellipse((tip[0] - 5, tip[1] - 5, tip[0] + 5, tip[1] + 5), metal, gloss=0.8)
            if kind == 'crossbow':
                cv.line([(tip[0] - 14 * diry - 4 * dirx, tip[1] - 14 * abs(dirx)), (tip[0] + 14 * diry - 4 * dirx, tip[1] + 14 * abs(dirx))], (110, 80, 50), 3.5)
            if kind == 'longrifle':
                cv.line([(mid[0] + dirx * 4, mid[1] - 4), (mid[0] + dirx * 14, mid[1] - 4)], (40, 40, 44), 3, gloss=0.9)
        return tip

    def arms(front, tip):
        raised = clip in ('aim', 'fire', 'stacked')
        for side in (-1, 1):
            near = (side * hx) <= 0 if abs(cz) < 0.6 else (side > 0) == (hx >= 0)
            draw_front = near if abs(cz) < 0.6 else cz > -0.35
            if draw_front != front:
                continue
            shx = sx + side * (tw + 1)
            if clip == 'throw' and side == (1 if hx >= 0 else -1):
                hand = (shx + 6 * hx, sh_y - (26 if frame == 0 else 6))
                cv.line([(shx, sh_y + 2), (shx + 2 * side, sh_y - 10), hand], shade(cloth, 1.05), 9 * big)
                cv.ellipse((hand[0] - 6, hand[1] - 6, hand[0] + 6, hand[1] + 6), (230, 120, 50), gloss=0.7)
                continue
            # hands on the weapon: grip and fore-end
            g = 0.15 if side == (1 if hx >= 0 else -1) else 0.55
            wl = WEAPON_LEN[ch['weapon']] * big * (0.45 + 0.55 * abs(hx))
            gx, gy = sx + 6 * hx + 4 * cz, sh_y + (16 if raised else 30)
            dxs = hx if abs(hx) > 0.05 else 0.35
            dirx, diry = (dxs, 0.18 * cz - 0.05) if raised else (dxs * 0.75, 0.55 + 0.1 * cz)
            n = math.hypot(dirx, diry); dirx, diry = dirx / n, diry / n
            hand = (gx + dirx * wl * g, gy + diry * wl * g)
            elbow = ((shx + hand[0]) / 2 + side * 5, (sh_y + hand[1]) / 2 + 8)
            cv.line([(shx, sh_y + 3), elbow, hand], shade(cloth, 1.05), 11.5 * big)
            cv.ellipse((hand[0] - 4.5, hand[1] - 4.5, hand[0] + 4.5, hand[1] + 4.5), (58, 46, 38))

    def shield(front):
        if not ch.get('shield'):
            return
        side = -1 if hx >= 0 else 1
        is_front = cz > -0.2
        if is_front != front:
            return
        px = sx + side * (tw + 4) + 6 * hx * (1 if cz > 0 else -1)
        w = 13 * (0.45 + 0.55 * abs(cz)) + 3
        cv.poly([(px - w, sh_y + 2), (px + w, sh_y + 2), (px + w, sh_y + 40), (px, sh_y + 52), (px - w, sh_y + 40)], (140, 146, 156), gloss=0.7)
        cv.poly([(px - w * 0.5, sh_y + 10), (px + w * 0.5, sh_y + 10), (px + w * 0.5, sh_y + 16), (px - w * 0.5, sh_y + 16)], team, flat=True)

    def cape():
        if not ch.get('cape'):
            return
        cv.poly([(sx - tw, sh_y), (sx + tw, sh_y), (sx + tw * 1.15 - 6 * hx, hip_y + 26), (sx - tw * 1.15 - 6 * hx, hip_y + 26)], shade(cloth, 0.95))

    # Paint order: back-facing extras first, then legs, torso, head, front extras.
    facing_away = cz < -0.35
    if not facing_away:
        cape()
    tip = weapon(False)
    arms(False, tip)
    shield(False)
    for side in ((-1, 1) if hx >= 0 else (1, -1)):
        leg(side)
    shoulders(False)
    torso()
    if facing_away:
        cape()
    shoulders(True)
    head()
    tip = weapon(True) or tip
    arms(True, tip)
    shield(True)
    if clip == 'fire' and frame == 0 and ch['weapon'] not in ('bow', 'maul', 'crossbow'):
        cv.glow(tip[0] + 6 * hx, tip[1], 14, (255, 210, 120), 1.0)
    if clip == 'hit':
        cv.glow(sx, sh_y + 20, 26, (255, 60, 50), 0.35)


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
                'facings': FACINGS, 'mirror': {}, 'anchor': [0.5, 10 / FH], 'worldHeight': 2.15 if ch.get('big') else 2.0, 'clips': clips,
                'events': {'fire': {'frame': 0, 'event': 'muzzle'}, 'throw': {'frame': 1, 'event': 'release'}}}
    with open(os.path.join(path, 'field.json'), 'w') as f:
        json.dump(manifest, f, indent=1)


def make_cutin(name, ch):
    """Back-shot layers (512 x 768): the character from behind, over the right shoulder, aiming upper right."""
    W, H = 512, 768
    armor, cloth, team = ch['armor'], ch['cloth'], TEAM[ch['team']]
    layers = {}
    back = Canvas(W, H, 2)
    back.poly([(150, 300), (360, 290), (440, 768), (70, 768)], shade(cloth, 0.8))                 # cape / coat tail
    if ch['head'] == 'hood':
        back.ellipse((170, 90, 340, 270), shade(cloth, 1.0))
    layers['back'] = back.image()
    body = Canvas(W, H, 2)
    body.poly([(118, 300), (392, 286), (372, 700), (150, 720)], shade(cloth, 1.05))
    body.poly([(132, 300), (380, 290), (356, 560), (160, 572)], armor, gloss=0.45)
    body.poly([(140, 318), (374, 308), (372, 326), (140, 336)], team, flat=True)
    if ch.get('pack') or True:
        body.poly([(190, 340), (320, 334), (312, 500), (200, 506)], shade(cloth, 1.3), gloss=0.25)
    body.ellipse((96, 262, 196, 352), shade(armor, 1.05), gloss=0.6)          # shoulders
    body.ellipse((316, 252, 416, 342), shade(armor, 1.05), gloss=0.6)
    body.poly([(226, 236), (290, 236), (292, 290), (224, 292)], shade(SKIN, 0.85))     # neck
    if ch['head'] == 'helmet':
        body.ellipse((192, 108, 324, 256), shade(armor, 0.8), gloss=0.7)
        body.poly([(186, 200), (330, 200), (330, 214), (186, 214)], shade(armor, 0.6))
    elif ch['head'] == 'hood':
        body.ellipse((186, 100, 330, 262), shade(cloth, 1.2))
    elif ch['head'] == 'cap':
        body.ellipse((196, 120, 320, 256), (70, 50, 36))
        body.ellipse((186, 104, 330, 196), shade(cloth, 1.2))
    else:
        body.ellipse((196, 116, 320, 256), SKIN)
        body.ellipse((196, 110, 320, 200), (60, 40, 30))
    if ch.get('shield'):
        body.poly([(40, 330), (150, 320), (150, 520), (95, 580), (40, 520)], (140, 146, 156), gloss=0.7)
    layers['body'] = body.image()
    arm = Canvas(W, H, 2)
    arm.line([(372, 312), (430, 250), (478, 196)], shade(cloth, 1.05), 40)
    arm.ellipse((462, 178, 498, 214), (58, 46, 38))
    wl = {'longrifle': 330, 'repeater': 260, 'blunderbuss': 220, 'musket': 290, 'crossbow': 200, 'bow': 200, 'lance': 300, 'maul': 220}[ch['weapon']]
    a = math.radians(-34)
    p0 = (400, 260); p1 = (p0[0] + math.cos(a) * wl, p0[1] + math.sin(a) * wl)
    if ch['weapon'] == 'maul':
        arm.line([p0, p1], (110, 80, 50), 16); arm.ellipse((p1[0] - 40, p1[1] - 40, p1[0] + 40, p1[1] + 40), (96, 98, 106), gloss=0.7)
    elif ch['weapon'] == 'bow':
        arm.line([(p0[0] + 60, p0[1] - 160), (p0[0] + 110, p0[1] - 40), (p0[0] + 60, p0[1] + 80)], (122, 82, 44), 12)
    else:
        mid = (p0[0] + (p1[0] - p0[0]) * 0.35, p0[1] + (p1[1] - p0[1]) * 0.35)
        arm.line([(p0[0] - 40, p0[1] + 30), mid], (92, 64, 42), 26, gloss=0.3)
        arm.line([mid, p1], (70, 74, 82), 16, gloss=0.9)
    layers['arm'] = arm.image()
    fx = Canvas(W, H, 1)
    fx.glow(min(W - 30, p1[0]), max(30, p1[1]), 90, (255, 200, 120) if ch['weapon'] != 'lance' else (255, 120, 40), 1.0)
    layers['fx'] = fx.image()
    path = os.path.join(OUT, name, 'cutin')
    os.makedirs(path, exist_ok=True)
    for k, im in layers.items():
        im.save(os.path.join(path, f'{k}.png'), optimize=True)
    manifest = {'placeholder': True, 'width': W, 'height': H,
                # Paint order back-to-front; parallax is how far each layer drifts during the push-in.
                'layers': [{'id': 'back', 'image': 'cutin/back.png', 'parallax': 0.4}, {'id': 'body', 'image': 'cutin/body.png', 'parallax': 0.7},
                           {'id': 'arm', 'image': 'cutin/arm.png', 'parallax': 1.0}, {'id': 'fx', 'image': 'cutin/fx.png', 'parallax': 1.2, 'blend': 'screen'}],
                'anchor': 'lower-left', 'screenHeight': 0.62}
    with open(os.path.join(OUT, name, 'cutin.json'), 'w') as f:
        json.dump(manifest, f, indent=1)


def make_portrait(name, ch):
    """128 x 128 head-and-shoulders, front view, on a team-tinted gradient."""
    cv = Canvas(128, 128, 4)
    team = TEAM[ch['team']]
    yy = np.linspace(0, 1, 128 * 4)[:, None]
    bg = (np.array(shade(team, 0.18)) * (1 - yy) + np.array(shade(team, 0.05)) * yy) / 255.0
    cv.img[..., :3] = bg[:, None, :] * np.ones((1, 128 * 4, 1))
    cv.img[..., 3] = 1
    armor, cloth = ch['armor'], ch['cloth']
    cv.poly([(14, 128), (24, 96), (104, 96), (114, 128)], armor, gloss=0.5)
    cv.poly([(26, 100), (102, 100), (102, 106), (26, 106)], team, flat=True)
    cv.poly([(54, 78), (74, 78), (76, 100), (52, 100)], shade(SKIN, 0.85))
    if ch['head'] == 'hood':
        cv.ellipse((30, 18, 98, 96), shade(cloth, 1.2))
        cv.ellipse((44, 38, 84, 86), (26, 20, 20), flat=True)
        cv.ellipse((52, 56, 58, 62), team, flat=True); cv.ellipse((70, 56, 76, 62), team, flat=True)
    else:
        cv.ellipse((40, 30, 88, 86), SKIN)
        cv.ellipse((52, 54, 58, 61), (30, 26, 26), flat=True); cv.ellipse((70, 54, 76, 61), (30, 26, 26), flat=True)
        cv.poly([(56, 72), (72, 72), (70, 75), (58, 75)], shade(SKIN, 0.6), flat=True)
        if ch['head'] == 'helmet':
            cv.poly([(36, 50), (44, 22), (84, 22), (92, 50), (92, 56), (36, 56)], shade(armor, 0.8), gloss=0.6)
            cv.poly([(40, 47), (88, 47), (86, 51), (42, 51)], team, flat=True)
        elif ch['head'] == 'cap':
            cv.ellipse((38, 22, 90, 54), shade(cloth, 1.2))
        else:
            cv.ellipse((40, 26, 88, 50), (60, 40, 30))
    im = cv.image()
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, 127, 4], fill=team + (255,))
    im.save(os.path.join(OUT, name, 'portrait.png'), optimize=True)


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


if __name__ == '__main__':
    main()
