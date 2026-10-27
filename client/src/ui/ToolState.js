// PLAN-15: pure rules for the battle controls, kept out of Game so they can be tested in node.
//
//  - one tool on screen at a time: entering any tool closes the action panels (gear, formation, breach), releases the
//    aiming mouse lock when aiming ends, and steps a peeking soldier back home;
//  - the turn ends by itself once no soldier the local player controls can still act;
//  - WASD while aiming steps the peek tile in the camera's frame.
import { alive } from '../../../shared/battle/Units.js';
import { peekCells } from '../../../shared/battle/Peek.js';

/** What switching from tool `prev` to tool `next` must tear down. */
export function toolTeardown(prev, next, { panelOpen = false, locked = false } = {}) {
    const prevKind = prev?.kind || 'move', nextKind = next?.kind || 'move';
    return {
        // A panel stays only when the new tool is opened from inside it (keepPanel) — e.g. a breach charge picks its door.
        closePanel: panelOpen && !next?.keepPanel,
        releaseLock: locked && nextKind !== 'shoot',
        endAimCamera: prevKind === 'shoot' && nextKind !== 'shoot',
        resetPeek: true,
        clearOverlays: true
    };
}

/** True when the local player's side has nobody left who can act (AP and move-only AP spent, or on overwatch). */
export function autoEndReady(battle, controllable = () => true) {
    if (!battle || battle.outcome || battle.activeSide !== 'player') return false;
    const mine = battle.unitsOf('player').filter(u => alive(u) && !u.extracted && controllable(u));
    if (!mine.length) return false;
    return mine.every(u => u.overwatch || (u.ap + (u.moveOnlyAp || 0)) <= 0);
}

const KEY_DIR = { w: [0, 1], s: [0, -1], a: [-1, 0], d: [1, 0] };
/**
 * Next peek tile for a WASD press. `forward` is the camera's flat view direction in grid axes ({x, y}: x east,
 * y south). Returns the cell (the unit's own tile means "back home"), or undefined when nothing fits that way.
 */
export function peekStep(battle, u, current, key, forward) {
    const k = KEY_DIR[key]; if (!k) return undefined;
    const fl = Math.hypot(forward.x, forward.y) || 1, fx = forward.x / fl, fy = forward.y / fl;
    // Screen right of a camera looking along (fx, fy) in x-east / y-south grid axes.
    const rx = -fy, ry = fx;
    const wx = fx * k[1] + rx * k[0], wy = fy * k[1] + ry * k[0];
    const ang = Math.atan2(wy, wx), oct = Math.round(ang / (Math.PI / 4));
    const order = [oct, oct - 1, oct + 1];        // the nearest of 8 directions, then its neighbours
    const cells = peekCells(battle, u);
    for (const o of order) {
        const a = o * Math.PI / 4, dx = Math.round(Math.cos(a)), dy = Math.round(Math.sin(a));
        const c = cells.find(q => q.x === current.x + dx && q.y === current.y + dy && q.z === current.z);
        if (c) return c;
    }
    return undefined;
}

/** PLAN-15: saved settings older than this plan take the new defaults once (auto end turn on, light aim assist). */
export function migrateSettings(o, store = globalThis.localStorage){
    if(!o||typeof o!=='object')return{};
    if((o.settingsVersion||0)>=15)return o;
    const next={...o,autoEndTurn:true,aimAssist:o.aimAssist===false?'off':typeof o.aimAssist==='string'?o.aimAssist:'light',settingsVersion:15};
    try{store?.setItem('tactics-settings',JSON.stringify(next));}catch{}
    return next;
}
