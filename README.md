# MCHTML

![status](https://img.shields.io/badge/build-3.x_green-8fe36f) ![license](https://img.shields.io/badge/license-MIT-blue)

**Play it live: [https://thelegendhascome.github.io/MCHTML/](https://thelegendhascome.github.io/MCHTML/)**

A tiny Minecraft-like voxel sandbox that runs entirely in your browser — **one HTML file, no build step, no server**. The whole engine (chunked world generation, meshing, physics, editing, persistence) is a single ~55 KB page.

## Features

- **Infinite chunked world** — 16×64×16 chunks stream in around you as you move, generated from a seeded value-noise height map with continents, ridged mountains, terraced plateaus, beaches and snow lines
- **Procedural pixel-art textures** — a 14-tile atlas painted at boot on a single 128×32 canvas (grass turf bleeding over dirt, bark grain, cobble courses, plank joints, frosted glass shine), nearest-filtered so it stays crisp
- **Block breaking & placing** — voxel raycast (Amanatides–Woo DDA), 10-block hotbar, middle-click eyedropper
- **Baked ambient occlusion** — per-vertex AO in the classic *0fps* style, with quad-diagonal flipping to kill the anisotropy artifacts; vertex colors act as pure brightness over the texture map, so shading and pixels stack
- **Water, trees & clouds** — depth-ordered translucent water, deterministic oak trees whose canopies cross chunk seams without holes, drifting instanced clouds
- **Physics** — swept AABB player with sub-stepping (no tunneling); the movement basis is derived directly from the camera rotation, so "forward" is always exactly where you're looking
- **Mouse settings** — live sensitivity slider and invert-Y toggle in the pause menu, persisted with your save
- **Persistence** — your edits, settings and position auto-save to `localStorage` every few seconds; the **seed** box in the pause menu lets you share worlds as a number
- **Touch support** — thumbstick + look-zone + fly/build toggles on mobile
- **Tiny synth** — break/place/jump sounds generated with WebAudio, no assets

## Controls

| Input | Action |
|---|---|
| `W A S D` | move |
| `Space` | jump / fly up — **double-tap**: toggle flight |
| `Shift` / `Ctrl` | fly down / sprint |
| `Mouse` | look |
| Left click | break block |
| Right click | place block |
| Middle click | pick block |
| `1–9` `0` / wheel | select hotbar slot |
| `Esc` | pause menu (auto-saves) |

## How it works

- Terrain is a pure function `heightAt(x, z)` — five stacked seeded value-noise octaves + a ridged mountain mask — so any block can be answered deterministically even far from loaded chunks
- Trees are placed by a deterministic per-column hash with a 5×5 local-maximum test, and stamped with a 3-block margin so canopies never get cut by chunk borders
- Each chunk becomes up to 3 static `BufferGeometry` meshes (opaque / glass / water) with face-culled geometry and vertex colors — no textures, no lights, `MeshBasicMaterial` + fog keeps it fast
- Chunk edits dirty their chunk **and its border neighbors** (AO fences), then remesh immediately for crisp feedback
- Everything runs on the main thread with a per-frame budget (~3 chunk generates / 2 mesh builds per frame) — no workers, no jank

## Development

No toolchain. Just open `index.html`, or serve it inline:

```bash
npx serve .        # or: python -m http.server
```

The engine exposes a debug handle on the window:

```js
MCHTML.world.get(x, y, z)          // read a block
MCHTML.world.set(x, y, z, id)      // write a block
MCHTML.world.height(x, z)          // terrain height function
MCHTML.freshWorld(seed)            // regenerate
MCHTML.player.flying = true        // creative flight
MCHTML.step(1/30)                  // step physics manually (headless tests)
```

## Credits

Built by [REDACTED]
Renders with [three.js](https://threejs.org).
