import { Worker } from 'node:worker_threads';

// Bound simultaneous CPU work and waiting requests, regardless of arbitrary seed choices.
const pending = [];
let active = 0;

export function buildMissionAsync(desc) {
    if (pending.length >= 8) return Promise.reject(Error('Map generation busy; please try again shortly'));
    return new Promise((resolve, reject) => {
        pending.push({ desc, resolve, reject });
        drain();
    });
}

function drain() {
    while (active < 2 && pending.length) {
        const job = pending.shift();
        let worker;
        try {
            worker = new Worker(new URL('./MissionWorker.js', import.meta.url), { workerData: job.desc });
        } catch (error) {
            job.reject(error);
            continue;
        }
        active++;
        let finished = false;
        const timer = setTimeout(() => finish(Error('Map generation timed out')), 30000);
        const finish = (error, mission) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            worker.terminate();
            active--;
            if (error) job.reject(error);
            else job.resolve(mission);
            drain();
        };
        worker.once('message', result => finish(result.error ? Error(result.error) : null, result.mission));
        worker.once('error', finish);
        worker.once('exit', code => {
            if (!finished) finish(Error(`Map generation stopped (${code})`));
        });
    }
}
