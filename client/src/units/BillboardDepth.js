/** A screen-facing card uses the depth of an upright character at the same projected height.
 * This stops the tilted card entering the next stair tread, without disabling wall depth tests. */
export function billboardDepthSlope(camera) {
 const e=camera.matrixWorld.elements;
 return e[5]>0.1?Math.hypot(e[4],e[6])/e[5]:0;
}
export function installBillboardDepth(material) {
 const slope={value:0};
 material.onBeforeCompile=shader=>{
  shader.uniforms.billboardDepthSlope=slope;
  shader.vertexShader='uniform float billboardDepthSlope;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`#include <project_vertex>
    vec4 uprightDepth = mvPosition;
    uprightDepth.z += max(0.0, position.y * modelViewMatrix[1].y) * billboardDepthSlope + 0.025;
    vec4 uprightProjection = projectionMatrix * uprightDepth;
    gl_Position.z = uprightProjection.z / uprightProjection.w * gl_Position.w;
  `);
 };
 material.customProgramCacheKey=()=> 'upright-billboard-depth-v1';
 return slope;
}
