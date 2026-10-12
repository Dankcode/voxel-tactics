import { CONTENT_CONTRACT } from './ContentContract.js';
import { createBattle } from './Scenarios.js';
import { unpackMission } from './MissionSnapshot.js';
import { hashString } from '../util/Rng.js';
/** Server recovery bundle: compiled initial map plus its complete, ordered event log.
 * Replaying authoritative inputs restores RNG, damage, statuses, ammo and ownership together. */
export function replayBattle(snapshot) {
    if (snapshot.contract?.content !== CONTENT_CONTRACT.content || snapshot.contract?.protocol !== CONTENT_CONTRACT.protocol) throw Error('Incompatible game content');
    if (hashString(JSON.stringify(snapshot.mission)).toString(16) !== snapshot.mapHash) throw Error('Map package hash mismatch');
    const battle = createBattle(snapshot.desc, unpackMission(snapshot.mission));
    let seq = 0;
    for (const entry of snapshot.log) {
        if (entry.seq !== ++seq || !battle.apply(entry.intent).ok) { battle.light.dispose(); throw Error('Invalid battle replay'); }
    }
    if (seq !== snapshot.seq || battle.hash() !== snapshot.hash) { battle.light.dispose(); throw Error('Battle replay hash mismatch'); }
    return battle;
}
