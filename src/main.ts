import { Sounds } from './audio';
import { Input } from './input/input';
import { EMBLEMS, chooseOptions, seatsFor } from './menu';
import { TURN_TICKS } from './net/protocol';
import { Minimap } from './minimap';
import { css, palettes, setFactions } from './render/teams';
import { loadAssets } from './render/assets';
import { renderIcons } from './render/icons';
import { Renderer } from './render/renderer';
import { Sidebar } from './sidebar';
import { checkPlacement, powerOf } from './sim/production';
import { Sim } from './sim/sim';
import {
  BUILDING_DEFS,
  FACTION_DEFS,
  HARVEST_CAPACITY,
  MAP_H,
  MAP_W,
  SUB,
  TICK_RATE,
  UNIT_DEFS,
  type BuildingType,
  type UnitType,
} from './sim/types';
import { BASES, addBuilding, spawnUnit } from './sim/world';
import { LOCAL_PLAYER, createUi, placementOrigin, setLocalPlayer } from './ui';

const TICK_MS = 1000 / TICK_RATE;

// Fetch the pack models before anything is drawn. The game still starts if they fail.
await loadAssets();

// Wait on the menu for the player to pick a side, then paint the armies to match.
const options = await chooseOptions();
// In a game against other people the room decides who sits where. Otherwise the menu does.
const online = options.online;
const seats = online ? online.info.seats : seatsFor(options);
if (online) setLocalPlayer(online.you);
setFactions(seats.map((s) => s.faction));
document.body.dataset.playing = 'yes';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const hintEl = document.getElementById('hint')!;
const dragEl = document.getElementById('dragbox')!;
const bannerEl = document.getElementById('banner')!;
const againEl = document.getElementById('again')!;
againEl.addEventListener('click', () => {
  // Back to the menu. Drop any choices carried in the address, so it is shown.
  location.href = location.pathname;
});
window.addEventListener('keydown', (e) => {
  if ((e.key === 'm' || e.key === 'M') && !e.repeat) sounds.toggleMute();
});

// A skirmish against the computer, on a map with rocks, lakes and woods,
// set up the way the player asked for on the menu.
const sim = new Sim(options.seed, {
  seats,
  terrain: true,
  // Against other people, everyone starts alike, with just a Pioneer.
  pioneers: online !== undefined,
  difficulty: options.difficulty,
  credits: options.credits,
});
const foeName = FACTION_DEFS[options.enemy].name;
// How the hints refer to the opposition, which depends on how many there are.
const foeText = options.mode === 'duel' ? `${foeName} is` : options.mode === 'teams' ? 'Both enemies are' : 'All three rivals are';
const whereText = online
  ? 'Your rivals start in the other corners'
  : options.mode === 'duel'
    ? `The ${foeName} base lies in the far south-east corner`
    : options.mode === 'teams'
      ? 'Your ally is to the south, and two enemy bases lie to the east'
      : 'There is a rival in each of the other three corners';

// Show whose side this is at the top of the sidebar.
const badge = document.getElementById('badge')!;
badge.innerHTML = `${EMBLEMS[options.faction]}<span>${FACTION_DEFS[options.faction].name}</span>`;
badge.style.color = css(palettes[LOCAL_PLAYER].light);
document.getElementById('sidebar')!.style.setProperty('--team', css(palettes[LOCAL_PLAYER].main));
const sounds = new Sounds();

// A small blip confirms each order as it is given.
const issue = sim.issue.bind(sim);
sim.issue = (cmd) => {
  // Online, an order goes to the room and takes effect when it comes back in a turn,
  // for every player at once. On its own, the game applies it straight away.
  if (online) online.client.order(cmd);
  else issue(cmd);
  if (cmd.type === 'move' || cmd.type === 'attack' || cmd.type === 'rally') sounds.play('order');
  else if (cmd.type !== 'place') sounds.play('click');
};

/** How loud something at a map position should be: full on screen, fainter beyond, silent in the fog. */
function loudness(x: number, z: number): number {
  const cx = Math.floor(x);
  const cz = Math.floor(z);
  if (cx < 0 || cz < 0 || cx >= MAP_W || cz >= MAP_H) return 0;
  if (!sim.world.vision[LOCAL_PLAYER].visible[cz * MAP_W + cx]) return 0;
  const dx = Math.abs(x - ui.camX) / (ui.viewW / ui.zoom / 2);
  const dz = Math.abs(z - ui.camZ) / (ui.viewH / ui.zoom / 2);
  const d = Math.max(dx, dz);
  return d <= 1 ? 1 : Math.max(0.15, 1 / (d * d));
}
const ui = createUi();
// Press V to flip between the diamond and straight-on views. The choice is remembered.
try {
  if (localStorage.getItem('view') === 'straight') ui.yaw = 0;
} catch {
  // No storage available, so start with the default view.
}
const renderer = new Renderer(canvas, sim.world);
const input = new Input(canvas, sim, ui, renderer);
const sidebar = new Sidebar(document.getElementById('sidebar')!, sim, ui, renderIcons());
const minimap = new Minimap(document.getElementById('minimap') as HTMLCanvasElement, sim, ui, () =>
  input.clampCamera(),
);

function resize(): void {
  renderer.resize(ui);
  input.clampCamera();
}
window.addEventListener('resize', resize);
renderer.resize(ui);
ui.camX = BASES[LOCAL_PLAYER].x + 0.5;
ui.camZ = BASES[LOCAL_PLAYER].y + 0.5;
input.clampCamera();

function handleEvents(now: number): void {
  for (const ev of sim.events) {
    renderer.onEvent(ev, now);
    if (ev.type === 'shot') {
      const sound = ev.kind === 'bullet' ? 'rifle' : ev.kind === 'flame' ? 'flame' : 'cannon';
      sounds.play(sound, loudness(ev.fromX / SUB, ev.fromY / SUB));
    } else if (ev.type === 'uplinkOnline' && ev.player === LOCAL_PLAYER) {
      sounds.play('ready');
    } else if (ev.type === 'sabotaged') {
      sounds.play('blast');
    } else if (ev.type === 'captured') {
      // Good news if we took it, bad news if it was ours.
      sounds.play(ev.player === LOCAL_PLAYER ? 'ready' : ev.from === LOCAL_PLAYER ? 'refused' : 'click');
    } else if (ev.type === 'mended' && ev.player === LOCAL_PLAYER) {
      sounds.play('ready');
    } else if (ev.type === 'unitDied') {
      sounds.play('blast', loudness(ev.x / SUB, ev.y / SUB));
    } else if (ev.type === 'buildingDestroyed') {
      sounds.play('collapse', loudness(ev.cx + ev.w / 2, ev.cy + ev.h / 2));
    } else if (ev.type === 'placed' && ev.player === LOCAL_PLAYER) {
      sounds.play('placed');
    } else if ((ev.type === 'productionReady' || ev.type === 'unitReady') && ev.player === LOCAL_PLAYER) {
      sounds.play('ready');
    } else if ((ev.type === 'placeRefused' && ev.player === LOCAL_PLAYER) || ev.type === 'deployBlocked') {
      sounds.play('refused');
    }
    if (ev.type === 'gameOver') {
      const won = ev.winner === sim.world.players[LOCAL_PLAYER].team;
      sounds.play(won ? 'victory' : 'defeat');
      againEl.style.display = 'block';
      bannerEl.textContent = won ? 'Victory' : 'Defeat';
      bannerEl.dataset.result = won ? 'won' : 'lost';
      bannerEl.style.display = 'block';
    }
    if (ev.type === 'deployBlocked') {
      ui.flashes.push({ cx: ev.cx, cy: ev.cy, w: ev.w, h: ev.h, t: now });
    } else if (ev.type === 'deployed' && ui.selectedUnits.delete(ev.unitId)) {
      ui.selectedBuilding = ev.buildingId;
    } else if (ev.type === 'placed' && ev.player === LOCAL_PLAYER) {
      ui.placing = null;
    } else if (ev.type === 'placeRefused' && ev.player === LOCAL_PLAYER) {
      ui.flashes.push({ cx: ev.cx, cy: ev.cy, w: ev.w, h: ev.h, t: now });
    }
  }
}

function currentHint(): string {
  const world = sim.world;
  const player = world.players[LOCAL_PLAYER];
  const pioneer = world.units.find((u) => u.type === 'pioneer' && u.owner === LOCAL_PLAYER);
  const yard = world.buildings.find((b) => b.type === 'conyard' && b.owner === LOCAL_PLAYER);
  const prod = player.production;

  if (online?.client.desynced) return 'The players\' games have drifted apart. This match cannot continue fairly';
  if (online?.client.closed) return 'The connection to the game was lost';
  if (world.winner !== -1) {
    return world.winner === player.team ? `${foeText} defeated` : 'Your side has been wiped out';
  }

  if (ui.placing) {
    const { cx, cy } = placementOrigin(ui, ui.placing);
    const check = checkPlacement(world, LOCAL_PLAYER, ui.placing, cx, cy);
    if (ui.mouseInside && !check.inRange) return 'Too far from your base. Build beside one of your buildings';
    return 'Left-click to place. Right-click to put it back';
  }
  if (ui.sellMode) return 'Click a building to sell it for half its cost. Right-click to stop';
  if (ui.repairMode) return 'Click a damaged building to repair it for credits. Click again to stop';
  const chosen = world.units.filter((u) => ui.selectedUnits.has(u.id));
  if (chosen.length > 0 && chosen.every((u) => u.type === 'engineer')) {
    return 'Engineer selected. Right-click an enemy building to capture it, or a damaged one of yours to mend it';
  }
  if (chosen.length > 0 && chosen.every((u) => u.type === 'saboteur')) {
    return 'Saboteur selected. Right-click an enemy building to blow it up from inside';
  }
  if (chosen.some((u) => UNIT_DEFS[u.type].weapon)) {
    return `${chosen.length} selected. Right-click ground to move, or an enemy to attack. Shift and a number saves the group`;
  }
  if (chosen.length > 1) {
    return `${chosen.length} units selected. Right-click to move. Shift and a number saves the group`;
  }
  if (pioneer && !yard) {
    return ui.selectedUnits.has(pioneer.id)
      ? 'Right-click to drive. Press D or double-click the Pioneer to deploy'
      : 'Left-click the Pioneer to select it';
  }
  const picked = world.units.find((u) => ui.selectedUnits.has(u.id) && u.type === 'harvester');
  const producer = world.buildings.find(
    (b) => b.id === ui.selectedBuilding && (b.type === 'barracks' || b.type === 'factory'),
  );
  if (producer) {
    return `${BUILDING_DEFS[producer.type].name} selected. Right-click the ground to set where new units gather`;
  }
  if (picked) {
    return `Harvester carrying ${picked.cargo} of ${HARVEST_CAPACITY}. Right-click ore to dig or a refinery to unload`;
  }
  if (!yard) return 'No Construction Yard. Nothing more can be built';
  if (yard.progress < yard.total && !yard.selling) return `${BUILDING_DEFS.conyard.name} deploying`;
  if (prod?.state === 'ready') {
    return `${BUILDING_DEFS[prod.type].name} ready. Click it in the sidebar, then choose a spot`;
  }
  if (prod?.state === 'held') {
    return `${BUILDING_DEFS[prod.type].name} on hold. Click to resume, right-click to cancel`;
  }
  if (prod) return `Building ${BUILDING_DEFS[prod.type].name}. Right-click it to put it on hold`;
  if (powerOf(world, LOCAL_PLAYER).low) return 'Low power is slowing production. Build a Power Plant';
  return `${whereText}, and they will come for you. Build defences and an army`;
}

function updateHud(): void {
  sidebar.update();
  minimap.draw();

  const hint = currentHint();
  if (hintEl.textContent !== hint) hintEl.textContent = hint;
  document.body.dataset.mode = ui.placing ? 'placing' : ui.sellMode ? 'sell' : ui.repairMode ? 'repair' : 'normal';

  const box = ui.dragBox;
  dragEl.style.display = box ? 'block' : 'none';
  if (box) {
    dragEl.style.left = `${Math.min(box.x0, box.x1)}px`;
    dragEl.style.top = `${Math.min(box.y0, box.y1)}px`;
    dragEl.style.width = `${Math.abs(box.x1 - box.x0)}px`;
    dragEl.style.height = `${Math.abs(box.y1 - box.y0)}px`;
  }
}

/** Drops selections and modes that no longer point at anything real. */
function tidyUi(): void {
  const world = sim.world;
  if (ui.selectedBuilding !== null && !world.buildings.some((b) => b.id === ui.selectedBuilding)) {
    ui.selectedBuilding = null;
  }
  const prod = world.players[LOCAL_PLAYER].production;
  if (ui.placing && (prod?.state !== 'ready' || prod.type !== ui.placing)) ui.placing = null;
  // Forget units that have been destroyed.
  for (const id of ui.selectedUnits) {
    if (!world.units.some((u) => u.id === id)) ui.selectedUnits.delete(id);
  }
}

// Set game.debug.paused from the console to freeze the game and step it by hand.
// game.debug.spawn drops a unit on the map, which is handy for trying out battles.
const debug = {
  paused: false,
  spawn: (type: UnitType, owner: number, cx: number, cy: number) =>
    spawnUnit(sim.world, type, owner, cx, cy),
  /** Puts up a finished building, ignoring cost and the usual placement rules. */
  build: (type: BuildingType, owner: number, cx: number, cy: number) => {
    const b = addBuilding(sim.world, type, owner, cx, cy);
    b.progress = b.total;
    return b;
  },
  /** Whether the local player could place a building with its corner on this cell. */
  fits: (type: BuildingType, cx: number, cy: number) => checkPlacement(sim.world, LOCAL_PLAYER, type, cx, cy).ok,
};

let last = performance.now();
let acc = 0;

function frame(now: number): void {
  const dt = Math.min(250, now - last);
  last = now;
  acc = debug.paused && !online ? 0 : acc + dt;
  // Online, the room keeps time for everyone. If turns are waiting, this machine is behind,
  // so play them straight away, up to a few seconds' worth in one go, instead of at its own pace.
  if (online) acc = Math.max(acc, Math.min(online.client.backlog * TURN_TICKS, 80) * TICK_MS);
  while (acc >= TICK_MS) {
    if (online) {
      const tick = sim.world.tick;
      // Every machine advances in step. If the next turn has not arrived yet, wait for it.
      if (!online.client.ready(tick)) {
        acc = Math.min(acc, TICK_MS);
        break;
      }
      if (tick % TURN_TICKS === 0) {
        for (const cmd of online.client.take(tick)) issue(cmd);
        online.client.report(tick, () => sim.hash());
      }
    }
    sim.step();
    handleEvents(now);
    acc -= TICK_MS;
  }
  tidyUi();
  input.updateCamera(dt / 1000);
  // Recomputed every frame, since the ground moves under a still mouse
  // whenever the camera scrolls.
  const hover = renderer.screenToGround(ui, ui.mouseX, ui.mouseY);
  ui.hoverX = hover.x;
  ui.hoverZ = hover.z;
  renderer.draw(sim.world, ui, acc / TICK_MS, now);
  updateHud();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Handy for poking at the game from the browser console.
Object.assign(window, { game: { sim, ui, renderer, debug, online } });
