# Browser RTS: Phase 1 Brief

## What we're building

An original real-time strategy game that runs in the browser, in the style of the classic mid-90s base-building RTS. We're borrowing the genre's mechanics and controls, but the factions, art, names, maps and balance are our own.

Phase 1 covers the base-building and economy loop only: place buildings, power them, harvest ore, earn credits and produce units. It runs on a flat test grid. Proper maps, terrain, combat, an AI opponent and multiplayer come afterwards.

## Phase 1 goal

A player can open the page and, starting with one Pioneer vehicle and some credits, do all of this:

1. Drive the Pioneer to a spot of their choosing and deploy it into a Construction Yard.
2. Build a Power Plant, Ore Refinery, Barracks and War Factory from a sidebar.
3. Watch a harvester collect ore and turn it into credits without being told to.
4. Train infantry and build vehicles, then select them and move them around.

If that loop feels right, everything else has something solid to sit on.

## Technology

| Area | Choice | Why |
| --- | --- | --- |
| Language | TypeScript | Catches mistakes early in a codebase that will grow large |
| Rendering | Three.js (WebGL) | Real 3D with lighting and shadows, viewed from a fixed raised camera in the classic style |
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
| Construction Yard | A deployed Pioneer | 0 | Unlocks the building list |
| Power Plant | Construction Yard | +100 | Supplies power |
| Ore Refinery | Power Plant | -30 | Receives ore, comes with one free harvester |
| Barracks | Power Plant | -20 | Trains infantry |
| War Factory | Ore Refinery | -30 | Builds vehicles |

### The Pioneer

The player starts with a Pioneer, a large, slow vehicle that carries the base. (Pioneer is a working name.)

- It is selected and moved like any other unit.
- Pressing D with it selected, or double-clicking it, deploys it. It needs a clear three by three area around it. If the area is blocked, the footprint flashes red and nothing happens.
- Deploying plays an unfolding animation, after which the vehicle is gone and a Construction Yard stands in its place. The sidebar's building list appears at that moment.
- Deployment is one-way in phase 1. Packing the yard back up into a vehicle, and building further Pioneers to expand, can come later.

### Construction

- Clicking a building in the sidebar starts it. One building is under construction at a time.
- Its cost is drained from credits gradually as it builds. If credits run out, progress pauses until more arrive.
- When finished it shows as ready. The player clicks it, then picks a spot on the grid. A ghost outline shows green for valid and red for invalid.
- A building must go on free cells, clear of ore and units, and beside one of the player's existing buildings. A gap of one cell is allowed, but no more.
- Once placed, a short build-up animation plays before the building becomes active.
- Right-clicking a sidebar item puts it on hold, and right-clicking again cancels it and refunds everything spent so far.
- A building can be sold for half its cost.

### Power

Total supply is compared with total demand. If demand is higher, the power bar turns red and production slows in proportion to the shortfall, down to a floor of a quarter speed. Being slightly short costs a little, and being badly short costs a lot.

### Economy

- Ore cells hold a finite amount and shrink visibly as they're harvested.
- A harvester finds the nearest ore, fills up over a few seconds, drives to the nearest refinery, docks and unloads. Credits tick up during unloading. It then repeats, all without player input.
- After unloading it goes back to the field it was last working, and moves to the next nearest ore when a cell runs dry.
- The player can redirect a harvester by right-clicking ore or a refinery. A plain move order parks it until it is given a new job.
- Each refinery has a dock cell at its front. One harvester unloads there at a time while others queue beside it, and nothing can be built on a dock.
- If its refinery is sold, a harvester keeps its load and delivers to another when one exists.
- No storage limit in phase 1. Silos can come later if we want that pressure.

### Units

| Unit | Built at | Role in phase 1 |
| --- | --- | --- |
| Pioneer | Present at start | Deploys into the Construction Yard |
| Rifleman | Barracks | Basic infantry |
| Light Tank | War Factory | Basic vehicle |
| Harvester | War Factory | Extra ore income |

- Infantry and vehicles are trained in two separate lines that run side by side, each holding up to twelve units. Clicking a unit adds one to its line.
- Right-clicking the unit in progress puts it on hold, and again cancels it with a refund. Right-clicking a unit that is only waiting drops one from the line.
- New units appear at the building's door and move to its rally point, which starts just clear of the door. Select the building and right-click the ground to move it.
- A harvester built at the War Factory needs a refinery first, and heads straight for ore.
- A group ordered to one spot forms up around it, each unit taking a cell of its own.
- Dragging a box over troops leaves harvesters and the Pioneer out of the selection, so the economy is never pulled off its work by accident.
- Units find their way around buildings and each other using grid pathfinding. No two units share a cell: a blocked unit waits briefly, then finds a way round.
- Units can move but not fight yet. Combat is the first job of phase 2.

### Controls

| Action | Input |
| --- | --- |
| Select a unit or building | Left-click |
| Select several units | Left-click and drag a box |
| Add to selection | Shift and left-click |
| Move, or harvest if ore is clicked | Right-click |
| Deselect, or cancel placement | Right-click on empty ground with nothing to order, or Escape |
| Save a control group | Ctrl or Shift, and a number key |
| Recall a control group | The number key. Press twice to jump the camera to it |
| Zoom | Mouse wheel |
| Deploy the Pioneer | D, or double-click it |
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

The game is rendered in 3D. The camera is fixed, looking north and tilted down at the ground, with mouse-wheel zoom but no rotation.

Phase 1 uses low-poly placeholder models built from simple shapes in code, in the player's colour, with build-up animations where each part of a structure rises out of the ground in turn. This keeps us moving on mechanics. The models live in one place, separate from the game logic, so proper models from an artist or an asset pack can be swapped in later.

## Build order

1. **Foundations.** Project setup, the grid, camera scrolling, and the tick-based simulation loop.
2. **Deployment.** The Pioneer, basic unit selection and movement, and deploying into the Construction Yard.
3. **Building.** Sidebar, construction, placement, prerequisites, power and selling.
4. **Economy.** Ore, harvesters, refineries and credits.
5. **Units.** Production queues, rally points, box selection, control groups and pathfinding around obstacles.
6. **Proof.** An automated test that replays a recorded game twice and confirms both runs end in an identical state.

Each step ends with something playable in the browser.

## Not in phase 1

Combat, damage and repair, fog of war, real maps and terrain, a map editor, an AI opponent, multiplayer, sound, a minimap, superweapons, naval and air units, and a second faction.

## Later phases

- **Phase 2:** maps and terrain, fog of war, combat, defensive buildings, a minimap and sound.
- **Phase 3:** multiplayer on Cloudflare Durable Objects, with lobbies.
- **Phase 4:** an AI opponent, a second faction, real art and balance.

## Using the open-source classics as reference

We read the published source of the classic games and OpenRA to understand how problems were solved, then write our own implementation. We don't copy or translate code, and we don't use any of their art, audio, maps, names or balance tables. This keeps our code free of GPL obligations and the game clearly our own.

## What the classics confirmed

Before building the construction stage we read the published Red Alert source and OpenRA to check our approach. Both work the way this brief describes, which is reassuring. The points we took on board:

- **Paying as you build.** Both drain the cost gradually and simply wait when credits run out. OpenRA works out each payment from the running total so the final price is always exact, and we do the same.
- **Low power.** The original slows production in proportion to the power shortfall, which is more forgiving and more interesting than a flat penalty, so we adopted it.
- **Placement.** The original requires new buildings to sit beside existing ones while tolerating a one-cell gap. Ours matches.
- **Multiplayer.** Both send only player commands, schedule them a few ticks ahead to absorb lag, and regularly compare a checksum of the game state to catch machines drifting apart. Our simulation already has the command log and state hash this needs, and every command now carries the player who gave it.

## Decisions still open

- **Name and setting.** The game needs a working title and a theme for its factions.
- **Vehicle name.** Pioneer is a placeholder for the deploying base vehicle.
- **Placement rule.** The brief allows a one-cell gap between buildings. We could loosen or tighten that once we can feel it.
