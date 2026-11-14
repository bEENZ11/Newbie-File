import { Input } from './input/input';
import { Renderer } from './render/renderer';
import { Sim } from './sim/sim';
import { BUILDING_DEFS, TICK_RATE } from './sim/types';
import { START_CX, START_CY } from './sim/world';
import { createUi } from './ui';

const TICK_MS = 1000 / TICK_RATE;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const creditsEl = document.getElementById('credits')!;
const hintEl = document.getElementById('hint')!;
const dragEl = document.getElementById('dragbox')!;

// The seed is chosen outside the simulation. Add ?seed=123 to replay a layout.
const seedParam = Number(new URLSearchParams(location.search).get('seed'));
const seed = Number.isInteger(seedParam) && seedParam !== 0 ? seedParam : Date.now() & 0x7fffffff;

const sim = new Sim(seed);
const ui = createUi();
const renderer = new Renderer(canvas);
const input = new Input(canvas, sim, ui, renderer);

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
    }
  }
}

function updateHud(): void {
  const world = sim.world;
  creditsEl.textContent = world.credits.toLocaleString('en-GB');
  const pioneer = world.units.find((u) => u.type === 'pioneer');
  const yard = world.buildings.find((b) => b.type === 'conyard');
  let hint: string;
  if (pioneer && !ui.selectedUnits.has(pioneer.id)) {
    hint = 'Left-click the Pioneer to select it';
  } else if (pioneer) {
    hint = 'Right-click to drive. Press D or double-click the Pioneer to deploy';
  } else if (yard && yard.progress < yard.total) {
    hint = `${BUILDING_DEFS.conyard.name} deploying`;
  } else {
    hint = `${BUILDING_DEFS.conyard.name} ready. Building comes in the next stage`;
  }
  if (hintEl.textContent !== hint) hintEl.textContent = hint;

  const box = ui.dragBox;
  dragEl.style.display = box ? 'block' : 'none';
  if (box) {
    dragEl.style.left = `${Math.min(box.x0, box.x1)}px`;
    dragEl.style.top = `${Math.min(box.y0, box.y1)}px`;
    dragEl.style.width = `${Math.abs(box.x1 - box.x0)}px`;
    dragEl.style.height = `${Math.abs(box.y1 - box.y0)}px`;
  }
}

let last = performance.now();
let acc = 0;

function frame(now: number): void {
  const dt = Math.min(250, now - last);
  last = now;
  acc += dt;
  while (acc >= TICK_MS) {
    sim.step();
    handleEvents(now);
    acc -= TICK_MS;
  }
  input.updateCamera(dt / 1000);
  renderer.draw(sim.world, ui, acc / TICK_MS, now);
  updateHud();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Handy for poking at the game from the browser console.
Object.assign(window, { game: { sim, ui, renderer } });
