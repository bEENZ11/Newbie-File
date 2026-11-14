import { SIN_PITCH, type Renderer } from '../render/renderer';
import type { Sim } from '../sim/sim';
import { checkPlacement } from '../sim/production';
import { BUILDING_DEFS, MAP_H, MAP_W, SUB, type Unit } from '../sim/types';
import { LOCAL_PLAYER, ZOOM_MAX, ZOOM_MIN, placementOrigin, type UiState } from '../ui';

const DRAG_THRESHOLD = 5;
const EDGE = 14;
/** Camera scroll speed in screen pixels per second. */
const CAMERA_SPEED = 900;
/** How close a click must land to a unit, in cells. */
const UNIT_PICK_RADIUS = 0.75;
/** Roughly the middle of a vehicle's height, used when picking on screen. */
const UNIT_PICK_HEIGHT = 0.4;

/** Turns mouse and keyboard input into selection changes and sim commands. */
export class Input {
  private keys = new Set<string>();
  private dragStart: { x: number; y: number } | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private sim: Sim,
    private ui: UiState,
    private renderer: Renderer,
  ) {
    canvas.addEventListener('mousedown', (e) => this.onDown(e));
    window.addEventListener('mousemove', (e) => this.onMove(e));
    window.addEventListener('mouseup', (e) => this.onUp(e));
    canvas.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    document.addEventListener('mouseleave', () => (ui.mouseInside = false));
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
    let dz = 0;
    if (this.keys.has('ArrowLeft')) dx -= 1;
    if (this.keys.has('ArrowRight')) dx += 1;
    if (this.keys.has('ArrowUp')) dz -= 1;
    if (this.keys.has('ArrowDown')) dz += 1;
    if (ui.mouseInside && !this.dragStart) {
      if (ui.mouseX < EDGE) dx -= 1;
      if (ui.mouseX > ui.viewW - EDGE) dx += 1;
      if (ui.mouseY < EDGE) dz -= 1;
      if (ui.mouseY > ui.viewH - EDGE) dz += 1;
    }
    const cellsPerSecond = CAMERA_SPEED / ui.zoom;
    ui.camX += Math.sign(dx) * cellsPerSecond * dt;
    ui.camZ += Math.sign(dz) * cellsPerSecond * dt;
    this.clampCamera();
  }

  /** Keeps the view inside the map, or centres the map if it is smaller. */
  clampCamera(): void {
    const ui = this.ui;
    const halfW = ui.viewW / ui.zoom / 2;
    // The tilt squashes the ground vertically, so more of it fits on screen.
    const halfD = ui.viewH / ui.zoom / SIN_PITCH / 2;
    ui.camX = halfW * 2 >= MAP_W ? MAP_W / 2 : Math.min(MAP_W - halfW, Math.max(halfW, ui.camX));
    ui.camZ = halfD * 2 >= MAP_H ? MAP_H / 2 : Math.min(MAP_H - halfD, Math.max(halfD, ui.camZ));
  }

  private screenPos(e: MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private unitScreenPos(u: Unit): { x: number; y: number } {
    return this.renderer.worldToScreen(this.ui, u.x / SUB, UNIT_PICK_HEIGHT, u.y / SUB);
  }

  private unitAt(sx: number, sy: number): Unit | null {
    let best: Unit | null = null;
    let bestD = (UNIT_PICK_RADIUS * this.ui.zoom) ** 2;
    for (const u of this.sim.world.units) {
      const p = this.unitScreenPos(u);
      const d = (p.x - sx) ** 2 + (p.y - sy) ** 2;
      if (d <= bestD) {
        best = u;
        bestD = d;
      }
    }
    return best;
  }

  private onDown(e: MouseEvent): void {
    const p = this.screenPos(e);
    const ui = this.ui;
    if (e.button === 2) {
      // Right-click backs out of placing or selling before anything else.
      if (ui.placing || ui.sellMode) {
        ui.placing = null;
        ui.sellMode = false;
      } else {
        this.rightClick(p.x, p.y);
      }
    } else if (e.button === 0) {
      if (ui.placing) this.placeAt(p.x, p.y);
      else if (ui.sellMode) this.sellAt(p.x, p.y);
      else this.dragStart = p;
    }
  }

  private onMove(e: MouseEvent): void {
    const p = this.screenPos(e);
    const ui = this.ui;
    ui.mouseX = p.x;
    ui.mouseY = p.y;
    // Over the sidebar counts as outside, so it neither scrolls nor previews.
    ui.mouseInside = e.target === this.canvas || this.dragStart !== null;
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
      const x0 = Math.min(box.x0, box.x1);
      const x1 = Math.max(box.x0, box.x1);
      const y0 = Math.min(box.y0, box.y1);
      const y1 = Math.max(box.y0, box.y1);
      for (const u of this.sim.world.units) {
        const s = this.unitScreenPos(u);
        if (s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1) ui.selectedUnits.add(u.id);
      }
      if (ui.selectedUnits.size > 0) ui.selectedBuilding = null;
      return;
    }

    const unit = this.unitAt(p.x, p.y);
    if (unit) {
      ui.selectedUnits.add(unit.id);
      ui.selectedBuilding = null;
      return;
    }
    if (ui.selectedUnits.size === 0) {
      ui.selectedBuilding = this.renderer.pickBuilding(ui, p.x, p.y);
    }
  }

  private rightClick(sx: number, sy: number): void {
    const ui = this.ui;
    if (ui.selectedUnits.size === 0) {
      ui.selectedBuilding = null;
      return;
    }
    // Clicking a building's wall or roof counts as clicking the building,
    // which is how a harvester is sent to a refinery.
    const picked = this.renderer.pickBuilding(ui, sx, sy);
    const building = this.sim.world.buildings.find((b) => b.id === picked);
    const hit = this.renderer.screenToGround(ui, sx, sy);
    const cx = building ? building.cx : Math.floor(hit.x);
    const cy = building ? building.cy : Math.floor(hit.z);
    if (cx < 0 || cy < 0 || cx >= MAP_W || cy >= MAP_H) return;
    this.sim.issue({ type: 'move', player: LOCAL_PLAYER, unitIds: [...ui.selectedUnits], cx, cy });
    ui.markers.push({ x: cx + 0.5, z: cy + 0.5, t: performance.now() });
  }

  /** Places the finished building, or flashes red if it cannot go there. */
  private placeAt(sx: number, sy: number): void {
    const ui = this.ui;
    const type = ui.placing;
    if (!type) return;
    const hit = this.renderer.screenToGround(ui, sx, sy);
    ui.hoverX = hit.x;
    ui.hoverZ = hit.z;
    const { cx, cy } = placementOrigin(ui, type);
    if (checkPlacement(this.sim.world, LOCAL_PLAYER, type, cx, cy).ok) {
      this.sim.issue({ type: 'place', player: LOCAL_PLAYER, cx, cy });
    } else {
      const def = BUILDING_DEFS[type];
      ui.flashes.push({ cx, cy, w: def.w, h: def.h, t: performance.now() });
    }
  }

  private sellAt(sx: number, sy: number): void {
    const id = this.renderer.pickBuilding(this.ui, sx, sy);
    const building = this.sim.world.buildings.find((b) => b.id === id);
    if (!building || building.owner !== LOCAL_PLAYER) return;
    this.sim.issue({ type: 'sell', player: LOCAL_PLAYER, buildingId: building.id });
    if (this.ui.selectedBuilding === building.id) this.ui.selectedBuilding = null;
  }

  private onDoubleClick(e: MouseEvent): void {
    const p = this.screenPos(e);
    const unit = this.unitAt(p.x, p.y);
    if (this.ui.placing || this.ui.sellMode) return;
    if (unit?.type === 'pioneer') {
      this.sim.issue({ type: 'deploy', player: LOCAL_PLAYER, unitId: unit.id });
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const ui = this.ui;
    ui.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, ui.zoom * Math.exp(-e.deltaY * 0.0012)));
    this.clampCamera();
  }

  private onKey(e: KeyboardEvent): void {
    this.keys.add(e.key);
    if (e.key.startsWith('Arrow')) e.preventDefault();
    if (e.repeat) return;
    if (e.key === 'Escape') {
      this.ui.selectedUnits.clear();
      this.ui.selectedBuilding = null;
      this.ui.placing = null;
      this.ui.sellMode = false;
    } else if (e.key === 'd' || e.key === 'D') {
      for (const u of this.sim.world.units) {
        if (u.type === 'pioneer' && this.ui.selectedUnits.has(u.id)) {
          this.sim.issue({ type: 'deploy', player: LOCAL_PLAYER, unitId: u.id });
        }
      }
    }
  }
}
