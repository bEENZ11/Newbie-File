# Browser RTS: Phase 1 Brief

## What we're building

An original real-time strategy game that runs in the browser, in the style of the classic mid-90s base-building RTS. We're borrowing the genre's mechanics and controls, but the factions, art, names, maps and balance are our own.

Phase 1 covers the base-building and economy loop only: place buildings, power them, harvest ore, earn credits and produce units. It runs on a flat test grid. Proper maps, terrain, combat, an AI opponent and multiplayer come afterwards.

## Phase 1 goal

A player can open the page and, starting with one Construction Yard and some credits, do all of this:

1. Build a Power Plant, Ore Refinery, Barracks and War Factory from a sidebar.
2. Watch a harvester collect ore and turn it into credits without being told to.
3. Train infantry and build vehicles, then select them and move them around.

If that loop feels right, everything else has something solid to sit on.

## Technology

| Area | Choice | Why |
| --- | --- | --- |
| Language | TypeScript | Catches mistakes early in a codebase that will grow large |
| Rendering | Canvas 2D | Plenty for a 2D tile game, and simple. We can move to WebGL later if needed |
| Build tool | Vite | Fast, minimal setup |
| Tests | Vitest | Runs the simulation without a browser |
| Framework | None | A game loop doesn't benefit from one |
| Hosting (later) | Cloudflare Workers, with Durable Objects for multiplayer | Agreed direction for phase 3 |

## Architecture

The one rule that matters: **the simulation is completely separate from everything the player sees and touches.**

```
Input (mouse, keyboard)
   -> Commands ("place Barracks at 12,8", "move units 4,5 to 30,14")
      -> Simulation (advances in fixed ticks, the only thing that changes game state)
         -> Renderer (draws the current state, never changes it)
```

The simulation follows three constraints from day one, because they are what make multiplayer possible later and are very hard to retrofit:

- **Fixed ticks.** The game advances 20 times a second regardless of frame rate. The renderer smooths movement between ticks.
- **Integer maths only.** No decimals in game state, so every browser gets identical results.
- **Seeded randomness.** One random number generator, owned by the simulation.

The result is that the same list of commands always produces exactly the same game. That gives us multiplayer (send commands, not state), replays and saved games almost for free, and it makes the game easy to test.

## Mechanics

### The grid

A flat test field of 64 by 64 cells with a few ore patches. Each cell is either free, occupied by a building, or holding ore. The camera scrolls with the arrow keys or by moving the mouse to the screen edge.

### Buildings

| Building | Requires | Power | Role |
| --- | --- | --- | --- |
| Construction Yard | Present at start | 0 | Unlocks the building list |
| Power Plant | Construction Yard | +100 | Supplies power |
| Ore Refinery | Power Plant | -30 | Receives ore, comes with one free harvester |
| Barracks | Power Plant | -20 | Trains infantry |
| War Factory | Ore Refinery | -30 | Builds vehicles |

### Construction

- Clicking a building in the sidebar starts it. One building is under construction at a time.
- Its cost is drained from credits gradually as it builds. If credits run out, progress pauses until more arrive.
- When finished it shows as ready. The player clicks it, then picks a spot on the grid. A ghost outline shows green for valid and red for invalid.
- A building must go on free cells and within two cells of one of the player's existing buildings.
- Once placed, a short build-up animation plays before the building becomes active.
- Right-clicking a sidebar item pauses it, and right-clicking again cancels with a full refund.
- A building can be sold for half its cost.

### Power

Total supply is compared with total demand. If demand is higher, all production runs at half speed and the power bar turns red.

### Economy

- Ore cells hold a finite amount and shrink visibly as they're harvested.
- A harvester finds the nearest ore, fills up over a few seconds, drives to the nearest refinery, docks and unloads. Credits tick up during unloading. It then repeats, all without player input.
- The player can redirect a harvester by right-clicking ore or a refinery.
- Only one harvester docks at a refinery at a time, and others queue.
- No storage limit in phase 1. Silos can come later if we want that pressure.

### Units

| Unit | Built at | Role in phase 1 |
| --- | --- | --- |
| Rifleman | Barracks | Basic infantry |
| Light Tank | War Factory | Basic vehicle |
| Harvester | War Factory | Extra ore income |

- Each production building has its own queue, so infantry and vehicles build in parallel.
- New units appear at the building's exit and walk to its rally point.
- Units find their way around buildings and each other using grid pathfinding.
- Units can move but not fight yet. Combat is the first job of phase 2.

### Controls

| Action | Input |
| --- | --- |
| Select a unit or building | Left-click |
| Select several units | Left-click and drag a box |
| Add to selection | Shift and left-click |
| Move, or harvest if ore is clicked | Right-click |
| Deselect, or cancel placement | Right-click on empty ground with nothing to order, or Escape |
| Save a control group | Ctrl and a number key |
| Recall a control group | The number key |
| Set a rally point | Select a production building, right-click the ground |
| Scroll the camera | Arrow keys or screen edge |

### Starting numbers

These are placeholders of our own to get the loop running. They will change during tuning.

| Item | Cost | Build time |
| --- | --- | --- |
| Power Plant | 250 | 8s |
| Ore Refinery | 1500 | 25s |
| Barracks | 400 | 10s |
| War Factory | 1800 | 30s |
| Rifleman | 80 | 4s |
| Light Tank | 600 | 12s |
| Harvester | 1100 | 18s |

Starting credits: 5000. A full harvester load is worth 500.

## Art

Phase 1 uses placeholder art drawn in code: simple shapes in the player's colour with clear labels, plus a basic build-up animation. This keeps us moving on mechanics. Everything is drawn through a sprite layer, so real art can be dropped in later without touching the game logic.

## Build order

1. **Foundations.** Project setup, the grid, camera scrolling, and the tick-based simulation loop.
2. **Building.** Sidebar, construction, placement, prerequisites, power and selling.
3. **Economy.** Ore, harvesters, refineries and credits.
4. **Units.** Production queues, rally points, selection, pathfinding and movement.
5. **Proof.** An automated test that replays a recorded game twice and confirms both runs end in an identical state.

Each step ends with something playable in the browser.

## Not in phase 1

Combat, damage and repair, fog of war, real maps and terrain, a map editor, an AI opponent, multiplayer, sound, a minimap, superweapons, naval and air units, and a second faction.

## Later phases

- **Phase 2:** maps and terrain, fog of war, combat, defensive buildings, a minimap and sound.
- **Phase 3:** multiplayer on Cloudflare Durable Objects, with lobbies.
- **Phase 4:** an AI opponent, a second faction, real art and balance.

## Using the open-source classics as reference

We read the published source of the classic games and OpenRA to understand how problems were solved, then write our own implementation. We don't copy or translate code, and we don't use any of their art, audio, maps, names or balance tables. This keeps our code free of GPL obligations and the game clearly our own.

## Decisions still open

- **Name and setting.** The game needs a working title and a theme for its factions.
- **Starting state.** The brief assumes the Construction Yard is already placed. The alternative is starting with a vehicle that deploys into one.
- **Placement rule.** The brief uses "within two cells of an existing building". We could loosen or tighten that once we can feel it.
