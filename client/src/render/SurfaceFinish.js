// Large surfaces share a continuous world-space finish. No tile-local UV repeats or grout baked into each voxel.
export const CONTINUOUS_SURFACES = new Set(['lawn','grass','concrete','paving','asphalt','oak_floor','ceramic','carpet','tile_dark','deck','stucco','city_wall']);
export function surfaceFinish(material) {
    const previous=material.onBeforeCompile;
    material.onBeforeCompile=shader=>{
        previous(shader);
        shader.vertexShader = 'varying vec3 vFinishWorld;\n' + shader.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
            vec4 finishP=vec4(transformed,1.0);
            #ifdef USE_INSTANCING
                finishP=instanceMatrix*finishP;
            #endif
            vFinishWorld=(modelMatrix*finishP).xyz;`);
        shader.fragmentShader = 'varying vec3 vFinishWorld;\n' + shader.fragmentShader;
        shader.fragmentShader=shader.fragmentShader.replace('#include <common>', `#include <common>
            float surfaceHash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
            float surfaceGrain(vec2 p) {
                vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
                return mix(mix(surfaceHash(i),surfaceHash(i+vec2(1,0)),f.x),mix(surfaceHash(i+vec2(0,1)),surfaceHash(i+vec2(1,1)),f.x),f.y);
            }`).replace('#include <color_fragment>', `#include <color_fragment>
            // Absolute world coordinates keep the finish seamless across chunk, tile and section boundaries.
            float grain=surfaceGrain(vFinishWorld.xz*0.23)*0.7+surfaceGrain(vFinishWorld.xz*3.17)*0.3;
            diffuseColor.rgb *= 0.94 + grain*0.12;`);
    };
    material.customProgramCacheKey=()=> 'continuous-surface-v1';
}
