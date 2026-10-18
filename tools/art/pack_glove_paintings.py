"""Register one left/right human glove pair to each pose's wrist and weapon sockets.
Near/far layers are disjoint fragments of ONE painting, never extra digits.
Requires Pillow and numpy; follow with sprite_formula.bake_heroes().
"""
import json, math
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
ROOT=Path(__file__).parent/'sprites/ranger-01';OUT=ROOT/'source/gloves-cleaned'
# Source pixels: anatomical wrist, grip contact, and the seam where the gun occludes this hand.
HANDS={
 'rifle':{
  'trigger':dict(rect=[0,0,560,512],wrist=[172,325],socket=[365,285],fragment=[[241,159],[292,144],[361,159],[300,193],[242,194]]),
  'support':dict(rect=[560,0,1024,512],wrist=[669,361],socket=[805,255],fragment=[[798,194],[1018,180],[1023,412],[835,425],[793,351]])},
 'sniper':{
  'trigger':dict(rect=[0,512,563,1024],wrist=[176,831],socket=[369,790],fragment=[[242,624],[294,601],[367,642],[301,670],[238,664]]),
  'support':dict(rect=[564,512,1024,1024],wrist=[675,869],socket=[814,759],fragment=[[805,647],[1023,636],[1023,912],[850,925],[798,834]])},
 'shotgun':{
  'trigger':dict(rect=[0,1024,554,1536],wrist=[170,1290],socket=[370,1250],fragment=[[250,1107],[302,1081],[359,1102],[304,1140]]),
  'support':dict(rect=[555,1024,1024,1536],wrist=[697,1352],socket=[824,1233],fragment=[[858,1100],[1023,1090],[1023,1362],[843,1369],[812,1289]])}}

# How much a hand is foreshortened along the barrel in each pose. The over-the-shoulder aim looks down the gun, so
# a side-view painting must shrink along the barrel (index finger and knuckle row point away from the camera).
# Only the aiming trigger hand needs it: seen from behind, its knuckles and index finger point away from the camera.
FORESHORTEN={}
# Trigger discipline: the index finger lies along the frame on top of the trigger guard. Gun-space contact point per
# family (metres, x = right side, y = toward the muzzle, z = up; origin = the grip socket), from the gun-kit meshes.
TRIGGER_CONTACT={'rifle':[0.019,0.065,0.028],'sniper':[0.018,0.070,0.035],'shotgun':[0.020,0.065,0.030]}
GUIDES=ROOT/'gun-guides.json'

def fingertip(alpha,spec):
 """The painted index fingertip: the opaque pixel of this hand farthest along wrist -> grip."""
 if 'fingertip' in spec:return np.array(spec['fingertip'],float)
 x0,y0,x1,y1=spec['rect'];w=np.array(spec['wrist'],float);u=np.array(spec['socket'],float)-w;u/=np.linalg.norm(u)
 ys,xs=np.nonzero(alpha[y0:y1,x0:x1]);pts=np.stack([xs+x0,ys+y0],1);return pts[np.argmax((pts-w)@u)].astype(float)

def contact_rest(guides,pname,family,axis_rest):
 """Screen position of the trigger contact for this gun, carried back into the rig's rest frame (the hand bone
 later moves the glove from the rest grip onto this gun's grip, rotating with the barrel)."""
 g=guides[pname]['guns'][family];c=TRIGGER_CONTACT[family]
 p=np.array(g['keys']['grip'])+np.array(g['unitY'])*c[0]+np.array(g['unitX'])*c[1]+np.array(g['unitZ'])*c[2]
 st,mz=np.array(g['keys']['stock']),np.array(g['keys']['muzzle'])
 delta=math.atan2(mz[1]-st[1],mz[0]-st[0])-math.atan2(axis_rest[1],axis_rest[0])
 rest=np.array(guides[pname]['guns']['rifle']['keys']['grip']);v=p-np.array(g['keys']['grip'])
 c_,s_=math.cos(-delta),math.sin(-delta)
 return rest+np.array([c_*v[0]-s_*v[1],s_*v[0]+c_*v[1]])

def register3(image,src,dst,size):
 """Affine through three landmark pairs (wrist, grip socket, index fingertip)."""
 S=np.array([[x,y,1] for x,y in src],float);D=np.array(dst,float)
 A=np.linalg.solve(S,D).T                                        # dst = A @ [x, y, 1]
 F,o=A[:,:2],A[:,2];inv=np.linalg.inv(F);b=-inv@o
 return image.transform(size,Image.Transform.AFFINE,(inv[0,0],inv[0,1],b[0],inv[1,0],inv[1,1],b[1]),Image.Resampling.BICUBIC)

def register(image,spec,wrist,socket,size,axis=None,foreshorten=1.0):
 """Similarity from the painting's wrist/socket to the pose's, then (optionally) compress along the screen barrel
 axis about the socket. The wrist moves with the compression; pack() moves the rig's rest wrist to match."""
 sx,sy=spec['wrist'];ex,ey=spec['socket'];tx,ty=wrist;ux,uy=socket
 scale=math.hypot(ux-tx,uy-ty)/math.hypot(ex-sx,ey-sy)
 angle=math.atan2(uy-ty,ux-tx)-math.atan2(ey-sy,ex-sx)
 c,s=math.cos(angle)*scale,math.sin(angle)*scale
 F=np.array([[c,-s],[s,c]]);o=np.array([ux,uy])-F@np.array([ex,ey])          # forward: target = F src + o
 if axis is not None and foreshorten!=1.0:
  u=np.array(axis,float);u/=np.linalg.norm(u);v=np.array([-u[1],u[0]]);d=np.array([tx-ux,ty-uy])
  C=np.eye(2)-(1-foreshorten)*np.outer(u,u)
  F=C@F;o=np.array([ux,uy])-F@np.array([ex,ey])                               # socket fixed; the wrist moves in
 inv=np.linalg.inv(F);b=-inv@o                                                  # PIL wants src = inv target + b
 return image.transform(size,Image.Transform.AFFINE,(inv[0,0],inv[0,1],b[0],inv[1,0],inv[1,1],b[1]),Image.Resampling.BICUBIC)

def set_rest_wrist(arm,wrist,socket,axis,fs,W,H):
 """Put the rig's rest wrist where the (foreshortened) glove cuff now is; re-solve the elbow with the same bone
 lengths so the forearm still meets the cuff."""
 u=np.array(axis,float);u/=np.linalg.norm(u);d=np.array(wrist)-np.array(socket)
 w=np.array(socket)+d-(1-fs)*(u@d)*u
 sh=np.array([arm['shoulder'][0]*W,arm['shoulder'][1]*H]);el=np.array([arm['elbow'][0]*W,arm['elbow'][1]*H]);wr=np.array([arm['wrist'][0]*W,arm['wrist'][1]*H])
 a=np.linalg.norm(el-sh);b=np.linalg.norm(wr-el);t=w-sh;dist=np.linalg.norm(t);ang=math.atan2(t[1],t[0])
 side=math.copysign(1,(wr[0]-sh[0])*(el[1]-sh[1])-(wr[1]-sh[1])*(el[0]-sh[0]))
 bend=math.acos(max(-1,min(1,(a*a+dist*dist-b*b)/(2*a*dist))))
 e=sh+a*np.array([math.cos(ang+side*bend),math.sin(ang+side*bend)])
 arm['elbow']=[e[0]/W,e[1]/H];arm['wrist']=[w[0]/W,w[1]/H]

def pack():
 path=ROOT/'formula.json';formula=json.loads(path.read_text());art=formula.get('gloveSource',{})
 master=Image.open(ROOT/art.get('image','source/gloves-cleaned/anatomy-painted.png')).convert('RGBA');audit=[]
 hands_by_family=art.get('landmarks',HANDS)
 guides=json.loads(GUIDES.read_text());alpha=np.asarray(master)[:,:,3]>250
 for pname,pose in formula['poses'].items():
  W,H=pose.get('canvasWidth',768),768
  for family,hands in hands_by_family.items():
   for side,spec in hands.items():
    arm=pose['rig']['arms'][side];socket=[arm['palm'][0]*W,arm['palm'][1]*H]
    # Register on the grip wrist (before any foreshortening) so re-running the packer is idempotent.
    reg=arm.setdefault('gripWrist',list(arm['wrist']));wrist=[reg[0]*W,reg[1]*H]
    fs=FORESHORTEN.get((pname,side),1.0)
    pixels=np.array(master);pixels[:,:,3]=np.uint8(np.clip((pixels[:,:,3].astype(float)-240)/10,0,1)*255)
    region=Image.new('L',master.size);ImageDraw.Draw(region).rectangle(spec['rect'],fill=255);pixels[:,:,3]*=np.asarray(region)>0
    split=Image.new('L',master.size);ImageDraw.Draw(split).polygon(spec['fragment'],fill=255);fragment=np.asarray(split)>0
    suffix='' if family=='rifle' else '-'+family
    for kind,ownership in [('glove',~fragment),('glove-fingers',fragment)]:
     part=pixels.copy();part[:,:,3]*=ownership
     ax=pose['rig']['handAxis'];axis=[(ax[1][0]-ax[0][0])*W,(ax[1][1]-ax[0][1])*H]
     if side=='trigger':
      # Pin the grip socket and the index fingertip (on the trigger guard) with an undistorted similarity; the
      # cuff lands where the painting puts it and the rig's rest wrist follows (elbow re-solved below).
      tip=contact_rest(guides,pname,family,axis);ft=fingertip(alpha,spec)
      if family=='rifle':
       register(Image.fromarray(part),{'wrist':spec['socket'],'socket':list(ft)},socket,list(tip),(W,H)).save(OUT/f'{pname}-{side}-{kind}{suffix}.png')
      else:
       # Other guns share the rig's rest wrist (set by the carbine): pin the cuff and the fingertip with an
       # undistorted similarity; the palm settles within a few pixels of the grip socket.
       rest=[arm['wrist'][0]*W,arm['wrist'][1]*H]
       register(Image.fromarray(part),{'wrist':spec['wrist'],'socket':list(ft)},rest,list(tip),(W,H)).save(OUT/f'{pname}-{side}-{kind}{suffix}.png')
      if family=='rifle':
       arm['fingertip']=[tip[0]/W,tip[1]/H]
       sv,tv=ft-np.array(spec['socket'],float),tip-np.array(socket,float)
       k=np.linalg.norm(tv)/np.linalg.norm(sv);r=math.atan2(tv[1],tv[0])-math.atan2(sv[1],sv[0])
       d=np.array(spec['wrist'],float)-np.array(spec['socket'],float)
       cuff=np.array(socket)+k*np.array([math.cos(r)*d[0]-math.sin(r)*d[1],math.sin(r)*d[0]+math.cos(r)*d[1]])
       arm['cuffWrist']=[cuff[0]/W,cuff[1]/H]
     else:
      register(Image.fromarray(part),spec,wrist,socket,(W,H),axis,fs).save(OUT/f'{pname}-{side}-{kind}{suffix}.png')
    if family=='rifle':
     if side=='trigger' and 'cuffWrist' in arm:set_rest_wrist(arm,[arm['cuffWrist'][0]*W,arm['cuffWrist'][1]*H],socket,axis,1.0,W,H)
     else:set_rest_wrist(arm,wrist,socket,axis,fs,W,H)
     # The baked layers map the painting's cuff onto the rest wrist: keep the part anchor on the painted cuff.
     for part in pose['parts']:
      if part['id']==side+'-hand':part['start']=[arm['wrist'][0]*W,arm['wrist'][1]*H]
    audit.append(dict(pose=pname,family=family,hand='right' if side=='trigger' else 'left',wrist=wrist,socket=socket,sourceWrist=spec['wrist'],sourceSocket=spec['socket'],occlusion='main near / thumb far' if side=='trigger' else 'palm and thumb far / fingers near'))
 for pose in formula['poses'].values():pose['rig']['triggerContact']=TRIGGER_CONTACT
 formula['gloveArt']=dict(source=art.get('image','source/gloves-cleaned/anatomy-painted.png'),packing='tools/art/pack_glove_paintings.py',skeleton='anatomical wrist and grip registration; no mocap capture supplied',handsPerPose={'left':1,'right':1},rule='near/far fragments are disjoint pixels of one hand, never additional hands')
 path.write_text(json.dumps(formula,indent=2)+'\n');(ROOT/'glove-cleanup-audit.json').write_text(json.dumps(audit,indent=2)+'\n')
 return dict(poses=len(formula['poses']),handsPerPose=2,weaponFamilies=3,fragmentsPerHand=2)
if __name__=='__main__':print(pack())
