"""Paint flat anime-style glove layers that actually hold the gun.

The gloves are 2D paintings (ink outline + flat tan + one cel-shadow tone + dark rubber panels). Their construction
lines are laid out from gun-anchored guide points so the trigger hand wraps the pistol grip (back of hand and knuckles
toward the camera, index finger along the trigger guard) and the support hand cradles the handguard from below
(fingers curled up the camera side, thumb behind the gun). Output: RGBA layers at the pose canvas size.

usage: paint_gloves.py HULLS_JSON CUTIN_JSON OUT_DIR
"""
import json, sys, math, os
import numpy as np
from PIL import Image, ImageDraw

SS = 4                                            # supersampling
TAN = (158, 134, 98); TAN_SH = (118, 97, 68); TAN_HI = (182, 160, 122)
RUBBER = (50, 49, 47); RUBBER_SH = (32, 31, 30); CUFF = (38, 38, 38); INK = (20, 18, 16)


def norm(v):
    v = np.asarray(v, float); return v / (np.linalg.norm(v) or 1)


class Pose:
    def __init__(self, g, cam, k_radius):
        self.X = np.array(g['unitY'], float)      # gun +x (right side)  -> screen px per metre
        self.Y = np.array(g['unitX'], float)      # gun +y (toward muzzle)
        self.Z = np.array(g['unitZ'], float)      # gun +z (up)
        self.keys = {k: np.array(v, float) for k, v in g['keys'].items()}
        self.cam = norm(cam)                      # direction toward the camera, gun coords
        self.k = k_radius                         # px per metre for radii

    def p(self, origin, v):
        v = np.asarray(v, float)
        return self.keys[origin] + self.X * v[0] + self.Y * v[1] + self.Z * v[2]

    def depth(self, v):
        return float(np.dot(np.asarray(v, float), self.cam))


def capsule_poly(a, b, ra, rb, n=14):
    a = np.asarray(a, float); b = np.asarray(b, float); d = b - a; L = np.linalg.norm(d)
    if L < 1e-6: d = np.array([1.0, 0]); L = 1e-6
    u = d / L; ang = math.atan2(u[1], u[0]); pts = []
    for i in range(n + 1):                       # cap at b
        t = ang - math.pi / 2 + math.pi * i / n; pts.append(b + rb * np.array([math.cos(t), math.sin(t)]))
    for i in range(n + 1):                       # cap at a
        t = ang + math.pi / 2 + math.pi * i / n; pts.append(a + ra * np.array([math.cos(t), math.sin(t)]))
    return [tuple(p) for p in pts]


class Canvas:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.rgb = np.zeros((h * SS, w * SS, 3), np.uint8); self.a = np.zeros((h * SS, w * SS), np.uint8)

    def mask(self, polys, grow=0.0):
        m = Image.new('L', (self.w * SS, self.h * SS), 0); d = ImageDraw.Draw(m)
        for poly in polys:
            if grow:
                # Dilate by drawing the outline thickly as well as the fill.
                d.polygon([(x * SS, y * SS) for x, y in poly], fill=255)
                d.line([(x * SS, y * SS) for x, y in poly] + [(poly[0][0] * SS, poly[0][1] * SS)], fill=255, width=max(1, int(round(grow * 2 * SS))), joint='curve')
            else:
                d.polygon([(x * SS, y * SS) for x, y in poly], fill=255)
        return np.array(m) > 127

    def put(self, m, colour):
        self.rgb[m] = colour; self.a[m] = 255

    def shape(self, polys, fill, shade=None, ink=2.4, light=(-1, -1.2), shade_px=None, details=()):
        """Ink rim, flat fill, a cel shadow on the side away from the light, then detail callbacks."""
        self.put(self.mask(polys, grow=ink), INK)
        body = self.mask(polys)
        self.put(body, fill)
        if shade:
            s = (shade_px or 6) * SS; lx, ly = light; l = math.hypot(lx, ly)
            dx, dy = int(round(-lx / l * s)), int(round(-ly / l * s))
            shifted = np.zeros_like(body)
            ys, xs = np.nonzero(body)
            ys2, xs2 = ys - dy, xs - dx
            ok = (ys2 >= 0) & (ys2 < body.shape[0]) & (xs2 >= 0) & (xs2 < body.shape[1])
            shifted[ys2[ok], xs2[ok]] = True       # body moved toward the light
            self.put(body & ~shifted, shade)
        for fn in details: fn(self, body)
        return body

    def line(self, pts, width=1.6, colour=INK):
        im = Image.new('L', (self.w * SS, self.h * SS), 0); d = ImageDraw.Draw(im)
        d.line([(x * SS, y * SS) for x, y in pts], fill=255, width=max(1, int(width * SS)), joint='curve')
        self.put(np.array(im) > 127, colour)

    def image(self):
        rgb = Image.fromarray(self.rgb); a = Image.fromarray(self.a)
        im = Image.merge('RGBA', (*rgb.split(), a)).resize((self.w, self.h), Image.LANCZOS)
        return im


def chain_polys(P, origin, pts3, radii):
    s = [P.p(origin, v) for v in pts3]; r = [x * P.k for x in radii]
    return [capsule_poly(s[i], s[i + 1], r[i], r[i + 1]) for i in range(len(s) - 1)], s, r


# --------------------------------------------------------------------------------------------- the trigger hand
GRIPS = {   # grip axis top -> bottom, trigger point, grip half width / half depth (gun-local metres, origin = grip key)
    'rifle':   dict(T=[0, 0.014, 0.034], B=[0, -0.030, -0.062], trigger=[0.009, 0.074, 0.016], hw=0.016, hd=0.020),
    'sniper':  dict(T=[0, 0.016, 0.030], B=[0, -0.022, -0.058], trigger=[0.009, 0.072, 0.012], hw=0.017, hd=0.021),
    # Pump gun: a straight stock wrist sloping down and back; the fingers curl under it.
    'shotgun': dict(T=[0, 0.040, 0.014], B=[0, -0.058, -0.030], trigger=[0.009, 0.070, -0.012], hw=0.018, hd=0.019),
}
SUPPORTS = {   # handguard / forend / pump: half width and how far the fingers reach up its side
    'rifle':   dict(hw=0.024, reach=1.0),
    'sniper':  dict(hw=0.026, reach=0.95),
    'shotgun': dict(hw=0.022, reach=0.72),
}


def trigger_hand(P, wrist_px, cuff_r, family='rifle'):
    """Right hand on the pistol grip, seen from the gun's right: a rounded back of hand on the grip's side, four
    finger roots bulging round the grip front (each with a rubber pad), middle segments curling back under, and the
    index finger laid forward along the trigger guard with its tip on the trigger. Thumb and fingertips behind."""
    gp = GRIPS[family]; T = np.array(gp['T'], float); B = np.array(gp['B'], float)
    a = norm(B - T); f = norm([0, -a[2], a[1]])
    if f[1] < 0 or (abs(f[1]) < 0.3 and f[2] > 0): f = -f   # forward / under the grip
    r = np.array([1.0, 0, 0]); hw, hd = gp['hw'], gp['hd']
    G = lambda t: T + (B - T) * t
    front, back = [], []
    for t, rad in [(0.36, 0.0102), (0.56, 0.0100), (0.75, 0.0092)]:       # fingertips on the far side
        g = G(t); back.append(('chain', [g + f * (hd + 0.006), g + f * (hd * 0.3) - r * (hw + 0.008), g - f * 0.004 - r * (hw + 0.004)], [rad, rad * 0.95, rad * 0.85], TAN, 0))
    back.append(('chain', [G(0.0) - f * (hd + 0.002), G(-0.14) - r * (hw + 0.008) + f * 0.004, G(-0.16) - r * (hw + 0.006) + f * 0.050], [0.0125, 0.012, 0.0105], TAN, 1))
    # Back of the hand: web high behind the grip, heel low behind it, knuckles just behind the grip front.
    kn = [G(t) + r * (hw + 0.010) + f * (hd * 0.15) for t in (0.10, 0.34, 0.55, 0.74)]
    web = G(0.04) + r * (hw + 0.008) - f * (hd - 0.002)
    heel = G(0.90) + r * (hw + 0.008) - f * (hd - 0.004)
    front.append(('hull', [web, kn[0], kn[-1], heel, (web + heel) / 2 - f * 0.002 + r * 0.004], 0.0125, TAN, 0))
    # Middle, ring, little: root segment round the grip front, middle segment curling back down.
    for i, (t, rad) in enumerate([(0.36, 0.0115), (0.56, 0.0112), (0.75, 0.0102)]):
        g = G(t)
        pts = [kn[i + 1], g + r * (hw + 0.006) + f * (hd + 0.010) - a * 0.004, g + r * 0.003 + f * (hd + 0.012) + a * 0.012]
        front.append(('chain', pts, [rad * 1.08, rad * 1.04, rad * 0.95], TAN, 10 - i))
        front.append(('pad', [kn[i + 1] + r * 0.003 + f * 0.003, g + r * (hw + 0.007) + f * (hd + 0.006)], [rad * 0.36, rad * 0.32], RUBBER, 20 - i))
    # Index finger forward along the trigger guard, tip curled onto the trigger.
    k0 = kn[0]
    tr = np.array(gp['trigger'], float)
    index = [k0, G(0.06) + r * (hw + 0.007) + f * (hd + 0.034), tr + np.array([0.003, -0.010, 0.015]), tr]
    front.append(('chain', index, [0.0118, 0.0110, 0.0102, 0.0092], TAN, 30))
    front.append(('pad', [k0 + r * 0.003 + f * 0.004, G(0.08) + r * (hw + 0.008) + f * (hd + 0.020)], [0.0042, 0.0040], RUBBER, 31))
    return front, back


# --------------------------------------------------------------------------------------------- the support hand
def support_hand(P, origin_offset=np.zeros(3), family='rifle'):
    """Left hand cradling the handguard from below: palm under it, four fingers curled up the camera side,
    thumb up the far side (behind the gun)."""
    o = origin_offset; r = np.array([1.0, 0, 0]); sp = SUPPORTS[family]; hw = sp['hw']; bottom = o[2]
    front, back = [], []
    # Palm and heel under the handguard (behind the gun layer; visible below its silhouette).
    palm = [o + np.array([0.010, -0.040, -0.016]), o + np.array([-0.012, -0.038, -0.014]), o + np.array([-0.014, 0.028, -0.008]),
            o + np.array([0.018, 0.030, -0.008]), o + np.array([0.024, -0.008, -0.012])]
    back.append(('hull', palm, 0.013, TAN, 0))
    # Thumb up the far side.
    back.append(('chain', [o + np.array([-0.016, -0.034, -0.012]), o + np.array([-hw - 0.006, -0.010, 0.010]), o + np.array([-hw - 0.004, 0.020, 0.034])], [0.0125, 0.0115, 0.0105], TAN, 1))
    # Four fingers curling up the camera side, index nearest the muzzle.
    for y, rad, reach in [(0.026, 0.0104, 0.042), (0.004, 0.0108, 0.046), (-0.018, 0.0104, 0.042), (-0.038, 0.0094, 0.034)]:
        reach *= sp['reach']
        pts = [o + np.array([0.016, y, -0.012]), o + np.array([hw + 0.010, y + 0.002, 0.008]), o + np.array([hw + 0.010, y + 0.004, reach * 0.62]), o + np.array([hw + 0.004, y + 0.005, reach])]
        front.append(('chain', pts, [rad * 1.08, rad * 1.02, rad * 0.96, rad * 0.86], TAN, None))
    return front, back


def draw_items(cv, P, origin, items, light):
    # Explicit painter's order where given, else far-to-near.
    def key(item):
        return (item[4] if item[4] is not None else 0, float(np.mean([P.depth(v) for v in item[1]])))
    for kind, pts3, rad, colour, _ in sorted(items, key=key):
        shade = TAN_SH if colour == TAN else RUBBER_SH
        if kind in ('chain', 'pad'):
            polys, s, rr = chain_polys(P, origin, pts3, rad)
            cv.shape(polys, colour, shade, light=light, shade_px=max(3, min(rr) * 0.45), ink=2.4 if kind == 'chain' else 1.5)
            if kind == 'chain':
                for j in range(1, len(s) - 1):     # knuckle creases
                    d = norm(s[j + 1] - s[j - 1]); n = np.array([-d[1], d[0]]) * rr[j] * 0.55
                    cv.line([tuple(s[j] - n), tuple(s[j] + n * 0.2)], width=1.3)
        else:
            s = [P.p(origin, v) for v in pts3]
            from scipy.spatial import ConvexHull
            circ = []
            for c in s:
                for i in range(16):
                    t = 2 * math.pi * i / 16; circ.append(c + rad * P.k * np.array([math.cos(t), math.sin(t)]))
            circ = np.array(circ); hull = circ[ConvexHull(circ).vertices]
            cv.shape([[tuple(p) for p in hull]], colour, shade, light=light, shade_px=8)


def cuff(cv, wrist, toward, radius):
    d = norm(np.asarray(toward) - wrist); a = wrist - d * radius * 0.3; b = wrist + d * radius * 0.9
    cv.shape([capsule_poly(a, b, radius, radius * 0.95)], TAN, TAN_SH, shade_px=6)
    n = np.array([-d[1], d[0]])
    strap = [tuple(wrist + d * radius * 0.05 + n * radius * 1.02), tuple(wrist + d * radius * 0.55 + n * radius * 0.99),
             tuple(wrist + d * radius * 0.55 - n * radius * 0.99), tuple(wrist + d * radius * 0.05 - n * radius * 1.02)]
    cv.shape([strap], RUBBER, RUBBER_SH, ink=1.6, shade_px=3)


def to_rest(img, target, palm_rest, delta):
    """Map a glove painted in a gun family's neutral frame back into the rig's rest frame.
    Runtime: x_family = target + R(delta) (x_rest - palm_rest); PIL wants input(x_family) for each output(x_rest)."""
    c, s_ = math.cos(delta), math.sin(delta)
    a, b_, d, e = c, -s_, s_, c
    tx = target[0] - (a * palm_rest[0] + b_ * palm_rest[1]); ty = target[1] - (d * palm_rest[0] + e * palm_rest[1])
    big = img.resize((img.width * 2, img.height * 2), Image.LANCZOS)
    out = big.transform((img.width * 2, img.height * 2), Image.AFFINE, (a, b_, tx * 2, d, e, ty * 2), resample=Image.BICUBIC)
    return out.resize(img.size, Image.LANCZOS)


def paint(hulls, cutin, out_dir, wrists):
    out = {}
    for pname, art in [('aim', cutin)]:
        h = hulls[pname]; W, H = h['width'], h['height']
        cam = {'aim': [1.5, -5, 1.3], 'ready': [5, -1.5, 0.3]}[pname]
        k = {'aim': 900, 'ready': 1010}[pname]
        ax = art['rig']['handAxis']; rest_ang = math.atan2((ax[1][1] - ax[0][1]) * H, (ax[1][0] - ax[0][0]) * W)
        light = (-1, -1.2); res = {}
        for family in ('rifle', 'sniper', 'shotgun'):
            g = h['guns'][family]; P = Pose(g, cam, k)
            st, mz = np.array(g['keys']['stock']), np.array(g['keys']['muzzle'])
            delta = math.atan2(mz[1] - st[1], mz[0] - st[0]) - rest_ang
            for side in ('trigger', 'support'):
                origin = 'grip' if side == 'trigger' else 'support'
                front, back = trigger_hand(P, None, None, family) if side == 'trigger' else support_hand(P, family=family)
                arm = art['rig']['arms'][side]
                palm_rest = np.array([arm['palm'][0] * W, arm['palm'][1] * H]); wrist_rest = np.array(wrists[pname][side], float)
                target = P.keys[origin]; c_, s_ = math.cos(delta), math.sin(delta); v = wrist_rest - palm_rest
                wrist = target + np.array([c_ * v[0] - s_ * v[1], s_ * v[0] + c_ * v[1]])
                cuff_r = {'aim': 24, 'ready': 27}[pname] if side == 'trigger' else {'aim': 22, 'ready': 26}[pname]
                hand_cv = Canvas(W, H); fing_cv = Canvas(W, H)
                hand_items, finger_items = (front, back) if side == 'trigger' else (back, front)
                cuff(hand_cv, wrist, target, cuff_r)
                draw_items(hand_cv, P, origin, hand_items, light)
                draw_items(fing_cv, P, origin, finger_items, light)
                suffix = '' if family == 'rifle' else '-' + family
                for kind, cv in (('glove', hand_cv), ('glove-fingers', fing_cv)):
                    im = cv.image()
                    if family != 'rifle': im = to_rest(im, target, palm_rest, delta)
                    im.save(os.path.join(out_dir, f'{pname}-{side}-{kind}{suffix}.png'))
                res.setdefault(side, {})[family] = {'wrist': wrist.tolist(), 'target': target.tolist(), 'delta': delta}
        out[pname] = res
    return out


if __name__ == '__main__':
    hulls = json.load(open(sys.argv[1])); cutin = json.load(open(sys.argv[2])); out = sys.argv[3]
    wrists = json.loads(sys.argv[4])
    os.makedirs(out, exist_ok=True)
    print(json.dumps(paint(hulls, cutin, out, wrists)))
