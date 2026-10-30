// Large surfaces share a continuous world-space finish. No tile-local UV repeats or grout baked into each voxel.
export const CONTINUOUS_SURFACES = new Set(['lawn','grass','concrete','paving','asphalt','oak_floor','ceramic','carpet','tile_dark','deck','stucco','city_wall']);
export function surfaceFinish(material, key='concrete') {
    const tiles=['ceramic','tile_dark'].includes(key),wood=['oak_floor','deck'].includes(key),paving=['paving','concrete'].includes(key);
    const detail=tiles?`
            vec2 tileP=vFinishWorld.xz*2.0;
            vec2 edge=min(fract(tileP),1.0-fract(tileP));
            float aa=max(fwidth(tileP.x),fwidth(tileP.y));
            float grout=1.0-smoothstep(0.012,0.012+aa,min(edge.x,edge.y));
            float checker=mod(floor(tileP.x)+floor(tileP.y),2.0);
            float horizontal=step(0.5,abs(normalize(cross(dFdx(vFinishWorld),dFdy(vFinishWorld))).y));
            diffuseColor.rgb *= mix(0.92,mix(0.56,1.08,checker),horizontal);
            diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*0.46,grout*0.65*horizontal);`
        :wood?`
            vec2 plankP=vec2(vFinishWorld.x*3.0,vFinishWorld.z*0.6);
            float woodGrain=surfaceGrain(vec2(vFinishWorld.x*45.0,vFinishWorld.z*2.0));
            float seam=1.0-smoothstep(0.012,0.025+fwidth(plankP.x),min(fract(plankP.x),1.0-fract(plankP.x)));
            diffuseColor.rgb *= 0.90+woodGrain*0.16;
            diffuseColor.rgb *= 1.0-seam*0.18;`
        :paving?`
            vec2 panel=vFinishWorld.xz*0.5;
            vec2 edge=min(fract(panel),1.0-fract(panel));
            float seam=1.0-smoothstep(0.003,0.003+max(fwidth(panel.x),fwidth(panel.y)),min(edge.x,edge.y));
            diffuseColor.rgb *= 1.0-seam*0.16;`:'';
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
            diffuseColor.rgb *= 0.96 + grain*0.08;
            ${detail}`);
    };
    material.customProgramCacheKey=()=> 'continuous-surface-v2-'+key;
}
