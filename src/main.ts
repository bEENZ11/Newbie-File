import { Input } from './input/input';
import { Renderer } from './render/renderer';
import { Sidebar } from './sidebar';
import { checkPlacement, powerOf } from './sim/production';
import { Sim } from './sim/sim';
import { BUILDING_DEFS, HARVEST_CAPACITY, TICK_RATE } from './sim/types';
import { START_CX, START_CY } from './sim/world';
import { LOCAL_PLAYER, createUi, placementOrigin } from './ui';

const TICK_MS = 1000 / TICK_RATE;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const hintEl = document.getElementById('hint')!;
const dragEl = document.getElementById('dragbox')!;

// The seed is chosen outside the simulation. Add ?seed=123 to replay a layout.
const seedParam = Number(new URLSearchParams(location.search).get('seed'));
const seed = Number.isInteger(seedParam) && seedParam !== 0 ? seedParam : Date.now() & 0x7fffffff;

const sim = new Sim(seed);
const ui = createUi();
const renderer = new Renderer(canvas);
const input = new Input(canvas, sim, ui, renderer);
const sidebar = new Sidebar(document.getElementById('sidebar')!, sim, ui);

function resize(): void {
  renderer.resize(ui);
  input.clampCamera();
}
window.addEventListener('resize', resize);
renderer.resize(ui);
ui.camX = START_CX + 0.5;
ui.camZ = START_CY + 0.5;
input.clampCamera();

function handleEvents(now: number): void {
  for (const ev of sim.events) {
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
  const pioneer = world.units.find((u) => u.type === 'pioneer');
  const yard = world.buildings.find((b) => b.type === 'conyard');
  const prod = player.production;

  if (ui.placing) {
    const { cx, cy } = placementOrigin(ui, ui.placing);
    const check = checkPlacement(world, LOCAL_PLAYER, ui.placing, cx, cy);
    if (ui.mouseInside && !check.inRange) return 'Too far from your base. Build beside one of your buildings';
    return 'Left-click to place. Right-click to put it back';
  }
  if (ui.sellMode) return 'Click a building to sell it for half its cost. Right-click to stop';
  if (pioneer && !yard) {
    return ui.selectedUnits.has(pioneer.id)
      ? 'Right-click to drive. Press D or double-click the Pioneer to deploy'
      : 'Left-click the Pioneer to select it';
  }
  const picked = world.units.find((u) => ui.selectedUnits.has(u.id) && u.type === 'harvester');
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
  return 'Choose a building from the sidebar';
}

function updateHud(): void {
  sidebar.update();

  const hint = currentHint();
  if (hintEl.textContent !== hint) hintEl.textContent = hint;
  document.body.dataset.mode = ui.placing ? 'placing' : ui.sellMode ? 'sell' : 'normal';

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
}

// Set game.debug.paused from the console to freeze the game and step it by hand.
const debug = { paused: false };

let last = performance.now();
let acc = 0;

function frame(now: number): void {
  const dt = Math.min(250, now - last);
  last = now;
  acc = debug.paused ? 0 : acc + dt;
  while (acc >= TICK_MS) {
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
Object.assign(window, { game: { sim, ui, renderer, debug } });
