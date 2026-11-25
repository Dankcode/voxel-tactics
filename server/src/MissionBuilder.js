import { Worker } from 'node:worker_threads';

// Reusable worker pool (max 2 concurrent workers) to avoid spawning Node workers & re-importing modules per room.
const MAX_WORKERS = 2;
const pending = [];
const pool = [];
let nextJobId = 1;

export function buildMissionAsync(desc) {
    if (pending.length >= 8) return Promise.reject(Error('Map generation busy; please try again shortly'));
    return new Promise((resolve, reject) => {
        pending.push({ id: nextJobId++, desc, resolve, reject });
        drain();
    });
}

function getIdleWorker() {
    const existing = pool.find(w => !w.busy);
    if (existing) return existing;
    if (pool.length >= MAX_WORKERS) return null;
    const worker = new Worker(new URL('./MissionWorker.js', import.meta.url));
    const slot = { worker, busy: false, job: null, timer: null };
    worker.on('message', result => {
        const job = slot.job;
        if (!job || result.id !== job.id) return;
        clearTimeout(slot.timer);
        slot.busy = false; slot.job = null; slot.timer = null;
        slot.worker.unref();
        if (result.error) job.reject(Error(result.error));
        else job.resolve(result.mission);
        drain();
    });
    const dropWorker = err => {
        const job = slot.job;
        clearTimeout(slot.timer);
        const i = pool.indexOf(slot); if (i >= 0) pool.splice(i, 1);
        if (job) { slot.busy = false; slot.job = null; job.reject(err instanceof Error ? err : Error(String(err))); }
        drain();
    };
    worker.on('error', dropWorker);
    worker.on('exit', code => dropWorker(Error(`Map generation stopped (${code})`)));
    worker.unref();
    pool.push(slot);
    return slot;
}

function drain() {
    while (pending.length) {
        const slot = getIdleWorker();
        if (!slot) break;
        const job = pending.shift();
        slot.busy = true;
        slot.job = job;
        slot.worker.ref();
        slot.timer = setTimeout(() => {
            const j = slot.job;
            slot.busy = false; slot.job = null; slot.timer = null;
            const i = pool.indexOf(slot); if (i >= 0) pool.splice(i, 1);
            slot.worker.terminate();
            j?.reject(Error('Map generation timed out'));
            drain();
        }, 30000);
        try {
            slot.worker.postMessage({ id: job.id, desc: job.desc });
        } catch (error) {
            clearTimeout(slot.timer);
            slot.busy = false; slot.job = null; slot.timer = null;
            slot.worker.unref();
            const i = pool.indexOf(slot); if (i >= 0) pool.splice(i, 1);
            job.reject(error);
        }
    }
}
