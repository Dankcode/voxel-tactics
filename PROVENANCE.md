# Provenance

Code and data copied from **vibe-game** (`github.com/Dankcode/vibe-game`) on 2026-10-06, from the working tree at
HEAD `99b2f41c` plus uncommitted changes. Each file's SHA-256 is of the original content before import paths were
rewritten.

**2026-10-08:** the world / burg generation closure (`shared/worldgen/`, `shared/generation/`, `shared/interiors/`,
`VoxelWorld`, `TileRegistry`, `TileLibrary`, `BurgThemeCatalog`, `WorldPalettes`, `WaterPalette`, `CameraView`,
`StructuralMatrixRules`, the baked burg sites and `tools/worldgen/`) was removed: Fireteam no longer generates
fantasy burgs, and that block-world look stays in vibe-game. The element ids it shared with vibe-game's
`TileRegistry` live on in `shared/elements/ElementIds.js` (same numbers). What remains from vibe-game:

- path search, stair runs and traversal rules (`shared/world/`), the seeded RNG and heap (`shared/util/`);
- the MeshKit tile-set contract (pivots, +X runs, material slots) used by `client/src/render/kit/`;
- the photographic material atlas the cobble / plaster / plank / grass textures were cut from;
- `docs/reference/vibe-game/`: unmodified originals that were audited or ported (targeting DDA/arc, statuses,
  animation code). They are not imported by the game.

| vibe-game path | here | bytes | sha256 |
|---|---|---|---|
| `shared/world/PathSearch.js` | `shared/world/PathSearch.js` | 1767 | `d07669b63f814ea9…` |
| `shared/world/StairRun.js` | `shared/world/StairRun.js` | 957 | `3f18985dce63c724…` |
| `shared/world/TraversalRules.js` | `shared/world/TraversalRules.js` | 3429 | `6bac397042c7401a…` |
| `shared/util/Rng.js` | `shared/util/Rng.js` | 761 | `733d8aa613e12f60…` |
| `shared/util/MinHeap.js` | `shared/util/MinHeap.js` | 830 | `16bf1e8ca2db3952…` |
| `shared/combat/targeting/Ray.js` | `docs/reference/vibe-game/shared/combat/targeting/Ray.js` | 2914 | `08f2b487ee257312…` |
| `shared/combat/targeting/Arc.js` | `docs/reference/vibe-game/shared/combat/targeting/Arc.js` | 1760 | `b2cf9385fde4111f…` |
| `shared/combat/targeting/Solidity.js` | `docs/reference/vibe-game/shared/combat/targeting/Solidity.js` | 896 | `e31791e9a8e8a5d4…` |
| `shared/content/statuses.js` | `docs/reference/vibe-game/shared/content/statuses.js` | 907 | `2d425de2e829daff…` |
| `shared/combat/Presentation.js` | `docs/reference/vibe-game/shared/combat/Presentation.js` | 2444 | `393f7624f31ae700…` |
| `client/src/entities/PlayerAvatar.js` | `docs/reference/vibe-game/client/src/entities/PlayerAvatar.js` | 22116 | `b5cad6cbf220e4d4…` |
| `client/src/rendering/CharacterSpriteBaker.js` | `docs/reference/vibe-game/client/src/rendering/CharacterSpriteBaker.js` | 9012 | `4e79cbc637aad37f…` |
| `client/src/combat/EventPlayer.js` | `docs/reference/vibe-game/client/src/combat/EventPlayer.js` | 7115 | `a6ab8f6793bbfc44…` |
| `client/src/rendering/SpriteLayer.js` | `docs/reference/vibe-game/client/src/rendering/SpriteLayer.js` | 9054 | `01769c1685f4dcea…` |
| `client/src/entities/PlayerGirl2.js` | `docs/reference/vibe-game/client/src/entities/PlayerGirl2.js` | 5862 | `d9b5d7e1f73709c6…` |
| `client/src/entities/CharacterScale.js` | `docs/reference/vibe-game/client/src/entities/CharacterScale.js` | 352 | `5ba85e0f3bdfaeb2…` |
| `client/public/assets/materials/rustic-atlas.jpg` | `client/public/assets/materials/rustic-atlas.jpg` | 590579 | `cac7dbaef2334e41…` |
| `client/public/assets/textures/tile-textures.png` | `client/public/assets/textures/tile-textures.png` | 482562 | `59a560d11542c6d1…` |
