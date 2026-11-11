import { materialById } from './Materials.js';

const PROFILES = Object.freeze({
    car: Object.freeze({ car_body: [0, 0.82], car_cabin: [0, 0.44] }),
    abandoned_car: Object.freeze({ car_body: [0, 0.98] }),
    truck: Object.freeze({ car_body: [0, 0.73], car_cabin: [0, 0.73] }),
    bus: Object.freeze({ car_body: [0, 0.73], car_cabin: [0, 0.73] }),
    semitrailer: Object.freeze({ car_body: [0, 0.73], car_cabin: [0, 0.73] }),
    eighteen_wheeler: Object.freeze({ car_body: [0, 0.73], car_cabin: [0, 0.73] })
});

export function registerVehicleCollision(store, piece, cells, materials) {
    const profile = PROFILES[piece];
    if (!profile) return;
    for (let i = 0; i < cells.length; i++) {
        const slab = profile[materialById(materials[i]).key];
        if (slab) store.vehicleCollision.set(cells[i], slab);
    }
}
