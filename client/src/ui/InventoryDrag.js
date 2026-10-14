/** Pointer-based dragging keeps keyboard rotation available while an item is held. */
export class InventoryDrag {
    constructor(root,{begin,target,drop}){
        this.root=root;this.begin=begin;this.target=target;this.drop=drop;
        root.addEventListener('pointerdown',e=>{
            if(e.button!==0)return;
            const item=e.target.closest('[data-cargo],[data-item]');if(!item)return;
            const data=begin(item,e);if(!data)return;
            this.pending={...data,id:e.pointerId,startX:e.clientX,startY:e.clientY};
        });
        root.addEventListener('pointermove',e=>{
            if(!this.pending||this.pending.id!==e.pointerId)return;
            if(!this.active&&Math.hypot(e.clientX-this.pending.startX,e.clientY-this.pending.startY)<5)return;
            e.preventDefault();if(!this.active)root.setPointerCapture(e.pointerId);this.active=true;this.point={x:e.clientX,y:e.clientY};this.update();
        });
        window.addEventListener('pointerup',e=>{
            if(!this.pending||this.pending.id!==e.pointerId)return;
            const destination=this.destination,active=this.active;this.cancel();
            if(active){e.preventDefault();this.suppressUntil=Date.now()+350;if(destination?.valid)drop(destination);}
        });
        window.addEventListener('pointercancel',()=>this.cancel());
        root.addEventListener('dragstart',e=>e.preventDefault());
        root.addEventListener('click',e=>{if(Date.now()<this.suppressUntil){e.preventDefault();e.stopImmediatePropagation();}},true);
    }
    update(){
        this.preview?.remove();this.preview=null;this.destination=null;if(!this.active)return;
        const hit=document.elementFromPoint(this.point.x,this.point.y),grid=hit?.closest('[data-storage-grid]');
        if(!grid||!this.root.contains(grid))return;
        const cell=grid.querySelector('[data-grid],[data-cell]'),rect=cell.getBoundingClientRect(),bounds=grid.getBoundingClientRect();
        const gap=parseFloat(getComputedStyle(grid).columnGap)||0;
        const offset=this.pending.offset;
        const x=Math.floor((this.point.x-rect.left)/(rect.width+gap))-offset.x;
        const y=Math.floor((this.point.y-rect.top)/(rect.height+gap))-offset.y;
        const d=this.target(grid,x,y);if(!d)return;this.destination={...d,grid,x,y};
        const preview=document.createElement('div');preview.className=`cargo-placement ${d.valid?'valid':'invalid'}`;
        Object.assign(preview.style,{left:`${rect.left-bounds.left+x*(rect.width+gap)}px`,top:`${rect.top-bounds.top+y*(rect.height+gap)}px`,width:`${d.w*rect.width+(d.w-1)*gap}px`,height:`${d.h*rect.height+(d.h-1)*gap}px`});
        preview.textContent=`${d.w} × ${d.h} · R ↻`;grid.append(preview);this.preview=preview;
    }
    rotateOffset(w,h){if(this.pending){const o=this.pending.offset;this.pending.offset={x:Math.min(w-1,o.y),y:Math.min(h-1,o.x)};}this.update();}
    cancel(){this.preview?.remove();this.preview=null;this.destination=null;this.active=false;const id=this.pending?.id;this.pending=null;if(id!==undefined&&this.root.hasPointerCapture(id))this.root.releasePointerCapture(id);}
}
