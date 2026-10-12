// Per-browser storage for the test ground: saved scenarios, the last setup, and recent battle reports.
// Browser storage can be missing or full (private windows, blocked site data), so every access is guarded and the
// game works without it.
const KEYS = { reports: 'fireteam.reports.v1', scenarios: 'fireteam.testScenarios.v1', last: 'fireteam.testLast.v1' };
const MAX_REPORTS = 20;

function read(key, fallback) {
    try { const v = JSON.parse(globalThis.localStorage?.getItem(key) ?? 'null'); return v ?? fallback; } catch { return fallback; }
}
function write(key, value) {
    try { globalThis.localStorage?.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

export const loadReports = () => read(KEYS.reports, []);
/** Keep the newest reports; when storage is full, drop the oldest until it fits. */
export function saveReport(report) {
    let list = [report, ...loadReports()].slice(0, MAX_REPORTS);
    while (list.length && !write(KEYS.reports, list)) list = list.slice(0, -1);
    return list.length > 0;
}
export const clearReports = () => write(KEYS.reports, []);

export const loadScenarios = () => read(KEYS.scenarios, []);
export function saveScenario(name, desc, client = {}) {
    const list = loadScenarios().filter(s => s.name !== name);
    list.unshift({ name, desc, client });
    return write(KEYS.scenarios, list.slice(0, 40));
}
export const deleteScenario = name => write(KEYS.scenarios, loadScenarios().filter(s => s.name !== name));

export const loadLastSetup = () => read(KEYS.last, null);
export const saveLastSetup = setup => write(KEYS.last, setup);

/** URL-safe base64 of a JSON value (deep links: ?test=…). */
export function encodeSetup(value) {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodeSetup(text) {
    const b64 = String(text).replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))));
}

export function downloadJson(filename, value) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
