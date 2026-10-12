// Authoritative compiled mission for co-op. RLE keeps empty voxel volumes small on the wire.
import { VoxelStore } from '../voxel/VoxelStore.js';
export function packMission(mission) {
    const { store, ...data } = mission;
    const voxels = [];
    for (let i = 0; i < store.mat.length;) {
        let end = i + 1;
        while (end < store.mat.length && store.mat[end] === store.mat[i] &&
            store.hp[end] === store.hp[i] && store.rooms[end] === store.rooms[i]) end++;
        voxels.push(end - i, store.mat[i], store.hp[i], store.rooms[i]);
        i = end;
    }
    return { ...structuredClone(data), store: {
        width: store.width, depth: store.depth, height: store.height,
        datum: store.datum, version: store.version,
        supportGroups: structuredClone(store.supportGroups || []), windowOpenings: [...store.windowOpenings], voxels,
    } };
}
export function unpackMission(snapshot) {
    const { store: packed, ...data } = snapshot;
    const store = new VoxelStore(packed.width, packed.depth, packed.height);
    let at = 0;
    for (let i = 0; i < packed.voxels.length; i += 4) {
        const [count, mat, hp, room] = packed.voxels.slice(i, i + 4);
        store.mat.fill(mat, at, at + count);
        store.hp.fill(hp, at, at + count);
        store.rooms.fill(room, at, at + count);
        at += count;
    }
    if (at !== store.mat.length) throw Error('Incomplete mission snapshot');
    store.datum = packed.datum;
    store.version = packed.version;
    store.supportGroups = structuredClone(packed.supportGroups || []);
    store.windowOpenings = new Map(packed.windowOpenings || []);
    return { ...structuredClone(data), store };
}
