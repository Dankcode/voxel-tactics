import * as THREE from 'three';
import { MARK_COLORS } from '../../../shared/battle/Markers.js';
export class TacticalMarks{
    constructor(scene){this.scene=scene;this.group=new THREE.Group();scene.scene.add(this.group);this.items=new Map();this.sequence=null;}
    update(battle,cut,time){
        if(!battle){this.group.visible=false;return;}this.group.visible=true;
        if(this.sequence!==battle.seq){this.sequence=battle.seq;const formations=[...battle.formations.list.values()].filter(f=>f.open).flatMap(f=>battle.formations.plannedSlots(f).map((p,i)=>({id:`formation-${f.id}-${i}`,source:'formation',color:Object.values(f.assignments).includes(i)?'green':'blue',...p})));const marks=[...battle.markers,...formations];const keep=new Set(marks.map(m=>m.id));for(const [id,g]of this.items)if(!keep.has(id)){this.group.remove(g);g.traverse(o=>{o.geometry?.dispose();o.material?.map?.dispose();o.material?.dispose();});this.items.delete(id);}
            for(const mark of marks){let g=this.items.get(mark.id);if(!g){g=this.make(mark);this.items.set(mark.id,g);this.group.add(g);}else if(g.userData.mark?.color!==mark.color)g.traverse(o=>o.material?.color?.setHex(MARK_COLORS[mark.color]));g.position.set(mark.x+.5,mark.z+1.02,mark.y+.5);g.userData.mark=mark;}
        }
        for(const g of this.items.values()){g.visible=g.userData.mark.z<cut;g.userData.sign.position.y=(g.userData.mark.source==='sensor'?.55:1.05)+Math.sin(time*3)*.05;}
    }
    make(mark){const g=new THREE.Group(),color=MARK_COLORS[mark.color],sensor=mark.source==='sensor';
        const geometry=new THREE.BoxGeometry(sensor?.7:.96,.05,sensor?.7:.96),mat=new THREE.MeshBasicMaterial({color,transparent:true,opacity:.4,depthWrite:false,toneMapped:false});
        g.add(new THREE.Mesh(geometry,mat));const edge=new THREE.LineSegments(new THREE.EdgesGeometry(geometry),new THREE.LineBasicMaterial({color,depthTest:false,toneMapped:false}));g.add(edge);
        const canvas=document.createElement('canvas');canvas.width=64;canvas.height=96;const c=canvas.getContext('2d');c.font='bold 76px sans-serif';c.textAlign='center';c.fillStyle=`#${color.toString(16).padStart(6,'0')}`;c.shadowColor=c.fillStyle;c.shadowBlur=6;c.fillText(sensor?'·':'!',32,76);
        const tex=new THREE.CanvasTexture(canvas),sign=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false,toneMapped:false}));sign.scale.set(sensor?.35:.5,sensor?.55:.8,1);g.add(sign);sign.visible=mark.source!=='formation';g.userData.sign=sign;return g;
    }
    clear(){for(const g of this.items.values()){g.traverse(o=>{o.geometry?.dispose();o.material?.map?.dispose();o.material?.dispose();});this.group.remove(g);}this.items.clear();this.sequence=null;}
}
