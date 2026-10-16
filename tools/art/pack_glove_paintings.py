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

def register(image,spec,wrist,socket,size):
 sx,sy=spec['wrist'];ex,ey=spec['socket'];tx,ty=wrist;ux,uy=socket
 scale=math.hypot(ux-tx,uy-ty)/math.hypot(ex-sx,ey-sy)
 angle=math.atan2(uy-ty,ux-tx)-math.atan2(ey-sy,ex-sx)
 c,s=math.cos(angle)/scale,math.sin(angle)/scale
 return image.transform(size,Image.Transform.AFFINE,(c,s,sx-c*tx-s*ty,-s,c,sy+s*tx-c*ty),Image.Resampling.BICUBIC)

def pack():
 path=ROOT/'formula.json';formula=json.loads(path.read_text());master=Image.open(OUT/'anatomy-painted.png').convert('RGBA');audit=[]
 for pname,pose in formula['poses'].items():
  W,H=pose.get('canvasWidth',768),768
  for family,hands in HANDS.items():
   for side,spec in hands.items():
    arm=pose['rig']['arms'][side];wrist=[arm['wrist'][0]*W,arm['wrist'][1]*H];socket=[arm['palm'][0]*W,arm['palm'][1]*H]
    pixels=np.array(master);pixels[:,:,3]=np.uint8(np.clip((pixels[:,:,3].astype(float)-240)/10,0,1)*255)
    region=Image.new('L',master.size);ImageDraw.Draw(region).rectangle(spec['rect'],fill=255);pixels[:,:,3]*=np.asarray(region)>0
    split=Image.new('L',master.size);ImageDraw.Draw(split).polygon(spec['fragment'],fill=255);fragment=np.asarray(split)>0
    suffix='' if family=='rifle' else '-'+family
    for kind,ownership in [('glove',~fragment),('glove-fingers',fragment)]:
     part=pixels.copy();part[:,:,3]*=ownership
     register(Image.fromarray(part),spec,wrist,socket,(W,H)).save(OUT/f'{pname}-{side}-{kind}{suffix}.png')
    audit.append(dict(pose=pname,family=family,hand='right' if side=='trigger' else 'left',wrist=wrist,socket=socket,sourceWrist=spec['wrist'],sourceSocket=spec['socket'],occlusion='main near / thumb far' if side=='trigger' else 'palm and thumb far / fingers near'))
 formula['gloveArt']=dict(source='source/gloves-cleaned/anatomy-painted.png',packing='tools/art/pack_glove_paintings.py',skeleton='anatomical wrist and grip registration; no mocap capture supplied',handsPerPose={'left':1,'right':1},rule='near/far fragments are disjoint pixels of one hand, never additional hands')
 path.write_text(json.dumps(formula,indent=2)+'\n');(ROOT/'glove-cleanup-audit.json').write_text(json.dumps(audit,indent=2)+'\n')
 return dict(poses=2,handsPerPose=2,weaponFamilies=3,fragmentsPerHand=2)
if __name__=='__main__':print(pack())
