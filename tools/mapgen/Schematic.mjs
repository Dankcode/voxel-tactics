// Explicit offline authoring previews, not AI concept art. PNG output needs no browser or external dependency.
import { deflateSync } from 'node:zlib';
function crc(bytes) {let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;}return(c^0xffffffff)>>>0;}
function chunk(kind,data){const name=Buffer.from(kind),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);name.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc(Buffer.concat([name,data])),data.length+8);return out;}
export function rasterPng(width,height,rects) {
    const pixels=Buffer.alloc(width*height*3,27);
    for(const r of rects)for(let y=Math.max(0,Math.floor(r.y));y<Math.min(height,Math.ceil(r.y+r.h));y++)for(let x=Math.max(0,Math.floor(r.x));x<Math.min(width,Math.ceil(r.x+r.w));x++)for(let c=0;c<3;c++)pixels[(y*width+x)*3+c]=r.color[c];
    const scan=Buffer.alloc(height*(width*3+1));for(let y=0;y<height;y++)pixels.copy(scan,y*(width*3+1)+1,y*width*3,(y+1)*width*3);
    const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=2;
    return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(scan)),chunk('IEND',Buffer.alloc(0))]);
}
export function schematicFloor(b,f) {
    const unit=24,rects=[],colors=[[139,164,164],[165,149,121],[111,139,159],[126,146,125]];
    for(const [i,r] of f.rooms.entries())for(const [x,y] of r.cells)rects.push({x:x*unit,y:y*unit,w:unit,h:unit,color:r.gameplay===false?[62,66,72]:r.kind==='hall'?[190,191,179]:colors[i%4]});
    for(const d of f.doors)rects.push({x:d.x*unit+6,y:d.y*unit,w:12,h:unit,color:d.locked?[158,89,66]:[94,207,208]});
    return rasterPng(b.w*unit,b.d*unit,rects);
}
