"""One new painted soldier plane, separate interchangeable gun collections. No puppet or armature."""
import bpy,json,os
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../../..'))
def build():
    root=os.path.join(ROOT,'tools/art/sprites/ranger-01');data=json.load(open(os.path.join(root,'static-gun-layout.json')));aspect=data['width']/data['height'];scenes=set()
    image=bpy.data.images.load(os.path.join(ROOT,'client/public/assets/characters/ranger-01',data['image']),check_existing=False);image.pack()
    mat=bpy.data.materials.new('New static soldier painting');mat.use_nodes=True;nt=mat.node_tree;nt.nodes.clear();tex=nt.nodes.new('ShaderNodeTexImage');tex.image=image
    em=nt.nodes.new('ShaderNodeEmission');nt.links.new(tex.outputs['Color'],em.inputs['Color']);trans=nt.nodes.new('ShaderNodeBsdfTransparent');mix=nt.nodes.new('ShaderNodeMixShader');nt.links.new(tex.outputs['Alpha'],mix.inputs[0]);nt.links.new(trans.outputs[0],mix.inputs[1]);nt.links.new(em.outputs[0],mix.inputs[2]);out=nt.nodes.new('ShaderNodeOutputMaterial');nt.links.new(mix.outputs[0],out.inputs['Surface']);mat.surface_render_method='DITHERED'
    for family,layout in data['layouts'].items():
        s=bpy.data.scenes.new('STATIC BACKSHOT / '+family);scenes.add(s);s.render.engine='BLENDER_EEVEE';s.render.film_transparent=True;s.view_settings.view_transform='Standard';s.render.resolution_x=data['width'];s.render.resolution_y=data['height'];s.render.resolution_percentage=100
        cam=bpy.data.objects.new('Reference pose camera',bpy.data.cameras.new('Static camera'));s.collection.objects.link(cam);cam.location=(aspect/2,.5,10);cam.data.type='ORTHO';cam.data.ortho_scale=aspect;s.camera=cam
        mesh=bpy.data.meshes.new('Whole soldier, single plane');mesh.from_pydata([(0,0,.03),(aspect,0,.03),(aspect,1,.03),(0,1,.03)],[],[(0,1,2,3)]);uv=mesh.uv_layers.new()
        for loop,co in zip(uv.data,[(0,0),(1,0),(1,1),(0,1)]):loop.uv=co
        ob=bpy.data.objects.new('Soldier / static artwork',mesh);s.collection.objects.link(ob);mesh.materials.append(mat);ob['source']='New painting from supplied screenshot. No legacy sprite pixels.'
        gunmat=bpy.data.materials.new(family+' gun reference');gunmat.diffuse_color=(.15,.18,.14,1)
        for spec in layout['meshes']:
            mesh=bpy.data.meshes.new(spec['name']);mesh.from_pydata([(x*aspect,y,.01+z*.001) for x,y,z in spec['vertices']],[],spec['faces']);mesh.materials.append(gunmat);ob=bpy.data.objects.new('GUN / '+spec['name'],mesh);s.collection.objects.link(ob)
        s['technique']='One static character plane; only gun selection changes.'
    path=os.path.join(root,'ranger-static-backshot.blend')
    if bpy.context.window:bpy.context.window.scene=next(s for s in scenes if s.name.endswith('rifle'))
    bpy.ops.wm.save_as_mainfile(filepath=path,copy=True)
    return {'file':path,'scenes':len(scenes),'bodyPlanesPerScene':1,'armatures':0,'shapeKeys':0,'oldSpritesIncluded':False}
if __name__=='__main__':print(build())
