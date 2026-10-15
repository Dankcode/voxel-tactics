# Squad head portraits

`vanguard/head.png`, `grenadier/head.png`, `marksman/head.png`, and `warden/head.png`
are authored 2D UI portraits generated with OpenAI Image Gen on 2026-10-15,
using `test-soldier/portrait.png` as a visual style reference. Each is a 256 × 256
RGBA PNG with a transparent background.

The HUD and dispatch review resolve these through `client/src/ui/Portraits.js`.
The heads are separate from the procedural `portrait.png` assets so running
`npm run art:placeholders` does not replace them. Field atlases and back shots
remain independent of UI portraits.
