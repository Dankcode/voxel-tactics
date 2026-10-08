#!/usr/bin/env python3
"""Build the voxel material textures: albedo + normal map per surface, 512 x 512, seamless.

Four surfaces come straight from vibe-game's photographic atlas (client/public/assets/materials/rustic-atlas.jpg):
cobblestone, plaster, wood planks and grass. The rest are generated here in the same painted-photo style
(layered spectral noise, Voronoi stones, block and tile patterns), so every surface tiles without seams and
has a height field for its normal map. Run:  python3 tools/art/make_textures.py
Output: client/public/assets/textures/pbr/<name>.jpg and <name>_n.jpg, plus manifest.json and a contact sheet.

Replacing a texture: drop a 512 x 512 (or any power of two) seamless JPEG with the same name; the normal map is
optional (the client falls back to a flat one). Scale, roughness and metalness live in
client/src/render/MaterialLibrary.js.
"""
import json, os
import numpy as np
from PIL import Image, ImageFilter
from scipy.spatial import cKDTree
from scipy import ndimage

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ATLAS = os.path.join(ROOT, 'client', 'public', 'assets', 'materials', 'rustic-atlas.jpg')
OUT = os.path.join(ROOT, 'client', 'public', 'assets', 'textures', 'pbr')
N = 512
RNG = np.random.default_rng(7)


# ----------------------------------------------------------------------------------------------- noise helpers
def spectral(beta=2.0, seed=None, n=N, aniso=(1.0, 1.0)):
    """Tileable fractal noise in [0, 1] (white noise shaped by 1/f^beta in the frequency domain)."""
    r = np.random.default_rng(seed) if seed is not None else RNG
    w = r.standard_normal((n, n))
    fy = np.fft.fftfreq(n)[:, None] * aniso[1]
    fx = np.fft.fftfreq(n)[None, :] * aniso[0]
    f = np.sqrt(fx * fx + fy * fy)
    f[0, 0] = 1
    spec = np.fft.fft2(w) / f ** (beta / 2)
    spec[0, 0] = 0
    out = np.real(np.fft.ifft2(spec))
    out -= out.min(); out /= out.max() + 1e-9
    return out


def band(lo, hi, seed=None):
    """Noise with features between 1/hi and 1/lo of the tile (tileable)."""
    r = np.random.default_rng(seed) if seed is not None else RNG
    w = r.standard_normal((N, N))
    fy = np.fft.fftfreq(N)[:, None] * N; fx = np.fft.fftfreq(N)[None, :] * N
    f = np.sqrt(fx * fx + fy * fy)
    mask = np.exp(-((np.log(f + 1e-6) - np.log((lo + hi) / 2)) ** 2) / (2 * (np.log(hi / lo) / 2 + 0.3) ** 2))
    out = np.real(np.fft.ifft2(np.fft.fft2(w) * mask))
    out -= out.min(); out /= out.max() + 1e-9
    return out


def voronoi(count, seed=None, jitter=1.0, points=None):
    """Tileable Voronoi: returns (F1, F2, cell id, points)."""
    r = np.random.default_rng(seed) if seed is not None else RNG
    if points is None:
        side = int(np.ceil(np.sqrt(count)))
        g = (np.stack(np.meshgrid(np.arange(side), np.arange(side)), -1).reshape(-1, 2) + 0.5 + (r.random((side * side, 2)) - 0.5) * jitter) * (N / side)
        points = np.mod(g, N)
    tree = cKDTree(points, boxsize=N)
    yy, xx = np.mgrid[0:N, 0:N]
    q = np.stack([xx.ravel() + 0.5, yy.ravel() + 0.5], -1)
    d, i = tree.query(q, k=2)
    return d[:, 0].reshape(N, N), d[:, 1].reshape(N, N), i[:, 0].reshape(N, N), points


def warp(img, amount, seed=None):
    """Domain warp (tileable) for organic edges."""
    dx = (spectral(2.6, seed) - 0.5) * amount
    dy = (spectral(2.6, None if seed is None else seed + 1) - 0.5) * amount
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float64)
    return ndimage.map_coordinates(img, [np.mod(yy + dy, N), np.mod(xx + dx, N)], order=1, mode='wrap')


def blur(img, s):
    return ndimage.gaussian_filter(img, s, mode='wrap')


def rgb(*c):
    return np.array(c, dtype=np.float64) / 255.0


def mix(a, b, t):
    t = np.clip(t, 0, 1)[..., None] if np.ndim(t) == 2 else t
    return a * (1 - t) + b * t


def colorize(base, var, tint_noise, amount=0.18):
    """base rgb, scalar field var in [0,1] → image; tint_noise jitters hue a little."""
    img = np.ones((N, N, 3)) * base
    img *= (1 - amount + 2 * amount * var)[..., None]
    img[..., 0] *= 1 + (tint_noise - 0.5) * 0.08
    img[..., 2] *= 1 - (tint_noise - 0.5) * 0.08
    return img


def cell_values(ids, seed):
    r = np.random.default_rng(seed)
    v = r.random(ids.max() + 1)
    return v[ids]


def normal_from_height(h, strength):
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    nx, ny, nz = -gx * strength, gy * strength, np.ones_like(h)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    n = np.stack([nx / l, ny / l, nz / l], -1)
    return (n * 0.5 + 0.5)


def height_from_albedo(img, invert=False, blur_s=1.2):
    lum = img[..., 0] * 0.3 + img[..., 1] * 0.59 + img[..., 2] * 0.11
    h = blur(lum, blur_s)
    h = (h - h.min()) / (h.max() - h.min() + 1e-9)
    return 1 - h if invert else h


def save(name, albedo, height, strength):
    os.makedirs(OUT, exist_ok=True)
    a = np.clip(albedo, 0, 1)
    Image.fromarray((a * 255).astype(np.uint8)).save(os.path.join(OUT, f'{name}.jpg'), quality=90)
    nmap = normal_from_height(height, strength)
    Image.fromarray((nmap * 255).astype(np.uint8)).save(os.path.join(OUT, f'{name}_n.jpg'), quality=92)
    return name


def seamless(img, border=48):
    """Blend a photo crop with its half-offset copy along the seams so it tiles."""
    h, w = img.shape[:2]
    shifted = np.roll(np.roll(img, h // 2, 0), w // 2, 1)
    yy, xx = np.mgrid[0:h, 0:w]
    dx = np.minimum(xx, w - 1 - xx) / border; dy = np.minimum(yy, h - 1 - yy) / border
    t = np.clip(np.minimum(dx, dy), 0, 1)[..., None]
    return img * t + shifted * (1 - t)


# ----------------------------------------------------------------------------------------------- patterns
def stone_blocks(rows, min_w, max_w, mortar, seed, bevel=6.0):
    """Running-bond ashlar: returns (height, block id, mortar mask, edge distance)."""
    r = np.random.default_rng(seed)
    ids = np.zeros((N, N), dtype=np.int64)
    edge = np.zeros((N, N))
    rh = N / rows
    nid = 0
    yy, xx = np.mgrid[0:N, 0:N]
    for row in range(rows):
        y0 = int(round(row * rh)); y1 = int(round((row + 1) * rh))
        # widths that sum to N
        ws = []
        while sum(ws) < N:
            ws.append(int(r.integers(min_w, max_w)))
        ws[-1] -= sum(ws) - N
        if ws[-1] < min_w * 0.6 and len(ws) > 1:
            ws[-2] += ws[-1]; ws.pop()
        offset = int(r.integers(0, N))
        x = offset
        for wdt in ws:
            cols = (np.arange(x, x + wdt)) % N
            ids[y0:y1, cols] = nid
            # distance to the block edge
            lx = np.arange(wdt)
            ex = np.minimum(lx, wdt - 1 - lx)[None, :]
            ly = np.arange(y1 - y0)
            ey = np.minimum(ly, (y1 - y0) - 1 - ly)[:, None]
            edge[y0:y1, cols] = np.minimum(ex, ey)
            nid += 1
            x += wdt
    edge_w = warp(edge, 6, seed + 3)
    mortar_mask = (edge_w < mortar).astype(np.float64)
    h = np.clip(edge_w / bevel, 0, 1)
    h = np.sqrt(h)
    return h, ids, mortar_mask, edge_w


def make_stone_wall(name='stone', base=(150, 144, 133), rows=5, min_w=70, max_w=170, seed=11, dark=1.0):
    h, ids, mortar, _ = stone_blocks(rows, min_w, max_w, 3.2, seed)
    cv = cell_values(ids, seed)
    grain = spectral(1.6, seed + 1)
    mott = spectral(2.6, seed + 2)
    pits = (band(60, 160, seed + 4) > 0.78).astype(float) * 0.5
    col = colorize(rgb(*base) * dark, 0.5 * cv + 0.3 * mott + 0.2 * grain, cell_values(ids, seed + 9))
    col *= (1 - pits * 0.25)[..., None]
    grime = blur(spectral(2.8, seed + 5), 2) ** 2
    col = mix(col, col * rgb(110, 100, 85) / 0.6, grime * 0.35)
    col = mix(col, rgb(96, 90, 82) * dark, mortar * 0.9)
    height = h * 0.85 + grain * 0.12 + mott * 0.08 - pits * 0.05
    height = height * (1 - mortar) + mortar * 0.05
    return save(name, col, height, 7.0)


def make_flagstones(name='stone_floor', seed=21):
    h, ids, mortar, _ = stone_blocks(4, 100, 220, 2.6, seed, bevel=4)
    cv = cell_values(ids, seed)
    grain = spectral(1.5, seed + 1); mott = spectral(2.4, seed + 2)
    col = colorize(rgb(176, 168, 154), 0.45 * cv + 0.35 * mott + 0.2 * grain, cell_values(ids, seed + 9), 0.15)
    wear = blur(spectral(2.2, seed + 3), 3)
    col = mix(col, col * 1.08, wear * 0.4)
    col = mix(col, rgb(92, 86, 78), mortar * 0.85)
    height = h * 0.7 + grain * 0.1 + mott * 0.1
    return save(name, col, height * (1 - mortar) + mortar * 0.08, 5.0)


def make_bedrock(name='bedrock', seed=31):
    f1, f2, ids, _ = voronoi(40, seed, 0.9)
    cracks = np.clip((f2 - f1) / 6, 0, 1)
    grain = spectral(1.3, seed + 1); mott = spectral(2.5, seed + 2)
    col = colorize(rgb(78, 74, 70), 0.4 * cell_values(ids, seed) + 0.35 * mott + 0.25 * grain, mott, 0.25)
    col *= (0.55 + 0.45 * cracks)[..., None]
    return save(name, col, cracks * 0.6 + grain * 0.3 + mott * 0.2, 6.0)


def make_soil(name='soil', base=(112, 84, 58), seed=41, pebbles=True):
    mott = spectral(2.3, seed); grain = spectral(1.2, seed + 1); clumps = band(20, 60, seed + 2)
    col = colorize(rgb(*base), 0.45 * mott + 0.3 * clumps + 0.25 * grain, grain, 0.28)
    height = mott * 0.4 + clumps * 0.35 + grain * 0.25
    if pebbles:
        f1, f2, ids, pts = voronoi(260, seed + 3, 1.0)
        sizes = np.random.default_rng(seed + 4).random(len(pts)) * 6 + 2
        keep = np.random.default_rng(seed + 5).random(len(pts)) < 0.18
        r = sizes[ids] * 0.8
        peb = np.clip(1 - f1 / r, 0, 1) * keep[ids]
        peb = np.sqrt(peb)
        pc = colorize(rgb(118, 108, 94), cell_values(ids, seed + 6), mott, 0.3) * (0.55 + 0.45 * peb[..., None])
        col = mix(col, pc, np.clip(peb * 4, 0, 1) * 0.85)
        height = height * 0.6 + peb * 0.9
    return save(name, col, height, 6.0)


def make_road(name='road', seed=51):
    mott = spectral(2.4, seed); grain = spectral(1.0, seed + 1)
    col = colorize(rgb(158, 136, 104), 0.5 * mott + 0.5 * grain, grain, 0.2)
    f1, f2, ids, pts = voronoi(900, seed + 2, 1.0)
    keep = np.random.default_rng(seed + 3).random(len(pts)) < 0.5
    peb = np.clip(1 - f1 / 3.2, 0, 1) * keep[ids]
    col = mix(col, colorize(rgb(130, 124, 116), cell_values(ids, seed + 4), grain, 0.35), (peb > 0.1) * 0.9)
    puddle = blur(spectral(2.8, seed + 5), 2)
    col *= (1 - 0.12 * (puddle > 0.7))[..., None]
    return save(name, col, mott * 0.4 + peb * 0.6 + grain * 0.15, 5.0)


def make_sand(name='sand', seed=61):
    yy, xx = np.mgrid[0:N, 0:N] / N * 2 * np.pi
    w = spectral(2.6, seed) * 2.5
    ripples = 0.5 + 0.5 * np.sin(yy * 9 + xx * 2 + w * 2.2)
    ripples = ripples ** 1.6
    grain = spectral(0.6, seed + 1)
    mott = spectral(2.2, seed + 2)
    col = colorize(rgb(214, 186, 128), 0.35 * ripples + 0.35 * mott + 0.3 * grain, grain, 0.14)
    return save(name, col, ripples * 0.6 + grain * 0.3, 4.0)


def make_snow(name='snow', seed=71):
    mott = spectral(2.6, seed); grain = spectral(0.8, seed + 1)
    col = colorize(rgb(236, 242, 248), 0.6 * mott + 0.4 * grain, mott, 0.06)
    col[..., 2] *= 1.02
    sparkle = (spectral(0.2, seed + 2) > 0.93) * 0.08
    col += sparkle[..., None]
    return save(name, col, mott * 0.8 + grain * 0.2, 3.5)


def make_roof(name='roof', seed=81, base=(160, 74, 52)):
    rows, cols = 8, 6
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float64)
    th, tw = N / rows, N / cols
    row = np.floor(yy / th)
    xo = xx + (row % 2) * tw / 2
    cx = np.mod(xo, tw) / tw         # 0..1 across a tile
    ty = np.mod(yy, th) / th         # 0 top .. 1 bottom (exposed edge)
    # Rounded bottom edge per tile: the visible lip is lower at the tile sides.
    lip = 1 - 0.28 * (2 * cx - 1) ** 2
    inside = (ty < lip).astype(float)
    curve = np.sin(cx * np.pi) ** 0.6          # barrel-shaped tile profile
    h = (0.35 + 0.65 * ty) * inside * (0.6 + 0.4 * curve)
    gap = np.clip(np.minimum(cx, 1 - cx) * tw / 2.0, 0, 1)
    h *= gap
    tid = (row * cols * 2 + np.floor(xo / tw)).astype(np.int64)
    cv = cell_values(tid - tid.min(), seed)
    mott = spectral(2.2, seed + 1); grain = spectral(1.2, seed + 2)
    col = colorize(rgb(*base), 0.45 * cv + 0.3 * mott + 0.25 * grain, cell_values(tid - tid.min(), seed + 3), 0.22)
    col *= (0.45 + 0.55 * np.clip(h * 1.4, 0, 1))[..., None]
    moss = np.clip((blur(spectral(2.6, seed + 4), 1.5) - 0.62) * 4, 0, 1) * inside
    col = mix(col, rgb(88, 100, 54), moss * 0.6)
    return save(name, col, h + grain * 0.05, 8.0)


def make_bark(name='trunk', seed=91):
    noise = spectral(2.0, seed, aniso=(0.12, 1.0))       # stretched vertically
    fib = spectral(1.2, seed + 1, aniso=(0.08, 1.0))
    cracks = np.clip((noise - 0.35) * 3, 0, 1)
    col = colorize(rgb(96, 70, 48), 0.6 * cracks + 0.4 * fib, fib, 0.3)
    col *= (0.45 + 0.55 * cracks)[..., None]
    return save(name, col, cracks * 0.8 + fib * 0.2, 7.0)


def make_metal(name='metal', seed=101):
    mott = spectral(2.2, seed); grain = spectral(1.0, seed + 1)
    yy, xx = np.mgrid[0:N, 0:N]
    scratches = spectral(1.5, seed + 2, aniso=(0.05, 1.0))
    col = colorize(rgb(86, 90, 96), 0.5 * mott + 0.3 * grain + 0.2 * scratches, mott, 0.18)
    rust = np.clip((blur(spectral(2.4, seed + 3), 2) - 0.6) * 3.5, 0, 1)
    col = mix(col, rgb(122, 70, 40) * (0.8 + 0.4 * grain[..., None]), rust * 0.75)
    # Riveted plates.
    plate = ((np.mod(xx, 256) < 3) | (np.mod(yy, 256) < 3)).astype(float)
    plate = blur(plate, 1.0)
    rv = np.zeros((N, N))
    for py in range(16, N, 256):
        for px in range(16, N, 64):
            for oy in (0, 224):
                rr = np.hypot(np.minimum(np.abs(xx - px), N - np.abs(xx - px)), np.minimum(np.abs(yy - (py + oy) % N), N - np.abs(yy - (py + oy) % N)))
                rv = np.maximum(rv, np.clip(1 - rr / 6, 0, 1))
    col *= (1 - plate * 0.45)[..., None]
    col = mix(col, rgb(120, 122, 126), (rv > 0) * 0.5)
    return save(name, col, mott * 0.15 + rv * 0.9 - plate * 0.5 + rust * 0.1, 6.0)


def make_sandbags(name='sandbag', seed=111):
    rows = 4
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float64)
    th = N / rows
    row = np.floor(yy / th)
    bw = N / 2.5
    xo = np.mod(xx + (row % 2) * bw / 2, N)
    # ellipse per bag (use 2 bags across with wrap: N/2.5 is not integral → use 2 bags + adjust)
    bw = N / 2
    cx = np.mod(xo, bw) / bw * 2 - 1
    cy = np.mod(yy, th) / th * 2 - 1
    d = (np.abs(cx / 1.0) ** 3 + np.abs(cy / 0.96) ** 2.2) ** 0.5
    bag = np.clip(1 - d, 0, 1)
    h = bag ** 0.35
    weave = (np.sin(xx * np.pi / 2.0) * np.sin(yy * np.pi / 2.0)) * 0.5 + 0.5
    bid = (row * 4 + np.floor(xo / bw)).astype(np.int64)
    mott = spectral(2.2, seed); grain = spectral(1.0, seed + 1)
    col = colorize(rgb(176, 150, 102), 0.35 * cell_values(bid, seed) + 0.35 * mott + 0.15 * weave + 0.15 * grain, mott, 0.2)
    col *= (0.35 + 0.65 * np.clip(h * 1.6, 0, 1))[..., None]
    return save(name, col, h + weave * 0.04, 7.0)


def make_leaves(name='hedge', seed=121, base=(58, 112, 54)):
    f1, f2, ids, pts = voronoi(1400, seed, 1.0)
    rr = np.random.default_rng(seed + 1)
    size = 4 + rr.random(len(pts)) * 5
    leaf = np.clip(1 - f1 / size[ids], 0, 1)
    shade_v = rr.random(len(pts))[ids]
    mott = spectral(2.4, seed + 2)
    col = colorize(rgb(*base), 0.55 * shade_v + 0.45 * mott, cell_values(ids, seed + 3), 0.35)
    col *= (0.42 + 0.7 * np.clip(leaf * 2.2, 0, 1) * (0.6 + 0.4 * mott))[..., None]
    return save(name, col, leaf * 0.7 + mott * 0.4, 6.0)


def make_water(name='water', seed=131):
    ripple = spectral(2.9, seed); fine = band(18, 40, seed + 1)
    col = colorize(rgb(46, 112, 128), 0.6 * ripple + 0.4 * fine, ripple, 0.2)
    return save(name, col, ripple * 0.7 + fine * 0.3, 5.0)


def make_ice(name='ice', seed=141):
    f1, f2, ids, _ = voronoi(30, seed, 0.9)
    cracks = np.clip(1 - (f2 - f1) / 2.5, 0, 1)
    fine = 1 - np.clip(((lambda a: a[1] - a[0])(voronoi(160, seed + 1, 1.0)[:2])) / 1.6, 0, 1)
    mott = spectral(2.5, seed + 2)
    col = colorize(rgb(186, 226, 240), 0.6 * mott + 0.4 * cell_values(ids, seed), mott, 0.12)
    col = mix(col, rgb(240, 250, 255), np.maximum(cracks, fine * 0.5) * 0.8)
    return save(name, col, mott * 0.4 - cracks * 0.3, 3.0)


def make_rubble(name='rubble', seed=151):
    f1, f2, ids, _ = voronoi(220, seed, 1.0)
    edge = np.clip((f2 - f1) / 4, 0, 1)
    cv = cell_values(ids, seed)
    mott = spectral(1.8, seed + 1)
    col = colorize(rgb(138, 130, 120), 0.6 * cv + 0.4 * mott, cell_values(ids, seed + 2), 0.35)
    col *= (0.3 + 0.7 * edge)[..., None]
    dust = blur(spectral(2.6, seed + 3), 2)
    col = mix(col, rgb(170, 160, 146), np.clip((dust - 0.55) * 2, 0, 1) * 0.5)
    return save(name, col, edge * 0.8 + cv * 0.4, 8.0)


def make_ash(name='ash', seed=161):
    mott = spectral(2.2, seed); grain = spectral(0.9, seed + 1)
    col = colorize(rgb(58, 55, 52), 0.5 * mott + 0.5 * grain, mott, 0.3)
    embers = np.clip((spectral(0.4, seed + 2) - 0.92) * 12, 0, 1)
    col = mix(col, rgb(255, 120, 40), embers * 0.8)
    return save(name, col, mott * 0.6 + grain * 0.4, 4.0)


def make_glass(name='glass', seed=171):
    yy, xx = np.mgrid[0:N, 0:N]
    lead = ((np.mod(xx, 128) < 6) | (np.mod(yy, 170) < 6)).astype(float)
    lead = blur(lead, 1.0)
    mott = spectral(2.6, seed)
    col = colorize(rgb(170, 210, 222), mott, mott, 0.12)
    col = mix(col, rgb(40, 40, 44), np.clip(lead * 1.5, 0, 1))
    return save(name, col, mott * 0.2 + lead * 0.8, 3.0)


def make_cloth(name='cloth', seed=181, stripes=((206, 150, 60), (182, 70, 52))):
    yy, xx = np.mgrid[0:N, 0:N]
    weave = (np.sin(xx * np.pi / 1.5) * 0.5 + 0.5) * 0.5 + (np.sin(yy * np.pi / 1.5) * 0.5 + 0.5) * 0.5
    s = (np.mod(xx, 128) < 64).astype(float)
    a, b = rgb(*stripes[0]), rgb(*stripes[1])
    col = mix(np.ones((N, N, 3)) * a, np.ones((N, N, 3)) * b, s)
    mott = spectral(2.2, seed)
    col *= (0.82 + 0.18 * weave + (mott - 0.5) * 0.2)[..., None]
    return save(name, col, weave * 0.3 + mott * 0.3, 2.0)


def make_crystal(name='crystal', seed=191):
    f1, f2, ids, _ = voronoi(18, seed, 0.9)
    facet = np.clip((f2 - f1) / 20, 0, 1)
    cv = cell_values(ids, seed)
    col = mix(np.ones((N, N, 3)) * rgb(90, 170, 230), np.ones((N, N, 3)) * rgb(200, 240, 255), cv * 0.7 + facet * 0.3)
    return save(name, col, facet + cv * 0.3, 5.0)


def make_lava(name='lava', seed=201):
    f1, f2, ids, _ = voronoi(40, seed, 1.0)
    crust = np.clip((f2 - f1) / 10, 0, 1)
    mott = spectral(2.4, seed + 1)
    hot = np.clip(1 - crust * 1.8, 0, 1)
    col = mix(np.ones((N, N, 3)) * rgb(45, 30, 26) * (0.7 + 0.6 * mott[..., None]), np.ones((N, N, 3)) * rgb(255, 140, 40), hot)
    return save(name, col, crust, 5.0)


# ------------------------------------------------------------------------------------------- photo-derived
def load_atlas():
    im = np.asarray(Image.open(ATLAS).convert('RGB'), dtype=np.float64) / 255.0
    return {'cobble': im[0:512, 0:512], 'plaster': im[0:512, 512:1024], 'planks': im[512:1024, 0:512], 'grass': im[512:1024, 512:1024]}


def grade(img, mul=(1, 1, 1), add=(0, 0, 0), sat=1.0, contrast=1.0):
    lum = (img[..., 0] * 0.3 + img[..., 1] * 0.59 + img[..., 2] * 0.11)[..., None]
    out = lum + (img - lum) * sat
    out = (out - 0.5) * contrast + 0.5
    return out * np.array(mul) + np.array(add)


def from_photo(atlas):
    names = []
    cob = atlas['cobble']; pl = atlas['plaster']; pk = atlas['planks']; gr = atlas['grass']
    names.append(save('cobble', cob, height_from_albedo(cob, blur_s=1.5), 6.0))
    names.append(save('plaster', pl, height_from_albedo(pl, blur_s=1.0), 3.5))
    names.append(save('plank', pk, height_from_albedo(pk, blur_s=0.8), 4.0))
    names.append(save('grass', gr, height_from_albedo(gr, blur_s=0.8), 4.0))
    # Variants graded from the photos.
    tim = np.rot90(pk).copy()
    names.append(save('timber', grade(tim, mul=(0.92, 0.84, 0.78), sat=0.9, contrast=1.05), height_from_albedo(tim, blur_s=0.8), 4.0))
    names.append(save('door', grade(tim, mul=(0.7, 0.58, 0.5), contrast=1.1), height_from_albedo(tim, blur_s=0.8), 5.0))
    names.append(save('furniture', grade(pk, mul=(1.1, 0.95, 0.8), sat=1.1), height_from_albedo(pk, blur_s=0.8), 3.0))
    names.append(save('stairs_wood', grade(pk, mul=(1.0, 0.9, 0.8)), height_from_albedo(pk, blur_s=0.8), 4.0))
    crate = grade(pk, mul=(1.45, 1.22, 0.95), sat=0.85, contrast=0.95)
    yy, xx = np.mgrid[0:N, 0:N]
    frame = ((np.minimum(xx, N - 1 - xx) < 34) | (np.minimum(yy, N - 1 - yy) < 34)).astype(float)
    diag = (np.abs(xx - yy) < 26).astype(float) * (1 - frame)
    crate = mix(crate, crate * 0.72, np.clip(frame + diag, 0, 1))
    names.append(save('crate', crate, height_from_albedo(pk, blur_s=0.8) * 0.5 + np.clip(frame + diag, 0, 1) * 0.5, 5.0))
    shelf = grade(pk, mul=(0.85, 0.72, 0.62))
    names.append(save('shelf', shelf, height_from_albedo(pk, blur_s=0.8), 3.0))
    ff = grade(gr, mul=(0.78, 0.86, 0.7), sat=0.9)
    litter = np.clip((band(30, 90, 5) - 0.55) * 3, 0, 1)
    ff = mix(ff, rgb(104, 78, 46) * (0.7 + 0.5 * spectral(1.2, 6)[..., None]), litter * 0.6)
    names.append(save('forest_floor', ff, height_from_albedo(gr, blur_s=0.8), 4.0))
    names.append(save('stairs_stone', grade(cob, mul=(1.05, 1.03, 1.0), sat=0.5), height_from_albedo(cob, blur_s=1.5), 6.0))
    return names


def make_barrel(name, band_col, wood_mul, seed):
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float64)
    staves = np.mod(xx, N / 6) / (N / 6)
    stave_h = np.sin(staves * np.pi) ** 0.5
    grain = spectral(1.3, seed, aniso=(0.1, 1.0))
    col = colorize(rgb(130, 92, 58) * np.array(wood_mul), 0.6 * grain + 0.4 * stave_h, grain, 0.25)
    col *= (0.55 + 0.45 * stave_h)[..., None]
    bands = ((np.abs(yy - N * 0.2) < 18) | (np.abs(yy - N * 0.8) < 18)).astype(float)
    col = mix(col, rgb(*band_col) * (0.8 + 0.4 * spectral(2.0, seed + 1)[..., None]), bands)
    return save(name, col, stave_h * 0.5 + bands * 0.6 + grain * 0.1, 6.0)


def make_hay(name='hay', seed=221):
    straw = spectral(0.9, seed, aniso=(0.06, 1.0))
    clumps = spectral(2.2, seed + 1)
    col = colorize(rgb(214, 182, 96), 0.6 * straw + 0.4 * clumps, clumps, 0.3)
    yy, xx = np.mgrid[0:N, 0:N]
    twine = ((np.abs(xx - N * 0.3) < 8) | (np.abs(xx - N * 0.7) < 8)).astype(float)
    col = mix(col, rgb(120, 86, 50), twine * 0.8)
    edge = np.clip(np.minimum(np.minimum(xx, N - 1 - xx), np.minimum(yy, N - 1 - yy)) / 40, 0, 1)
    col *= (0.6 + 0.4 * edge)[..., None]
    return save(name, col, straw * 0.6 + edge * 0.4 - twine * 0.2, 6.0)


def make_grass_side(atlas, name='grass_side'):
    """Face texture for the sides of grass voxels: soil with a grass fringe along the top edge."""
    soil = np.asarray(Image.open(os.path.join(OUT, 'soil.jpg')), dtype=np.float64) / 255.0
    gr = atlas['grass']
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float64)
    edge = 0.22 + 0.08 * spectral(1.4, 3)[0][None, :] * np.ones((N, 1))        # fringe depth per column (wrapping in x)
    edge = edge + (band(40, 120, 4)[0][None, :] - 0.5) * 0.1
    t = (yy / N < edge).astype(float)
    t = blur(t, 1.0)
    col = soil * (1 - t[..., None]) + gr * t[..., None]
    shadow = np.clip(1 - (yy / N - edge) / 0.08, 0, 1) * (1 - t)
    col *= (1 - 0.35 * shadow)[..., None]
    h = height_from_albedo(col, blur_s=1.0) * 0.6 + t * 0.4
    return save(name, col, h, 5.0)



# ------------------------------------------------------------------------------------------- modern set
def grid_joints(n_cells, width, jitter_seed=None):
    """Distance-to-joint field for an n x n grid of slabs (tileable): 0 at a joint, grows inward."""
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float64)
    cell = N / n_cells
    dx = np.minimum(np.mod(xx, cell), cell - np.mod(xx, cell))
    dy = np.minimum(np.mod(yy, cell), cell - np.mod(yy, cell))
    d = np.minimum(dx, dy)
    ids = (np.floor(yy / cell) * n_cells + np.floor(xx / cell)).astype(np.int64)
    return d, ids


def make_lawn(atlas, name='lawn'):
    g = atlas['grass']
    big = np.tile(g, (2, 2, 1))
    fine = np.asarray(Image.fromarray((big * 255).astype(np.uint8)).resize((N, N), Image.LANCZOS), dtype=np.float64) / 255.0
    col = grade(fine, mul=(0.78, 0.98, 0.62), sat=1.05, contrast=1.08)
    clover = blur(spectral(2.4, 401), 3)
    col *= (0.9 + 0.2 * clover)[..., None]
    return save(name, col, height_from_albedo(fine, blur_s=0.7), 3.5)


def make_slabs(name, n_cells, base, seed, joint=2.2, var=0.07, stains=0.12):
    d, ids = grid_joints(n_cells, 1)
    grain = spectral(0.9, seed); mott = spectral(2.4, seed + 1)
    cv = cell_values(ids, seed + 2)
    col = colorize(rgb(*base), 0.5 * cv + 0.3 * mott + 0.2 * grain, mott, var)
    st = np.clip((blur(spectral(2.8, seed + 3), 2) - 0.6) * 2.5, 0, 1)
    col *= (1 - stains * st)[..., None]
    j = np.clip(d / joint, 0, 1)
    col *= (0.55 + 0.45 * j)[..., None]
    bevel = np.clip(d / 6, 0, 1)
    return save(name, col, bevel * 0.6 + grain * 0.15 + mott * 0.1, 4.0)


def make_asphalt(name='asphalt', seed=411, mark=False):
    grain = spectral(0.3, seed); mott = spectral(2.3, seed + 1)
    f1, f2, ids, pts = voronoi(2600, seed + 2, 1.0)
    keep = np.random.default_rng(seed + 3).random(len(pts)) < 0.35
    agg = np.clip(1 - f1 / 2.2, 0, 1) * keep[ids]
    col = colorize(rgb(66, 70, 74), 0.5 * mott + 0.5 * grain, mott, 0.16)
    col = mix(col, rgb(120, 122, 124), agg * 0.55)
    cracks = np.clip(1 - np.abs(band(3, 9, seed + 4) - 0.5) * 40, 0, 1) * (blur(spectral(2.6, seed + 5), 3) > 0.62)
    col *= (1 - 0.35 * cracks)[..., None]
    h = mott * 0.3 + agg * 0.5 - cracks * 0.3
    if mark:
        yy, xx = np.mgrid[0:N, 0:N]
        paint = ((np.abs(yy - N / 2) < N * 0.045) & (np.mod(xx, N) < N * 0.62) & (np.mod(xx, N) > N * 0.08)).astype(float)
        paint = blur(paint, 1.2) * (0.85 + 0.15 * grain)
        col = mix(col, rgb(232, 228, 212), paint)
        h = h + paint * 0.1
    return save(name, col, h, 4.0)


def make_boards(name, base, boards, seed, gap=3, grain_amt=0.35, vertical=False):
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float64)
    a = xx if vertical else yy
    b = yy if vertical else xx
    bw = N / boards
    row = np.floor(a / bw)
    rng_ = np.random.default_rng(seed)
    offs = rng_.random(boards) * N
    ends = np.mod(b + offs[row.astype(int) % boards], N / 2)
    seam = (np.minimum(np.mod(a, bw), bw - np.mod(a, bw)) < gap) | (ends < 2)
    grain = spectral(1.2, seed + 1, aniso=(1.0, 0.08) if vertical else (0.08, 1.0))
    cv = cell_values((row * 7 + np.floor((b + offs[row.astype(int) % boards]) / (N / 2))).astype(np.int64) % 997, seed + 2)
    col = colorize(rgb(*base), 0.45 * cv + grain_amt * grain + 0.2 * spectral(2.2, seed + 3), grain, 0.22)
    col *= (1 - 0.6 * blur(seam.astype(float), 0.8))[..., None]
    return save(name, col, grain * 0.3 - seam * 0.8, 4.0)


def make_tiles(name='ceramic', n=4, base=(226, 230, 228), grout=(150, 154, 152), seed=431):
    d, ids = grid_joints(n, 1)
    mott = spectral(2.6, seed)
    col = colorize(rgb(*base), 0.6 * cell_values(ids, seed) + 0.4 * mott, mott, 0.04)
    g = np.clip(d / 3.0, 0, 1)
    col = mix(col, np.ones((N, N, 3)) * rgb(*grout), 1 - g)
    gloss = np.clip(1 - d / 40, 0, 1) * 0
    return save(name, col + gloss[..., None], np.clip(d / 4, 0, 1) * 0.5, 3.0)


def make_stucco(name='stucco', base=(230, 228, 220), seed=441):
    fine = spectral(0.6, seed); trowel = spectral(2.2, seed + 1, aniso=(1.0, 0.6))
    col = colorize(rgb(*base), 0.5 * fine + 0.5 * trowel, trowel, 0.05)
    dirt = np.clip((blur(spectral(2.8, seed + 2), 3) - 0.62) * 2, 0, 1)
    col *= (1 - 0.06 * dirt)[..., None]
    return save(name, col, fine * 0.4 + trowel * 0.3, 2.0)


def make_brick(name='brick', seed=451):
    rows = 16
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float64)
    bh = N / rows; bw = N / 4
    row = np.floor(yy / bh)
    xo = np.mod(xx + (row % 2) * bw / 2, N)
    dx = np.minimum(np.mod(xo, bw), bw - np.mod(xo, bw)); dy = np.minimum(np.mod(yy, bh), bh - np.mod(yy, bh))
    d = np.minimum(dx, dy)
    ids = (row * 8 + np.floor(xo / bw)).astype(np.int64)
    mott = spectral(1.8, seed)
    col = colorize(rgb(150, 82, 62), 0.6 * cell_values(ids, seed) + 0.4 * mott, cell_values(ids, seed + 1), 0.22)
    mortar = np.clip(d / 2.6, 0, 1)
    col = mix(col, np.ones((N, N, 3)) * rgb(176, 168, 152) * (0.9 + 0.2 * mott[..., None]), 1 - mortar)
    return save(name, col, mortar * 0.7 + mott * 0.2, 5.0)


def make_board_concrete(name='concrete_wall', seed=461):
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float64)
    boards = np.mod(yy, N / 6)
    lines = np.clip(np.minimum(boards, N / 6 - boards) / 2, 0, 1)
    grain = spectral(1.4, seed, aniso=(0.1, 1.0)); mott = spectral(2.5, seed + 1)
    col = colorize(rgb(176, 178, 172), 0.5 * mott + 0.3 * grain + 0.2 * cell_values(np.floor(yy / (N / 6)).astype(np.int64), seed), mott, 0.08)
    col *= (0.8 + 0.2 * lines)[..., None]
    holes = np.zeros((N, N))
    for cy in range(N // 12, N, N // 6):
        for cx in (N // 4, 3 * N // 4):
            holes = np.maximum(holes, np.clip(1 - np.hypot(xx - cx, yy - cy) / 5, 0, 1))
    col *= (1 - 0.45 * holes)[..., None]
    return save(name, col, lines * 0.3 + grain * 0.2 - holes * 0.4, 3.0)


def make_corrugated(name, base, seed, ribs=16, rust=0.0, horizontal=False):
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float64)
    a = yy if horizontal else xx
    ph = np.mod(a, N / ribs) / (N / ribs)
    prof = np.clip(np.abs(ph - 0.5) * 4 - 0.6, 0, 1)          # trapezoid ribs
    mott = spectral(2.4, seed); grain = spectral(1.0, seed + 1)
    col = colorize(rgb(*base), 0.5 * mott + 0.3 * grain + 0.2 * prof, mott, 0.08)
    col *= (0.78 + 0.22 * prof)[..., None]
    if rust:
        streak = np.clip((spectral(2.0, seed + 2, aniso=(1.0, 0.05)) - 0.6) * 3, 0, 1)
        col = mix(col, rgb(130, 76, 44), streak * rust)
    return save(name, col, prof, 6.0)


def make_standing_seam(name='roof_metal', seed=471):
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float64)
    ph = np.mod(xx, N / 4)
    seam = np.clip(1 - np.minimum(ph, N / 4 - ph) / 4, 0, 1)
    mott = spectral(2.4, seed)
    col = colorize(rgb(108, 116, 120), 0.7 * mott + 0.3 * spectral(0.9, seed + 1), mott, 0.08)
    col *= (1 - 0.25 * seam)[..., None]
    return save(name, col, seam, 5.0)


def make_gravel(name='gravel', seed=481):
    f1, f2, ids, pts = voronoi(1800, seed, 1.0)
    edge = np.clip((f2 - f1) / 2.5, 0, 1)
    col = colorize(rgb(160, 154, 144), 0.6 * cell_values(ids, seed) + 0.4 * spectral(2, seed + 1), cell_values(ids, seed + 2), 0.3)
    col *= (0.5 + 0.5 * edge)[..., None]
    return save(name, col, edge * 0.8, 6.0)


def make_fabric(name, base, seed, weave=2.0):
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float64)
    w = (np.sin(xx * np.pi / weave) * np.sin(yy * np.pi / weave)) * 0.5 + 0.5
    mott = spectral(2.4, seed)
    col = colorize(rgb(*base), 0.3 * w + 0.7 * mott, mott, 0.08)
    return save(name, col, w * 0.4 + mott * 0.2, 2.0)


def make_worktop(name='worktop', seed=491):
    veins = np.clip(1 - np.abs(warp(spectral(2.6, seed), 30, seed + 1) - 0.5) * 30, 0, 1)
    col = colorize(rgb(228, 228, 222), spectral(1.0, seed + 2), spectral(2, seed + 3), 0.04)
    col = mix(col, rgb(170, 170, 168), veins * 0.35)
    return save(name, col, spectral(1.0, seed + 4) * 0.1, 1.0)


def make_modern(atlas):
    pk = atlas['planks']
    oak = grade(pk, mul=(1.35, 1.12, 0.86), sat=0.85, contrast=0.92)
    out = [
        make_lawn(atlas),
        save('oak_floor', oak, height_from_albedo(pk, blur_s=0.8), 2.5),
        make_slabs('paving', 2, (184, 186, 182), 501, joint=2.4),
        make_slabs('concrete', 2, (198, 198, 192), 511, joint=1.8, var=0.05, stains=0.18),
        make_asphalt(), make_asphalt('road_mark', 421, mark=True),
        make_boards('deck', (150, 128, 104), 6, 521, gap=4),
        make_tiles(), make_tiles('tile_dark', 3, (88, 92, 96), (60, 62, 66), 531),
        make_stucco(), make_brick(), make_board_concrete(),
        make_corrugated('siding', (196, 202, 204), 541), make_corrugated('container', (200, 200, 196), 551, ribs=20, rust=0.35),
        make_standing_seam(), make_gravel(),
        make_fabric('upholstery', (110, 140, 136), 561), make_fabric('linen', (232, 230, 222), 571, 1.5),
        make_fabric('carpet', (150, 140, 128), 581, 1.2), make_worktop(),
    ]
    return out


def contact_sheet(names):
    cols = 8
    rows = (len(names) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * 128, rows * 140), (20, 22, 26))
    from PIL import ImageDraw
    d = ImageDraw.Draw(sheet)
    for i, n in enumerate(names):
        im = Image.open(os.path.join(OUT, f'{n}.jpg')).resize((128, 128))
        sheet.paste(im, ((i % cols) * 128, (i // cols) * 140))
        d.text(((i % cols) * 128 + 3, (i // cols) * 140 + 128), n, fill=(220, 220, 220))
    sheet.save(os.path.join(ROOT, 'docs', 'textures-contact-sheet.jpg'), quality=85)


def main():
    atlas = load_atlas()
    names = from_photo(atlas)
    names += [
        make_stone_wall('stone', (150, 144, 133), 5, 70, 170, 11),
        make_stone_wall('city_wall', (128, 122, 112), 4, 120, 240, 13, 0.95),
        make_flagstones(), make_bedrock(), make_soil(), make_road(), make_sand(), make_snow(), make_roof(), make_bark(),
        make_metal(), make_sandbags(), make_leaves('hedge', 121, (66, 124, 58)), make_leaves('leaves', 125, (70, 130, 58)),
        make_water(), make_ice(), make_rubble(), make_ash(), make_glass(), make_cloth(), make_crystal(), make_lava(),
        make_barrel('barrel_powder', (60, 60, 64), (1.05, 0.7, 0.6), 211), make_barrel('barrel_water', (70, 76, 84), (0.85, 0.85, 0.9), 213),
        make_barrel('lantern', (40, 40, 44), (1.4, 1.2, 0.7), 215), make_hay(),
    ]
    names.append(make_grass_side(atlas))
    names += make_modern(atlas)
    with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
        json.dump({'size': N, 'textures': sorted(names), 'source': 'tools/art/make_textures.py'}, f, indent=1)
    contact_sheet(sorted(names))
    print('wrote', len(names), 'textures to', OUT)


if __name__ == '__main__':
    main()
