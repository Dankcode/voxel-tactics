"""Pack the transparent extraction of the supplied reference into the field atlas.
Run with Pillow. Frame selections are pose approximations; this sheet is not 8-direction animation.
"""
from pathlib import Path
from PIL import Image, ImageOps, ImageDraw, ImageChops
import json
root = Path(__file__).resolve().parents[2]
out = root / 'client/public/assets/characters/test-soldier'
src = Image.open(out / 'source.png').convert('RGBA')
# Coordinates measured against the extracted 1664 × 936 sheet; normalize for portable packing.
boxes = [(20+i*205,30+j*233,235+i*205,255+j*233) for j in range(3) for i in range(5)]
# Avoid overlap: narrow the first three rows to individual pose footprints.
boxes = [(30,30,210,252),(250,30,400,252),(450,30,635,252),(655,30,835,252),(850,30,1010,252),
 (30,268,195,493),(240,268,405,493),(450,268,625,493),(650,268,825,493),(850,268,1025,493),
 (30,500,205,735),(250,500,415,735),(450,500,625,735),(650,500,815,735),(860,500,1010,735),
 (30,740,245,936),(255,740,420,936),(460,740,680,936),(685,740,890,936)]
def crop(box):
    w,h=src.size
    im=src.crop(tuple(round(v*(w/1664 if i%2==0 else h/936)) for i,v in enumerate(box)))
    return im.crop(im.getbbox())
poses=[crop(b) for b in boxes]
fw,fh=192,256
facings=['s','sw','w','nw','n','ne','e','se']
clips={'idle':(0,2,2,True),'walk':(2,4,7,True),'aim':(6,1,1,True),'fire':(7,2,12,False),'throw':(9,2,6,False),'hit':(11,1,1,False),'down':(12,1,1,True),'stacked':(13,1,1,True),'hunker':(14,1,1,True),'vault':(15,3,7,False),'climb':(18,3,6,True)}
atlas=Image.new('RGBA',(fw*21,fh*8))
for row,facing in enumerate(facings):
    back=facing in ['nw','n','ne']; mirror=facing in ['sw','w','nw']
    idle=1 if back else 0; walk=[7,8,12,7] if back else [2,5,6,2]; aim=16 if back else 15
    indices=[idle,idle,*walk,aim,aim,aim,11 if back else 14,13 if back else 14,idle,idle,8 if back else 4,aim,5,7,6,11,13,14]
    for col,idx in enumerate(indices):
        im=poses[idx].copy()
        if mirror: im=ImageOps.mirror(im)
        im.thumbnail((fw-12,fh-16),Image.Resampling.LANCZOS)
        # Consistent foot baseline and centre; do not stretch differing poses.
        atlas.alpha_composite(im,(col*fw+(fw-im.width)//2,row*fh+fh-8-im.height))
atlas.save(out/'field.png')
manifest={'placeholder':False,'image':'field.png','frameWidth':fw,'frameHeight':fh,'columns':21,'rows':8,'facings':facings,'anchor':[.5,8/fh],'worldHeight':2.4,'clips':{k:dict(column=v[0],frames=v[1],fps=v[2],loop=v[3]) for k,v in clips.items()},'events':{'fire':{'frame':0,'event':'muzzle'}},'notes':'Reference pose test atlas. Mirrored/approximated facings; repeated fire frames; no authored death pose.'}
(out/'field.json').write_text(json.dumps(manifest,indent=2)+'\n')
back=crop((1030,30,1510,495)); back.save(out/'backshot-full.png')
shoulder=crop((980,498,1664,936))
# Keep the connected shoulder illustration, excluding fragments of neighboring sheet cells.
mask=shoulder.getchannel('A').point(lambda v: 255 if v > 16 else 0)
ImageDraw.floodfill(mask,(shoulder.width//2,shoulder.height//2),128,thresh=0)
mask=mask.point(lambda v: 255 if v == 128 else 0)
shoulder.putalpha(ImageChops.multiply(shoulder.getchannel('A'),mask))
shoulder=shoulder.crop(shoulder.getbbox()); shoulder.save(out/'backshot.png')
(out/'cutin.json').write_text(json.dumps({'placeholder':False,'width':shoulder.width,'height':shoulder.height,'layers':[{'id':'body','image':'backshot.png','parallax':1}],'screenHeight':.72},indent=2)+'\n')
portrait=poses[0].crop((0,0,poses[0].width,round(poses[0].height*.6))); portrait.thumbnail((192,192)); portrait.save(out/'portrait.png')
