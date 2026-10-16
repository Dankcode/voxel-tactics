"""Assemble supplied reference meshes at one physical scale; keep every part traceable.
No relief reconstruction, cross-family scope, or independent component rescaling.
Blender MCP: runpy.run_path(PATH)['run'](). Characters are never created here.
"""
import bpy,runpy,os,json,math
from mathutils import Vector
BASE=runpy.run_path(os.path.join(os.path.dirname(__file__),'gun_kit.py'))
ROOT=BASE['REPO'];OUT=os.path.join(ROOT,'client/public/assets/weapons/ranger-preview')
ROLES={'body':'Stock / receiver / barrel assembly','receiver':'Receiver','stock':'Buttstock','grip':'Trigger grip','foregrip':'Handguard / foregrip','magazine':'Magazine','barrel':'Barrel + muzzle','sight':'Iron sights','scope':'Scope'}

def run():
 sc=bpy.data.scenes.get('VT_WeaponReference')
 if sc:
  for o in list(sc.objects):bpy.data.objects.remove(o,do_unlink=True)
 else:sc=bpy.data.scenes.new('VT_WeaponReference')
 root=bpy.data.objects.new('Gun',None);sc.collection.objects.link(root)
 parts={};families={};created=[]
 def make(key,name,role,objs,matrix=None):
  ob=BASE['join'](sc,name,[BASE['copy_mesh'](sc,o,'source copy',matrix or BASE['to_gun'](key)) for o in objs]);ob.parent=root
  # Keep source geometry, apply one family-wide metre conversion, and one neutral live-lit material.
  mat=bpy.data.materials.new(name+' material');mat.diffuse_color=({'stock':(.11,.13,.12,1),'grip':(.085,.09,.095,1),'magazine':(.09,.105,.11,1),'scope':(.07,.085,.095,1),'foregrip':(.10,.12,.13,1)}.get(role,(.15,.17,.18,1)))
  mat.use_nodes=True;bs=mat.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=mat.diffuse_color;bs.inputs['Roughness'].default_value=.48;bs.inputs['Metallic'].default_value=.55
  ob.data.materials.clear();ob.data.materials.append(mat)
  for face in ob.data.polygons:face.material_index=0
  ob['reference_objects']=[o.name for o in objs];ob['reference_role']=ROLES.get(role,role);ob['reference_file']=BASE['REFS'][key]['file'];ob['units']='metres';ob['family_scale']=BASE['REFS'][key]['unit']
  parts[name]=ob;return ob
 ar,new=BASE['load_reference'](sc,'ar');created+=new
 groups={'receiver':['m5scw lower','m5scw upper','m5scw trigga','m5scw dust cover','m5scw charging handle','m5scw selector','m5scw bolt catch R','m5scw bolt catch L','m5scw bolt','m5scw mag catch R','m5scw mag catch L'], 'stock':['m5scw stock'],'grip':['m5scw grip'],'foregrip':['m5scw handguard'],'magazine':['55645 ar15 30rnd mag empty (pmag)'],'barrel':['m5scw 10.3in barrel ','m5scw flash hider'],'sight':['m5scw iron sights']}
 for role,names in groups.items():make('ar','rifle_'+role,role,[ar[n] for n in names])
 sn,new=BASE['load_reference'](sc,'sniper');created+=new
 make('sniper','sniper_body','body',[o for n,o in sn.items() if not n.startswith('Cylinder_000')])
 make('sniper','sniper_scope','scope',[o for n,o in sn.items() if n.startswith('Cylinder_000')])
 sg,new=BASE['load_reference'](sc,'shotgun');created+=new;make('shotgun','shotgun_body','body',list(sg.values()))
 for o in created:
  if o.name in bpy.data.objects:bpy.data.objects.remove(o,do_unlink=True)
 sc.view_layers[0].update()
 def bounds(ob):
  vs=[v.co for v in ob.data.vertices];return [[min(v[i] for v in vs) for i in range(3)],[max(v[i] for v in vs) for i in range(3)]]
 def stock(names):
  vs=[v.co for n in names for v in parts[n].data.vertices];rear=min(v.y for v in vs);tail=[v for v in vs if v.y<rear+.006]
  return [0,rear,(min(v.z for v in tail)+max(v.z for v in tail))/2]
 assemblies={}
 for family,key,names in [('rifle','ar',[n for n in parts if n.startswith('rifle_')]),('sniper','sniper',['sniper_body','sniper_scope']),('shotgun','shotgun',['shotgun_body'])]:
  ref=BASE['REFS'][key];mu=list(BASE['gun_point'](key,ref['muzzle'],ref['bore']));support=list(BASE['gun_point'](key,*ref['support']));st=stock(['rifle_stock'] if family=='rifle' else names)
  assemblies[family]={'parts':names,'stock':st,'support':support,'muzzle':mu,'grip':[0,0,0],'source':ref['file'],'referenceLengthMetres':{'rifle':.705,'sniper':1.18,'shotgun':1.02}[family]}
  allbounds=[bounds(parts[n]) for n in names];minimum=min(b[0][1] for b in allbounds);maximum=max(b[1][1] for b in allbounds)
  assemblies[family]['measuredLengthMetres']=maximum-minimum
 anchors={'units':'metres','axes':'Blender +Y muzzle +Z up; glTF (x,z,-y)','assemblies':assemblies,'parts':{n:{'role':o['reference_role'],'source':o['reference_file'],'bounds':bounds(o),'scale':list(o.scale),'sourceObjects':list(o['reference_objects'])} for n,o in parts.items()},'source':'tools/art/blender/ranger_guns.py'}
 for family,a in assemblies.items():
  for role in ['stock','grip','support','muzzle']:
   e=bpy.data.objects.new(family+'__'+role,None);sc.collection.objects.link(e);e.parent=root;e.location=a[role];e.empty_display_type='SPHERE';e.empty_display_size=.012;e['reference_role']=role;e['units']='metres'
 os.makedirs(OUT,exist_ok=True)
 for ob in sc.objects:ob.select_set(False,view_layer=sc.view_layers[0])
 for ob in [root,*root.children_recursive]:ob.select_set(True,view_layer=sc.view_layers[0])
 BASE['_in_scene'](sc,lambda:bpy.ops.export_scene.gltf(filepath=OUT+'/gun-kit.glb',export_format='GLB',use_selection=True,use_active_scene=True,export_apply=True,export_yup=True,export_extras=True,export_cameras=False,export_lights=False))
 with open(OUT+'/gun-kit.json','w') as f:json.dump(anchors,f,indent=2)
 # Labelled equal-scale reference: real source assemblies, side-on, with physical anchor markers.
 colours=[(.15,.8,.85,1),(.95,.65,.2,1),(.8,.3,.5,1),(.3,.8,.5,1)]
 for row,(family,a) in enumerate(assemblies.items()):
  z=1.15-row*.6
  for name in a['parts']:parts[name].location.z+=z
  def text(name,label,y,z,size=.027):
   curve=bpy.data.curves.new(name,'FONT');curve.body=label;curve.size=size;curve.extrude=0
   ob=bpy.data.objects.new(name,curve);sc.collection.objects.link(ob);ob.location=(.18,y,z);ob.rotation_euler=(math.pi/2,0,math.pi/2)
   material=bpy.data.materials.get('Reference white')
   if not material:
    material=bpy.data.materials.new('Reference white');material.diffuse_color=(.9,.95,.98,1);material.use_nodes=True;b=material.node_tree.nodes.get('Principled BSDF');b.inputs['Base Color'].default_value=(.9,.95,.98,1);b.inputs['Emission Color'].default_value=(.9,.95,.98,1);b.inputs['Emission Strength'].default_value=.5
   curve.materials.append(material)
  text(family+' title',family.upper()+'  '+str(round(a['measuredLengthMetres'],3))+' m',-.4,z+.24,.038)
  for i,role in enumerate(['stock','grip','support','muzzle']):
   p=a[role];e=bpy.data.objects.get(family+'__'+role);e.location.z+=z
   # Small coloured 3D marker and a numbered legend, no re-positioning of gun components.
   mesh=bpy.data.meshes.new('reference mark');mesh.from_pydata([(.12,p[1]-.008,p[2]+z-.008),(.12,p[1]+.008,p[2]+z-.008),(.12,p[1]+.008,p[2]+z+.008),(.12,p[1]-.008,p[2]+z+.008)],[],[(0,1,2,3)])
   marker=bpy.data.objects.new(family+' '+role+' marker',mesh);sc.collection.objects.link(marker)
   text(family+role,str(i+1),p[1]-.007,p[2]+z+.018,.025)
  if family=='rifle':
   palette=[(.15,.65,.85,1),(.9,.45,.15,1),(.5,.6,.7,1),(.25,.7,.38,1),(.85,.7,.15,1),(.85,.25,.3,1),(.65,.35,.8,1)]
   for index,name in enumerate(a['parts']):
    ob=parts[name];b=bounds(ob);cy=(b[0][1]+b[1][1])/2;cz=(b[0][2]+b[1][2])/2+z
    material=ob.data.materials[0];material.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=palette[index]
    material.node_tree.nodes.get('Principled BSDF').inputs['Metallic'].default_value=.1
    text(name+' label',chr(65+index),cy,cz+.035,.028)
   text('AR roles','A Receiver   B Stock   C Trigger grip   D Foregrip',-.4,z-.22,.022)
   text('AR roles 2','E Magazine   F Barrel + muzzle   G Sights',-.4,z-.26,.022)
  else:text(family+' legend','1 Stock / armpit   2 Trigger grip   3 Foregrip   4 Muzzle',-.4,z-.25,.024)
 text('parts legend','AR parts: stock | grip | receiver | handguard | magazine | barrel | sights',-.4,1.55,.025)
 text('scale rule','SAME METRE SCALE - source components keep their authored mounts',-.4,-.5,.026)
 cam=bpy.data.objects.new('Reference camera',bpy.data.cameras.new('Reference camera'));sc.collection.objects.link(cam);cam.location=(5,.22,.55);cam.rotation_euler=(Vector((0,.22,.55))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=2.15;sc.camera=cam
 for name,loc,power in [('Reference key',(3,-1,4),700),('Reference fill',(2,3,1),450)]:
  l=bpy.data.objects.new(name,bpy.data.lights.new(name,'AREA'));sc.collection.objects.link(l);l.location=loc;l.rotation_euler=(Vector((0,.2,.5))-l.location).to_track_quat('-Z','Y').to_euler();l.data.energy=power;l.data.shape='DISK';l.data.size=4
 sc.world=bpy.data.worlds.new('Reference background');sc.world.color=(.025,.035,.045);sc.render.engine='BLENDER_EEVEE';sc.render.resolution_x=1600;sc.render.resolution_y=1600;sc.render.resolution_percentage=100;sc.view_settings.view_transform='AgX';sc.render.image_settings.file_format='PNG';sc.render.filepath=OUT+'/gun-reference.png';bpy.ops.render.render(write_still=True,scene=sc.name)
 if bpy.context.window:bpy.context.window.scene=sc
 for area in bpy.context.screen.areas if bpy.context.screen else []:
  if area.type=='VIEW_3D':area.spaces.active.region_3d.view_perspective='CAMERA';area.spaces.active.shading.type='MATERIAL'
 bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT,'tools/art/sprites/ranger-01/gun-reference.blend'),copy=True)
 return {'assemblies':assemblies,'labelledReference':OUT+'/gun-reference.png','parts':len(parts),'allPartScalesIdentity':all(all(abs(s-1)<1e-6 for s in ob.scale) for ob in parts.values())}
if __name__=='__main__':print(run())
