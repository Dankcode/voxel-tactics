import { parentPort, workerData } from 'node:worker_threads';
import { buildMission } from '../../shared/session/Scenarios.js';
import { packMission } from '../../shared/session/MissionSnapshot.js';
import { registerBakedFromDisk } from './BakedDisk.js';
try{registerBakedFromDisk(workerData.scenario,workerData.seed??1);parentPort.postMessage({mission:packMission(buildMission(workerData))});}
catch(error){parentPort.postMessage({error:error.message});}
