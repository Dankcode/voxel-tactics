"""Bake a 2D anime character pack through Blender, never a 3D character.
MCP: import runpy; p=runpy.run_path(PATH); p['build'](); p['bake_field'](); p['bake_heroes']()
CLI: blender -b -P tools/art/sprite_formula.py
The editable formula owns grid layout, arm cutouts, pivots and separate lighting passes.
"""
import bpy, numpy as np, os, json, math, zlib, struct
from collections import deque
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
OUT=os.path.join(ROOT,'client/public/assets/characters/ranger-01')
CONFIG=os.path.join(ROOT,'tools/art/sprites/ranger-01/formula.json')
SRC=os.path.join(os.path.dirname(CONFIG),'source')
CLIPS={'idle':(0,2,2,True),'run':(2,4,12,True),'aim':(6,1,1,True),'fire':(7,2,12,False),'throw':(9,2,6,False),'hit':(11,1,1,False),'down':(12,4,8,False),'stacked':(16,1,1,True),'hunker':(17,1,1,True),'vault':(18,3,7,False),'climb':(21,3,6,True)}
FACINGS=['s','sw','w','nw','n','ne','e','se']
S=None

def read_png(path):
    im=bpy.data.images.load(path,check_existing=False);im.colorspace_settings.name='Non-Color'
    w,h=im.size;data=np.empty(w*h*4,dtype=np.float32);im.pixels.foreach_get(data)
    bpy.data.images.remove(im)
    return data.reshape(h,w,4)[::-1].copy()

def write_png(path,a):
    a=np.clip(a*255+.5,0,255).astype(np.uint8);h,w=a.shape[:2]
    def chunk(t,d):return struct.pack('>I',len(d))+t+d+struct.pack('>I',zlib.crc32(t+d)&0xffffffff)
    raw=b''.join(b'\0'+a[y].tobytes() for y in range(h))
    with open(path+'.tmp','wb') as f:f.write(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(raw,7))+chunk(b'IEND',b''))
    os.replace(path+'.tmp',path)

def resample(a,w,h):
    ys=np.linspace(0,a.shape[0]-1,h);xs=np.linspace(0,a.shape[1]-1,w)
    y0=ys.astype(int);x0=xs.astype(int);y1=np.minimum(y0+1,a.shape[0]-1);x1=np.minimum(x0+1,a.shape[1]-1)
    fy=(ys-y0)[:,None,None];fx=(xs-x0)[None,:,None]
    # Premultiply before filtering so hidden RGB cannot produce dark outlines.
    p=a.copy();p[:,:,:3]*=p[:,:,3:4]
    out=(p[y0[:,None],x0[None,:]]*(1-fx)+p[y0[:,None],x1[None,:]]*fx)*(1-fy)+(p[y1[:,None],x0[None,:]]*(1-fx)+p[y1[:,None],x1[None,:]]*fx)*fy
    out[:,:,:3]/=np.maximum(out[:,:,3:4],1e-5)
    return out.astype(np.float32)

def cleaned_albedo(a):
    # Keep the approved cleaned illustration's RGB, cel shading and fine ink intact.
    # Lighting belongs in normal/response maps, not destructive palette quantization.
    out=a.copy()
    out[:,:,3]=np.where(out[:,:,3]<.04,0,out[:,:,3])
    return out

def lighting_passes(albedo,volumes=()):
    alpha=albedo[:,:,3];h,w=alpha.shape;blur=alpha.copy()
    for i in range(8):blur=(blur*4+np.roll(blur,1,0)+np.roll(blur,-1,0)+np.roll(blur,1,1)+np.roll(blur,-1,1))/8
    height=blur*.15
    yy,xx=np.mgrid[:h,:w];xx=xx/w;yy=yy/h
    for cx,cy,rx,ry,strength in volumes:
        d=((xx-cx)/rx)**2+((yy-cy)/ry)**2
        height+=np.sqrt(np.maximum(0,1-d))*strength*alpha
    gy,gx=np.gradient(height);n=np.stack([-gx*70,gy*70,np.ones_like(alpha)],axis=2)
    n/=np.maximum(np.linalg.norm(n,axis=2,keepdims=True),1e-5)
    normal=np.concatenate([n*.5+.5,alpha[:,:,None]],axis=2)
    # Saturated magenta is metadata, never a visible painted highlight. R=direct light, B=ambient, G=emission.
    mask=np.zeros_like(albedo);mask[:,:,0]=1;mask[:,:,2]=1;mask[:,:,3]=alpha
    return normal,mask

def bounds(a):
    y,x=np.where(a[:,:,3]>.025)
    return (int(x.min()),int(y.min()),int(x.max()+1),int(y.max()+1)) if len(x) else (0,0,a.shape[1],a.shape[0])

def largest(a):
    a=a.copy();a[:,:,3]=np.where(a[:,:,3]<.04,0,a[:,:,3])
    mask=a[:,:,3]>.05;seen=np.zeros(mask.shape,dtype=bool);best=[];h,w=mask.shape
    for y,x in zip(*np.where(mask)):
        if seen[y,x]:continue
        seen[y,x]=True;q=deque([(int(y),int(x))]);component=[]
        while q:
            yy,xx=q.pop();component.append((yy,xx))
            for dy,dx in [(1,0),(-1,0),(0,1),(0,-1)]:
                ny,nx=yy+dy,xx+dx
                if 0<=ny<h and 0<=nx<w and mask[ny,nx] and not seen[ny,nx]:seen[ny,nx]=True;q.append((ny,nx))
        if len(component)>len(best):best=component
    keep=np.zeros(mask.shape,dtype=bool)
    if best:
        y,x=zip(*best);keep[y,x]=True
        # Keep antialiasing directly next to the connected ink silhouette.
        keep=keep|np.roll(keep,1,0)|np.roll(keep,-1,0)|np.roll(keep,1,1)|np.roll(keep,-1,1)
        a=a.copy();a[:,:,3]*=keep
    return a

def row_bounds(a,rows=3):
    p=np.sum(a[:,:,3]>.08,axis=1);h=len(p);cuts=[0]
    for f in [i/rows for i in range(1,rows)]:
        lo,hi=int(h*(f-.09)),int(h*(f+.09));s=p[lo:hi]
        low=np.where(s<=max(2,s.max()*.015))[0]
        if len(low):
            runs=np.split(low,np.where(np.diff(low)>1)[0]+1);run=max(runs,key=lambda r:len(r)-abs(np.mean(r)+lo-h*f)*.015);cut=int(lo+np.mean(run))
        else:cut=lo+int(np.argmin(s))
        cuts.append(cut)
    return cuts+[h]

def bake_field():
    fw,fh,columns=192,256,24;atlas=np.zeros((fh*8,fw*columns,4),dtype=np.float32);sources=[]
    names={col+i:(clip,i) for clip,(col,n,fps,loop) in CLIPS.items() for i in range(n)}
    old={'idle':0,'aim':6,'fire':7,'throw':9,'hit':11,'stacked':13,'hunker':14,'vault':15,'climb':18}
    for row,facing in enumerate(FACINGS):
        original=read_png(os.path.join(SRC,'field-'+facing+'.png'))
        actions=read_png(os.path.join(SRC,'run-down-'+facing+'.png'))
        for col in range(columns):
            kind,frame=names[col]
            a=actions if kind in ('run','down') else original
            count=4 if kind in ('run','down') else 7
            source_index=(frame if kind=='run' else frame+4) if kind in ('run','down') else old[kind]+frame
            h,w=a.shape[:2];cuts=row_bounds(a,2 if count==4 else 3)
            sr,sc=divmod(source_index,count);x0,x1=round(w*sc/count),round(w*(sc+1)/count);y0,y1=cuts[sr],cuts[sr+1]
            cell=largest(a[y0:y1,x0:x1].copy());box=bounds(cell);cell=cell[box[1]:box[3],box[0]:box[2]]
            if kind=='down':
                height=232*[.92,.64,.40,.28][frame]
                scale=min(height/max(1,cell.shape[0]),176/max(1,cell.shape[1]))
            else:
                height=232*{'hunker':.62,'stacked':.85,'vault':.82,'climb':.98,'run':.96}.get(kind,1)
                scale=min(height/max(1,cell.shape[0]),174/max(1,cell.shape[1]))
            tw,th=max(1,round(cell.shape[1]*scale)),max(1,round(cell.shape[0]*scale));th=min(th,240);tw=min(tw,180)
            cell=cleaned_albedo(resample(cell,tw,th));px=(fw-tw)//2;py=fh-8-th
            atlas[row*fh+py:row*fh+py+th,col*fw+px:col*fw+px+tw]=cell
            sources.append({'facing':facing,'column':col,'clip':kind,'frame':frame,'source':('run-down-' if count==4 else 'field-')+facing+'.png','sourceRect':[x0,y0,x1,y1]})
    preview=np.concatenate([atlas[:256,2*192:6*192],atlas[:256,12*192:16*192],atlas[2*256:3*256,2*192:6*192],atlas[2*256:3*256,12*192:16*192]],axis=0)
    write_png(os.path.join(os.path.dirname(CONFIG),'run-downed-preview.png'),preview)
    write_png(os.path.join(OUT,'field.png'),atlas);normal,mask=lighting_passes(atlas,[( (c+.5)/columns,(r+.45)/8,.32/columns,.40/8,.22) for r in range(8) for c in range(columns)])
    write_png(os.path.join(OUT,'field-normal.png'),normal);write_png(os.path.join(OUT,'field-lighting.png'),mask)
    manifest={'version':2,'character':'ranger-01','placeholder':False,'image':'field.png','normal':'field-normal.png','lightingMask':'field-lighting.png','frameWidth':fw,'frameHeight':fh,'columns':columns,'rows':8,'facings':FACINGS,'anchor':[.5,8/fh],'worldHeight':2.4,
        'clips':{k:dict(column=v[0],frames=v[1],fps=v[2],loop=v[3]) for k,v in CLIPS.items()},'events':{'fire':{'frame':0,'event':'muzzle'}},'notes':'One 2D anime identity; 8 illustrated facing sheets; cleaned source colours and line art + separate tangent normals and magenta light-response mask. No 3D character.'}
    with open(os.path.join(OUT,'field.json'),'w') as f:json.dump(manifest,f,indent=2)
    with open(os.path.join(OUT,'sprite-list.json'),'w') as f:json.dump({'character':'ranger-01','frames':sources,'formula':'tools/art/sprite_formula.py'},f,indent=2)
    # Matching UI head: the first front-facing illustrated frame, never an unrelated character.
    front=read_png(os.path.join(SRC,'field-s.png'));cuts=row_bounds(front);head=largest(front[:round(cuts[1]*.36),:round(front.shape[1]/7)])
    bb=bounds(head);head=head[bb[1]:bb[3],bb[0]:bb[2]];size=256;out=np.zeros((size,size,4),dtype=np.float32);sc=min(236/head.shape[1],236/head.shape[0]);head=resample(head,round(head.shape[1]*sc),round(head.shape[0]*sc));oy=(size-head.shape[0])//2;ox=(size-head.shape[1])//2;out[oy:oy+head.shape[0],ox:ox+head.shape[1]]=cleaned_albedo(head);write_png(os.path.join(OUT,'portrait.png'),out)
    return {'frames':len(sources),'size':[fw*columns,fh*8],'rowBounds':'auto from transparent gutters'}

def poly_mask(points,w,h):
    yy,xx=np.mgrid[:h,:w];x=(xx+.5)/w;y=(yy+.5)/h;inside=np.zeros((h,w),dtype=bool)
    for i,p in enumerate(points):
        q=points[(i+1)%len(points)];cross=((p[1]>y)!=(q[1]>y))&(x<(q[0]-p[0])*(y-p[1])/(q[1]-p[1]+1e-10)+p[0]);inside^=cross
    return inside.astype(np.float32)

def stage_2d(layers,pose='aim'):
    global S
    aspect=json.load(open(CONFIG))['poses'][pose].get('canvasWidth',768)/768
    scene_name='VT_2D_SpriteStudio' if pose=='aim' else 'VT_2D_ReadyStudio'
    sc=bpy.data.scenes.get(scene_name)
    if sc:
        for ob in list(sc.objects):bpy.data.objects.remove(ob,do_unlink=True)
        bpy.data.scenes.remove(sc)
    sc=bpy.data.scenes.new(scene_name);S=sc;sc.render.engine='BLENDER_EEVEE';sc.render.film_transparent=True;sc.render.resolution_x=round(768*aspect);sc.render.resolution_y=768;sc.render.resolution_percentage=100
    sc.render.image_settings.file_format='PNG';sc.render.image_settings.color_mode='RGBA';sc.view_settings.view_transform='Standard'
    world=bpy.data.worlds.new('2D transparent stage');sc.world=world
    cam=bpy.data.objects.new('2D orthographic camera',bpy.data.cameras.new('2D orthographic camera'));sc.collection.objects.link(cam);cam.location=(aspect/2,.5,10);cam.data.type='ORTHO';cam.data.ortho_scale=aspect;sc.camera=cam
    order=lambda l:(l.get('stage')!='back',l.get('order',1 if l['id'].endswith('upper') else 2 if l['id'].endswith('forearm') else 3))
    layers=sorted(layers,key=order)
    for i,layer in enumerate(layers):
        im=bpy.data.images.load(os.path.join(OUT,layer['image']),check_existing=True);im.reload()
        mat=bpy.data.materials.new('2D '+layer['id']);mat.use_nodes=True;nt=mat.node_tree;nt.nodes.clear()
        tex=nt.nodes.new('ShaderNodeTexImage');tex.image=im;em=nt.nodes.new('ShaderNodeEmission');nt.links.new(tex.outputs['Color'],em.inputs['Color']);trans=nt.nodes.new('ShaderNodeBsdfTransparent');mix=nt.nodes.new('ShaderNodeMixShader');nt.links.new(tex.outputs['Alpha'],mix.inputs[0]);nt.links.new(trans.outputs[0],mix.inputs[1]);nt.links.new(em.outputs[0],mix.inputs[2]);out=nt.nodes.new('ShaderNodeOutputMaterial');nt.links.new(mix.outputs[0],out.inputs['Surface'])
        mat.surface_render_method='DITHERED'
        me=bpy.data.meshes.new('Flat image rectangle');me.from_pydata([(0,0,0),(aspect,0,0),(aspect,1,0),(0,1,0)],[],[(0,1,2,3)]);uv=me.uv_layers.new()
        for loop,co in zip(uv.data,[(0,0),(1,0),(1,1),(0,1)]):loop.uv=co
        ob=bpy.data.objects.new(layer['id'],me);sc.collection.objects.link(ob);ob.location.z=i*.001;ob.data.materials.append(mat);ob['sprite_layer']=True;ob['bone']=layer.get('bone','body')
    rig=json.load(open(CONFIG))['poses'][pose]['rig'];pivots={}
    for side,arm in rig['arms'].items():
        parent=None
        for joint in ['shoulder','elbow','wrist','palm']:
            u,v=arm[joint];ob=bpy.data.objects.new(side+' '+joint+' pivot',None);sc.collection.objects.link(ob)
            ob.empty_display_type='CIRCLE';ob.empty_display_size=.018;ob.location=(u*aspect,1-v,.04)
            ob['uv']=[u,v];ob['2D_only']=True
            sc.view_layers[0].update()
            if parent:ob.parent=parent;ob.matrix_parent_inverse=parent.matrix_world.inverted()
            pivots[(side,joint)]=ob;parent=ob
    sc.view_layers[0].update()
    for ob in list(sc.objects):
        bone=ob.get('bone','');bits=bone.split('-')
        if len(bits)==2:
            side,part=bits;joint={'upper':'shoulder','forearm':'elbow','hand':'wrist'}.get(part)
            if (side,joint) in pivots:
                parent=pivots[(side,joint)];ob.parent=parent;ob.matrix_parent_inverse=parent.matrix_world.inverted()
    return sc

def place_section(sheet, spec, start, end, w, h, target_width=None):
    """Pack a complete illustrated section by two artist-authored joint anchors.
    This is an affine atlas placement, never a cut from the body image.
    """
    x0,y0,x1,y1=spec['rect'];src=sheet[y0:y1,x0:x1].copy()
    a=np.array(spec['start'],dtype=float)-[x0,y0];b=np.array(spec['end'],dtype=float)-[x0,y0]
    q=np.array(start)*[w,h];r=np.array(end)*[w,h]
    u=(b-a)/np.linalg.norm(b-a);v=np.array([-u[1],u[0]])
    d=(r-q)/np.linalg.norm(r-q);e=np.array([-d[1],d[0]])
    along=np.linalg.norm(r-q)/np.linalg.norm(b-a)
    across=target_width/spec['sourceWidth'] if target_width else along
    matrix=np.outer(d,u)*along+np.outer(e,v)*across;inverse=np.linalg.inv(matrix)
    yy,xx=np.mgrid[:h,:w];uv=inverse@np.stack([xx.ravel()-q[0],yy.ravel()-q[1]])+a[:,None]
    x,y=uv[0].reshape(h,w),uv[1].reshape(h,w)
    valid=(x>=0)&(y>=0)&(x<src.shape[1]-1)&(y<src.shape[0]-1)
    x=np.clip(x,0,src.shape[1]-1.001);y=np.clip(y,0,src.shape[0]-1.001)
    ix=x.astype(int);iy=y.astype(int);fx=(x-ix)[:,:,None];fy=(y-iy)[:,:,None]
    src[:,:,:3]*=src[:,:,3:4]
    out=(src[iy,ix]*(1-fx)+src[iy,ix+1]*fx)*(1-fy)+(src[iy+1,ix]*(1-fx)+src[iy+1,ix+1]*fx)*fy
    out[:,:,:3]/=np.maximum(out[:,:,3:4],1e-5);out[:,:,3]*=valid
    return cleaned_albedo(out.astype(np.float32))

def over(back,front):
    a=front[:,:,3:4];b=back[:,:,3:4];alpha=a+b*(1-a)
    rgb=(front[:,:,:3]*a+back[:,:,:3]*b*(1-a))/np.maximum(alpha,1e-5)
    return np.concatenate([rgb,alpha],axis=2)

def bake_heroes():
    formula=json.load(open(CONFIG));poses={};contact_audit={}
    for name,p in formula['poses'].items():
        body=cleaned_albedo(resample(read_png(os.path.join(SRC,p['bodySource'])),768,768))
        if p.get('canvasWidth',768)>768:body=np.pad(body,((0,0),(0,p['canvasWidth']-768),(0,0)))
        h,w=body.shape[:2];sheet=read_png(os.path.join(SRC,p['sectionsSource']))
        layers=[];images={};hand_layers={};contact_audit[name]={}
        def emit(id,a,stage,bone=None,order=None):
            filename=name+'-'+id+'.png';normal,mask=lighting_passes(a,p.get('normalVolumes',[]) if id=='body' else [])
            write_png(os.path.join(OUT,filename),a)
            write_png(os.path.join(OUT,name+'-'+id+'-normal.png'),normal)
            write_png(os.path.join(OUT,name+'-'+id+'-lighting.png'),mask)
            layer={'id':id,'image':filename,'normal':name+'-'+id+'-normal.png','lightingMask':name+'-'+id+'-lighting.png','stage':stage}
            if bone:layer['bone']=bone
            if order is not None:layer['order']=order
            layers.append(layer);images[id]=a
        emit('body',body,'back',order=5)
        for part in p['parts']:
            side,kind=part['id'].split('-');arm=p['rig']['arms'][side]
            joints={'upper':('shoulder','elbow'),'forearm':('elbow','wrist'),'hand':('wrist','palm')}[kind]
            start,end=[arm[j] for j in joints]
            width=h*2*max(p['rig']['limbRadii'][kind]) if kind!='hand' else None
            a=place_section(sheet,part,start,end,w,h,width)
            emit(part['id'],a,part['stage'],part['id'],10 if part['id']=='support-hand' else None)
            if kind=='hand':
                hand_layers[side]=a
                if part.get('wrapFingers'):
                    front=sheet.copy();mask=np.maximum.reduce([poly_mask(poly,sheet.shape[1],sheet.shape[0]) for poly in part['wrapFingers']]);front[:,:,3]*=mask
                    fingers=place_section(front,part,start,end,w,h)
                    emit('support-fingers',fingers,'front','support-hand',order=0)
        # The glove socket may be transparent: the gun occupies it. Check the wrist
        # and actual glove pixels around that socket, not a filled-in palm silhouette.
        for side,arm in p['rig']['arms'].items():
            hand=hand_layers[side];ys,xs=np.where(hand[:,:,3]>.5);audit={}
            for point in ['palm','wrist']:
                u,v=arm[point];coverage=float(hand[min(h-1,round(v*h)),min(w-1,round(u*w)),3])
                audit[point+'Coverage']=coverage;audit[point+'DistancePixels']=float(np.min(np.sqrt((xs-u*w)**2+(ys-v*h)**2)))
            assert audit['wristCoverage']>.9,name+' '+side+' wrist must lie inside cuff'
            assert audit['palmDistancePixels']<h*.045,name+' '+side+' gun socket must be surrounded by glove'
            audit['socketIsOpen']=True;contact_audit[name][side]=audit
        # Compatibility diagnostic textures. Runtime uses each independent layer's maps.
        normal,mask=lighting_passes(body,p.get('normalVolumes',[]))
        write_png(os.path.join(OUT,name+'-normal.png'),normal);write_png(os.path.join(OUT,name+'-lighting.png'),mask)
        preview=np.zeros_like(body)
        for layer in sorted(layers,key=lambda l:(l['stage']!='back',l.get('order',1 if l['id'].endswith('upper') else 2 if l['id'].endswith('forearm') else 3))):preview=over(preview,images[layer['id']])
        write_png(os.path.join(OUT,name+'-albedo.png'),preview)
        layers.insert(1,{'id':'gun','gun':True})
        poses[name]={'character':'ranger-01','version':3,'placeholder':False,'width':w,'height':h,'screenHeight':.72,'maxWidthShare':p.get('maxWidthShare',.42),'muzzle':p['muzzle'],'layers':layers,'rig':p['rig'],'lighting':'albedo-normal-response-mask','gun':True,'sections':'complete-independent-paintings'}
    with open(os.path.join(os.path.dirname(CONFIG),'rig-image-audit.json'),'w') as f:json.dump(contact_audit,f,indent=2)
    base=poses['aim'];base['variants']={'left':{**dict(base),'mirror':True,'mirrorGun':True,'pose':'aim-left'}};base['ready']={'right':poses['ready'],'left':{**poses['ready'],'mirror':True,'mirrorGun':True,'pose':'ready-left'}}
    with open(os.path.join(OUT,'cutin.json'),'w') as f:json.dump(base,f,indent=2)
    sc=stage_2d([l for l in poses['aim']['layers'] if l.get('image')]);sc.render.filepath=os.path.join(os.path.dirname(CONFIG),'blender-2d-preview.png');bpy.ops.render.render(write_still=True,scene=sc.name)
    stage_2d([l for l in poses['ready']['layers'] if l.get('image')],pose='ready')
    if bpy.context.window:bpy.context.window.scene=sc
    for area in bpy.context.screen.areas if bpy.context.screen else []:
        if area.type=='VIEW_3D':area.spaces.active.region_3d.view_perspective='CAMERA';area.spaces.active.shading.type='MATERIAL'
    for im in bpy.data.images:
        if im.filepath.startswith(OUT) and not im.packed_file:im.pack()
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT,'tools/art/sprites/ranger-01/ranger-01-2d.blend'),copy=True)
    return {'poses':list(poses),'scene':sc.name,'all_character_meshes_flat':all(not o.get('sprite_layer') or all(abs(v.co.z)<1e-8 for v in o.data.vertices) for o in sc.objects)}

def build():
    os.makedirs(OUT,exist_ok=True)
    return {'character':'2D only','blender':bpy.app.version_string,'formula':CONFIG}

if __name__=='__main__':
    print(build());print(bake_field());print(bake_heroes())
