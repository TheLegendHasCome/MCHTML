# MCHTML

![status](https://img.shields.io/badge/build-2.0_survival_update-8fe36f) ![license](https://img.shields.io/badge/license-MIT-blue)

**Play it live: [https://thelegendhascome.github.io/MCHTML/](https://thelegendhascome.github.io/MCHTML/)**

A Minecraft-like voxel sandbox that runs entirely in your browser — no build step, no server, no install. v2.0 is the **survival update**: a full game loop on top of the engine — inventory, crafting, furnaces, mining tiers, redstone, portals, three dimensions, villages, and a world border at ±30,000,000 blocks, just like the real thing.

## What's new in v2.0

- **Survival mode** — 20 HP, fall damage, drowning, lava burns, slow regen, death screen. Mine with progress + crack overlay; tool tiers gate everything (wood → stone → iron → diamond). Drops go straight to your inventory; placing consumes blocks.
- **Inventory + crafting** — 36-slot inventory, 2×2 personal grid, 3×3 crafting table. Shaped, mirrored and shapeless recipes: planks, sticks, tools of four materials, torches, furnace, portal igniter, end frames, eyes of ender, redstone lamps and levers.
- **Furnace** — smelt iron & gold ore into ingots, sand into glass, cobble into stone, logs into coal. Real fuel values (coal 8, planks 1.5, sticks 0.5), flame + progress UI, contents persist in your save.
- **Redstone** — levers, dust (power BFS with 15-block decay) and lamps that actually glow. Wire lights up when powered; lamps light next to powered wire or an ON lever.
- **The Nether** — build a 4×5+ obsidian frame, light it with a portal igniter (coal + stick), stand in the glow. Coordinates scale ÷8 / ×8 like vanilla; arrival platforms and return portals are stamped automatically. Ruined nether-brick towers dot the caverns.
- **The End** — craft end frames, ring 12 of them around a 3×3 gap, fill them with eyes of ender, and step through. Pale island, purpur pillars, an exit portal that carries you home.
- **Structures** — villages of 2–3 plank-and-cobble huts spawn on flat ground (96-block regions); glowstone-lit towers rise on nether cavern floors.
- **Bigger, wilder terrain** — continents + ridged mountain ranges (peaks past y=84), cheese caverns + spaghetti tunnels, lava pools deep down, vein-ish ore clusters by depth (coal → iron → gold → redstone → diamond).
- **30M×30M world border** — the world is procedural and unbounded in generation, but the player is clamped at ±30,000,000 like Minecraft's world barrier. All hashes use exact 32-bit math (`Math.imul`), so terrain stays deterministic at any coordinate.
- **Better textures** — a ~50-tile 256×256 atlas painted at boot: ore blobs, bark grain, brick courses, glowstone cells, portal swirls, four crack stages for mining.
- **Multiplayer (beta), now dimension-aware** — same serverless `MCHTML-…` code flow; edits, positions and relaying all carry the dimension, so you can be in the Nether while your friend mines coal topside. Star topology through the host, idempotent edit replay, seed mismatch warnings.
- **World creation screen** — name, seed (number or any text), Creative or Survival. Multiple worlds with a save list; v1 saves migrate automatically. Day/night cycle (10-minute days), sun, moon, stars, clouds.

## Controls

| Input | Action |
|---|---|
| `W A S D` | move |
| `Space` | jump / fly up — **double-tap**: toggle flight (creative) |
| `Shift` / `Ctrl` | fly down / sprint |
| `Mouse` | look |
| Left click (hold) | mine — instant in creative, crack-progress in survival |
| Right click | place / use (crafting table, furnace, lever, fill end frame, light portal) |
| `1–9` / wheel | select hotbar slot |
| `E` | inventory |
| `Esc` | pause menu (auto-saves) |

**Touch:** left stick to move, drag the right side to look. **MINE** mode: hold to dig (quick tap in creative instant-breaks). **BUILD** mode: tap to place. JUMP / DOWN / FLY / MENU buttons, tap the hotbar to select.

## Survival progression

1. Punch a tree → planks → crafting table → wooden pickaxe.
2. Dig stone → stone tools + furnace (8 cobble).
3. Find iron below y≈52 → smelt ingots → iron pickaxe.
4. Deep below y≈30: gold, redstone, diamond. Redstone drops dust ×4.
5. Diamond pickaxe (tier 4) mines obsidian → build a Nether portal.
6. Craft an igniter (coal + stick), light the frame, step through.
7. End frames = obsidian + 2 glowstone dust + stone. Eyes = redstone + 2 glowstone dust. Ring 12 frames around a 3×3 gap, fill them, and fall into the stars.

## Multiplayer (beta)

No accounts, no server: the host presses **Host** in the pause menu and gets an `MCHTML-…` invite code; the friend pastes it, presses **Join**, and sends back a reply code; the host pastes that. One paste each way via any chat app, and you're building together. Both players should load the **same seed** (use **Copy Seed**). Strict corporate NATs may refuse the peer link — home networks are fine.

## Tech notes

- Classic multi-file scripts sharing a `window.MCH` namespace — double-clicking `index.html` still works offline (`file://`).
- three.js (UMD) for rendering; the atlas, mesher (baked AO + block-light BFS), physics, crafting, redstone and WebRTC netcode are all hand-rolled in plain JS.
- Everything persists to `localStorage`: per-world edit logs (dimension-tagged), portal links, furnace contents, inventory, settings.

## Credits

Built by [REDACTED]
