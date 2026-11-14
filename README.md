# Browser RTS prototype

An original base-building real-time strategy game for the browser. The plan and scope live in [docs/BRIEF.md](docs/BRIEF.md).

## Running it

```
npm install
npm run dev
```

Then open the address it prints. Add `?seed=123` to the address to get the same ore layout each time.

## What works so far

- A 64 by 64 test grid with ore patches, scrolled with the arrow keys or the screen edges.
- The Pioneer: left-click to select, right-click to drive, press D or double-click to deploy it into a Construction Yard.
- A deterministic simulation running at 20 ticks a second, separate from drawing and input.

## Commands

- `npm run dev` starts the game locally.
- `npm test` runs the simulation tests.
- `npm run build` type-checks and makes a production build in `dist`.

## Layout

- `src/sim` is the game itself. It uses whole numbers only and never touches the browser, so the same commands always produce the same game.
- `src/render` draws the current state.
- `src/input` turns mouse and keyboard input into commands.
