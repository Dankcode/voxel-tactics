// After-action report overlay: shown at the end of every battle (replaces the old outcome card).
import { ABILITIES, ENEMIES } from '../../../shared/content/units.js';
import { THROWABLES } from '../../../shared/content/weapons.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = v => (v == null ? '–' : `${v}%`);
const REASONS = { recovered: 'Package recovered', held: 'Zone held', extracted: 'Squad extracted', eliminated: 'All hostiles down', timer: 'Deadline passed', 'squad lost': 'The squad was lost', abandoned: 'Battle abandoned' };
const STATUS = { unhurt: 'Unhurt', wounded: 'Wounded', down: 'Down', killed: 'KIA', extracted: 'Extracted' };
const TABS = [['squad', 'Squad'], ['hostiles', 'Hostiles'], ['weapons', 'Weapons'], ['playstyle', 'Playstyle & AI'], ['field', 'Field & objective'], ['timeline', 'Timeline']];
const TRAIT_LABEL = { aggression: 'Aggression', flanking: 'Flanking', overwatch: 'Overwatch', explosives: 'Explosives', elements: 'Elements', stealth: 'Stealth & intel', range: 'Range', cover: 'Cover discipline', breach: 'Breaching', melee: 'Melee' };

/** PLAN-09: the playstyle tab - this match's traits, the profile the AI played against, and how it adapts next. */
function playstyleMarkup(ps) {
    if (!ps) return '<p class="rnone">No playstyle data in this report.</p>';
    const bar = (v, was) => `<span class="rtrait"><i style="width:${Math.round(v * 100)}%"></i>${was != null ? `<em style="left:${Math.round(was * 100)}%" title="profile the AI played against"></em>` : ''}</span><span class="num">${Math.round(v * 100)}</span>`;
    const rows = Object.keys(TRAIT_LABEL).map(k => `<tr><td><b>${TRAIT_LABEL[k]}</b></td><td>${bar(ps.traits[k] ?? 0.5, ps.faced?.traits?.[k])}</td></tr>`).join('');
    const hc = ps.hitChance || {};
    const tun = ps.nextTuning ? Object.entries(ps.nextTuning).map(([k, v]) => `<span class="rtune ${v > 1.05 ? 'up' : v < 0.95 ? 'down' : ''}">${esc(k)} ×${v}</span>`).join(' ') : '';
    return `<p class="rsub">${ps.headline?.length ? `This match read as: <b>${esc(ps.headline.join(' · '))}</b>` : 'This match read as a balanced playstyle.'}${ps.faced ? ` · the AI had studied ${ps.faced.matches} earlier match${ps.faced.matches === 1 ? '' : 'es'} (marker = what it expected)` : ' · the AI had no profile of you yet'}</p>
      <div class="rtable"><table><tbody>${rows}</tbody></table></div>
      ${hc.shots ? `<div class="rgrid"><div><b>${hc.shots}</b><span>rolled shots</span></div><div><b>${hc.avg}%</b><span>avg chance to hit</span></div><div><b>${hc.hits}/${hc.rolls}</b><span>rolls hit</span></div><div><b>${hc.crits}</b><span>crits</span></div></div>` : ''}
      <h4>How the AI adapts next match</h4><ul class="radapt">${(ps.adaptation || []).map(a => `<li>${esc(a)}</li>`).join('')}</ul>
      ${tun ? `<p class="rtunes">${tun}</p>` : ''}`;
}

function title(r) {
    if (r.outcome.winner === 'player') return 'MISSION COMPLETE';
    if (r.outcome.winner === 'enemy') return r.outcome.reason === 'timer' ? 'MISSION FAILED' : 'SQUAD LOST';
    return 'BATTLE ENDED';
}
const usedList = obj => Object.entries(obj).map(([k, n]) => `${esc((ABILITIES[k] || THROWABLES[k])?.name || k)}${n > 1 ? ` ×${n}` : ''}`).join(', ');
const hpBar = (hp, max) => `<span class="rhp"><i style="width:${Math.round((100 * hp) / Math.max(1, max))}%"></i></span><span class="num">${hp}/${max}</span>`;

function testSummary(test) {
    if (!test) return 'Map defaults';
    const parts = [];
    if (test.enemies) parts.push(`Roster: ${test.enemies.map(e => `${e.count} ${ENEMIES[e.type]?.name || e.type}`).join(', ')} (pods of ${test.podSize})`);
    else parts.push('Map hostiles');
    if (test.alerted) parts.push('hostiles alerted');
    if (test.objective === 'eliminate') parts.push('objective: eliminate');
    if (test.rounds) parts.push(`deadline round ${test.rounds}`);
    if (test.timeOfDay) parts.push(`time: ${test.timeOfDay}`);
    return parts.join(' · ');
}

/** HTML for the report card. `opts.saved` notes whether it went into the browser's report history. */
export function reportMarkup(r, { saved = true, canEdit = true, tab = 'squad' } = {}) {
    const P = r.totals.player, E = r.totals.enemy, sc = r.scenario;
    const tiles = [
        [r.outcome.rounds, 'rounds'],
        [r.outcome.firstContactRound ?? '–', 'first contact'],
        [`${P.standing}/${P.units}`, 'soldiers standing'],
        [`${E.losses}/${E.units}`, 'hostiles down'],
        [pct(P.accuracy), 'squad accuracy'],
        [`${P.damageDealt} / ${P.damageTaken}`, 'damage dealt / taken'],
        [pct(E.accuracy), 'hostile accuracy']
    ];
    const squadRows = r.squad.map(s => `<tr class="${s.status}"><td><b>${esc(s.name)}</b><small>${esc(s.typeName)}</small></td><td><span class="rstat ${s.status}">${STATUS[s.status] || s.status}</span>${hpBar(s.hp, s.maxHp)}</td>
        <td class="n">${s.kills}</td><td class="n">${s.shotsHit}/${s.shots}<small>${pct(s.accuracy)}</small></td><td class="n">${s.damageDealt}${s.friendlyDamage ? `<small class="warn">FF ${s.friendlyDamage}</small>` : ''}</td><td class="n">${s.damageTaken}</td>
        <td class="n">${s.reactions}</td><td class="n">${s.tilesMoved}<small>${s.moves} moves</small></td><td>${[usedList(s.abilities), usedList(s.items)].filter(Boolean).join(', ') || '–'}${s.healed ? `<small>healed ${s.healed}</small>` : ''}${s.disabled.length ? `<small class="warn">disabled: ${esc(s.disabled.join(', '))}</small>` : ''}</td></tr>`).join('');
    const typeRows = r.enemyTypes.map(t => `<tr><td><b>${esc(t.name)}</b></td><td class="n">${t.count}</td><td class="n">${t.killed}</td><td class="n">${t.survived}</td><td class="n">${t.damageDealt}</td><td class="n">${t.damageTaken}</td></tr>`).join('');
    const hostileRows = r.hostiles.map(s => `<tr class="${s.status}"><td><b>${esc(s.typeName)}</b><small>${esc(s.id)} · pod ${s.group ?? '–'}</small></td><td><span class="rstat ${s.status}">${STATUS[s.status] || s.status}</span>${hpBar(s.hp, s.maxHp)}</td><td class="n">${s.shotsHit}/${s.shots}</td><td class="n">${s.damageDealt}</td><td class="n">${s.killedRound ?? '–'}</td></tr>`).join('');
    const weaponRows = r.weapons.map(w => `<tr><td><span class="side ${w.side}">${w.side === 'player' ? 'Squad' : 'Hostile'}</span></td><td><b>${esc(w.name)}</b></td><td class="n">${w.shots}</td><td class="n">${pct(w.accuracy)}</td><td class="n">${w.projectileHits}/${w.projectiles}</td><td class="n">${w.damage}</td><td class="n">${w.kills}</td></tr>`).join('');
    const env = r.environment;
    const field = [[env.voxelsDestroyed, 'voxels destroyed'], [env.fires, 'fires'], [env.breaches, 'breaches'], [env.doorsKicked, 'doors kicked'], [env.collapses, 'collapses'], [env.reactionShots, 'reaction shots'], [env.drops, 'drops'], [env.undergroundSteps, 'underground steps'], [env.flankSteps, 'flank steps']];
    const tabsHtml = TABS.map(([id, label]) => `<button data-act="rtab" data-arg="${id}" class="${id === tab ? 'on' : ''}" role="tab" aria-selected="${id === tab}">${label}</button>`).join('');
    const section = (id, body) => `<section class="rsec ${id === tab ? '' : 'hidden'}" data-tab="${id}" role="tabpanel">${body}</section>`;
    return `<div class="rcard ${r.outcome.winner}" role="dialog" aria-label="After-action report">
      <header class="rtop">
        <div><span class="kicker">After-action report${sc.test ? ' · Test ground' : ''}${sc.rules === 'intel' ? ' · Intel co-op rules' : ''}</span><h2>${title(r)}</h2>
          <p class="rsub">${esc(REASONS[r.outcome.reason] || r.outcome.reason)} · ${esc(sc.name)} · seed ${esc(sc.seed)}${sc.timeOfDay ? ` · ${esc(sc.timeOfDay)}` : ''}</p></div>
        <div class="ractions"><button data-act="restart" class="primary">Replay</button>${canEdit ? '<button data-act="reportEdit">Edit setup</button>' : ''}<button data-act="menu">Menu</button></div>
      </header>
      <div class="rtiles">${tiles.map(([v, l]) => `<div><b>${esc(v)}</b><span>${l}</span></div>`).join('')}</div>
      <nav class="rtabs" role="tablist">${tabsHtml}</nav>
      ${section('squad', `<div class="rtable"><table><thead><tr><th>Soldier</th><th>Status</th><th>Kills</th><th>Shots hit</th><th>Dealt</th><th>Taken</th><th>Reactions</th><th>Tiles</th><th>Used</th></tr></thead><tbody>${squadRows}</tbody></table></div>`)}
      ${section('hostiles', `<div class="rtable"><table><thead><tr><th>Type</th><th>Count</th><th>Down</th><th>Standing</th><th>Dealt</th><th>Taken</th></tr></thead><tbody>${typeRows}</tbody></table></div>
        <details class="rdetails"><summary>Every hostile (${r.hostiles.length})</summary><div class="rtable"><table><thead><tr><th>Unit</th><th>Status</th><th>Shots hit</th><th>Dealt</th><th>Down in round</th></tr></thead><tbody>${hostileRows}</tbody></table></div></details>`)}
      ${section('weapons', r.weapons.length ? `<div class="rtable"><table><thead><tr><th>Side</th><th>Weapon</th><th>Shots</th><th>Hit</th><th>Projectiles hit</th><th>Damage</th><th>Kills</th></tr></thead><tbody>${weaponRows}</tbody></table></div>` : '<p class="rnone">No shots fired.</p>')}
      ${section('playstyle', playstyleMarkup(r.playstyle))}
      ${section('field', `<div class="rgrid">${field.map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('')}</div>
        <dl class="rdl"><dt>Objective</dt><dd>${esc(r.objective.kind)} — ${esc(r.objective.status)}${r.objective.deadline ? ` · deadline round ${r.objective.deadline}` : ''}</dd>
        <dt>Setup</dt><dd>${esc(testSummary(sc.test))}</dd><dt>Rules</dt><dd>${sc.rules === 'intel' ? `Intel co-op (experimental)${sc.intel?.asyncCoop ? ' · independent turns' : ''} · support ${esc(sc.intel?.support || '')}` : 'Classic'}</dd><dt>Squad</dt><dd>${esc(r.squad.map(s => s.typeName).join(', '))}</dd>
        <dt>Map</dt><dd>${esc(sc.id)}${sc.operation ? ` · ${esc(sc.operation.plot)}` : ''}${sc.size ? ` · ${esc(sc.size)}` : ''}</dd></dl>`)}
      ${section('timeline', r.timeline.length ? `<ol class="rtime">${r.timeline.map(t => `<li class="${t.side}"><span>R${t.round}</span>${esc(t.text)}</li>`).join('')}</ol>` : '<p class="rnone">Nothing notable happened.</p>')}
      <footer class="rfoot"><button data-act="reportCopy">Copy summary</button><button data-act="reportJson">Download JSON</button>
        <span>${saved ? 'Saved to recent reports in the Test ground.' : 'Not saved: browser storage is unavailable.'}</span></footer>
    </div>`;
}
