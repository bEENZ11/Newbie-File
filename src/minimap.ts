// The radar map in the sidebar: the whole battlefield at a glance.

import { SIN_PITCH } from './render/renderer';
import type { Sim } from './sim/sim';
import { MAP_H, MAP_W, ROCK, TREES, WATER, cellIndex } from './sim/types';
import { LOCAL_PLAYER, type UiState } from './ui';

type RGB = [number, number, number];
const GROUND: RGB = [58, 84, 44];
const ORE: RGB = [214, 160, 40];
const GROUND_BY_TYPE: Record<number, RGB> = {
  [ROCK]: [112, 110, 104],
  [WATER]: [44, 92, 140],
  [TREES]: [34, 62, 34],
};
const TEAM: RGB[] = [
  [90, 160, 255],
  [255, 84, 70],
];
const TEAM_BUILDING: RGB[] = [
  [52, 110, 200],
  [190, 52, 44],
];

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
    const r = this.canvas.getBoundingClientRect();
    this.ui.camX = ((e.clientX - r.left) / r.width) * MAP_W;
    this.ui.camZ = ((e.clientY - r.top) / r.height) * MAP_H;
    this.onMove();
  }

  draw(): void {
    // A few times a second is plenty, and keeps it cheap.
    if (this.frame++ % 5 !== 0) return;
    const world = this.sim.world;
    const { visible, explored } = world.vision[LOCAL_PLAYER];
    const data = this.image.data;

    const put = (i: number, c: RGB, shade: number): void => {
      data[i * 4] = c[0] * shade;
      data[i * 4 + 1] = c[1] * shade;
      data[i * 4 + 2] = c[2] * shade;
      data[i * 4 + 3] = 255;
    };

    for (let i = 0; i < MAP_W * MAP_H; i++) {
      if (!explored[i]) put(i, [0, 0, 0], 1);
      else put(i, world.ore[i] > 0 ? ORE : (GROUND_BY_TYPE[world.terrain[i]] ?? GROUND), visible[i] ? 1 : 0.55);
    }
    for (const b of world.buildings) {
      for (let y = b.cy; y < b.cy + b.h; y++) {
        for (let x = b.cx; x < b.cx + b.w; x++) {
          const i = cellIndex(x, y);
          if (b.owner === LOCAL_PLAYER || explored[i]) put(i, TEAM_BUILDING[b.owner % 2], 1);
        }
      }
    }
    for (const u of world.units) {
      if (u.owner === LOCAL_PLAYER || visible[u.cell]) put(u.cell, TEAM[u.owner % 2], 1);
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
