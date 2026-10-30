"""Actual metre-space gun geometry, fixed painted shoulder and independently checked bore ray."""
import bpy, json, math, os
from mathutils import Matrix, Vector
from bpy_extras.object_utils import world_to_camera_view
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../../..'))

def build():
    root=os.path.join(ROOT,'tools/art/sprites/ranger-01')
    data=json.load(open(os.path.join(root,'static-gun-layout.json')))
    aspect=data['width']/data['height']; fov=math.radians(data['rig']['gunView']['verticalFovDeg'])
    # three.js x/right, y/up, -z/forward -> Blender x/right, y/forward, z/up.
    axes=Matrix(((1,0,0,0),(0,0,-1,0),(0,1,0,0),(0,0,0,1)))
    for scene in list(bpy.data.scenes):
        if scene.name.startswith('SHOULDER AUDIT / '): bpy.data.scenes.remove(scene)
    image=bpy.data.images.load(os.path.join(ROOT,'client/public/assets/characters/ranger-01',data['image']),check_existing=True);image.pack()
    mat=bpy.data.materials.new('Static shoulder / unchanged painting');mat.use_nodes=True
    nt=mat.node_tree;nt.nodes.clear();tex=nt.nodes.new('ShaderNodeTexImage');tex.image=image
    em=nt.nodes.new('ShaderNodeEmission');nt.links.new(tex.outputs['Color'],em.inputs['Color'])
    trans=nt.nodes.new('ShaderNodeBsdfTransparent');mix=nt.nodes.new('ShaderNodeMixShader');nt.links.new(tex.outputs['Alpha'],mix.inputs[0]);nt.links.new(trans.outputs[0],mix.inputs[1]);nt.links.new(em.outputs[0],mix.inputs[2]);out=nt.nodes.new('ShaderNodeOutputMaterial');nt.links.new(mix.outputs[0],out.inputs['Surface']);mat.surface_render_method='DITHERED'
    report=[]
    for family,layout in data['layouts'].items():
        scene=bpy.data.scenes.new('SHOULDER AUDIT / '+family)
        scene.render.engine='BLENDER_EEVEE';scene.render.film_transparent=True;scene.view_settings.view_transform='Standard'
        scene.render.resolution_x=data['width'];scene.render.resolution_y=data['height'];scene.render.resolution_percentage=100
        cam=bpy.data.objects.new('Perspective / matched runtime lens',bpy.data.cameras.new('Shoulder camera'));scene.collection.objects.link(cam)
        cam.rotation_euler=Vector((0,1,0)).to_track_quat('-Z','Y').to_euler();cam.data.sensor_fit='VERTICAL';cam.data.sensor_height=32;cam.data.lens=16/math.tan(fov/2);cam.data.clip_start=.01;cam.data.clip_end=500;scene.camera=cam
        # Artwork is in front of the gun, exactly as in the live alpha compositor.
        d=.3;h=2*d*math.tan(fov/2);w=h*aspect
        mesh=bpy.data.meshes.new('Unchanged soldier card');mesh.from_pydata([(-w/2,d,-h/2),(w/2,d,-h/2),(w/2,d,h/2),(-w/2,d,h/2)],[],[(0,1,2,3)])
        uv=mesh.uv_layers.new()
        for loop,co in zip(uv.data,[(0,0),(1,0),(1,1),(0,1)]):loop.uv=co
        ob=bpy.data.objects.new('Soldier / fixed shoulder',mesh);scene.collection.objects.link(ob);mesh.materials.append(mat)
        m=layout['matrix'];matrix=Matrix(tuple(tuple(m[c*4+r] for c in range(4)) for r in range(4)))
        transform=axes@matrix
        for spec in layout['meshes']:
            mesh=bpy.data.meshes.new(spec['name']);mesh.from_pydata(spec['localVertices'],[],spec['faces'])
            ob=bpy.data.objects.new('3D / '+spec['name'],mesh);scene.collection.objects.link(ob);ob.matrix_world=transform
        def anchor(p):return transform@Vector((p[0],p[2],-p[1]))
        stock=transform@Vector(layout.get('actualStock',(layout['assembly']['stock'][0],layout['assembly']['stock'][2],-layout['assembly']['stock'][1])));muzzle=anchor(layout['assembly']['muzzle'])
        direction=(transform.to_3x3()@Vector((0,0,-1))).normalized();target=axes@Vector(layout['bore']['target'])
        miss=(target-muzzle).cross(direction).length
        for name,point in [('Lowered butt contact',stock),('Muzzle centre',muzzle),('Crosshair target',target)]:
            marker=bpy.data.objects.new(name,None);scene.collection.objects.link(marker);marker.location=point;marker.empty_display_type='SPHERE';marker.empty_display_size=.025;marker.hide_render=True
        if bpy.context.window:bpy.context.window.scene=scene
        bpy.context.view_layer.update()
        stock_uv=world_to_camera_view(scene,cam,stock);target_uv=world_to_camera_view(scene,cam,target)
        stock_error=math.hypot((stock_uv.x-layout['targets']['stock'][0])*data['width'],(1-stock_uv.y-layout['targets']['stock'][1])*data['height'])
        aim=data['rig']['gunView']['aimUV'];target_error=math.hypot((target_uv.x-aim[0])*data['width'],(1-target_uv.y-aim[1])*data['height'])
        assert miss<.0001 and stock_error<.02 and target_error<.02,(family,miss,stock_error,target_error)
        scene['alignment']='Rear stock lowered around unchanged barrel; physical barrel axis intersects crosshair target.'
        report.append({'weapon':family,'stockDropMetres':layout.get('stockDropMetres',0),'boreMissMetres':miss,'stockErrorPixels':stock_error,'crosshairErrorPixels':target_error})
    path=os.path.join(root,'ranger-shoulder-alignment.blend')
    bpy.ops.wm.save_as_mainfile(filepath=path,copy=True)
    with open(os.path.join(root,'shoulder-blender-audit.json'),'w') as out:json.dump({'passed':True,'checks':report,'file':path},out,indent=2)
    return {'passed':True,'checks':report,'file':path}

if __name__=='__main__':print(build())
