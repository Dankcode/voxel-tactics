// Stable gameplay IDs resolve to authored packs without changing saves or player class identities.
export const ENEMY_ART = Object.freeze({
    cultist:'syndicate-gunman', archer:'syndicate-lookout', pyromancer:'syndicate-arsonist',
    brute:'syndicate-enforcer', guard:'syndicate-guard', tech:'syndicate-tech'
});
export function characterArtId(art) {
    return ENEMY_ART[art] || (Object.values(ENEMY_ART).includes(art) ? art : 'ranger-01');
}
