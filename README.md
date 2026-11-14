# Browser RTS prototype

An original base-building real-time strategy game for the browser. The plan and scope live in [docs/BRIEF.md](docs/BRIEF.md).

## Running it

```
npm install
npm run dev
```

Then open the address it prints. Add `?seed=123` to the address to get the same ore layout each time.

## What works so far

- A 3D view with a fixed raised camera, lighting and shadows. Scroll with the arrow keys or the screen edges, and zoom with the mouse wheel.
- A 64 by 64 test grid with ore patches.
- The Pioneer: left-click to select, right-click to drive, press D or double-click to deploy it into a Construction Yard.
- Base building from the sidebar: Power Plant, Ore Refinery, Barracks and War Factory, with prerequisites, pay-as-you-build costs, hold and cancel, placement beside your base, power and selling.
- A deterministic simulation running at 20 ticks a second, separate from drawing and input.

## Commands

- `npm run dev` starts the game locally.
- `npm test` runs the simulation tests.
- `npm run build` type-checks and makes a production build in `dist`.

## Layout

- `src/sim` is the game itself. It uses whole numbers only and never touches the browser, so the same commands always produce the same game.
- `src/render` draws the current state in 3D with Three.js. The placeholder models are in `src/render/models.ts`.
- `src/input` turns mouse and keyboard input into commands.
