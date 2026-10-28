"""Bake a 2D anime character pack through Blender, never a 3D character.
MCP: import runpy; p=runpy.run_path(PATH); p['build'](); p['bake_field'](); p['bake_heroes']()
CLI: blender -b -P tools/art/sprite_formula.py
The editable formula owns grid layout, arm cutouts, pivots and separate lighting passes.
"""
import numpy as np, os, json, math, zlib, struct, copy
try:
    import bpy                      # Blender: previews, the editable .blend and the MCP workflow
except ImportError:                 # plain Python: the bakes still run (PIL reads the sources)
    bpy = None
from collections import deque
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
OUT=os.path.join(ROOT,'client/public/assets/characters/ranger-01')
CONFIG=os.path.join(ROOT,'tools/art/sprites/ranger-01/formula.json')
SRC=os.path.join(os.path.dirname(CONFIG),'source')
SOURCE_CLIPS={'idle':(0,2,2,True),'run':(2,4,12,True),'aim':(6,1,1,True),'fire':(7,2,12,False),'throw':(9,2,6,False),'hit':(11,1,1,False),'down':(12,4,8,False),'stacked':(16,1,1,True),'hunker':(17,1,1,True),'vault':(18,3,7,False),'climb':(21,3,6,True)}
CLIPS={'idle':(0,2,2,True),'run':(2,2,6,True),'aim':(4,1,1,True),'fire':(5,2,12,False),'throw':(7,2,6,False),'hit':(9,1,1,False),'down':(10,4,8,False),'stacked':(14,1,1,True),'hunker':(15,1,1,True),'vault':(16,2,14/3,False),'climb':(18,2,4,True)}
MOVEMENT_FRAMES={'run':[0,2],'vault':[0,2],'climb':[0,2]}
FACINGS=['s','sw','w','nw','n','ne','e','se']
S=None

def read_png(path):
    if bpy is None:
        from PIL import Image
        return np.asarray(Image.open(path).convert('RGBA'),dtype=np.float32)/255.0
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

def edge_response(alpha,width=6):
    # Distance bands inside the silhouette, never around painted folds/colour changes.
    # Pad instead of rolling so opposite atlas edges cannot illuminate one another.
    inside=alpha>.04;remaining=inside.copy();rim=np.zeros_like(alpha)
    for step in range(width):
        padded=np.pad(remaining,1);eroded=remaining.copy()
        for dy,dx in [(-1,-1),(-1,0),(-1,1),(0,-1),(0,1),(1,-1),(1,0),(1,1)]:
            eroded &= padded[1+dy:1+dy+alpha.shape[0],1+dx:1+dx+alpha.shape[1]]
        t=1-step/width;rim[remaining&~eroded]=t*t*(3-2*t)
        remaining=eroded
    return rim

def lighting_passes(albedo,volumes=(),edge_width=6):
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
    # G preserves the painted base. World light adds only a narrow, soft silhouette rim.
    # The interior is exactly R=0, G=1, B=0; colour differences never produce new lighting.
    rim=edge_response(alpha,edge_width)
    mask=np.zeros_like(albedo);mask[:,:,0]=rim*.35;mask[:,:,1]=1;mask[:,:,2]=rim*.08;mask[:,:,3]=alpha
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

def match_colours(cell,ref_stats,strength=.6):
    """Pull a frame's colour statistics toward the reference sheet's (opaque pixels only, per channel)."""
    m=cell[:,:,3]>.5
    if not m.any() or ref_stats is None:return cell
    out=cell.copy();rgb=out[:,:,:3];mu=rgb[m].mean(0);sd=rgb[m].std(0)+1e-4
    rmu,rsd=ref_stats;mapped=(rgb-mu)/sd*rsd+rmu
    out[:,:,:3]=np.clip(rgb*(1-strength)+mapped*strength,0,1);return out

def body_centre(cell,kind):
    """Horizontal anchor: the head-and-torso centre for upright clips (feet swing, the body does not slide), the
    whole silhouette for a body lying down."""
    a=cell[:,:,3]>.08;ys,xs=np.nonzero(a)
    if kind=='down' or not len(xs):return (cell.shape[1]-1)/2
    top=ys.min()+(ys.max()-ys.min())*.42;sel=ys<=top
    return float(xs[sel].mean())

def bake_field():
    fw,fh,columns=192,256,24;atlas=np.zeros((fh*8,fw*columns,4),dtype=np.float32);sources=[]
    names={col+i:(clip,i) for clip,(col,n,fps,loop) in SOURCE_CLIPS.items() for i in range(n)}
    old={'idle':0,'aim':6,'fire':7,'throw':9,'hit':11,'stacked':13,'hunker':14,'vault':15,'climb':18}
    report={}
    for row,facing in enumerate(FACINGS):
        original=read_png(os.path.join(SRC,'field-'+facing+'.png'))
        actions=read_png(os.path.join(SRC,'run-down-'+facing+'.png'))
        cells={}
        for col in range(columns):
            kind,frame=names[col]
            a=actions if kind in ('run','down') else original
            count=4 if kind in ('run','down') else 7
            source_index=(frame if kind=='run' else frame+4) if kind in ('run','down') else old[kind]+frame
            h,w=a.shape[:2];cuts=row_bounds(a,2 if count==4 else 3)
            sr,sc=divmod(source_index,count);x0,x1=round(w*sc/count),round(w*(sc+1)/count);y0,y1=cuts[sr],cuts[sr+1]
            cell=largest(a[y0:y1,x0:x1].copy());box=bounds(cell);cell=cell[box[1]:box[3],box[0]:box[2]]
            cells[col]=(kind,frame,cell,count,[x0,y0,x1,y1])
        # One scale per source sheet, so a clip never changes the character's size: the standing frames of the
        # field sheet are 232 px tall; the run/down sheet is scaled so its run cycle stands 0.94 of that.
        standing=[c[2].shape[0] for c in cells.values() if c[0] in ('idle','aim','fire','hit')]
        running=[c[2].shape[0] for c in cells.values() if c[0]=='run']
        sheet_scale={'field':232/float(np.median(standing)),'actions':232*.94/float(np.median(running))}
        # The two sheets are painted with slightly different palettes: pull the field sheet toward the run/down one.
        ref=np.concatenate([c[2][c[2][:,:,3]>.5][:,:3] for c in cells.values() if c[0] in ('run','down')])
        ref_stats=(ref.mean(0),ref.std(0)+1e-4)
        shrunk=[]
        for col,(kind,frame,cell,count,rect) in cells.items():
            scale=sheet_scale['actions' if count==4 else 'field']
            fit=min(1,(fw-6)/(cell.shape[1]*scale),(fh-12)/(cell.shape[0]*scale))
            if fit<1:shrunk.append((kind,frame,round(fit,3)))
            scale*=fit
            tw,th=max(1,round(cell.shape[1]*scale)),max(1,round(cell.shape[0]*scale))
            centre=body_centre(cell,kind)*scale
            cell=cleaned_albedo(resample(cell,tw,th))
            if count!=4:cell=match_colours(cell,ref_stats)
            px=int(round(fw/2-centre));px=max(2,min(fw-2-tw,px));py=fh-8-th
            atlas[row*fh+py:row*fh+py+th,col*fw+px:col*fw+px+tw]=cell
            sources.append({'facing':facing,'column':col,'clip':kind,'frame':frame,'source':('run-down-' if count==4 else 'field-')+facing+'.png','sourceRect':rect})
        report[facing]={'scales':{k:round(v,4) for k,v in sheet_scale.items()},'shrunkToFit':shrunk}
    # Bake original cells first: compacting must not change scale, colour matching or source artwork.
    keep=[];compacted=[]
    for clip,(column,n,fps,loop) in CLIPS.items():
        for frame,source_frame in enumerate(MOVEMENT_FRAMES.get(clip,range(n))):
            old_col=SOURCE_CLIPS[clip][0]+source_frame;keep.append(old_col)
            for row,facing in enumerate(FACINGS):
                entry=next(x for x in sources if x['facing']==facing and x['column']==old_col)
                compacted.append({**entry,'column':column+frame,'frame':frame})
    atlas=np.concatenate([atlas[:,col*fw:(col+1)*fw] for col in keep],axis=1)
    columns=len(keep);sources=sorted(compacted,key=lambda s:(FACINGS.index(s['facing']),s['column']))
    def preview_clip(row,clip):
        col,n,_,_=CLIPS[clip];a=atlas[row*fh:(row+1)*fh,col*fw:(col+n)*fw]
        return np.pad(a,((0,0),(0,(4-n)*fw),(0,0)))
    preview=np.concatenate([preview_clip(row,clip) for row in [0,2] for clip in ['run','down']],axis=0)
    write_png(os.path.join(os.path.dirname(CONFIG),'run-downed-preview.png'),preview)
    write_png(os.path.join(OUT,'field.png'),atlas);normal,mask=lighting_passes(atlas,[( (c+.5)/columns,(r+.45)/8,.32/columns,.40/8,.22) for r in range(8) for c in range(columns)],edge_width=2)
    write_png(os.path.join(OUT,'field-normal.png'),normal);write_png(os.path.join(OUT,'field-lighting.png'),mask)
    manifest={'version':2,'character':'ranger-01','placeholder':False,'image':'field.png','normal':'field-normal.png','lightingMask':'field-lighting.png','frameWidth':fw,'frameHeight':fh,'columns':columns,'rows':8,'facings':FACINGS,'anchor':[.5,8/fh],'worldHeight':2.4,
        'clips':{k:dict(column=v[0],frames=v[1],fps=v[2],loop=v[3]) for k,v in CLIPS.items()},'events':{'fire':{'frame':0,'event':'muzzle'}},'notes':'One 2D anime identity; 8 illustrated facing sheets; cleaned source colours and line art + separate tangent normals and edge-only light-response mask. No 3D character.'}
    with open(os.path.join(OUT,'field.json'),'w') as f:json.dump(manifest,f,indent=2)
    with open(os.path.join(OUT,'sprite-list.json'),'w') as f:json.dump({'character':'ranger-01','frames':sources,'formula':'tools/art/sprite_formula.py','scale':report},f,indent=2)
    # Matching UI head: the first front-facing illustrated frame, never an unrelated character.
    front=read_png(os.path.join(SRC,'field-s.png'));cuts=row_bounds(front);head=largest(front[:round(cuts[1]*.36),:round(front.shape[1]/7)])
    bb=bounds(head);head=head[bb[1]:bb[3],bb[0]:bb[2]];size=256;out=np.zeros((size,size,4),dtype=np.float32);sc=min(236/head.shape[1],236/head.shape[0]);head=resample(head,round(head.shape[1]*sc),round(head.shape[0]*sc));oy=(size-head.shape[0])//2;ox=(size-head.shape[1])//2;out[oy:oy+head.shape[0],ox:ox+head.shape[1]]=cleaned_albedo(head);write_png(os.path.join(OUT,'portrait.png'),out)
    return {'frames':len(sources),'size':[fw*columns,fh*8],'rowBounds':'auto from transparent gutters','report':report}

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
    order=lambda l:l.get('zIndex',(0 if l.get('stage')=='back' else 100)+l.get('order',1 if l['id'].endswith('upper') else 2 if l['id'].endswith('forearm') else 3))
    layers=sorted(layers,key=order)
    for i,layer in enumerate(layers):
        im=bpy.data.images.load(os.path.join(OUT,layer['image']),check_existing=True);im.reload()
        mat=bpy.data.materials.new('2D '+layer['id']);mat.use_nodes=True;nt=mat.node_tree;nt.nodes.clear()
        tex=nt.nodes.new('ShaderNodeTexImage');tex.image=im;em=nt.nodes.new('ShaderNodeEmission');nt.links.new(tex.outputs['Color'],em.inputs['Color']);trans=nt.nodes.new('ShaderNodeBsdfTransparent');mix=nt.nodes.new('ShaderNodeMixShader');nt.links.new(tex.outputs['Alpha'],mix.inputs[0]);nt.links.new(trans.outputs[0],mix.inputs[1]);nt.links.new(em.outputs[0],mix.inputs[2]);out=nt.nodes.new('ShaderNodeOutputMaterial');nt.links.new(mix.outputs[0],out.inputs['Surface'])
        mat.surface_render_method='DITHERED'
        me=bpy.data.meshes.new('Flat image rectangle');me.from_pydata([(0,0,0),(aspect,0,0),(aspect,1,0),(0,1,0)],[],[(0,1,2,3)]);uv=me.uv_layers.new()
        for loop,co in zip(uv.data,[(0,0),(1,0),(1,1),(0,1)]):loop.uv=co
        ob=bpy.data.objects.new(layer['id'],me);sc.collection.objects.link(ob);ob.location.z=i*.001;ob.data.materials.append(mat);ob['sprite_layer']=True;ob['bone']=layer.get('bone','body');ob['zIndex']=order(layer)
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
    # The world pose reuses the remade limb paintings at a smaller authored scale,
    # with a complete full-body painting instead of a screen-edge torso crop.
    if formula.get('worldAim'):
        spec=formula['worldAim'];p=copy.deepcopy(formula['poses']['aim']);k=spec['scale'];ox,oy=spec['offset']
        uv=lambda a:[a[0]*k+ox,a[1]*k+oy]
        p['bodySource']=spec['bodySource'];p['cropEdges']=[];p['muzzle']=uv(p['muzzle'])
        p['worldHeight']=spec['worldHeight'];p['anchor']=spec['anchor'];r=p['rig']
        if p.get('puppet'):
            for form in p['puppet']['keyforms'].values():
                for key in form.values():
                    for joint in ['shoulder','elbow']:key[joint]=uv(key[joint])
                    for part in ['upper','forearm']:key[part]['bend']*=k
                    for channel in key['parameters'].values():
                        for sign in channel:channel[sign]=[v*k for v in channel[sign]]
        for key in ['stock','grip','support']:r[key]=uv(r[key])
        r['handAxis']=[uv(a) for a in r['handAxis']]
        r['gunView']['referenceMuzzle']=uv(r['gunView']['referenceMuzzle'])
        for arm in r['arms'].values():
            for key in ['shoulder','elbow','wrist','palm','gripWrist','cuffWrist','fingertip']:
                if key in arm:arm[key]=uv(arm[key])
        r['limbRadii']={key:[v*k for v in vals] for key,vals in r['limbRadii'].items()}
        p['normalVolumes']=[[cx*k+ox,cy*k+oy,rx*k,ry*k,s] for cx,cy,rx,ry,s in p['normalVolumes']]
        formula['poses']['world-aim']=p
    for name,p in formula['poses'].items():
        body=cleaned_albedo(resample(read_png(os.path.join(SRC,p['bodySource'])),768,768))
        if p.get('canvasWidth',768)>768:body=np.pad(body,((0,0),(0,p['canvasWidth']-768),(0,0)))
        h,w=body.shape[:2];sheet=read_png(os.path.join(SRC,p['sectionsSource']))
        layers=[];images={};hand_layers={};hand_variants={};contact_audit[name]={}
        def files(id,a):
            filename=name+'-'+id+'.png';normal,mask=lighting_passes(a,p.get('normalVolumes',[]) if id=='body' else [])
            write_png(os.path.join(OUT,filename),a)
            write_png(os.path.join(OUT,name+'-'+id+'-normal.png'),normal)
            write_png(os.path.join(OUT,name+'-'+id+'-lighting.png'),mask)
            return {'image':filename,'normal':name+'-'+id+'-normal.png','lightingMask':name+'-'+id+'-lighting.png','bounds':[int(v) for v in bounds(a)]}
        def emit(id,a,stage,bone=None,order=None):
            layer={'id':id,**files(id,a),'stage':stage}
            if bone:layer['bone']=bone
            if bone:
                side=bone.split('-')[0];layer['anatomicalSide']='right' if side=='trigger' else 'left'
                if id.endswith('fingers'):layer['fragmentOf']=side+'-hand'
            # Explicit stage-local draw order travels with the PNGs, including into future sprite packs.
            layer['order']=order if order is not None else (1 if id.endswith('upper') else 2 if id.endswith('forearm') else 3)
            if id in p.get('layerZ',{}):layer['zIndex']=p['layerZ'][id]
            layers.append(layer);images[id]=a
            return layer
        emit('body',body,'back',order=5)
        for part in p['parts']:
            side,kind=part['id'].split('-');arm=p['rig']['arms'][side]
            joints={'upper':('shoulder','elbow'),'forearm':('elbow','wrist'),'hand':('wrist','palm')}[kind]
            start,end=[arm[j] for j in joints]
            width=h*2*max(p['rig']['limbRadii'][kind]) if kind!='hand' else None
            # A part may come from its own painting (e.g. the gloves painted on the gun guides, tools/art/paint_gloves.py).
            source=read_png(os.path.join(SRC,part['source'])) if part.get('source') else sheet
            a=place_section(source,part,start,end,w,h,width)
            emit(part['id'],a,part['stage'],part['id'],part.get('order',10 if part['id']=='support-hand' else None))
            if kind=='hand':
                hand_layers[side]=a
                hand_variants[side]={'rifle':a}
                hand_layer=layers[-1]
                if part.get('fingersSource'):
                    # Fingers on the other side of the gun from the palm: their own layer and stage.
                    fingers=place_section(read_png(os.path.join(SRC,part['fingersSource'])),part,start,end,w,h)
                    finger_layer=emit(side+'-fingers',fingers,part.get('fingersStage','front'),part['id'],order=part.get('fingersOrder',0))
                    # Per gun family gloves (a pump gun's straight wrist, the sniper's grip and forend): same anchors,
                    # the runtime picks the variant for the gun in hand.
                    for family,v in part.get('variants',{}).items():
                        variant=place_section(read_png(os.path.join(SRC,v['source'])),part,start,end,w,h)
                        hand_variants[side][family]=variant
                        hand_layer.setdefault('variants',{})[family]=files(part['id']+'-'+family,variant)
                        finger_layer.setdefault('variants',{})[family]=files(side+'-fingers-'+family,place_section(read_png(os.path.join(SRC,v['fingersSource'])),part,start,end,w,h))
                elif part.get('wrapFingers'):
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
            audit['families']={}
            for family,variant in hand_variants[side].items():
                ys,xs=np.where(variant[:,:,3]>.5);u,v=arm['wrist']
                coverage=float(variant[round(v*h),round(u*w),3])
                assert coverage>.9,f'{name} {side} {family} cuff must cover the wrist'
                audit['families'][family]={'wristCoverage':coverage,'wristDistancePixels':float(np.min(np.hypot(xs-u*w,ys-v*h)))}
        # Compatibility diagnostic textures. Runtime uses each independent layer's maps.
        normal,mask=lighting_passes(body,p.get('normalVolumes',[]))
        write_png(os.path.join(OUT,name+'-normal.png'),normal);write_png(os.path.join(OUT,name+'-lighting.png'),mask)
        preview=np.zeros_like(body)
        for layer in sorted(layers,key=lambda l:l.get('zIndex',(0 if l['stage']=='back' else 100)+l['order'])):preview=over(preview,images[layer['id']])
        write_png(os.path.join(OUT,name+'-albedo.png'),preview)
        layers.insert(1,{'id':'gun','gun':True,'zIndex':p.get('layerZ',{}).get('gun',100)})
        poses[name]={'character':'ranger-01','version':3,'placeholder':False,'width':w,'height':h,'screenHeight':.72,'maxWidthShare':p.get('maxWidthShare',.42),'cropEdges':p.get('cropEdges',[]),'muzzle':p['muzzle'],'layers':layers,'rig':p['rig'],'anatomy':p.get('anatomy'),'lighting':'albedo-normal-response-mask','gun':True,'sections':'complete-independent-paintings'}
        if p.get('puppet'):poses[name]['puppet']=p['puppet']
        if 'anchor' in p:poses[name].update(anchor=p['anchor'],worldHeight=p['worldHeight'])
    with open(os.path.join(os.path.dirname(CONFIG),'rig-image-audit.json'),'w') as f:json.dump(contact_audit,f,indent=2)
    base=poses['aim']
    if 'world-aim' in poses:base['worldAim']=poses['world-aim']
    base['variants']={'left':{**dict(base),'mirror':True,'mirrorGun':True,'pose':'aim-left'}}
    with open(os.path.join(OUT,'cutin.json'),'w') as f:json.dump(base,f,indent=2)
    if bpy is None:
        return {'poses':list(poses),'scene':None,'note':'baked without Blender: no preview render or .blend update'}
    sc=stage_2d([l for l in poses['aim']['layers'] if l.get('image')]);sc.render.filepath=os.path.join(os.path.dirname(CONFIG),'blender-2d-preview.png');bpy.ops.render.render(write_still=True,scene=sc.name)
    if bpy.context.window:bpy.context.window.scene=sc
    for area in bpy.context.screen.areas if bpy.context.screen else []:
        if area.type=='VIEW_3D':area.spaces.active.region_3d.view_perspective='CAMERA';area.spaces.active.shading.type='MATERIAL'
    for im in bpy.data.images:
        if im.filepath.startswith(OUT) and not im.packed_file:im.pack()
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT,'tools/art/sprites/ranger-01/ranger-01-2d.blend'),copy=True)
    return {'poses':list(poses),'scene':sc.name,'all_character_meshes_flat':all(not o.get('sprite_layer') or all(abs(v.co.z)<1e-8 for v in o.data.vertices) for o in sc.objects)}

def build():
    os.makedirs(OUT,exist_ok=True)
    return {'character':'2D only','blender':bpy.app.version_string if bpy else None,'formula':CONFIG}

if __name__=='__main__':
    print(build());print(bake_field());print(bake_heroes())
