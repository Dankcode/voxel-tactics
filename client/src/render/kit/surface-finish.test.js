import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { surfaceFinish } from '../SurfaceFinish.js';

function shaderFor(key) {
    const material = new THREE.MeshStandardMaterial();
    material.onBeforeCompile = () => {};
    surfaceFinish(material, key);
    const shader = {
        vertexShader: '#include <worldpos_vertex>',
        fragmentShader: '#include <common>\n#include <color_fragment>\n#include <normal_fragment_maps>\n#include <roughnessmap_fragment>'
    };
    material.onBeforeCompile(shader);
    material.dispose();
    return shader.fragmentShader;
}

test('continuous streets and paving have deterministic wear and non-uniform physical response', () => {
    for (const key of ['asphalt', 'paving', 'concrete', 'stucco']) {
        const shader = shaderFor(key);
        assert.ok(shader.includes('surfaceHash'), key);
        assert.ok(shader.includes('roughnessFactor=clamp'), key);
        assert.ok(shader.includes('finishMicro'), key);
    }
    assert.ok(shaderFor('asphalt').includes('oil'));
    assert.ok(shaderFor('paving').includes('edgeWear'));
});
