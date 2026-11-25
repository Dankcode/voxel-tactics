import { parentPort } from 'node:worker_threads';
import { buildMission } from '../../shared/session/Scenarios.js';
import { packMission } from '../../shared/session/MissionSnapshot.js';
import { registerBakedFromDisk } from './BakedDisk.js';

parentPort.on('message', ({ id, desc }) => {
    try {
        registerBakedFromDisk(desc.scenario, desc.seed ?? 1);
        parentPort.postMessage({ id, mission: packMission(buildMission(desc)) });
    } catch (error) {
        parentPort.postMessage({ id, error: error.message });
    }
});
