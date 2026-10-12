# Climbing enemy prototype

The default tactical camera is 25% closer (distance 27, previously 36), retaining the 45° angle. Playable scenario insertion tiles are chosen deterministically on the same connected ground: soldiers prefer a minimum three-tile separation, with a safe free-cell fallback when the map is too tight.

## New enemies

| Enemy | Size | Health | Behavior |
| --- | --- | --- | --- |
| Wall Strider | Four feet plus body; five occupied tiles, normally a 3×3 span | 60 | Mobile rifle/melee construct that can climb a facade and clamber over a roof edge. |
| Siege Weaver | Six feet plus body; seven occupied tiles, normally a 5×3 span | 90 | Slower armored gun platform; larger footprint constrains where it can stand. |

Both use procedural 3D models with long two-segment legs, an analytic inverse-kinematics knee solution, and alternating planted feet during movement. Each leg reserves a tile; on a facade the footprint rotates vertically and feet attach to distinct wall tiles. No ladder is required. Body clearance, unit collisions and real foot support are validated by deterministic shared rules on the server and clients. Narrow passages and unsupported sky destinations are rejected. Destroying wall support makes the walker fall; heavy constructs resist forced knockback.

Projectiles can hit the long leg capsules outside the body tile. Explosion and support-strike footprints count those extremities. Leg damage currently uses the existing shared **legs** health pool, rather than individually selectable health bars per leg. Disabling the pool reduces movement and hides lower leg segments. These are prototype constructs; their identity and balancing remain open for playtesting.

## Try it

Run `npm run play`, open http://localhost:2567, and select **Training Facility** (Proving Grounds). The normal training roster now includes both enemy types. For a focused battle, open **Test ground**, select **Climbing walkers**, select a map, and launch. This preset has two Wall Striders and one Siege Weaver and works in online co-op as well.

Enable debug and use enemy control/manual enemy stepping to explore climbing directly. On a tall facade, a valid route can include vertical steps followed by a two-tile clamber onto the roof. Use the **ALL** cutaway setting to inspect the full climbing model; lower cutaway levels also clip units above that floor. Look for planted feet, stable knees, blocked leg tiles, and behavior after shooting out the supporting wall.

Validation covers multi-tile occupancy, facade-to-roof traversal, narrow corridors, unsupported positions, leg projectile hits, support loss, deterministic spawns, and finite procedural mesh transforms while moving. Existing online training-map tests exercise both new types through synchronized enemy turns.
