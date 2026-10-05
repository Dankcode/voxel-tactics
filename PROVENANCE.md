# Provenance

Code and data copied from **vibe-game** (`github.com/Dankcode/vibe-game`) on 2026-10-06, from the working tree at
HEAD `99b2f41c` **plus uncommitted changes** (the generation files `NoiseField.js`, `WfcNoiseMask.js`, `MapData.js`,
`GeographicWFCGenerator.js`, `TownVectorData.js`, `WorldConstraintField.js`, `TileLibrary.js`, `InteriorGenerator.js`, … were
modified or untracked at that time). Each file's SHA-256 is of the original content before import paths were rewritten.

Rules of the copy:

- `client/src/data/*` (the 39-file generation closure) moved to `shared/worldgen/` so the server no longer imports from the client.
- Only relative import specifiers were rewritten (`tools/extract` logic, see git history); no other edits.
- `docs/reference/vibe-game/` holds unmodified originals that were audited or ported (targeting DDA/arc, statuses,
  animation code). They are not imported by the game.
- Parity: `shared/worldgen/worldgen.test.js` regenerates Kida (burg-10) and compares it with the baked site. The full
  72 × 54 Kida rows hash `c7efa30149a5639a` (sha256 prefix of element,texture,building,height per cell) in this repo.

| vibe-game path | here | bytes | sha256 |
|---|---|---|---|
| `client/src/data/ActiveEnvironmentData.js` | `shared/worldgen/ActiveEnvironmentData.js` | 108709 | `8ec7a44e301a3a34…` |
| `client/src/data/ActiveTownVectorData.js` | `shared/worldgen/ActiveTownVectorData.js` | 106831 | `c292a2fde107cfea…` |
| `client/src/data/ActiveWorldData.js` | `shared/worldgen/ActiveWorldData.js` | 2986218 | `ebd934b784bafb85…` |
| `client/src/data/BakedBuildingCatalog.js` | `shared/worldgen/BakedBuildingCatalog.js` | 14879 | `18bced17ea709a7e…` |
| `client/src/data/BakedBuildingLibrary.js` | `shared/worldgen/BakedBuildingLibrary.js` | 57711 | `c0345679d180e9c2…` |
| `client/src/data/BakedChunkData.js` | `shared/worldgen/BakedChunkData.js` | 14607 | `af996a97d7c047a4…` |
| `client/src/data/BakedStreetLibrary.js` | `shared/worldgen/BakedStreetLibrary.js` | 52383 | `53a4a9a8c18fc386…` |
| `client/src/data/BuildingData.js` | `shared/worldgen/BuildingData.js` | 36280 | `348f2fa7478b781f…` |
| `client/src/data/BuildingEntries.js` | `shared/worldgen/BuildingEntries.js` | 3662 | `fbeee47e09513438…` |
| `client/src/data/BurgThemeCatalog.js` | `shared/worldgen/BurgThemeCatalog.js` | 46 | `431c86bfc4fba380…` |
| `client/src/data/ContextualBuildingWFC.js` | `shared/worldgen/ContextualBuildingWFC.js` | 54751 | `5eb5f72f21c48f95…` |
| `client/src/data/DioramaWorldProfile.js` | `shared/worldgen/DioramaWorldProfile.js` | 1522 | `b14ed4353ed1d057…` |
| `client/src/data/EnvironmentProfiles.js` | `shared/worldgen/EnvironmentProfiles.js` | 2950 | `ab89260d6e94d77b…` |
| `client/src/data/EnvironmentRules.js` | `shared/worldgen/EnvironmentRules.js` | 2705 | `99a2a6bab31b09e3…` |
| `client/src/data/FantasyWorldData.js` | `shared/worldgen/FantasyWorldData.js` | 2020 | `8e4d5500486c174d…` |
| `client/src/data/GeographicWFCGenerator.js` | `shared/worldgen/GeographicWFCGenerator.js` | 278248 | `f8ea6cc71cf90a37…` |
| `client/src/data/MapData.js` | `shared/worldgen/MapData.js` | 25861 | `a6bfbb0a386fc518…` |
| `client/src/data/NoiseField.js` | `shared/worldgen/NoiseField.js` | 3918 | `1d861c4b4ec31373…` |
| `client/src/data/PartialChunkRegistry.js` | `shared/worldgen/PartialChunkRegistry.js` | 8026 | `274c3daf3ef7da01…` |
| `client/src/data/PlacementValidation.js` | `shared/worldgen/PlacementValidation.js` | 4593 | `3a64b5842c069486…` |
| `client/src/data/SettlementDressing.js` | `shared/worldgen/SettlementDressing.js` | 5306 | `6e67b7d039072253…` |
| `client/src/data/StructuralMatrixRules.js` | `shared/worldgen/StructuralMatrixRules.js` | 51 | `c9e8ffcb57ae1408…` |
| `client/src/data/TerrainMacroTileLibrary.js` | `shared/worldgen/TerrainMacroTileLibrary.js` | 60484 | `309a8848446eabb9…` |
| `client/src/data/TileLibrary.js` | `shared/worldgen/TileLibrary.js` | 41 | `b361d51e4fd3f92c…` |
| `client/src/data/TileRegistry.js` | `shared/worldgen/TileRegistry.js` | 42 | `35a554d9c374b636…` |
| `client/src/data/TownVectorData.js` | `shared/worldgen/TownVectorData.js` | 23265 | `9c97e97a2309801a…` |
| `client/src/data/TownWavePlanner.js` | `shared/worldgen/TownWavePlanner.js` | 18912 | `dd01e8aeb3c2d042…` |
| `client/src/data/WaveFunctionCollapse.js` | `shared/worldgen/WaveFunctionCollapse.js` | 55 | `1d7fc0ab0fd26741…` |
| `client/src/data/WfcNoiseMask.js` | `shared/worldgen/WfcNoiseMask.js` | 16704 | `5d933475add79e5d…` |
| `client/src/data/WorldConstraintField.js` | `shared/worldgen/WorldConstraintField.js` | 76811 | `f99f378a53e281ab…` |
| `client/src/data/WorldPathConnectivity.js` | `shared/worldgen/WorldPathConnectivity.js` | 67988 | `50710b2d27754727…` |
| `client/src/data/WorldTileSet.js` | `shared/worldgen/WorldTileSet.js` | 6300 | `288000b6db6e51ab…` |
| `shared/world/BurgThemeCatalog.js` | `shared/world/BurgThemeCatalog.js` | 13820 | `716ca471417c06d4…` |
| `shared/world/CameraView.js` | `shared/world/CameraView.js` | 3624 | `fb727a903c65e974…` |
| `shared/world/PathSearch.js` | `shared/world/PathSearch.js` | 1767 | `d07669b63f814ea9…` |
| `shared/world/StairRun.js` | `shared/world/StairRun.js` | 957 | `3f18985dce63c724…` |
| `shared/world/StructuralMatrixRules.js` | `shared/world/StructuralMatrixRules.js` | 25474 | `6dfe10ee5f3079d5…` |
| `shared/world/TileLibrary.js` | `shared/world/TileLibrary.js` | 43339 | `b2df36ecfea0e664…` |
| `shared/world/TileRegistry.js` | `shared/world/TileRegistry.js` | 21041 | `8321d46f878db768…` |
| `shared/world/TraversalRules.js` | `shared/world/TraversalRules.js` | 3429 | `6bac397042c7401a…` |
| `shared/world/VoxelWorld.js` | `shared/world/VoxelWorld.js` | 1435 | `760b943d9fccd95e…` |
| `shared/world/WaterPalette.js` | `shared/world/WaterPalette.js` | 840 | `0afd878757932308…` |
| `shared/world/WorldPalettes.js` | `shared/world/WorldPalettes.js` | 10991 | `ae802210d8bc6ae9…` |
| `shared/util/Rng.js` | `shared/util/Rng.js` | 761 | `733d8aa613e12f60…` |
| `shared/util/MinHeap.js` | `shared/util/MinHeap.js` | 830 | `16bf1e8ca2db3952…` |
| `shared/generation/WaveFunctionCollapse.js` | `shared/generation/WaveFunctionCollapse.js` | 18678 | `7bb735a08facd180…` |
| `shared/interiors/InteriorGenerator.js` | `shared/interiors/InteriorGenerator.js` | 19517 | `a005c3b32a33ff83…` |
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
