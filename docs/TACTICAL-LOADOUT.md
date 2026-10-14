# Tactical HUD and loadouts

The battlefield HUD uses transparent black and gray controls. The cube has floor-up/down and rotate-left/right arrows. Settings contains camera, graphics, debug tools, animation speed, camera rotation speed, movement confirmation, automatic soldier selection, and health-display preferences. End Turn sits under the center phase indicator.

## Soldiers and storage

The centered left portrait rail shows numeric HP and remaining AP. Open equipment with **I**; the same portraits switch the body-status and equipment views together. The body diagram shows part health and armor, active buffs/debuffs, encumbrance, and a gameplay heart-rate readout derived from stress, wounds, and recent movement.

Helmet, body armor, weapons, attachments, worn rig, backpack, and pockets are physical loadout state. Rigs and backpacks have different grid dimensions. Drag an item, or select it and click an empty destination cell. **R** rotates the selected item. Select wearable equipment or an attachment and choose **Equip**. A replaced rig/backpack retains its contents inside the removed container. Capacity, overlap, duplicate identities, and nesting depth are validated by the shared rules.

Double-click a rig or pouch inside storage to open its internal grid. Its contents remain usable: reloads draw loose rounds from pockets, worn storage, and nested storage. Every carried container, weapon, attachment, loaded round, and stored item contributes weight. Above 12 kg, each additional 0.45 kg reduces movement by 1%, capped at a 65% reduction. Test-ground soldiers intentionally carry a heavy full arsenal.

## Guns and free aiming

The dock starts with the equipped weapon, Overwatch, and Reload. Gaps separate equipment actions, augmentation abilities, and commander actions. The weapon button shows loaded rounds, carried reserve, and fire mode. The mode control cycles the modes supported by that gun:

| Mode | Rounds per action |
| --- | --- |
| Single | 1 |
| Burst | 3; default on assault rifles and carbines |
| Auto | Up to 5 |

A final salvo uses the rounds remaining in the gun. Every bullet is traced separately; a shotgun shell distributes its total damage across its pellets. Reload transfers actual loose rounds into the gun up to its capacity. Bolt-action rifles cycle available loose rounds automatically and have no manual reload action.

| Ammo family | Damage through 5 tiles | Damage beyond 5 tiles |
| --- | --- | --- |
| AR | 10 per bullet | 5 per bullet |
| High caliber | 30 per bullet | 10 per bullet |
| Shotgun | 30 per shell across its pellets | 5 per shell across its pellets |

Armor subtracts damage after the projectile's penetration allowance. Gun type and attachments determine spread and effective range; scopes tighten spread and narrow the overwatch cone. Precision barrels tighten spread and extend range. Wounds, status, cover, and range modifiers still apply.

Choose **Shoot**, move the reticle, then click or press **Space** to fire. Visible enemy buttons and **Z/X/C/V/G** provide body-part aim anchors. Aim can move away from those anchors to an unseen location or environmental object; the tracer decides what is actually hit. The shoulder camera and committed back shot use the same world-space aim point. Sprite breathing is cosmetic and can be disabled in Settings.

Overwatch remains active across phases and can react to successive movement actions, consuming the selected gun's normal salvo each time. It ends on a wound, a status effect, or exhausted loaded ammunition. Reactions never create free ammo.

## Shared map marks

Choose a red, blue, or green **!** button, then click a solid block. Repeat the same color on the same block to clear your mark. A player can retain twelve manual marks. Destruction drops a mark vertically onto the closest surviving solid block below it, or removes it when none remains. Marks replay through the co-op command stream. Intel sensing abilities produce smaller red contact marks; these are observed positions, not live tracking.

## Formation assembly

Choose **Formation** or press **F** to open the drop-up menu. Selecting a template highlights slots around the activating soldier. Teammates must walk into the highlighted positions; planning does not teleport them. Benefits begin with a leader and at least one additional member. Moving the leader moves the assembled group through normal movement rules; the movement preview uses the lowest remaining member movement budget. Blocked or separated members reduce cohesion.

- **Wedge / Skirmish Line:** eligible members with line of sight and ammunition return fire after a hostile attack hits a surviving member.
- **Patrol File:** incoming fire from an unseen shooter lets members with AP reposition toward nearby cover or greater separation.
- **Shield Line:** protects its front arc while positioned; the benefit decays when stationary.
- **Breach Stack:** assembles near a breachable doorway and improves the entry.

The legacy Crossfire intent remains available to AI and rule fixtures; the player drop-up uses formations with physical slots. Commander Strike earns one team charge per three squad kills.

## Testing

Launch from **Test ground admin** for all weapons, every grenade/gadget, all three ammo families, an optic, a precision barrel, a spare rig with ammo inside it, a pouch, and an alternate helmet. Standard missions retain their class loadouts. The shared rules and server tests cover ammunition conservation, nested storage, protection, weight, marks after destruction, formation reactions, and co-op replay.
