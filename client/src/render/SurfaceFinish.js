// Large surfaces share a continuous world-space finish. No tile-local UV repeats or grout baked into each voxel.
export const CONTINUOUS_SURFACES = new Set(['lawn','grass','concrete','paving','asphalt','oak_floor','ceramic','carpet','tile_dark','deck','stucco','city_wall','plaster']);
export function surfaceFinish(material, key='concrete') {
    const tiles=['ceramic','tile_dark'].includes(key),wood=['oak_floor','deck'].includes(key);
    const masonry=['stucco','city_wall','plaster'].includes(key),vegetation=['lawn','grass'].includes(key);
    const detail=tiles?`
            vec2 tileP=finishUv*2.0;
            vec2 edge=min(fract(tileP),1.0-fract(tileP));
            float aa=max(fwidth(tileP.x),fwidth(tileP.y));
            float grout=1.0-smoothstep(0.012,0.012+aa,min(edge.x,edge.y));
            float checker=mod(floor(tileP.x)+floor(tileP.y),2.0);
            float horizontal=step(0.5,abs(finishNormal.y));
            diffuseColor.rgb *= mix(0.92,mix(0.68,1.08,checker),horizontal);
            diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*0.46,grout*0.65*horizontal);`
        :wood?`
            vec2 plankP=vec2(finishUv.x*3.0,finishUv.y*0.6);
            float woodGrain=surfaceGrain(vec2(finishUv.x*45.0,finishUv.y*2.0));
            float seam=1.0-smoothstep(0.012,0.025+fwidth(plankP.x),min(fract(plankP.x),1.0-fract(plankP.x)));
            float boardTone=surfaceHash(vec2(floor(plankP.x),floor(plankP.y)));
            diffuseColor.rgb *= 0.84+woodGrain*0.15+boardTone*0.12;
            diffuseColor.rgb *= 1.0-seam*0.22;`
        :key==='paving'?`
            vec2 panel=finishUv*0.5;
            vec2 edge=min(fract(panel),1.0-fract(panel));
            float seam=1.0-smoothstep(0.006,0.006+max(fwidth(panel.x),fwidth(panel.y)),min(edge.x,edge.y));
            float slab=surfaceHash(floor(panel));
            float edgeWear=smoothstep(0.72,0.95,surfaceGrain(finishUv*3.7));
            diffuseColor.rgb *= 0.86+slab*0.20+macro*0.06;
            diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(0.78,0.80,0.77),edgeWear*0.18);
            diffuseColor.rgb *= 1.0-seam*0.32;`
        :key==='concrete'?`
            vec2 panel=finishUv*0.5;
            vec2 edge=min(fract(panel),1.0-fract(panel));
            float seam=1.0-smoothstep(0.003,0.003+max(fwidth(panel.x),fwidth(panel.y)),min(edge.x,edge.y));
            float pores=smoothstep(0.82,0.98,surfaceGrain(finishUv*31.0));
            diffuseColor.rgb *= 0.91+macro*0.16-pores*0.08;
            diffuseColor.rgb *= 1.0-seam*0.18;`
        :key==='asphalt'?`
            float aggregate=surfaceGrain(finishUv*42.0);
            float repair=step(0.76,surfaceHash(floor(finishUv*0.17)));
            float crack=smoothstep(0.975,0.995,surfaceGrain(finishUv*vec2(1.3,5.0)));
            float oil=smoothstep(0.67,0.88,surfaceGrain(finishUv*0.32+vec2(7.1)));
            diffuseColor.rgb *= 0.80+aggregate*0.24+macro*0.14;
            diffuseColor.rgb *= 1.0-repair*0.08-crack*0.10-oil*0.13;`
        :masonry?`
            float trowel=surfaceGrain(finishUv*1.7)*0.6+surfaceGrain(finishUv*8.0)*0.4;
            float streak=surfaceGrain(vec2(finishUv.x*5.0,finishUv.y*0.12));
            float weather=smoothstep(0.54,0.88,streak)*0.10;
            diffuseColor.rgb *= 0.85+trowel*0.22+macro*0.12-weather;`
        :vegetation?`
            float blades=surfaceGrain(finishUv*37.0);
            diffuseColor.rgb *= 0.78+macro*0.28+blades*0.14;
            diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(1.05,1.02,0.82),smoothstep(0.63,0.9,macro)*0.24);`
        :key==='carpet'?`
            float fibre=surfaceGrain(finishUv*55.0);
            diffuseColor.rgb *= 0.88+macro*0.12+fibre*0.10;`:'';
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
            vec3 finishNormal=normalize(cross(dFdx(vFinishWorld),dFdy(vFinishWorld)));
            vec2 finishUv=abs(finishNormal.y)>0.65?vFinishWorld.xz:(abs(finishNormal.x)>abs(finishNormal.z)?vFinishWorld.zy:vFinishWorld.xy);
            float macro=surfaceGrain(finishUv*0.23)*0.7+surfaceGrain(finishUv*0.71)*0.3;
            float grain=surfaceGrain(finishUv*3.17);
            diffuseColor.rgb *= 0.95 + grain*0.10;
            ${detail}`).replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
            roughnessFactor=clamp(roughnessFactor+(macro-0.5)*0.12+(grain-0.5)*0.05,0.18,1.0);`)
            .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
            vec2 finishMicro=vec2(dFdx(grain),dFdy(grain))*0.12;
            normal=normalize(normal+vec3(finishMicro,0.0));`);
    };
    material.customProgramCacheKey=()=> 'continuous-surface-v4-'+key;
}
