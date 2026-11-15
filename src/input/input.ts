import { SIN_PITCH, type Renderer } from '../render/renderer';
import type { Sim } from '../sim/sim';
import { checkPlacement } from '../sim/production';
import { BUILDING_DEFS, MAP_H, MAP_W, SUB, UNIT_DEFS, type Unit } from '../sim/types';
import { DIAMOND_YAW, LOCAL_PLAYER, ZOOM_MAX, ZOOM_MIN, placementOrigin, type UiState } from '../ui';

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
  private lastGroup = -1;
  private lastGroupAt = 0;

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
    // Scrolling follows the screen, so it has to allow for how the view is turned.
    const sx = Math.sign(dx) * cellsPerSecond * dt;
    const sz = Math.sign(dz) * cellsPerSecond * dt;
    ui.camX += sx * Math.cos(ui.yaw) + sz * Math.sin(ui.yaw);
    ui.camZ += -sx * Math.sin(ui.yaw) + sz * Math.cos(ui.yaw);
    this.clampCamera();
  }

  /** Keeps the view inside the map, or centres the map if it is smaller. */
  clampCamera(): void {
    const ui = this.ui;
    if (ui.yaw !== 0) {
      // Turned views show a diamond of ground, so simply keep the centre on the map.
      ui.camX = Math.min(MAP_W - 1, Math.max(1, ui.camX));
      ui.camZ = Math.min(MAP_H - 1, Math.max(1, ui.camZ));
      return;
    }
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

  /** The unit nearest a screen position, optionally only our own or only the enemy's. */
  private unitAt(sx: number, sy: number, side: 'any' | 'own' | 'enemy' = 'any'): Unit | null {
    let best: Unit | null = null;
    let bestD = (UNIT_PICK_RADIUS * this.ui.zoom) ** 2;
    for (const u of this.sim.world.units) {
      if (side === 'own' && u.owner !== LOCAL_PLAYER) continue;
      if (side === 'enemy' && u.owner === LOCAL_PLAYER) continue;
      // Enemies hidden by the fog cannot be clicked on.
      if (u.owner !== LOCAL_PLAYER && !this.sim.world.vision[LOCAL_PLAYER].visible[u.cell]) continue;
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
      if (ui.placing || ui.sellMode || ui.repairMode) {
        ui.placing = null;
        ui.sellMode = false;
        ui.repairMode = false;
      } else {
        this.rightClick(p.x, p.y);
      }
    } else if (e.button === 0) {
      if (ui.placing) this.placeAt(p.x, p.y);
      else if (ui.sellMode) this.sellAt(p.x, p.y);
      else if (ui.repairMode) this.repairAt(p.x, p.y);
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
      const boxed = this.sim.world.units.filter((u) => {
        const s = this.unitScreenPos(u);
        return u.owner === LOCAL_PLAYER && s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1;
      });
      // A box drawn over an army leaves harvesters and the Pioneer alone, so
      // sweeping up troops never pulls the economy off its work.
      const isSoldier = (u: Unit): boolean => u.type === 'rifleman' || u.type === 'tank';
      const picked = boxed.some(isSoldier) ? boxed.filter(isSoldier) : boxed;
      for (const u of picked) ui.selectedUnits.add(u.id);
      if (ui.selectedUnits.size > 0) ui.selectedBuilding = null;
      return;
    }

    const unit = this.unitAt(p.x, p.y, 'own');
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
      // With a Barracks or War Factory selected, a right-click sets its rally point.
      const producer = this.sim.world.buildings.find(
        (b) =>
          b.id === ui.selectedBuilding &&
          b.owner === LOCAL_PLAYER &&
          (b.type === 'barracks' || b.type === 'factory'),
      );
      const spot = this.renderer.screenToGround(ui, sx, sy);
      const rx = Math.floor(spot.x);
      const ry = Math.floor(spot.z);
      if (producer && rx >= 0 && ry >= 0 && rx < MAP_W && ry < MAP_H) {
        this.sim.issue({ type: 'rally', player: LOCAL_PLAYER, buildingId: producer.id, cx: rx, cy: ry });
        ui.markers.push({ x: rx + 0.5, z: ry + 0.5, t: performance.now() });
      } else {
        ui.selectedBuilding = null;
      }
      return;
    }
    // Clicking a building's wall or roof counts as clicking the building,
    // which is how a harvester is sent to a refinery.
    const picked = this.renderer.pickBuilding(ui, sx, sy);
    const building = this.sim.world.buildings.find((b) => b.id === picked);

    // Engineers walk into a building: to capture an enemy's, or mend a damaged one of ours.
    const engineers = this.sim.world.units.filter(
      (u) => ui.selectedUnits.has(u.id) && u.type === 'engineer',
    );
    const worthEntering =
      building &&
      building.type !== 'wall' &&
      (building.owner !== LOCAL_PLAYER || building.hp < BUILDING_DEFS[building.type].hp);
    if (building && worthEntering && engineers.length > 0) {
      this.sim.issue({
        type: 'capture',
        player: LOCAL_PLAYER,
        unitIds: engineers.map((u) => u.id),
        buildingId: building.id,
      });
      ui.markers.push({ x: building.cx + building.w / 2, z: building.cy + building.h / 2, t: performance.now() });
      if (engineers.length === ui.selectedUnits.size) return;
    }

    // Right-clicking something of the enemy's is an order to attack it.
    const foe = this.unitAt(sx, sy, 'enemy');
    const hostile = foe ?? (building && building.owner !== LOCAL_PLAYER ? building : null);
    const armed = this.sim.world.units.filter(
      (u) => ui.selectedUnits.has(u.id) && UNIT_DEFS[u.type].weapon,
    );
    if (hostile && armed.length > 0) {
      this.sim.issue({
        type: 'attack',
        player: LOCAL_PLAYER,
        unitIds: armed.map((u) => u.id),
        targetId: hostile.id,
      });
      const at = this.renderer.screenToGround(ui, sx, sy);
      ui.markers.push({ x: at.x, z: at.z, t: performance.now(), hostile: true });
      return;
    }
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

  private repairAt(sx: number, sy: number): void {
    const id = this.renderer.pickBuilding(this.ui, sx, sy);
    const building = this.sim.world.buildings.find((b) => b.id === id);
    if (!building || building.owner !== LOCAL_PLAYER) return;
    this.sim.issue({ type: 'repair', player: LOCAL_PLAYER, buildingId: building.id });
  }

  private onDoubleClick(e: MouseEvent): void {
    const p = this.screenPos(e);
    const unit = this.unitAt(p.x, p.y);
    if (this.ui.placing || this.ui.sellMode || this.ui.repairMode) return;
    if (unit?.type === 'pioneer' && unit.owner === LOCAL_PLAYER) {
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
      this.ui.repairMode = false;
    } else if (e.key === 'd' || e.key === 'D') {
      for (const u of this.sim.world.units) {
        if (u.type === 'pioneer' && this.ui.selectedUnits.has(u.id)) {
          this.sim.issue({ type: 'deploy', player: LOCAL_PLAYER, unitId: u.id });
        }
      }
    } else if (e.key === 'v' || e.key === 'V') {
      // Flip between the diamond view and the straight-on view.
      this.ui.yaw = this.ui.yaw === 0 ? DIAMOND_YAW : 0;
      try {
        localStorage.setItem('view', this.ui.yaw === 0 ? 'straight' : 'diamond');
      } catch {
        // Storage can be unavailable in private windows. The choice just won't be remembered.
      }
      this.clampCamera();
    } else if (/^Digit[0-9]$/.test(e.code)) {
      this.controlGroup(Number(e.code.slice(5)), e.ctrlKey || e.metaKey || e.shiftKey);
      e.preventDefault();
    }
  }

  /**
   * Ctrl or Shift with a number saves the selection. The number alone
   * recalls it, and pressing it twice quickly jumps the camera there.
   */
  private controlGroup(n: number, save: boolean): void {
    const ui = this.ui;
    if (save) {
      if (ui.selectedUnits.size > 0) ui.groups.set(n, [...ui.selectedUnits]);
      return;
    }
    const members = (ui.groups.get(n) ?? [])
      .map((id) => this.sim.world.units.find((u) => u.id === id))
      .filter((u): u is Unit => !!u);
    if (members.length === 0) return;
    ui.selectedUnits = new Set(members.map((u) => u.id));
    ui.selectedBuilding = null;
    ui.placing = null;
    ui.sellMode = false;
    ui.repairMode = false;
    const now = performance.now();
    if (this.lastGroup === n && now - this.lastGroupAt < 400) {
      ui.camX = members.reduce((a, u) => a + u.x, 0) / members.length / SUB;
      ui.camZ = members.reduce((a, u) => a + u.y, 0) / members.length / SUB;
      this.clampCamera();
    }
    this.lastGroup = n;
    this.lastGroupAt = now;
  }
}
