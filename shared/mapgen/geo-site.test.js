import test from 'node:test';
import assert from 'node:assert/strict';
import { geoExportToSite, clipPolyline, ringArea, storeysFromTags, METRES_PER_CELL } from './GeoSite.js';
import { validateSite } from './PackageBuilder.js';
import { solveSite } from './SiteSolver.js';

// A tiny synthetic block (metres): two touching shallow storefronts on a street, one office, a car park.
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const GEO = {
    crs: 'EPSG:32615', origin: { lon: -91.1874, lat: 30.4497 }, extent: { x0: -60, x1: 60, y0: -50, y1: 50 },
    buildings: [
        { osm: '1', tags: { building: 'yes', name: 'Corner Store', 'building:levels': '2' }, ring: rect(-40, 20, -10, 28) },   // 8 m deep: merges
        { osm: '2', tags: { building: 'yes', 'building:levels': '3' }, ring: rect(-40, 28, -10, 42) },
        { osm: '3', tags: { building: 'office', 'building:levels': '21' }, ring: rect(10, -30, 40, 10) },
        { osm: '4', tags: { building: 'yes' }, ring: rect(55, 0, 90, 20) },                                                   // mostly off-map
    ],
    highways: [
        { osm: '10', tags: { highway: 'tertiary', name: 'Main Street', lanes: '2' }, line: [[-55, -80], [-50, 80]] },
        { osm: '11', tags: { highway: 'secondary', name: 'Cross Street', lanes: '4' }, line: [[-80, -40], [80, -38]] },
        { osm: '12', tags: { highway: 'footway' }, line: [[0, 0], [10, 10]] },
    ],
    areas: [{ osm: '20', tags: { amenity: 'parking' }, ring: rect(-35, -30, 0, 5) }],
    dem: { step: 10, z: [[20, 20, 21], [20, 21, 21]] },
};

test('geo: block converts to a valid site at 1:1 (frame in kit cells)', () => {
    const { site, report } = geoExportToSite(GEO, { id: 'geo-test', name: 'Geo Test', objectiveName: 'Corner Store' });
    validateSite(site);
    assert.equal(Math.round(site.frame.width), Math.round(120 / METRES_PER_CELL));
    assert.equal(site.buildings.length, 2, 'shallow storefront merged into its neighbour, off-map building dropped');
    assert.deepEqual(report.merged[0].add, ['1']);
    assert.equal(report.dropped[0].osm, '4');
    const office = site.buildings.find(b => b.source.osm.includes('3'));
    assert.equal(office.observedStoreys, 21);
    assert.equal(office.storeys, 2, 'kit cap 4, then filler policy 2 (the objective is the landmark)');
    assert.ok(report.storeys.some(s => s.id === office.id && s.played === 2));
    assert.equal(site.objectiveBuilding, site.buildings.find(b => b.source.names.includes('Corner Store')).id);
    assert.ok(site.roads.every(r => r.width >= 3 && r.width <= 14 && r.points.every(p => p.every(n => n >= 0 && n <= 1))));
    assert.ok(!site.roads.some(r => /footway/.test(r.id)));
    assert.equal(site.parking.length, 1);
});

test('geo: site solves without repairs that drop or distort buildings', () => {
    const { site } = geoExportToSite(GEO, { id: 'geo-test', name: 'Geo Test' });
    const s = solveSite(site, 1);
    assert.equal(s.buildings.length, site.buildings.length);
    assert.ok(s.congruence.every(c => c.iou >= 0.85));
    assert.ok(Math.abs(s.transform.scale - 1) < 0.25, 'played near real scale');
});

test('geo: deterministic', () => {
    assert.deepEqual(geoExportToSite(GEO, { id: 'a' }).site, geoExportToSite(GEO, { id: 'a' }).site);
});

test('geo: helpers', () => {
    assert.equal(ringArea(rect(0, 0, 10, 5)), 50);
    assert.deepEqual(clipPolyline([[-10, 5], [20, 5]], { x0: 0, y0: 0, x1: 10, y1: 10 }), [[[0, 5], [10, 5]]]);
    assert.deepEqual(storeysFromTags({ height: '14' }), { observed: 4, storeys: 4 });
    assert.deepEqual(storeysFromTags({}), { observed: null, storeys: 2 });
});
