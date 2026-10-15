#!/usr/bin/env node
// Markdown tables for docs/mechanics/, generated from the shared rules so the docs can't drift from the data.
//
//   node tools/docs/gen_mechanics_tables.mjs              # every section
//   node tools/docs/gen_mechanics_tables.mjs weapons      # one section (see SECTIONS below)
//   node tools/docs/gen_mechanics_tables.mjs --list       # section names
//   node tools/docs/gen_mechanics_tables.mjs --write      # refresh the generated blocks in docs/mechanics/*.md
//
// The docs carry each table between `<!-- generated:<name> -->` and `<!-- /generated:<name> -->` markers; paste the
// printed output there by hand, or let --write replace every marked block in place.
import { WEAPONS, THROWABLES, ARMOR } from '../../shared/content/weapons.js';
import { CALIBERS } from '../../shared/content/calibers.js';
import { CLASSES, ENEMIES, ABILITIES, BODY, PARTS, SQUADS, ENEMY_PODS } from '../../shared/content/units.js';
import { FORMATIONS, FORMATION_RULES } from '../../shared/content/formations.js';
import { BALANCE } from '../../shared/content/balance.js';
import { MATERIALS, coverWeight } from '../../shared/voxel/Materials.js';
import { BANDS, WALL_KEYS, WALL_THICKNESS } from '../../shared/voxel/ConnectedShapes.js';
import { voxelDamageMultiplier } from '../../shared/voxel/Destruction.js';
import { STATUS_DEFS, ELEMENT_IDS } from '../../shared/elements/Elements.js';
import { ELEMENTS } from '../../shared/elements/ElementIds.js';
import { DEFAULT_GATES } from '../../shared/mission/MissionMetrics.js';
import { PROP_CATALOG, SUBURB_PROPS, DOWNTOWN_PROPS, DOCKS_PROPS, FORECOURT_PROPS } from '../../shared/mission/PropCatalog.js';
import { MAPS } from '../../shared/mission/Maps.js';

const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.map(c => String(c ?? '').replace(/\|/g, '\\|')).join(' | ')} |`)].join('\n');
const num = v => (v === Infinity ? '∞' : Number.isInteger(v) ? String(v) : String(+v.toFixed(2)));
const yn = v => (v ? 'yes' : '—');
const wname = id => WEAPONS[id]?.name || THROWABLES[id]?.name || id;
const ELEMENT_NAME = Object.fromEntries(Object.entries(ELEMENTS).map(([k, v]) => [v, k.toLowerCase()]));

const SECTIONS = {
    weapons() {
        const rows = Object.values(WEAPONS).filter(w => w.kind === 'ballistic').map(w => [
            `\`${w.id}\``, w.name, w.caliber ? CALIBERS[w.caliber].name : '— (fuel)', w.ap, w.projectiles, w.damage, w.pierce, w.shred || '—', `${w.spread}°`, w.range, w.maxRange,
            `${w.ammo} (${w.perShot}/shot)`, w.reloadAp, w.voxel, w.noise, w.element || '—']);
        return table(['id', 'name', 'round', 'AP', 'proj.', 'dmg/proj.', 'pierce', 'shred', 'spread', 'range', 'max range', 'ammo', 'reload AP', 'voxel dmg', 'noise', 'element'], rows);
    },
    calibers() {
        const rows = Object.values(CALIBERS).map(c => [`\`${c.id}\``, c.name, c.damage, c.pierce, c.voxel, c.energy ?? 0,
            Object.values(WEAPONS).filter(w => w.caliber === c.id).map(w => w.name).join(', ') || '—']);
        return table(['id', 'round', 'dmg/proj.', 'pierce', 'voxel dmg', 'penetration energy', 'fired by'], rows);
    },
    resistance() {
        const by = new Map();
        for (const m of MATERIALS) if (Number.isFinite(m.resistance)) (by.get(m.resistance) || by.set(m.resistance, []).get(m.resistance)).push(`\`${m.key}\``);
        const rows = [...by].sort((a, b) => a[0] - b[0]).map(([r, keys]) => [r, keys.join(', '),
            Object.values(CALIBERS).filter(c => (c.energy ?? 0) > r).map(c => c.name).join(', ') || '—']);
        rows.push(['∞', 'everything else (ground, floors, slabs, steel, stone masses)', '—']);
        return table(['resistance', 'materials', 'rounds that pass through one cell (straight on)'], rows);
    },
    melee() {
        const rows = Object.values(WEAPONS).filter(w => w.kind === 'melee').map(w => [
            `\`${w.id}\``, w.name, w.ap, w.damage, w.pierce, w.shred || '—', w.knockback ? `${w.knockback} tiles` : '—', w.noise, w.reach, w.voxel]);
        return table(['id', 'name', 'AP', 'dmg', 'pierce', 'shred', 'knockback', 'noise', '`reach` (unused)', '`voxel` (unused)'], rows);
    },
    throwables() {
        const rows = Object.values(THROWABLES).map(t => [
            `\`${t.id}\``, t.name, t.ap, t.range, t.radius, t.damage, t.power, t.element || (t.smoke ? 'smoke' : '—'), t.shred || '—', t.knockback ? `${t.knockback} tiles` : '—',
            t.smoke ? `${t.smoke} rounds` : '—', t.noise, t.placed ? 'placed (no arc, no scatter)' : 'thrown (arc + scatter)']);
        return table(['id', 'name', 'AP', 'range', 'radius', 'unit dmg', 'voxel power', 'element', 'shred', 'knockback', 'smoke', 'noise', 'delivery'], rows);
    },
    armor() {
        const rows = Object.entries(ARMOR).map(([k, a]) => [`\`${k}\``, a.head, a.torso, a.armL, a.armR, a.legs, a.mobility ? num(a.mobility) : '0']);
        return table(['armour', 'head', 'torso', 'arm L', 'arm R', 'legs', 'mobility (tiles/AP)'], rows);
    },
    bodyparts() {
        return table(['part', 'label', 'HP share of unit HP'], PARTS.map(p => [`\`${p}\``, BODY[p].label, BODY[p].share]));
    },
    units() {
        const row = (d, side) => {
            const armor = ARMOR[d.armor] || ARMOR.light;
            const part = p => Math.max(1, Math.round(d.hp * BODY[p].share));
            return [`\`${d.id}\``, d.name, side, d.hp, `${part('head')}/${part('torso')}/${part('armL')}/${part('legs')}`, d.accuracy, num(d.mobility + (armor.mobility || 0)) + ` (${d.mobility}${armor.mobility ? ` ${armor.mobility}` : ''})`,
                d.will, `\`${d.armor}\``, d.weapons.map(wname).join(', '), Object.entries(d.items).map(([k, n]) => `${wname(k)} ×${n}`).join(', ') || '—',
                d.abilities.map(a => ABILITIES[a].name).join(', ') || '—'];
        };
        return table(['id', 'name', 'side', 'HP', 'part HP head/torso/arm/legs', 'accuracy', 'tiles per AP (base + armour)', 'Will', 'armour', 'weapons (first = default)', 'items', 'abilities'],
            [...Object.values(CLASSES).map(d => row(d, 'squad')), ...Object.values(ENEMIES).map(d => row(d, 'Syndicate'))]);
    },
    abilities() {
        const holders = id => [...Object.values(CLASSES), ...Object.values(ENEMIES)].filter(d => d.abilities.includes(id)).map(d => d.name).join(', ');
        return table(['id', 'name', 'Will', 'AP', 'text (from data)', 'who has it'], Object.values(ABILITIES).map(a => [`\`${a.id}\``, a.name, a.wp, a.ap, a.text, holders(a.id)]));
    },
    squads() {
        return [table(['squad preset', 'classes'], Object.entries(SQUADS).map(([k, v]) => [`\`${k}\``, v.map(c => CLASSES[c].name).join(', ')])), '',
            table(['enemy pod preset (unused by the current maps)', 'members'], Object.entries(ENEMY_PODS).map(([k, v]) => [`\`${k}\``, v.map(c => ENEMIES[c].name).join(', ')]))].join('\n');
    },
    statuses() {
        const fx = s => Object.entries(s).filter(([k]) => !['rounds', 'tags'].includes(k)).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(',') || '—' : v}`).join('; ');
        return table(['status', 'rounds', 'data fields', 'tags'], Object.entries(STATUS_DEFS).map(([k, s]) => [`\`${k}\``, s.rounds, fx(s) || '—', s.tags.join(', ')]));
    },
    balance() {
        return table(['tunable (`B.*`)', 'value', 'min', 'max'], Object.entries(BALANCE).map(([k, v]) => [`\`${k}\``, v.value, v.min, v.max]));
    },
    formations() {
        const rows = Object.values(FORMATIONS).map(f => [`\`${f.id}\``, f.name, `${f.min}–${f.max}`, f.slots ? f.slots.map(s => `[${s}]`).join(' ') : `none (≥ ${f.minSpacing} apart)`,
            Object.entries(f.bonus).map(([k, v]) => `${k} ${v}`).join(', '), f.cost ? Object.entries(f.cost).map(([k, v]) => `${k} ${v}`).join(', ') : '—',
            f.decayPerStaticPhase ?? '—', f.requiresDoor ? 'yes' : '—']);
        return [table(['id', 'name', 'members', 'slots [right, forward]', 'bonus (data)', 'cost', 'decay / static phase', 'needs door'], rows), '',
            table(['rule', 'value'], Object.entries(FORMATION_RULES).map(([k, v]) => [`\`${k}\``, v]))].join('\n');
    },
    elementvoxels() {
        const fams = [...new Set(MATERIALS.map(m => m.family))];
        return table(['element \\ family', ...fams], ELEMENT_IDS.map(e => [`\`${e}\``, ...fams.map(f => {
            const k = voxelDamageMultiplier({ family: f }, e); return k === 1 ? '1' : `**${k}**`;
        })]));
    },
    materials() {
        const band = m => {
            if (BANDS[m.key]) return `band ${BANDS[m.key].thickness}`;
            if (WALL_KEYS.has(m.key)) return `wall ${WALL_THICKNESS}`;
            if (m.key === 'glass') return 'pane 0.1';
            if (m.key === 'door') return 'pane 0.08';
            if (m.key === 'ice' || m.key === 'deep_ice') return 'liquid shoreline';
            return '—';
        };
        const cover = m => { const w = coverWeight(m); return w >= 1 ? 'cover (1)' : w > 0 ? `concealment (${w})` : 'none (0)'; };
        const xform = m => [m.burnTo && `burn→${m.burnTo}`, m.meltTo && `melt→${m.meltTo}`, m.freezeTo && `freeze→${m.freezeTo}`, m.debris && `debris→${m.debris}`].filter(Boolean).join(', ') || '—';
        const ex = m => (m.explosive ? `r ${m.explosive.radius}, pow ${m.explosive.power}, dmg ${m.explosive.damage}, ${m.explosive.element}` : '—');
        const rows = MATERIALS.map(m => [m.id, `\`${m.key}\``, m.label, num(m.hp), yn(m.solid), yn(m.opaque), m.projectile, yn(m.walkable),
            m.moveCost !== 1 ? m.moveCost : '1', m.liquid ? (m.traversal || 'liquid') : '—', yn(m.flammable), ex(m), xform(m), yn(m.structural), m.family, ELEMENT_NAME[m.element], cover(m), band(m)]);
        return table(['id', 'key', 'label', 'hp', 'solid', 'opaque', 'projectile', 'walkable', 'move cost', 'liquid', 'flammable', 'explosive', 'transforms', 'structural', 'family', 'element', 'cover class (`coverWeight`)', 'connected shape'], rows);
    },
    gates() {
        return table(['gate', 'min', 'max'], Object.entries(DEFAULT_GATES).map(([k, [lo, hi]]) => [`\`${k}\``, lo, hi]));
    },
    props() {
        const mats = p => {
            const out = new Set();
            for (const r of [0, 0.5, 0.99]) for (let n = 1; n <= 2; n++) for (let i = 0; i < n; i++) p.stack(i, n, { next: () => r }).forEach(k => out.add(k));
            return [...out].map(k => `\`${k}\``).join(', ');
        };
        const cat = (name, c) => `**${name}**\n\n` + table(['key', 'name', 'cover', 'layout', 'length', 'weight', 'context', 'materials', 'note'],
            Object.entries(c).map(([k, p]) => [`\`${k}\``, p.name, p.cover, p.layout, p.len.join('–'), p.w, p.context, mats(p), p.text]));
        return [cat('PROP_CATALOG (generic; not used by the present-day maps)', PROP_CATALOG), cat('SUBURB_PROPS (Cedar Close)', SUBURB_PROPS), cat('DOWNTOWN_PROPS (Main Street)', DOWNTOWN_PROPS),
            cat('DOCKS_PROPS (Harbor Yard, Training Facility)', DOCKS_PROPS), cat('FORECOURT_PROPS (Route 9 Stop)', FORECOURT_PROPS)].join('\n\n');
    },
    maps() {
        const rows = MAPS.map(m => {
            const mission = m.build({ seed: 1 });
            const x = mission.metrics;
            return [`\`${m.id}\``, m.name, m.theme, `${mission.store.width}×${mission.store.depth}×${mission.store.height}`, x.buildings, x.rooms, mission.spawns.enemy.length,
                new Set(mission.spawns.enemy.map(e => e.group)).size, mission.meta?.lighting || 'day', `${(x.coverDensity * 100).toFixed(0)}%`, x.coverGap, x.killingField,
                x.sightlineMedian.toFixed(1), x.lanes, `${(x.breachability * 100).toFixed(0)}%`, x.spawnSafe ? 'yes' : 'NO', x.pass ? 'PASS' : Object.entries(x.gates).filter(([, ok]) => !ok).map(([k]) => k).join(', ')];
        });
        return table(['id', 'name', 'theme', 'size W×D×H', 'buildings', 'rooms', 'enemies', 'pods', 'lighting', 'cover density', 'cover gap', 'killing field', 'sightline median', 'lanes', 'breachability', 'spawn safe', 'gates (seed 1)'], rows);
    }
};

const arg = process.argv[2];
if (arg === '--write') {
    // Refresh every `<!-- generated:name -->…<!-- /generated:name -->` block in docs/mechanics/*.md in place.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const dir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../docs/mechanics');
    const cache = {};
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.md'))) {
        const file = path.join(dir, f), src = fs.readFileSync(file, 'utf8');
        const out = src.replace(/<!-- generated:(\w+) -->[\s\S]*?<!-- \/generated:\1 -->/g, (m, name) => {
            if (!SECTIONS[name]) return m;
            cache[name] ??= SECTIONS[name]();
            return `<!-- generated:${name} -->\n${cache[name]}\n<!-- /generated:${name} -->`;
        });
        if (out !== src) { fs.writeFileSync(file, out); console.log(`updated ${path.relative(process.cwd(), file)}`); }
    }
} else if (arg === '--list') console.log(Object.keys(SECTIONS).join('\n'));
else if (arg) {
    if (!SECTIONS[arg]) { console.error(`unknown section ${arg}; try --list`); process.exit(1); }
    console.log(SECTIONS[arg]());
} else for (const [k, fn] of Object.entries(SECTIONS)) console.log(`<!-- generated:${k} -->\n${fn()}\n<!-- /generated:${k} -->\n`);
