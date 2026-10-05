import { getTileDefinition } from './TileRegistry.js';

export class VoxelWorld {
    constructor(columns, tileInfo = getTileDefinition) { this.columns = columns; this.tileInfo = tileInfo; this.surfaceCache = new Map(); }
    invalidate() { this.surfaceCache.clear(); }
    column(x, y) { return this.columns.get(`${x},${y}`) || null; }
    isSolid(x, y, z) {
        const v = this.column(x, y)?.find(v => v.z === z);
        return Boolean(v && v.element !== 0 && v.collision?.active !== false);
    }
    surfaces(x, y) {
        const key = `${x},${y}`;
        if (this.surfaceCache.has(key)) return this.surfaceCache.get(key);
        const surfaces = (this.column(x, y) || []).filter(v => v.walkable).map(voxel => {
            let headroom = 0;
            while (headroom < 8 && !this.isSolid(x, y, voxel.z + headroom + 1)) headroom++;
            return { x, y, z: voxel.z, voxel, headroom,
                info: this.tileInfo(voxel.element, voxel.textureValue ?? voxel.texture) };
        }).sort((a, b) => a.z - b.z);
        this.surfaceCache.set(key, surfaces);
        return surfaces;
    }
    static fromMatrix(matrix, tileInfo) {
        const columns = new Map();
        for (let y = 0; y < matrix.height; y++) for (let x = 0; x < matrix.width; x++) {
            columns.set(`${x - matrix.offsetX},${y - matrix.offsetY}`, matrix.columns[y][x]);
        }
        return new VoxelWorld(columns, tileInfo);
    }
}
