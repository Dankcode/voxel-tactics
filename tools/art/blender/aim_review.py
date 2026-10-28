"""Editable flat ArtMesh cards and named keyforms, exported from the in-game puppet. No auto rigging."""
import bpy,json,os
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../../..'))
def build():
    path=os.path.join(ROOT,'tools/art/sprites/ranger-01')
    layouts=json.load(open(os.path.join(path,'aim-layout.json')))
    for family,layout in layouts.items():
        name='PUPPET / '+family
        old=bpy.data.scenes.get(name)
        if old:
            for ob in list(old.objects):bpy.data.objects.remove(ob,do_unlink=True)
            bpy.data.scenes.remove(old)
        scene=bpy.data.scenes.new(name);scene.render.engine='BLENDER_EEVEE';scene.render.film_transparent=True
        scene.render.resolution_x=768;scene.render.resolution_y=768;scene.render.resolution_percentage=100;scene.view_settings.view_transform='Standard'
        cam=bpy.data.objects.new('Orthographic review',bpy.data.cameras.new('Review'));scene.collection.objects.link(cam);cam.location=(.5,.5,10);cam.data.type='ORTHO';cam.data.ortho_scale=1;scene.camera=cam
        for spec in layout['cards']:
            mesh=bpy.data.meshes.new(spec['id']);mesh.from_pydata(spec['shapes']['neutral'],[],spec['faces']);uv=mesh.uv_layers.new()
            for loop in mesh.loops:uv.data[loop.index].uv=spec['uv'][loop.vertex_index]
            ob=bpy.data.objects.new(spec['id'],mesh);scene.collection.objects.link(ob);ob.location.z=spec['zIndex']*.001;ob['technique']='authored-2d-warp';ob['source_image']=spec['image']
            ob.shape_key_add(name='Basis')
            for key,vertices in spec['shapes'].items():
                if key=='neutral':continue
                shape=ob.shape_key_add(name=key)
                for point,co in zip(shape.data,vertices):point.co=co
            image=bpy.data.images.load(os.path.join(ROOT,'client/public/assets/characters/ranger-01',spec['image']),check_existing=True);image.reload()
            mat=bpy.data.materials.new(family+' / '+spec['id']);mat.use_nodes=True;nt=mat.node_tree;nt.nodes.clear()
            tex=nt.nodes.new('ShaderNodeTexImage');tex.image=image;em=nt.nodes.new('ShaderNodeEmission');nt.links.new(tex.outputs['Color'],em.inputs['Color']);trans=nt.nodes.new('ShaderNodeBsdfTransparent');mix=nt.nodes.new('ShaderNodeMixShader');nt.links.new(tex.outputs['Alpha'],mix.inputs[0]);nt.links.new(trans.outputs[0],mix.inputs[1]);nt.links.new(em.outputs[0],mix.inputs[2]);out=nt.nodes.new('ShaderNodeOutputMaterial');nt.links.new(mix.outputs[0],out.inputs['Surface']);mat.surface_render_method='DITHERED';mesh.materials.append(mat)
        mat=bpy.data.materials.new('Gun reference graphite');mat.diffuse_color=(.12,.15,.17,1)
        for spec in layout['meshes']:
            mesh=bpy.data.meshes.new(spec['name']);mesh.from_pydata([(x,y,.04+z*.001) for x,y,z in spec['vertices']],[],spec['faces']);mesh.materials.append(mat)
            ob=bpy.data.objects.new('GUN reference / '+spec['name'],mesh);scene.collection.objects.link(ob)
        for side,joints in layout['arms']['joints'].items():
            for key in ['shoulder','elbow','wrist','palm']:
                p=joints[key];ob=bpy.data.objects.new(side+' / '+key,None);scene.collection.objects.link(ob);ob.location=(p['x']/768,1-p['y']/768,.12);ob.empty_display_type='CIRCLE';ob.empty_display_size=.012
        scene['authoring']='Edit flat meshes / named shape keys. Runtime source is formula.json puppet.keyforms; Blender edits are review-only until transferred to the workbench.'
    scene=bpy.data.scenes['PUPPET / rifle']
    if bpy.context.window:bpy.context.window.scene=scene
    for image in bpy.data.images:
        if image.filepath and not image.packed_file:image.pack()
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(path,'ranger-puppet.blend'),copy=True)
    return {'file':os.path.join(path,'ranger-puppet.blend'),'scenes':3,'technique':'authored-2d-warp','armatures':0,'keyforms':['aimXNegative','aimXPositive','aimYNegative','aimYPositive','recoil']}
if __name__=='__main__':print(build())
