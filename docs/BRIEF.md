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
| Attack | Right-click an enemy unit or building |
| Deselect, or cancel placement | Right-click on empty ground with nothing to order, or Escape |
| Save a control group | Ctrl or Shift, and a number key |
| Recall a control group | The number key. Press twice to jump the camera to it |
| Zoom | Mouse wheel |
| Deploy the Pioneer | D, or double-click it |
| Set a rally point | Select a production building, right-click the ground |
| Scroll the camera | Arrow keys, screen edge, or click the radar |
| Repair or sell a building | The Repair or Sell button, then click the building |
| Mute sound | M |
| Flip between the diamond and straight-on views | V |

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

The game is rendered in 3D. The camera looks down at the ground from a raised angle, with mouse-wheel zoom. By default it uses a diamond view from the south-east, which shows two sides of every building. V flips to a straight-on view looking north, and the choice is remembered.

The ground is painted procedurally, with grass that varies between lush and dry, forest floor, bare rock and lakes with sandy shores, all blended across cell boundaries. Lighting uses a low warm sun with soft shadows and filmic tone mapping. Chimneys smoke, cooling towers steam, damaged buildings burn, explosions leave scorch marks, and tank and turret guns swing round to track their targets. The build buttons show portraits rendered from the game's own models.

Riflemen, Light Tanks and trees use models from the Toon Shooter Game Kit by Quaternius, which is released under the CC0 licence and credited in `public/models/CREDITS.md`. The game repaints them in each side's colours when it loads them. Soldiers are animated: they stand at ease, run, fire and fall. If the pack files are missing the game falls back to its built-in models.

Everything else uses low-poly models built from simple shapes in code, in the player's colour, with build-up animations where each part of a structure rises out of the ground in turn. This keeps us moving on mechanics. The models live in one place, separate from the game logic, so proper models from an artist or an asset pack can be swapped in later.

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

## Phase 2 and beyond: where the game stands

Everything below is built and playable. A game is now a skirmish against the computer on a generated map.

### Combat

- **Health.** Every unit and building has health, shown as a bar when it is selected or damaged. At zero it is destroyed and its ground is freed.
- **Weapons.** Riflemen and Light Tanks are armed. Rifles are strong against infantry and weak against vehicles and buildings, and tank cannons are the reverse. Harvesters and the Pioneer are unarmed.
- **Orders.** With armed units selected, right-clicking an enemy orders an attack. They close to weapon range, follow a target that moves, and stop when it is destroyed. A move order cancels an attack.
- **Instincts.** An idle unit fires at any enemy that comes into range without leaving its post. If something out of reach shoots at it, it goes after the attacker, and idle allies nearby join in.
- **Winning.** A side is beaten when it has no buildings left and no Pioneer to start again.

### Defences and repair

- **Gun Turret.** A one-cell defensive building that needs a Barracks. It out-ranges every unit and fires on anything hostile that approaches, but falls silent if the base is short of power.
- **Repair.** The Repair button, then a click on a damaged building, restores its health over time. A full repair from nothing costs 30% of the building's price. It pauses if credits run out, and a second click stops it.

### Fog of war and the radar

- **Shroud.** Ground nobody has seen is black. Ground seen earlier but not in view now is dimmed.
- **Sight.** Every unit and building sees a few cells around itself. Enemy units only appear while something of yours can see them, and enemy buildings stay marked once discovered.
- **Radar.** A map of the whole battlefield sits at the top of the sidebar. Clicking or dragging on it moves the camera.

### Terrain

Maps are generated from the game's seed, with rocky outcrops, lakes and woods that block movement and building. Both starting areas are kept clear, each has an ore field within reach, and a map is only accepted if there is a way between the two bases.

### The computer opponent

The enemy starts with a Construction Yard in the south-east and plays by the same rules as the player, with the same costs, build times and commands.

- It builds power, a refinery, a barracks, a war factory and turrets, keeping spare power in hand and leaving lanes between buildings.
- It runs harvesters, repairs badly damaged buildings and rebuilds what it loses.
- Its army grows gradually. The first attack comes no sooner than four minutes in, with later waves at least ninety seconds apart and larger each time.
- It runs inside the simulation, so in multiplayer every machine will see it make the same decisions.

### Sound

Shots, cannon fire, explosions, collapsing buildings, order confirmations and build notifications are all synthesised in the browser, so there are no audio files to load or license. Sounds from the fog are silent, and those off-screen are quieter. M mutes.

### Factions and the start menu

There are two sides, Aegis and Dominion.

| Faction | Motto | Colours | In a mirror match |
| --- | --- | --- | --- |
| Aegis | Hold the line | Blue | The second Aegis player wears teal |
| Dominion | Take what is owed | Red | The second Dominion player wears orange |

For now both sides build the same things. Each faction has a list of units and buildings it cannot make, both currently empty, and the rules for what can be built already check those lists. Giving the factions their own character is a matter of filling them in and adding anything unique to one side.

A game starts from a menu, where the player chooses:

- **Their faction**, from two cards showing each side's emblem, motto and a line of background.
- **The opponent's faction.** Choosing the side the opponent already has swaps the two over. Picking the same for both gives a mirror match.
- **Difficulty.** Easy, Normal or Hard, which sets how soon the computer first attacks (six, four, or two and a half minutes), how often it attacks after that, and how fast its army grows.
- **Starting credits:** 5,000, 10,000 or 20,000.
- **Map number.** Left blank for a random map. The same number always gives the same map.

The choices are remembered for next time. A game can also be started straight from a link, such as `?faction=dominion&difficulty=easy&seed=3`, which skips the menu. Play again returns to the menu.

"Aegis and Dominion" is used as the title for now, since the game has no other name yet.

### The shared roster

Both sides currently draw on the same units and buildings. This is the common core that the factions will later be split from.

| Infantry | Cost | Needs | Role |
| --- | --- | --- | --- |
| Rifleman | 80 | Barracks | Cheap, good against other infantry |
| Rocket Soldier | 200 | Barracks | Strong against vehicles, poor against infantry |
| Grenadier | 140 | Barracks | Short range, the best foot soldier against buildings |
| Engineer | 400 | Radar Station | Unarmed. Captures an enemy building, or fully mends one of yours, and is used up doing it |

| Vehicle | Cost | Needs | Role |
| --- | --- | --- | --- |
| Harvester | 1,100 | Refinery | Gathers ore |
| Scout Car | 350 | War Factory | Very fast and far-sighted, with a light machine gun |
| Light Tank | 600 | War Factory | The all-round fighting vehicle |
| Artillery | 900 | Radar Station | Out-ranges everything, turrets included, but is fragile |
| Heavy Tank | 1,100 | Tech Centre | Twice the armour and firepower of a Light Tank, and slower |

| Building | Cost | Needs | Role |
| --- | --- | --- | --- |
| Radar Station | 1,000 | Refinery | Switches on the radar map, which also needs full power |
| Tech Centre | 1,500 | Radar Station and War Factory | Unlocks the Heavy Tank |
| Service Depot | 1,200 | War Factory | Repairs vehicles parked beside it, for credits |
| Wall | 50 | Barracks | Blocks movement. Can be laid up to five cells from the base |

Rules worth knowing:

- Walls do not count as part of the base. They cannot be used to extend where you may build, troops ignore them unless ordered to attack one, and a side left with nothing but walls has lost.
- A captured building works for its new owner straight away, and taking an enemy's last building wins the game.
- The sidebar has a tab each for structures, infantry and vehicles. A dot on a tab shows that something behind it is building or ready.
- The computer builds a Radar Station after its first attack and a Tech Centre after its second, and mixes rocket soldiers, grenadiers, scout cars, artillery and heavy tanks into its army. It does not yet use engineers, walls or depots.

### Still to come

Splitting the roster into two factions, hand-made maps and a map editor, multiplayer on Cloudflare, music, further art, and balance.

## What the classics confirmed

Before building the construction stage we read the published Red Alert source and OpenRA to check our approach. Both work the way this brief describes, which is reassuring. The points we took on board:

- **Paying as you build.** Both drain the cost gradually and simply wait when credits run out. OpenRA works out each payment from the running total so the final price is always exact, and we do the same.
- **Low power.** The original slows production in proportion to the power shortfall, which is more forgiving and more interesting than a flat penalty, so we adopted it.
- **Placement.** The original requires new buildings to sit beside existing ones while tolerating a one-cell gap. Ours matches.
- **Multiplayer.** Both send only player commands, schedule them a few ticks ahead to absorb lag, and regularly compare a checksum of the game state to catch machines drifting apart. Our simulation already has the command log and state hash this needs, and every command now carries the player who gave it.

## Decisions still open

- **Name.** The game is titled "Aegis and Dominion" after its two factions until it has a name of its own.
- **What sets the factions apart.** They share a roster today. Their different defences, specialist weapons and playing styles are still to be decided.
- **Vehicle name.** Pioneer is a placeholder for the deploying base vehicle.
- **Placement rule.** The brief allows a one-cell gap between buildings. We could loosen or tighten that once we can feel it.
