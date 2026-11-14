import { CELL, MAP_PX_H, MAP_PX_W } from '../render/renderer';
import type { Sim } from '../sim/sim';
import { MAP_H, MAP_W, SUB, type Building, type Unit } from '../sim/types';
import type { UiState } from '../ui';

const DRAG_THRESHOLD = 5;
const EDGE = 14;
const CAMERA_SPEED = 900;
const UNIT_PICK_RADIUS = 26;
const TO_PX = CELL / SUB;

/** Turns mouse and keyboard input into selection changes and sim commands. */
export class Input {
  private keys = new Set<string>();
  private dragStart: { x: number; y: number } | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private sim: Sim,
    private ui: UiState,
  ) {
    canvas.addEventListener('mousedown', (e) => this.onDown(e));
    window.addEventListener('mousemove', (e) => this.onMove(e));
    window.addEventListener('mouseup', (e) => this.onUp(e));
    canvas.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mouseleave', () => (ui.mouseInside = false));
    document.addEventListener('mouseenter', () => (ui.mouseInside = true));
    window.addEventListener('blur', () => {
      this.keys.clear();
      ui.mouseInside = false;
    });
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.key));
  }

  /** Scrolls the camera from the arrow keys and the screen edges. */
  updateCamera(dt: number): void {
    const ui = this.ui;
    let dx = 0;
    let dy = 0;
    if (this.keys.has('ArrowLeft')) dx -= 1;
    if (this.keys.has('ArrowRight')) dx += 1;
    if (this.keys.has('ArrowUp')) dy -= 1;
    if (this.keys.has('ArrowDown')) dy += 1;
    if (ui.mouseInside && !this.dragStart) {
      if (ui.mouseX < EDGE) dx -= 1;
      if (ui.mouseX > ui.viewW - EDGE) dx += 1;
      if (ui.mouseY < EDGE) dy -= 1;
      if (ui.mouseY > ui.viewH - EDGE) dy += 1;
    }
    ui.camX += Math.sign(dx) * CAMERA_SPEED * dt;
    ui.camY += Math.sign(dy) * CAMERA_SPEED * dt;
    this.clampCamera();
  }

  clampCamera(): void {
    const ui = this.ui;
    // If the view is larger than the map, centre the map instead.
    ui.camX =
      ui.viewW >= MAP_PX_W
        ? (MAP_PX_W - ui.viewW) / 2
        : Math.min(MAP_PX_W - ui.viewW, Math.max(0, ui.camX));
    ui.camY =
      ui.viewH >= MAP_PX_H
        ? (MAP_PX_H - ui.viewH) / 2
        : Math.min(MAP_PX_H - ui.viewH, Math.max(0, ui.camY));
  }

  private screenPos(e: MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private unitAt(wx: number, wy: number): Unit | null {
    let best: Unit | null = null;
    let bestD = UNIT_PICK_RADIUS * UNIT_PICK_RADIUS;
    for (const u of this.sim.world.units) {
      const dx = u.x * TO_PX - wx;
      const dy = u.y * TO_PX - wy;
      const d = dx * dx + dy * dy;
      if (d <= bestD) {
        best = u;
        bestD = d;
      }
    }
    return best;
  }

  private buildingAt(wx: number, wy: number): Building | null {
    const cx = Math.floor(wx / CELL);
    const cy = Math.floor(wy / CELL);
    return (
      this.sim.world.buildings.find(
        (b) => cx >= b.cx && cy >= b.cy && cx < b.cx + b.w && cy < b.cy + b.h,
      ) ?? null
    );
  }

  private onDown(e: MouseEvent): void {
    const p = this.screenPos(e);
    if (e.button === 0) {
      this.dragStart = p;
    } else if (e.button === 2) {
      this.rightClick(p.x + this.ui.camX, p.y + this.ui.camY);
    }
  }

  private onMove(e: MouseEvent): void {
    const p = this.screenPos(e);
    const ui = this.ui;
    ui.mouseX = p.x;
    ui.mouseY = p.y;
    ui.mouseInside = true;
    if (!this.dragStart) return;
    const moved = Math.abs(p.x - this.dragStart.x) + Math.abs(p.y - this.dragStart.y);
    if (ui.dragBox || moved > DRAG_THRESHOLD) {
      ui.dragBox = { x0: this.dragStart.x, y0: this.dragStart.y, x1: p.x, y1: p.y };
    }
  }

  private onUp(e: MouseEvent): void {
    if (e.button !== 0 || !this.dragStart) return;
    const ui = this.ui;
    const p = this.screenPos(e);
    const box = ui.dragBox;
    this.dragStart = null;
    ui.dragBox = null;
    if (!e.shiftKey) {
      ui.selectedUnits.clear();
      ui.selectedBuilding = null;
    }

    if (box) {
      const x0 = Math.min(box.x0, box.x1) + ui.camX;
      const x1 = Math.max(box.x0, box.x1) + ui.camX;
      const y0 = Math.min(box.y0, box.y1) + ui.camY;
      const y1 = Math.max(box.y0, box.y1) + ui.camY;
      for (const u of this.sim.world.units) {
        const ux = u.x * TO_PX;
        const uy = u.y * TO_PX;
        if (ux >= x0 && ux <= x1 && uy >= y0 && uy <= y1) ui.selectedUnits.add(u.id);
      }
      if (ui.selectedUnits.size > 0) ui.selectedBuilding = null;
      return;
    }

    const wx = p.x + ui.camX;
    const wy = p.y + ui.camY;
    const unit = this.unitAt(wx, wy);
    if (unit) {
      ui.selectedUnits.add(unit.id);
      ui.selectedBuilding = null;
      return;
    }
    const building = this.buildingAt(wx, wy);
    if (building && ui.selectedUnits.size === 0) ui.selectedBuilding = building.id;
  }

  private rightClick(wx: number, wy: number): void {
    const ui = this.ui;
    if (ui.selectedUnits.size === 0) {
      ui.selectedBuilding = null;
      return;
    }
    const cx = Math.floor(wx / CELL);
    const cy = Math.floor(wy / CELL);
    if (cx < 0 || cy < 0 || cx >= MAP_W || cy >= MAP_H) return;
    this.sim.issue({ type: 'move', unitIds: [...ui.selectedUnits], cx, cy });
    ui.markers.push({ x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2, t: performance.now() });
  }

  private onDoubleClick(e: MouseEvent): void {
    const p = this.screenPos(e);
    const unit = this.unitAt(p.x + this.ui.camX, p.y + this.ui.camY);
    if (unit?.type === 'pioneer') this.sim.issue({ type: 'deploy', unitId: unit.id });
  }

  private onKey(e: KeyboardEvent): void {
    this.keys.add(e.key);
    if (e.key.startsWith('Arrow')) e.preventDefault();
    if (e.repeat) return;
    if (e.key === 'Escape') {
      this.ui.selectedUnits.clear();
      this.ui.selectedBuilding = null;
    } else if (e.key === 'd' || e.key === 'D') {
      for (const u of this.sim.world.units) {
        if (u.type === 'pioneer' && this.ui.selectedUnits.has(u.id)) {
          this.sim.issue({ type: 'deploy', unitId: u.id });
        }
      }
    }
  }
}
