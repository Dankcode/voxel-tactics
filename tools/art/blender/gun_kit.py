"""Voxel Tactics gun kit: the 3D guns drawn as a live layer of the 2D back shot (AR, sniper, shotgun).

Built on reference models, never from scratch. Each gun is rebuilt as a very low-poly UV relief by depth analysis,
because the gun is only ever seen small in the back shot:

    AR       Colt M5 SCW (output/reference/m5-scw.blend): body_rifle (lower, upper, grip, stock, handguard, trigger),
             barrel_std (10.3"), barrel_long (precision, 1.45x), sight_irons, mag_rifle (PMAG); optic_scope is the
             L118A1's scope at 0.75 scale (the M5 has no optic)
    sniper   L118A1 (output/reference/l118a1.usdz), with its own scope: body_sniper
    shotgun  pump shotgun (output/reference/shotgun/shotgun.obj) textured from its reference photo: body_shotgun

Real-world scale comes from published specs (online references): M5 SCW ~0.705 m with a 10.3" barrel; L118A1 / AI
Arctic Warfare 1.18 m with a 26" (660 mm) barrel; Mossberg Maverick 88 Security ~1.02 m with an 18.5-20" barrel.

Depth analysis, per part:
  1. Scan    ray-cast the part orthographically from its right (+X) and left (-X) sides at RES per texel: silhouette,
             both surface depths, and a baked colour per side (the reference material colour, or the reference
             model's own texture where it has one, lit + inked on depth steps and the outline).
  2. Clean   fill small holes (slots, screw holes; the trigger guard and stock cut-outs stay), smooth both depth
             maps, never let a surface cross the other.
  3. Relief  silhouette samples (one per grid cell), depth-step samples and a sparse interior grid kept >= 3 texels from
             the outline -> Delaunay (CDT) -> triangles inside the silhouette; right and left surfaces share the
             silhouette vertices (closed mesh). The geometry carries the volume; the atlas texture carries the detail.

Outputs (in the repo):
    client/public/assets/weapons/gun-kit.glb    Gun > body_rifle, barrel_std, barrel_long, sight_irons, mag_rifle,
                                                optic_scope, body_sniper, body_shotgun, muzzle_std, muzzle_long,
                                                muzzle_sniper, muzzle_shotgun
    client/public/assets/weapons/gun-kit.json   anchors in gun space (grip, support, muzzles, scope mounts) + triangles

Gun space (Blender axes, metres): +Y muzzle, +Z up, +X the gun's right; origin = the firing hand's grip point.
The references are not committed (licences to confirm); they live in output/reference/ (git-ignored).

Run:  blender -b -P tools/art/blender/gun_kit.py
  or  Blender MCP: import runpy; runpy.run_path('<repo>/tools/art/blender/gun_kit.py', run_name='__main__')
The script works in a temporary scene and removes everything it created; the open file is left as it was.
"""
import bpy, bmesh, json, math, os, re, sys
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
REF_DIR = os.path.join(REPO, 'output/reference')
OUT_DIR = os.path.join(REPO, 'client/public/assets/weapons')
SCENE = 'VT_GunKit'
RES = 0.002                  # texel / sample size in metres
LIGHT = (0.55, -0.35, 0.76)  # gun-space light for the baked texture (right side = +X)

# Reference models: file, units -> metres, firing-hand grip (x, z), bore height, muzzle x, support hand (x, z).
# All three references point their muzzle along +X with +Z up.
REFS = {
    'ar': dict(file='m5-scw.blend', unit=0.705 / 6.407, grip=(-1.80, -0.72), bore=0.225, muzzle=2.896, support=(1.2, -0.025),
               rail=0.541),
    'sniper': dict(file='l118a1.usdz', unit=1.18 / 2.864, grip=(-0.72, 0.0), bore=0.234, muzzle=1.416, support=(0.22, 0.117)),
    'shotgun': dict(file='shotgun/shotgun.obj', unit=1.02 / 4.953, grip=(-1.151, 0.093), bore=0.423, muzzle=2.481,
                    support=(1.003, 0.223), mount=(-0.371, 0.453)),
}
# AR parts (M5 SCW object names). Small controls (selector, catches, dust cover, charging handle) and the bolt are dropped.
AR_PARTS = {
    'body_rifle': ['m5scw lower', 'm5scw upper', 'm5scw grip', 'm5scw stock', 'm5scw trigga', 'm5scw handguard'],
    'barrel_std': ['m5scw 10.3in barrel ', 'm5scw flash hider'],
    'sight_irons': ['m5scw iron sights'],
    'mag_rifle': ['55645 ar15 30rnd mag empty (pmag)'],
}
LONG_BARREL = 1.45           # precision barrel: the 10.3" barrel stretched
SCOPE_SCALE = 0.75           # the L118A1 scope on the AR / shotgun
# relief sample density per part: (interior spacing, edge column step, edge gap, ring gap) in texels
DENSITY = {'body_sniper': (26, 10, 6, 8), 'body_shotgun': (26, 10, 6, 8), 'mag_rifle': (26, 10, 6, 8), 'optic_scope': (26, 10, 6, 8)}
BARREL_CUT = 2.33           # AR barrels start just inside the handguard's front end (the rest is never seen)
HOLE_FILL_PX = 60            # holes smaller than this (texels) are filled; the trigger guard and stock cut-outs stay

# ------------------------------------------------------------------------------------------------ helpers
def _scene():
    sc = bpy.data.scenes.get(SCENE)
    if sc:
        for o in list(sc.collection.all_objects): bpy.data.objects.remove(o, do_unlink=True)
    else:
        sc = bpy.data.scenes.new(SCENE)
    return sc

def _in_scene(sc, fn):
    """Run an operator with `sc` as the context scene (window session or background)."""
    win = bpy.context.window or (bpy.context.window_manager.windows[0] if bpy.context.window_manager.windows else None)
    if win:
        prev = win.scene; win.scene = sc
        try:
            with bpy.context.temp_override(window=win): return fn()
        finally:
            win.scene = prev
    with bpy.context.temp_override(scene=sc, view_layer=sc.view_layers[0]): return fn()

def load_reference(sc, key):
    """Bring one reference into the temp scene; returns {object name: mesh object} (world matrices evaluated)."""
    path = os.path.join(REF_DIR, REFS[key]['file'])
    before = set(sc.collection.all_objects)
    if path.endswith('.blend'):
        with bpy.data.libraries.load(path, link=False) as (src, dst):
            dst.objects = [n for n in src.objects]
        for o in dst.objects:
            if o is not None: sc.collection.objects.link(o)
    elif path.endswith(('.usdz', '.usd', '.usdc')):
        _in_scene(sc, lambda: bpy.ops.wm.usd_import(filepath=path))
    elif path.endswith('.obj'):
        _in_scene(sc, lambda: bpy.ops.wm.obj_import(filepath=path))
    sc.view_layers[0].update()
    new = [o for o in sc.collection.all_objects if o not in before]
    return {re.sub(r'\.\d{3}$', '', o.name): o for o in new if o.type == 'MESH'}, new

def copy_mesh(sc, o, name, M=Matrix()):
    """Evaluated, world-space copy of a reference mesh (materials and UVs kept) with `M` applied."""
    dg = sc.view_layers[0].depsgraph
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    me.transform(M @ o.matrix_world)
    if me.uv_layers: me.uv_layers.active.name = 'UVMap'
    c = bpy.data.objects.new(name, me); sc.collection.objects.link(c)
    return c

def scale_about(sx, sy, sz, pivot):
    p = Vector(pivot)
    return Matrix.Translation(p) @ Matrix.Diagonal((sx, sy, sz, 1)) @ Matrix.Translation(-p)

def join(sc, name, objs):
    """One mesh from several copies; keeps every source material and the UV layer."""
    bm = bmesh.new(); mats = []
    for o in objs:
        remap = []
        for m in o.data.materials:
            if m not in mats: mats.append(m)
            remap.append(mats.index(m))
        tmp = bmesh.new(); tmp.from_mesh(o.data)
        for f in tmp.faces: f.material_index = remap[f.material_index] if remap and f.material_index < len(remap) else 0
        me = bpy.data.meshes.new('tmp'); tmp.to_mesh(me); tmp.free()
        bm.from_mesh(me); bpy.data.meshes.remove(me)
        bpy.data.objects.remove(o, do_unlink=True)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for m in mats: me.materials.append(m)
    ob = bpy.data.objects.new(name, me); sc.collection.objects.link(ob)
    return ob

def to_gun(key):
    """Reference units/axes -> gun space: scale, +X forward -> +Y forward, grip point at the origin."""
    r = REFS[key]
    return Matrix.Rotation(math.radians(90), 4, 'Z') @ Matrix.Diagonal((r['unit'],) * 3 + (1,)) @ Matrix.Translation((-r['grip'][0], 0, -r['grip'][1]))

def gun_point(key, x, z):
    return tuple(round(v, 4) for v in to_gun(key) @ Vector((x, 0, z)))

# ----------------------------------------------------------------------------------------- image helpers
def _dilate(m, n):
    import numpy as np
    for _ in range(n): m = m | np.roll(m, 1, 0) | np.roll(m, -1, 0) | np.roll(m, 1, 1) | np.roll(m, -1, 1)
    return m

def _erode(m, n):
    import numpy as np
    for _ in range(n): m = m & np.roll(m, 1, 0) & np.roll(m, -1, 0) & np.roll(m, 1, 1) & np.roll(m, -1, 1)
    return m

def _fill(a, mask, iters=24):
    """Fill NaNs inside mask from their neighbours (iterative 4-neighbour mean)."""
    import numpy as np
    a = a.copy()
    for _ in range(iters):
        nan = np.isnan(a) & mask
        if not nan.any(): break
        acc = np.zeros_like(a); cnt = np.zeros_like(a)
        for sh, ax in ((1, 0), (-1, 0), (1, 1), (-1, 1)):
            r = np.roll(a, sh, ax); ok = ~np.isnan(r); acc += np.where(ok, r, 0); cnt += ok
        a = np.where(nan & (cnt > 0), acc / np.maximum(cnt, 1), a)
    return np.where(np.isnan(a), 0, a)

def _blur(a, mask, r):
    """Box blur of `a` restricted to `mask` (normalised), radius r texels."""
    import numpy as np
    def box(x):
        c = np.cumsum(np.cumsum(np.pad(x, ((r + 1, r), (r + 1, r))), 0), 1)
        return c[2 * r + 1:, 2 * r + 1:] - c[:-2 * r - 1, 2 * r + 1:] - c[2 * r + 1:, :-2 * r - 1] + c[:-2 * r - 1, :-2 * r - 1]
    m = mask.astype(np.float64)
    return box(np.where(mask, a, 0) * 1.0) / np.maximum(box(m), 1e-9)

def _fill_small_holes(hit, max_px):
    """Holes not connected to the border and smaller than max_px texels become solid."""
    import numpy as np
    H, W = hit.shape
    out = np.zeros_like(hit); out[0, :] = out[-1, :] = True; out[:, 0] = out[:, -1] = True; out &= ~hit
    while True:
        grown = out.copy()
        grown[1:, :] |= out[:-1, :]; grown[:-1, :] |= out[1:, :]; grown[:, 1:] |= out[:, :-1]; grown[:, :-1] |= out[:, 1:]
        grown &= ~hit
        if (grown == out).all(): break
        out = grown
    holes = ~hit & ~out
    seen = np.zeros_like(holes); res = hit.copy()
    for j0, i0 in zip(*np.nonzero(holes)):
        if seen[j0, i0]: continue
        stack, comp = [(j0, i0)], []
        seen[j0, i0] = True
        while stack:
            j, i = stack.pop(); comp.append((j, i))
            for dj, di in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                jj, ii = j + dj, i + di
                if 0 <= jj < H and 0 <= ii < W and holes[jj, ii] and not seen[jj, ii]:
                    seen[jj, ii] = True; stack.append((jj, ii))
        if len(comp) < max_px:
            for j, i in comp: res[j, i] = True
    return res

def _material_info(m):
    """(linear base colour, texture pixels or None) of a reference material."""
    import numpy as np
    col, tex = (0.03, 0.03, 0.03), None
    if m is None: return col, tex
    col = tuple(m.diffuse_color[:3])
    if m.node_tree:
        b = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if b: col = tuple(b.inputs['Base Color'].default_value[:3])
        t = next((n for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image), None)
        if t and t.image.size[0]:
            img = t.image; w, h = img.size
            tex = np.array(img.pixels[:], np.float32).reshape(h, w, img.channels)[..., :3]
    return col, tex

# ------------------------------------------------------------------------------------- 1-2. scan + clean
def depth_scan(ob):
    import numpy as np
    from mathutils.bvhtree import BVHTree
    from mathutils.geometry import barycentric_transform
    me = ob.data
    bvh = BVHTree.FromPolygons([v.co.copy() for v in me.vertices], [tuple(p.vertices) for p in me.polygons])
    infos = [_material_info(m) for m in me.materials] or [((0.03, 0.03, 0.03), None)]
    uvl = me.uv_layers.active.data if me.uv_layers else None
    ys = [v.co.y for v in me.vertices]; zs = [v.co.z for v in me.vertices]
    y0, y1, z0, z1 = min(ys) - 3 * RES, max(ys) + 3 * RES, min(zs) - 3 * RES, max(zs) + 3 * RES
    W, H = int(math.ceil((y1 - y0) / RES)), int(math.ceil((z1 - z0) / RES))
    hits = np.zeros((2, H, W), bool); xs = np.zeros((2, H, W), np.float32); col = np.zeros((2, H, W, 3), np.float32)
    L = Vector(LIGHT).normalized()
    to_lin = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    for side, sx in ((0, 1.0), (1, -1.0)):
        Ls = Vector((L.x * sx, L.y, L.z))
        for j in range(H):
            z = z1 - (j + 0.5) * RES
            for i in range(W):
                y = y0 + (i + 0.5) * RES
                loc, n, f, _ = bvh.ray_cast(Vector((sx * 2.0, y, z)), Vector((-sx, 0, 0)), 4.0)
                if loc is None: continue
                poly = me.polygons[f]; base, tex = infos[min(poly.material_index, len(infos) - 1)]
                if tex is not None and uvl is not None:
                    li = list(poly.loop_indices); vv = [me.vertices[k].co for k in poly.vertices]
                    uvw = [Vector((*uvl[k].uv, 0)) for k in li]
                    uv = barycentric_transform(loc, vv[0], vv[1], vv[2], uvw[0], uvw[1], uvw[2])
                    th, tw = tex.shape[:2]
                    p = tex[min(th - 1, max(0, int((uv.y % 1.0) * th))), min(tw - 1, max(0, int((uv.x % 1.0) * tw)))]
                    r, g, b = (float(v) for v in p)
                    if r > 0.22 and r > g * 1.18 and r > b * 1.45: continue        # photo background (wood) -> not gun
                    base = (to_lin(r), to_lin(g), to_lin(b)); k_lit, k_amb = 0.45, 0.8
                else:
                    base = tuple(max(c, 0.022) for c in base); k_lit, k_amb = 1.7, 0.55
                hits[side, j, i] = True; xs[side, j, i] = loc.x
                if n.x * sx < 0: n = -n
                lam = max(0.0, n.dot(Ls)); rim = max(0.0, 1 - abs(n.x)) ** 2
                col[side, j, i] = [c * (k_amb + k_lit * lam) + 0.04 * rim + 0.01 for c in base]
    hit = hits[0] | hits[1]
    solid = _fill_small_holes(_erode(_dilate(hit, 1), 1), HOLE_FILL_PX)
    geo = _dilate(solid, 2)                        # mesh slightly past the outline; the texture alpha cuts the exact edge
    for side in (0, 1):
        x = _fill(np.where(hits[side], xs[side], np.nan), geo)
        xs[side] = np.where(geo, _blur(x, geo, 10), 0)
        c = col[side]
        for k in range(3):
            c[..., k] = np.where(solid & ~hits[side], _fill(np.where(hits[side], c[..., k], np.nan), solid) * 0.7, c[..., k])
    mid = (xs[0] + xs[1]) / 2; xs[0] = np.maximum(xs[0], mid + 0.0015); xs[1] = np.minimum(xs[1], mid - 0.0015)
    edge = solid & ~_erode(solid, 1)
    # pad the colours outward so filtering and texels just past the outline never pick up the black atlas gaps
    for side in (0, 1):
        for k in range(3):
            col[side][..., k] = _fill(np.where(solid, col[side][..., k], np.nan), _dilate(solid, 6), iters=8)
    for side in (0, 1):
        x = xs[side]; step = np.zeros((H, W), bool)
        step[:, 1:] |= np.abs(np.diff(x, axis=1)) > 0.004; step[1:, :] |= np.abs(np.diff(x, axis=0)) > 0.004
        col[side][(step | edge) & solid] *= 0.35
    srgb = np.where(col <= 0.0031308, col * 12.92, 1.055 * np.power(np.clip(col, 0, None), 1 / 2.4) - 0.055)
    return dict(hit=solid, geo=geo, pad=_dilate(solid, 6), xs=xs, rgb=np.clip(srgb, 0, 1), box=(y0, z1), W=W, H=H)

# ---------------------------------------------------------------------------------------------- 3. relief
def relief_mesh(scan, spacing=22, edge_step=8, edge_gap=5, ring_gap=6):
    import numpy as np
    from mathutils.geometry import delaunay_2d_cdt
    hit, xs, H, W = scan['geo'], scan['xs'], scan['H'], scan['W']
    edge = hit & ~_erode(hit, 1)
    ring = _erode(hit, 3) & ~_erode(hit, 4)                  # a bevel ring of samples: even slopes, no saw-tooth rims
    deep = _erode(hit, 7)
    steep = np.zeros_like(hit)
    for x in xs:
        steep[:, 1:] |= np.abs(np.diff(x, axis=1)) > 0.003; steep[1:, :] |= np.abs(np.diff(x, axis=0)) > 0.003
    steep &= deep
    pts, taken = [], set()
    def take(mask, step, gap):
        for j, i in zip(*np.nonzero(mask)):
            if i % step and j % step: continue               # every step-th column and row: both sides of thin strips
            c = (i // gap, j // gap)
            if c in taken: continue
            taken.add(c); pts.append((int(i), int(j)))
    take(edge, edge_step, edge_gap)
    take(ring, edge_step, ring_gap)
    s2 = edge_step + 3
    for j, i in zip(*np.nonzero(steep)):
        if i % s2 == 0 and j % s2 == 0: pts.append((int(i), int(j)))
    for j in range(spacing // 2, H, spacing):
        for i in range(spacing // 2, W, spacing):
            if deep[j, i]: pts.append((i, j))
    pts = sorted(set(pts))
    if len(pts) < 3: return None
    vco, _, faces, *_ = delaunay_2d_cdt([Vector(p) for p in pts], [], [], 0, 1e-6)
    inside = lambda p: hit[min(H - 1, max(0, int(round(p[1])))), min(W - 1, max(0, int(round(p[0]))))]
    tris = []
    for f in faces:
        if len(f) != 3: continue
        a, b, c = (vco[k] for k in f)
        if all(inside(q) for q in ((a + b + c) / 3, (a + b) / 2, (b + c) / 2, (c + a) / 2,
                                   (2 * a + b) / 3, (2 * b + c) / 3, (2 * c + a) / 3)): tris.append(f)
    return [tuple(v) for v in vco], tris, edge

def build_relief(sc, name, scan, atlas_pos, atlas_size):
    import numpy as np
    vco, tris, edge = relief_mesh(scan, *DENSITY.get(name, ()))
    hit, xs, H, W = scan['geo'], scan['xs'], scan['H'], scan['W']
    (y0, z1) = scan['box']; AW, AH = atlas_size; (rx, ry), (lx, ly) = atlas_pos
    hj, hi = np.nonzero(hit)
    def sample_x(side, i, j):
        i = min(W - 1, max(0, int(round(i)))); j = min(H - 1, max(0, int(round(j))))
        if hit[j, i]: return float(xs[side, j, i])
        k = np.argmin((hj - j) ** 2 + (hi - i) ** 2); return float(xs[side, hj[k], hi[k]])
    verts, uv_r, uv_l, front, back, seam = [], [], [], {}, {}, set()
    for k in sorted({k for t in tris for k in t}):
        i, j = vco[k]; Y = y0 + (i + 0.5) * RES; Z = z1 - (j + 0.5) * RES
        on_edge = edge[min(H - 1, int(round(j))), min(W - 1, int(round(i)))]
        xr, xl = sample_x(0, i, j), sample_x(1, i, j)
        u = lambda ox, oy: ((ox + i + 0.5) / AW, 1 - (oy + j + 0.5) / AH)
        if on_edge:                       # same position on both sides, separate vertices: each side keeps its own normals
            xm = (xr + xl) / 2
            front[k] = len(verts); verts.append((xm, Y, Z)); uv_r.append(u(rx, ry)); uv_l.append(u(lx, ly))
            back[k] = len(verts); verts.append((xm, Y, Z)); uv_r.append(u(rx, ry)); uv_l.append(u(lx, ly))
            seam.add(k)
        else:
            front[k] = len(verts); verts.append((xr, Y, Z)); uv_r.append(u(rx, ry)); uv_l.append(u(lx, ly))
            back[k] = len(verts); verts.append((xl, Y, Z)); uv_r.append(u(rx, ry)); uv_l.append(u(lx, ly))
    faces, fside = [], []
    for a, b, c in tris:
        faces.append((front[a], front[b], front[c])); fside.append(0)
        if not (a in seam and b in seam and c in seam):          # an all-silhouette triangle is a single card
            faces.append((back[a], back[c], back[b])); fside.append(1)
    me = bpy.data.meshes.new(name); me.from_pydata(verts, [], faces); me.update()
    for p, sd in zip(me.polygons, fside):
        if (p.normal.x < 0) == (sd == 0): p.flip()
    uv = me.uv_layers.new(name='UVMap')
    for p, sd in zip(me.polygons, fside):
        for li, vi in zip(p.loop_indices, p.vertices): uv.data[li].uv = (uv_r if sd == 0 else uv_l)[vi]
    for p in me.polygons: p.use_smooth = True
    ob = bpy.data.objects.new(name, me); sc.collection.objects.link(ob)
    return ob, len(faces)

def pack_atlas(scans):
    import numpy as np
    tiles = sorted([(n, s, sd) for n, s in scans.items() for sd in (0, 1)], key=lambda t: -t[1]['H'])
    AW = 1024 if max(s['W'] for _, s, _ in tiles) < 1020 else 2048
    x = y = row = 0; pos = {}
    for n, s, sd in tiles:
        if x + s['W'] + 2 > AW: x, y, row = 0, y + row + 2, 0
        pos.setdefault(n, [None, None])[sd] = (x, y); x += s['W'] + 2; row = max(row, s['H'])
    AH = 1 << int(math.ceil(math.log2(y + row + 2)))
    px = np.zeros((AH, AW, 4), np.float32)
    for n, s, sd in tiles:
        ox, oy = pos[n][sd]
        px[oy:oy + s['H'], ox:ox + s['W'], :3] = np.where(s['pad'][..., None], s['rgb'][sd], 0)
        px[oy:oy + s['H'], ox:ox + s['W'], 3] = s['hit']
    img = bpy.data.images.new('vt_gun_atlas', AW, AH, alpha=True)
    img.pixels = px[::-1].ravel().tolist()
    img.file_format = 'PNG'; img.pack()
    return img, pos, (AW, AH)

def atlas_material(img):
    m = bpy.data.materials.new('vt_gun_atlas')
    m.use_nodes = True; m.use_backface_culling = False; nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial'); b = nt.nodes.new('ShaderNodeBsdfPrincipled'); t = nt.nodes.new('ShaderNodeTexImage')
    t.image = img
    nt.links.new(t.outputs['Color'], b.inputs['Base Color']); nt.links.new(b.outputs[0], out.inputs[0])
    clip = nt.nodes.new('ShaderNodeMath'); clip.operation = 'GREATER_THAN'; clip.inputs[1].default_value = 0.5
    nt.links.new(t.outputs['Alpha'], clip.inputs[0]); nt.links.new(clip.outputs[0], b.inputs['Alpha'])     # glTF alphaMode MASK
    b.inputs['Metallic'].default_value = 0.3; b.inputs['Roughness'].default_value = 0.55
    return m

# ------------------------------------------------------------------------------------------------- build
def build():
    sc = _scene()
    parts, created = {}, []
    # AR (M5 SCW)
    ar, new = load_reference(sc, 'ar'); created += new
    G = to_gun('ar'); rail = REFS['ar']['rail']; bore = REFS['ar']['bore']
    for name, objs in AR_PARTS.items():
        parts[name] = join(sc, name, [copy_mesh(sc, ar[n], n, G) for n in objs])
    cut_y = (G @ Vector((BARREL_CUT, 0, 0))).y
    pivot = (-0.156, 0, bore)
    parts['barrel_long'] = join(sc, 'barrel_long', [
        copy_mesh(sc, ar['m5scw 10.3in barrel '], 'lb', G @ scale_about(LONG_BARREL, 1.12, 1.12, pivot)),
        copy_mesh(sc, ar['m5scw flash hider'], 'lh', G @ Matrix.Translation(((2.531 + 0.156) * (LONG_BARREL - 1), 0, 0)) @ scale_about(1, 1.12, 1.12, (2.424, 0, bore)))])
    # sniper (L118A1) and the scope reused on the AR
    sn, new = load_reference(sc, 'sniper'); created += new
    Gs = to_gun('sniper')
    parts['body_sniper'] = join(sc, 'body_sniper', [copy_mesh(sc, o, n, Gs) for n, o in sn.items()])
    scope_objs = [o for n, o in sn.items() if n.startswith('Cylinder_000')]
    scope = join(sc, 'optic_scope', [copy_mesh(sc, o, 'sc', Gs) for o in scope_objs])
    zs = [v.co.z for v in scope.data.vertices]; ys = [v.co.y for v in scope.data.vertices]
    seat = Vector((0, (min(ys) + max(ys)) / 2, min(zs)))
    mount_ar = Vector(gun_point('ar', -0.75, rail))                     # scope foot on the AR's flat-top
    scope.data.transform(Matrix.Translation(mount_ar) @ Matrix.Scale(SCOPE_SCALE, 4) @ Matrix.Translation(-seat))
    parts['optic_scope'] = scope
    # shotgun (photo-textured)
    sg, new = load_reference(sc, 'shotgun'); created += new
    parts['body_shotgun'] = join(sc, 'body_shotgun', [copy_mesh(sc, o, n, to_gun('shotgun')) for n, o in sg.items()])
    for o in created:
        if o.name in bpy.data.objects: bpy.data.objects.remove(o, do_unlink=True)
    for name in ('barrel_std', 'barrel_long'):                # hidden inside the handguard: drop it
        me = parts[name].data; bm = bmesh.new(); bm.from_mesh(me)
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, cut_y, 0), plane_no=(0, 1, 0), clear_inner=True)
        bm.to_mesh(me); bm.free()
    # depth analysis -> atlas -> reliefs
    scans = {n: depth_scan(o) for n, o in parts.items()}
    img, pos, size = pack_atlas(scans)
    mat = atlas_material(img)
    root = bpy.data.objects.new('Gun', None); sc.collection.objects.link(root)
    tris = {}
    for name, ob in parts.items():
        bpy.data.objects.remove(ob, do_unlink=True)
        rob, n = build_relief(sc, name, scans[name], pos[name], size)
        rob.name = name; rob.data.name = name; rob.data.materials.append(mat); rob.parent = root; tris[name] = n
    k = (2.531 + 0.156) * (LONG_BARREL - 1)
    muzzles = {'muzzle_std': gun_point('ar', REFS['ar']['muzzle'], bore), 'muzzle_long': gun_point('ar', REFS['ar']['muzzle'] + k, bore),
               'muzzle_sniper': gun_point('sniper', REFS['sniper']['muzzle'], REFS['sniper']['bore']),
               'muzzle_shotgun': gun_point('shotgun', REFS['shotgun']['muzzle'], REFS['shotgun']['bore'])}
    for name, p in muzzles.items():
        e = bpy.data.objects.new(name, None); sc.collection.objects.link(e); e.parent = root; e.location = p; e.empty_display_size = 0.01
    mount_sg = Vector(gun_point('shotgun', *REFS['shotgun']['mount']))
    anchors = dict(units='metres', axes='blender gun space: +Y muzzle, +Z up, +X right; origin = grip (glTF: x, z, -y)',
                   grip=[0, 0, 0],
                   support={'rifle': list(gun_point('ar', *REFS['ar']['support'])), 'sniper': list(gun_point('sniper', *REFS['sniper']['support'])),
                            'shotgun': list(gun_point('shotgun', *REFS['shotgun']['support']))},
                   muzzles={k: list(v) for k, v in muzzles.items()},
                   bores={'rifle': gun_point('ar', 0, bore)[2], 'sniper': gun_point('sniper', 0, REFS['sniper']['bore'])[2],
                          'shotgun': gun_point('shotgun', 0, REFS['shotgun']['bore'])[2]},
                   scopeOffset={'rifle': [0, 0, 0], 'shotgun': [round(v, 4) for v in (mount_sg - mount_ar)]},
                   bodies={'body_rifle': 'rifle', 'body_sniper': 'sniper', 'body_shotgun': 'shotgun'},
                   triangles=tris, totalTriangles=sum(tris.values()),
                   references={'rifle': 'Low-poly Colt M5 SCW (m5 scw.blend)', 'sniper': 'Low-Poly L118A1 (usdz, Sketchfab export)',
                               'shotgun': 'pump shotgun (shotgun.obj + reference photo)', 'note': 'supplied by Leon; licences to confirm'},
                   source='tools/art/blender/gun_kit.py')
    return sc, root, anchors

def export(sc, root, anchors):
    os.makedirs(OUT_DIR, exist_ok=True)
    glb = os.path.join(OUT_DIR, 'gun-kit.glb')
    vl = sc.view_layers[0]
    for o in list(vl.objects):
        if o: o.select_set(False, view_layer=vl)
    for o in [root, *root.children_recursive]: o.select_set(True, view_layer=vl)
    kw = dict(filepath=glb, export_format='GLB', use_selection=True, use_active_scene=True, export_apply=True, export_yup=True,
              export_texcoords=True, export_normals=True, export_image_format='AUTO', export_extras=False, export_cameras=False,
              export_lights=False, export_animations=False)
    _in_scene(sc, lambda: bpy.ops.export_scene.gltf(**kw))
    with open(os.path.join(OUT_DIR, 'gun-kit.json'), 'w') as f: f.write(json.dumps(anchors, indent=2) + '\n')
    return dict(glb=glb, bytes=os.path.getsize(glb), triangles=anchors['triangles'], total=anchors['totalTriangles'])

POOLS = ('meshes', 'materials', 'images', 'armatures', 'actions', 'cameras', 'lights', 'node_groups', 'textures')

def run():
    before = {p: set(getattr(bpy.data, p)) for p in POOLS}
    try:
        sc, root, anchors = build(); return export(sc, root, anchors)
    finally:
        sc = bpy.data.scenes.get(SCENE)
        if sc:
            for o in list(sc.collection.all_objects): bpy.data.objects.remove(o, do_unlink=True)
            if len(bpy.data.scenes) > 1: bpy.data.scenes.remove(sc)
        for p in POOLS:                                   # remove only what this run created
            pool = getattr(bpy.data, p)
            for d in [d for d in pool if d not in before[p]]:
                try: pool.remove(d)
                except Exception: pass

if __name__ == '__main__':
    print(run())
