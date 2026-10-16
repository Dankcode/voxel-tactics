// Human-readable intent rejection reasons.
export const REASONS = { formation_blocked: 'formation too wide to fit here — break it or switch to a narrower one (Formation tab)', not_detected:'support unlocks when the squad is detected', support_cooldown:'recharging — killstreaks come back 10 turns after use', no_ap: 'not enough AP', unreachable: 'no path there', occupied: 'tile occupied', out_of_range: 'out of range', no_ammo: 'out of ammo — reload', no_target: 'no target', not_adjacent: 'not adjacent', no_will: 'not enough Will', not_your_turn: 'not your turn', not_your_unit: "a teammate's soldier", debug_disabled: 'debug mode is off' };
export const reasonText = r => REASONS[r] || String(r || 'unknown').replace(/_/g, ' ');

