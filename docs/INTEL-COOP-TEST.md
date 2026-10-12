# Intel co-op test build

Run `npm run play` (it builds the client, then starts the server), then open http://localhost:2567. Choose a map (Proving Grounds is the fastest test arena), tick **Intel co-op rules (experimental)** — the classic rules are the default — select match support, and **Host online co-op**. The same option is in the Test ground, and `?play=proving-grounds&intel=1` starts a local intel battle. Class and enemy names switch to their intel roles only under these rules. Friends open the same server address and join with the room code; they choose support before joining. The room supports 2–4 players, with one or more soldiers per player. To test alone, use separate browser windows. For LAN play use the host computer's LAN address and allow port 2567 through its firewall.

## Independent turn contract

- Every accepted action immediately updates the authoritative server and all peers. There is no player order or team end-turn vote in test mode. Conflicting actions are resolved in server arrival order; an occupied destination is rejected.
- **End my turn** triggers one enemy phase, advances the shared enemy beat, then refreshes only that player's soldiers. Teammates retain AP, personal status durations and buffs. Their actions can be submitted during another player's animation.
- Enemy phases are resolved on the server; effects, damage and terrain changes still affect everyone. Environmental effects and objective timers advance each enemy beat. Fast players can cause more enemy responses while slower players plan. This is an explicit prototype pacing rule that needs group playtesting.
- Support recharges on the caller's completed personal turns, independently of other players. One support selection per player, shared by their soldiers; switching soldiers does not bypass the cooldown. First use requires detection and 1 AP; subsequent uses require ten more personal turns.
- The existing classic team-vote mode remains available by disabling the test checkbox. Full offline/persistent asynchronous play is not implemented: rooms run in memory, and reconnect grace is 60 seconds.

## Roles

| Class (stable internal ID) | Distinct role |
| --- | --- |
| Faultfinder (`vanguard`) | Seismic Sense detects grounded enemies within 14 tiles and two levels through walls; Earth Cover shapes cover. |
| Tidekeeper (`grenadier`) | Water Sense detects enemies within 14 tiles adjacent to water; Water Mend restores allies. |
| Skywatch (`marksman`) | Deploy/reposition a scout drone within 18 tiles. Its scan sees enemies within 10 tiles along clear sight. |
| Ghostwright (`warden`) | Quiet Cut removes two wall voxels within 3 tiles without generating noise; Shield Wall protects infiltration. |

Sensor observations are shared snapshots (yellow rings and coordinates with the observation beat), not permission to shoot unseen enemies. They can go stale. Drones are teal diamonds; ordinary enemies detect them within 2 tiles along clear sight, Drone Hunters within 8. Detected drones are lost; redeploy to scout again. A guard facing away can miss a newly opened sightline. Unalerted guards use a 120° viewing cone except within two tiles; alerted guards retain full awareness.

Intel mode uses much tighter physical projectile spread and removes hit percentages from the target panel. Suppression, stagger, arm injury and target smoke are the explicit accuracy penalties. Walls and cover still physically intercept bullets; selecting an obscured body part can still miss. This is deliberately high precision rather than guaranteed damage.

## Support

**Carpet Bomb** previews three radius-3 circular areas spaced four tiles apart east–west. **Orbital Laser** previews a 17-by-3 east–west strip. Both remove destructible voxels throughout the affected columns, including surface ground, leaving bedrock and indestructible material intact. Structural collapse and falls are resolved. Units in the footprint take 40 piercing damage, including allies. Aim areas are highlighted before clicking; no separate confirmation is required in this test build.

## Practical test checklist

1. Open four clients and confirm each owns one soldier. Move different soldiers without ending teammates' turns.
2. Spend P2's actions. End P1's turn: P1 refreshes immediately and P2 stays spent. Verify all clients show the same map and positions.
3. Use sensing through a wall. Verify the contact appears for teammates but cannot be selected as an unseen shot target.
4. Place a drone away from ordinary guards, then near a Drone Hunter. Check the detection/loss log.
5. Quiet-cut a wall behind an unalerted guard, then move into their cone. Check that detection unlocks support.
6. Preview each support shape, fire into a building, and verify holes/collapse across clients. Check friendly fire and blocked cooldown; complete ten caller turns before reuse.
7. Join late, leave, and reconnect during the 60-second grace window. This is manual coverage; automated coverage validates ordered replay, ownership, independent refreshes and matching state hashes.

Automated checks: `npm test` includes a four-client WebSocket test and dedicated intel rules tests. `npm run build` creates the playable build in `client/dist`.
