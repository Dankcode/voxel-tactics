import { characterArtId } from '../units/CharacterArt.js';
// Portraits and field sprites resolve through the same identity map.
export function portraitSrc(unit) { return `/assets/characters/${characterArtId(unit?.art || unit?.type)}/portrait.png`; }
