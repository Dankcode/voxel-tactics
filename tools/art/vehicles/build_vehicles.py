"""PLAN-12: build client/public/assets/kit/vehicles.glb (car_sedan, car_pickup) from tools/art/vehicles/source/.

Run inside Blender (5.x), e.g. through the Blender MCP or:  blender -b -P tools/art/vehicles/build_vehicles.py
Works in its own scene ("vehicles_build"), so an open file is not disturbed.

  sedan  = civic.fbx (PSX-style, ~720 tris, already low) — body + 4 wheels joined, turned so the front faces +X.
  pickup = pickup3.obj (photo scan, 68,877 tris) — straightened by its principal axes (it is upside down and tilted
           in the source), decimated to ~1,600 tris, widened 15 % to fill the 2-cell footprint.
Both are scaled to 3.9 m long (the 4 x 2 cell parked-car footprint), centred, wheels on z = 0. Materials are named
after the renderer's slots: veh_sedan / veh_pickup (own UV textures) and glass_dark. Textures are written small:
256 / 512 px (desktop, client/public/assets/textures/pbr) and 128 / 256 px (mobile). The GLB carries no images.
"""
import bpy, mathutils, math, os
import numpy as np

REPO = os.path.abspath(os.path.join(os.path.dirname(bpy.data.filepath or __file__), '..', '..', '..')) if '__file__' in dir() else os.getcwd()
SRC = os.path.join(REPO, 'tools/art/vehicles/source/')

def main():
    scn = bpy.data.scenes.get('vehicles_build') or bpy.data.scenes.new('vehicles_build')
    bpy.context.window.scene = scn
    for o in list(scn.objects): bpy.data.objects.remove(o, do_unlink=True)
    vl = bpy.context.view_layer
    def sel(objs):
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs: o.select_set(True)
        vl.objects.active = objs[0]
    def imp(fn, path):
        before = set(bpy.data.objects); fn(filepath=path); return [o for o in bpy.data.objects if o not in before]
    sed = imp(bpy.ops.import_scene.fbx, SRC + 'civic.fbx')
    pk = imp(bpy.ops.wm.obj_import, SRC + 'pickup3.obj')[0]
    body = [o for o in sed if o.name.startswith('body')][0]; wheels = [o for o in sed if o.name.startswith('cvc_wheel')]
    sel(wheels); bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    sel([body] + wheels); bpy.ops.object.transform_apply(location=True, rotation=True, scale=True); vl.objects.active = body; bpy.ops.object.join()
    sedan = vl.objects.active; sedan.name = 'car_sedan'
    sedan.rotation_euler = (0, 0, math.radians(90)); sel([sedan]); bpy.ops.object.transform_apply(rotation=True)
    # Pickup: principal axes → (length, width, up), then decimate.
    M = np.array(pk.matrix_world); co = np.zeros(len(pk.data.vertices) * 3); pk.data.vertices.foreach_get('co', co)
    w = (np.c_[co.reshape(-1, 3), np.ones(len(co) // 3)] @ M.T)[:, :3]; c = w.mean(0)
    vals, vecs = np.linalg.eigh(np.cov((w - c).T)); vecs = vecs[:, np.argsort(vals)[::-1]]
    R = mathutils.Matrix(vecs.T.tolist())
    if R.determinant() < 0: R[1] = -R[1]
    pk.matrix_world = R.to_4x4() @ mathutils.Matrix.Translation(-mathutils.Vector(c)) @ pk.matrix_world
    # The scan's up axis came out as +Z with the front at +X; check the renders in output/review/vehicles if the source changes.
    sel([pk]); bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    tris = sum(len(p.vertices) - 2 for p in pk.data.polygons)
    mod = pk.modifiers.new('dec', 'DECIMATE'); mod.ratio = 1600 / tris; mod.use_collapse_triangulate = True; bpy.ops.object.modifier_apply(modifier='dec')
    pk.name = 'car_pickup'
    for o, widen in ((sedan, 1.0), (pk, 1.15)):
        bb = [o.matrix_world @ mathutils.Vector(v) for v in o.bound_box]
        mn = mathutils.Vector([min(v[i] for v in bb) for i in range(3)]); mx = mathutils.Vector([max(v[i] for v in bb) for i in range(3)])
        s = 3.9 / (mx.x - mn.x)
        o.location = (-(mn.x + mx.x) / 2 * s, -(mn.y + mx.y) / 2 * s * widen, -mn.z * s); o.scale = (s, s * widen, s)
        sel([o]); bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    names = {'Material.004': 'veh_sedan', 'Material.001': 'glass_dark', 'pickup3': 'veh_pickup'}
    for o in (sedan, pk):
        for m in o.data.materials:
            if m and m.name in names: m.name = names[m.name]
    for src, key, sizes in (('cvc_grey.png', 'veh_sedan', (256, 128)), ('pickup3.jpg', 'veh_pickup', (512, 256))):
        img = bpy.data.images.load(SRC + src, check_existing=True)
        for d, sz in zip(('pbr', 'mobile'), sizes):
            cp = img.copy(); cp.scale(sz, sz); path = os.path.join(REPO, f'client/public/assets/textures/{d}/{key}.jpg')
            cp.filepath_raw = path; cp.file_format = 'JPEG'; cp.save(); bpy.data.images.remove(cp)
    sel([sedan, pk])
    bpy.ops.export_scene.gltf(filepath=os.path.join(REPO, 'client/public/assets/kit/vehicles.glb'), export_format='GLB', use_selection=True,
                              export_apply=True, export_texcoords=True, export_normals=True, export_materials='EXPORT', export_yup=True, export_image_format='NONE')

main()
