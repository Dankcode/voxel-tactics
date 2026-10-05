// PLAN 15A §7.3 — statuses as declarative data. Hooks are op lists interpreted by shared/combat/Resolve.js.
export default Object.freeze([
    { id: 'guarded', maxStacks: 3, rounds: -1, modifyIncoming: { flat: -1, consume: 1 }, tags: ['buff'] },
    { id: 'marked', maxStacks: 2, rounds: 2, modifyIncoming: { perStack: 1 }, tags: ['debuff'] },
    { id: 'burning', maxStacks: 1, rounds: 2, onRoundStart: [{ op: 'damage', amount: 1, element: 'pyro' }], tags: ['debuff', 'fire'] },
    { id: 'wet', maxStacks: 1, rounds: 2, removes: ['burning'], tags: ['debuff', 'water'] },
    { id: 'chilled', maxStacks: 2, rounds: 2, modifyBudget: { perStack: -1.5 }, tags: ['debuff', 'cold'] },
    { id: 'rooted', maxStacks: 1, rounds: 1, modifyBudget: { set: 0 }, tags: ['debuff'] },
    { id: 'stunned', maxStacks: 1, rounds: 1, skipTurn: true, immunityRounds: 1, tags: ['debuff'] }
].map(s => Object.freeze(s)));
