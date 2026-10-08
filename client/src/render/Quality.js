// Graphics quality. "mobile" (the default) is built for phones and integrated GPUs: the 256 px painted texture set
// (assets/textures/mobile, tools/art/make_mobile_textures.py), softened normal maps, a 2048 shadow map, render scale
// capped at 1.25 and ambient occlusion off. "high" is the full set: 512 px textures, 4096 shadows, AO, up to 2× scale.
// Choose with ?quality=high|mobile or Options ⚙ (stored per browser, applied on reload).
const PROFILES = {
    mobile: { name: 'mobile', textures: '/assets/textures/mobile/', pixelRatio: 1.25, shadowMap: 2048, ao: false, anisotropy: 2, normalScale: 0.7 },
    high: { name: 'high', textures: '/assets/textures/pbr/', pixelRatio: 2, shadowMap: 4096, ao: true, anisotropy: 8, normalScale: 1 }
};
const KEY = 'fireteam.quality';
function pick() {
    try {
        const q = new URLSearchParams(globalThis.location?.search || '').get('quality');
        if (PROFILES[q]) return q;
        const saved = globalThis.localStorage?.getItem(KEY);
        if (PROFILES[saved]) return saved;
    } catch { /* storage blocked: fall through */ }
    return 'mobile';
}
export const QUALITY = PROFILES[pick()];
export function setQuality(name) {
    try { globalThis.localStorage?.setItem(KEY, name); } catch { /* ignore */ }
    globalThis.location?.reload();
}
