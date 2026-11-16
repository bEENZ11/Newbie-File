// The radar map in the sidebar: the whole battlefield at a glance.

import { SIN_PITCH } from './render/renderer';
import { palettes, rgb } from './render/teams';
import { hasRadar } from './sim/production';
import type { Sim } from './sim/sim';
import { MAP_H, MAP_W, ROCK, TREES, WATER, cellIndex } from './sim/types';
import { LOCAL_PLAYER, type UiState } from './ui';

type RGB = [number, number, number];
const GROUND: RGB = [58, 84, 44];
const SAND: RGB = [176, 150, 98];
const ORE: RGB = [214, 160, 40];
const GEMS: RGB = [70, 220, 205];
const GROUND_BY_TYPE: Record<number, RGB> = {
  [ROCK]: [112, 110, 104],
  [WATER]: [44, 92, 140],
  [TREES]: [34, 62, 34],
};
export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private cells = document.createElement('canvas');
  private cellCtx: CanvasRenderingContext2D;
  private image: ImageData;
  private frame = 0;
  private dragging = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private sim: Sim,
    private ui: UiState,
    private onMove: () => void,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.cells.width = MAP_W;
    this.cells.height = MAP_H;
    this.cellCtx = this.cells.getContext('2d')!;
    this.image = this.cellCtx.createImageData(MAP_W, MAP_H);

    // Click or drag on the map to move the camera there.
    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      this.dragging = true;
      this.jump(e);
    });
    window.addEventListener('mousemove', (e) => this.dragging && this.jump(e));
    window.addEventListener('mouseup', () => (this.dragging = false));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private jump(e: MouseEvent): void {
    if (!hasRadar(this.sim.world, LOCAL_PLAYER)) return;
    const r = this.canvas.getBoundingClientRect();
    this.ui.camX = ((e.clientX - r.left) / r.width) * MAP_W;
    this.ui.camZ = ((e.clientY - r.top) / r.height) * MAP_H;
    this.onMove();
  }

  /** Without a powered Radar Station there is nothing to show. */
  private drawOffline(): void {
    const g = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    g.fillStyle = '#0b0e10';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.05)';
    g.lineWidth = 1;
    for (let i = 0; i < w; i += 16) {
      g.strokeRect(i + 0.5, -1, 16, h + 2);
      g.strokeRect(-1, i + 0.5, w + 2, 16);
    }
    g.textAlign = 'center';
    g.fillStyle = '#93a0aa';
    g.font = '600 13px system-ui, sans-serif';
    g.fillText('RADAR OFFLINE', w / 2, h / 2 - 4);
    g.font = '11px system-ui, sans-serif';
    g.fillText('Needs a powered Radar Station', w / 2, h / 2 + 14);
  }

  draw(): void {
    // A few times a second is plenty, and keeps it cheap.
    if (this.frame++ % 5 !== 0) return;
    const world = this.sim.world;
    if (!hasRadar(world, LOCAL_PLAYER)) {
      this.drawOffline();
      return;
    }
    const { visible, explored } = world.vision[LOCAL_PLAYER];
    const data = this.image.data;

    const put = (i: number, c: RGB, shade: number): void => {
      data[i * 4] = Math.min(255, c[0] * shade);
      data[i * 4 + 1] = Math.min(255, c[1] * shade);
      data[i * 4 + 2] = Math.min(255, c[2] * shade);
      data[i * 4 + 3] = 255;
    };

    for (let i = 0; i < MAP_W * MAP_H; i++) {
      if (!explored[i]) put(i, [0, 0, 0], 1);
      else {
        const ground =
          world.ore[i] > 0
            ? world.rich[i] ? GEMS : ORE
            : (GROUND_BY_TYPE[world.terrain[i]] ?? (world.map === 'desert' ? SAND : GROUND));
        put(i, ground, visible[i] ? 1 : 0.55);
      }
    }
    for (const b of world.buildings) {
      for (let y = b.cy; y < b.cy + b.h; y++) {
        for (let x = b.cx; x < b.cx + b.w; x++) {
          const i = cellIndex(x, y);
          if (b.owner === LOCAL_PLAYER || explored[i]) put(i, rgb(palettes[b.owner % palettes.length].dark), 1.25);
        }
      }
    }
    for (const u of world.units) {
      if (u.owner === LOCAL_PLAYER || visible[u.cell]) put(u.cell, rgb(palettes[u.owner % palettes.length].light), 1);
    }
    this.cellCtx.putImageData(this.image, 0, 0);

    const g = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    g.imageSmoothingEnabled = false;
    g.drawImage(this.cells, 0, 0, w, h);

    // The part of the map currently on screen.
    const ui = this.ui;
    const halfW = ui.viewW / ui.zoom / 2;
    const halfD = ui.viewH / ui.zoom / SIN_PITCH / 2;
    // Its four corners on the ground, which form a tilted box when the view is turned.
    const rx = Math.cos(ui.yaw);
    const rz = -Math.sin(ui.yaw);
    const fx = Math.sin(ui.yaw);
    const fz = Math.cos(ui.yaw);
    const corner = (a: number, b: number): [number, number] => [
      ((ui.camX + rx * halfW * a + fx * halfD * b) / MAP_W) * w,
      ((ui.camZ + rz * halfW * a + fz * halfD * b) / MAP_H) * h,
    ];
    g.strokeStyle = '#ffffff';
    g.lineWidth = 1;
    g.beginPath();
    [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)].forEach(([x, y], i) =>
      i === 0 ? g.moveTo(x, y) : g.lineTo(x, y),
    );
    g.closePath();
    g.stroke();
  }
}
