import test from 'node:test';
import assert from 'node:assert/strict';
import { VoxelStore } from '../../../../shared/voxel/VoxelStore.js';
import { MAT } from '../../../../shared/voxel/Materials.js';
import { wallFootprint, bandFootprint, BANDS } from '../../../../shared/voxel/ConnectedShapes.js';
import { prismGeometry, CONNECTED_PIECES, GROUPED } from './ConnectedPieces.js';
import { meshChunk } from '../ChunkMesher.js';
import { TERRAIN_CUES } from '../MaterialLibrary.js';

test('wall rendering uses the collision boundary and correct triangle winding for every junction',()=>{
    for(let mask=0;mask<16;mask++) {
        const polygon=wallFootprint(mask),g=prismGeometry(polygon),p=g.attributes.position,n=g.attributes.normal;
        for(let i=0;i<polygon.length;i++) {
            assert.ok(Math.abs(p.getX(i)+.5-polygon[i][0])<1e-6);
            assert.ok(Math.abs(p.getZ(i)+.5-polygon[i][1])<1e-6);
        }
        for(let i=0;i<g.index.count;i+=3) {
            const [a,b,c]=[0,1,2].map(k=>g.index.array[i+k]);
            const u=[p.getX(b)-p.getX(a),p.getY(b)-p.getY(a),p.getZ(b)-p.getZ(a)];
            const v=[p.getX(c)-p.getX(a),p.getY(c)-p.getY(a),p.getZ(c)-p.getZ(a)];
            const dot=(u[1]*v[2]-u[2]*v[1])*n.getX(a)+(u[2]*v[0]-u[0]*v[2])*n.getY(a)+(u[0]*v[1]-u[1]*v[0])*n.getZ(a);
            assert.ok(dot>0,`mask ${mask}, triangle ${i/3} has incorrect winding`);
        }
        g.dispose();
    }
});

test('shallow and deep water share one surface material with no internal vertical face, even across chunks',()=>{
    const s=new VoxelStore(32,16,8);s.set(15,5,1,MAT.water);s.set(16,5,1,MAT.deep_water);
    for(const cx of [0,1]) {
        const parts=meshChunk(s,cx,0,0);
        assert.deepEqual(parts.map(p=>p.key),['water']);
        const p=parts[0];
        for(let i=0;i<p.positions.length;i+=3) {
            const onSeam=Math.abs(p.positions[i]-16)<1e-6;
            assert.ok(!(onSeam&&Math.abs(p.normals[i])>.99),'no vertical face between liquid depths');
        }
        assert.ok(p.positions.every(Number.isFinite));
    }
});

test('joined ground uses matching colours at shared vertices and grid cues are off by default',()=>{
    const s=new VoxelStore(16,16,8);s.fill(2,2,1,9,9,1,'lawn');
    const mesh=meshChunk(s,0,0,0).find(p=>p.key==='lawn');
    const seen=new Map();
    for(let i=0;i<mesh.positions.length/3;i++) {
        if(mesh.normals[i*3+1]!==1)continue;
        const k=mesh.positions.slice(i*3,i*3+3).join(',');
        const c=mesh.colors.slice(i*3,i*3+3);
        if(seen.has(k))assert.deepEqual(c,seen.get(k),`shared vertex ${k}`);else seen.set(k,c);
    }
    assert.equal(TERRAIN_CUES.uGrid.value,0);assert.equal(TERRAIN_CUES.uRim.value,0);
});

test('grouped cover (hedges, planters, sandbags, field walls) renders exactly its collision silhouette for every mask',()=>{
    for (const family of Object.keys(GROUPED)) for (let mask = 0; mask < 16; mask++) {
        const polygon = bandFootprint(mask, BANDS[family].thickness, BANDS[family].radius);
        const parts = CONNECTED_PIECES[`joined_${family}_${mask}_top`].build();
        const p = parts[0].geometry.attributes.position;
        for (let i = 0; i < polygon.length; i++) {
            assert.ok(Math.abs(p.getX(i) + .5 - polygon[i][0]) < 1e-6 && Math.abs(p.getZ(i) + .5 - polygon[i][1]) < 1e-6, `${family} mask ${mask}`);
        }
        // Joined sides reach the cell edge exactly, so neighbouring modules meet without a seam.
        for (const [bit, test] of [[1, q => q[0] === 1], [2, q => q[1] === 1], [4, q => q[0] === 0], [8, q => q[1] === 0]])
            assert.equal(polygon.some(test), !!(mask & bit), `${family} mask ${mask} edge ${bit}`);
    }
});
