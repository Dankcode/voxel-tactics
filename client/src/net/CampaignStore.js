// Guarded browser persistence for the active Campaign Operations Theater state.
import {
    createTheaterState,
    normalizeTheaterState,
    applyOperationOutcome
} from '../../../shared/campaign/OperationsTheater.js';

const STORAGE_KEY = 'fireteam.theater.v1';

export function loadTheater() {
    try {
        const raw = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? 'null');
        return normalizeTheaterState(raw);
    } catch {
        return createTheaterState();
    }
}

export function saveTheater(state) {
    const clean = normalizeTheaterState(state);
    try {
        globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(clean));
        return true;
    } catch {
        return false;
    }
}

export function resetTheater() {
    const fresh = createTheaterState();
    saveTheater(fresh);
    return fresh;
}

export function setActiveTheaterOp(opId) {
    const state = loadTheater();
    state.activeOpId = opId;
    saveTheater(state);
    return state;
}

export function recordTheaterOutcome(opId, report) {
    const current = loadTheater();
    const res = applyOperationOutcome(current, opId, report);
    saveTheater(res.state);
    return res;
}
