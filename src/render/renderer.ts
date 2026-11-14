import * as THREE from 'three';
import { checkPlacement } from '../sim/production';
import { canDeploy, deployFootprint } from '../sim/step';
import {
  BUILDING_DEFS,
  HARVEST_CAPACITY,
  MAP_H,
  MAP_W,
  SUB,
  cellIndex,
  UNIT_DEFS,
  type Building,
  type BuildingType,
  type SimEvent,
  type UnitType,
  type World,
} from '../sim/types';
import { LOCAL_PLAYER, placementOrigin, type UiState } from '../ui';
import { rallyPoint } from '../sim/training';
import { Effects } from './effects';
import { HealthBars } from './healthbars';
import { frameGeometry, makeBuilding, makeGhost, makeRallyFlag, makeUnit } from './models';

// The view is 3D with a fixed camera: looking north, tilted down at the ground.
// One cell is one world unit, x runs east and z runs south.
const PITCH = (44 * Math.PI) / 180;
export const SIN_PITCH = Math.sin(PITCH);
const COS_PITCH = Math.cos(PITCH);
const CAMERA_DISTANCE = 120;

const MARKER_MS = 450;
const FLASH_MS = 600;
const TURN_RATE = 9;
const TERRAIN_TEXELS = 32;

/** Cheap repeatable noise so terrain and ore look the same every time. */
function noise(x: number, y: number, salt: number): number {
  let h = Math.imul(x * 374761393 + y * 668265263 + salt * 2246822519, 3266489917);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

/** True if any cell under a building is set in the given vision layer. */
function footprintSeen(layer: Uint8Array, b: Building): boolean {
  for (let y = b.cy; y < b.cy + b.h; y++) {
    for (let x = b.cx; x < b.cx + b.w; x++) if (layer[cellIndex(x, y)]) return true;
  }
  return false;
}

/** Selection ring size for each kind of unit, as a share of the largest. */
const RING_SIZE: Record<UnitType, number> = { pioneer: 0.85, harvester: 0.62, tank: 0.52, rifleman: 0.28 };

/** How many nuggets to draw on a cell, so a field visibly thins as it is mined. */
function oreNuggets(amount: number): number {
  return amount <= 0 ? 0 : 1 + Math.min(5, Math.floor(amount / 170));
}

interface UnitView {
  obj: THREE.Group;
  ring: THREE.Mesh;
  angle: number;
  cargo: THREE.Object3D | null;
  drum: THREE.Object3D | null;
}

interface BuildingView {
  obj: THREE.Group;
  stages: THREE.Object3D[];
  arm: THREE.Object3D | null;
  frame: THREE.Mesh;
}

export class Renderer {
  private gl: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  private sun = new THREE.DirectionalLight(0xfff0d6, 3.1);
  private raycaster = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private tmp = new THREE.Vector3();
  private ndc = new THREE.Vector2();

  private unitViews = new Map<number, UnitView>();
  private buildingViews = new Map<number, BuildingView>();
  private oreMesh: THREE.InstancedMesh | null = null;
  private oreSeen = new Int32Array(MAP_W * MAP_H);
  private oreDrawn = false;

  private ringGeo = new THREE.RingGeometry(1.08, 1.14, 56).rotateX(-Math.PI / 2);
  private overlayMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false });
  /** Building outlines sit on the ground, so walls in front hide them. */
  private frameMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  private preview: THREE.Mesh;
  private previewFrame: THREE.Mesh;
  private flashPool: THREE.Mesh[] = [];
  /** One tile per footprint cell while placing, green or red. */
  private ghostCells: THREE.Mesh[] = [];
  private ghosts = new Map<BuildingType, THREE.Group>();
  private rallyFlag = makeRallyFlag();
  private markerPool: THREE.Mesh[] = [];
  private lastDraw = 0;
  private fogData = new Uint8Array(MAP_W * MAP_H * 4);
  private fogTexture!: THREE.DataTexture;
  private fogTick = -1;
  private effects = new Effects(this.scene);
  private healthBars = new HealthBars(this.scene);

  constructor(private canvas: HTMLCanvasElement) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.background = new THREE.Color(0x0e1012);

    this.scene.add(new THREE.HemisphereLight(0xdfeaff, 0x3d3a2c, 0.95));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -34;
    sc.right = 34;
    sc.top = 34;
    sc.bottom = -34;
    sc.near = 1;
    sc.far = 120;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);

    this.scene.add(this.makeTerrain());

    // Fog of war: one texel per cell, drawn over everything on the ground.
    this.fogTexture = new THREE.DataTexture(this.fogData, MAP_W, MAP_H, THREE.RGBAFormat);
    this.fogTexture.magFilter = THREE.LinearFilter;
    this.fogTexture.minFilter = THREE.LinearFilter;
    const fog = new THREE.Mesh(
      new THREE.PlaneGeometry(MAP_W, MAP_H).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: this.fogTexture, transparent: true, depthTest: false, depthWrite: false }),
    );
    fog.position.set(MAP_W / 2, 0.02, MAP_H / 2);
    fog.renderOrder = 3;
    this.scene.add(fog);

    const flat = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.preview = new THREE.Mesh(
      flat,
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.16, depthWrite: false }),
    );
    this.previewFrame = new THREE.Mesh(
      frameGeometry(1, 1, 0.03),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false }),
    );
    this.preview.visible = this.previewFrame.visible = false;
    this.scene.add(this.preview, this.previewFrame);

    this.rallyFlag.visible = false;
    this.scene.add(this.rallyFlag);

    const tile = new THREE.PlaneGeometry(0.92, 0.92).rotateX(-Math.PI / 2);
    for (let i = 0; i < 10; i++) {
      const cell = new THREE.Mesh(
        tile,
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false }),
      );
      cell.visible = false;
      this.ghostCells.push(cell);
      this.scene.add(cell);
    }

    for (let i = 0; i < 4; i++) {
      const flash = new THREE.Mesh(
        flat,
        new THREE.MeshBasicMaterial({ color: 0xe8423a, transparent: true, depthWrite: false }),
      );
      const marker = new THREE.Mesh(
        new THREE.RingGeometry(0.82, 1, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0x7dff8e, transparent: true, depthTest: false }),
      );
      flash.visible = marker.visible = false;
      // Above the fog, so an order into the unknown still shows where it went.
      marker.renderOrder = 4;
      this.flashPool.push(flash);
      this.markerPool.push(marker);
      this.scene.add(flash, marker);
    }
  }

  resize(ui: UiState): void {
    ui.viewW = this.canvas.clientWidth;
    ui.viewH = this.canvas.clientHeight;
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.gl.setSize(ui.viewW, ui.viewH, false);
  }

  private makeTerrain(): THREE.Mesh {
    const c = document.createElement('canvas');
    c.width = MAP_W * TERRAIN_TEXELS;
    c.height = MAP_H * TERRAIN_TEXELS;
    const g = c.getContext('2d')!;
    const t = TERRAIN_TEXELS;
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const light = 31 + noise(x, y, 1) * 1.1;
        const hue = 92 + noise(x, y, 2) * 4;
        g.fillStyle = `hsl(${hue} 30% ${light}%)`;
        g.fillRect(x * t, y * t, t, t);
        for (let i = 0; i < 9; i++) {
          g.fillStyle = noise(x, y, 10 + i) > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.09)';
          const sx = x * t + Math.floor(noise(x, y, 20 + i) * (t - 2));
          const sy = y * t + Math.floor(noise(x, y, 30 + i) * (t - 2));
          g.fillRect(sx, sy, 2 + (i % 2), 1 + (i % 3 === 0 ? 1 : 0));
        }
      }
    }
    g.fillStyle = 'rgba(0,0,0,0.055)';
    for (let i = 0; i <= MAP_W; i++) g.fillRect(i * t, 0, 1, c.height);
    for (let i = 0; i <= MAP_H; i++) g.fillRect(0, i * t, c.width, 1);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.gl.capabilities.getMaxAnisotropy();
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(MAP_W, MAP_H).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ map: tex }),
    );
    mesh.position.set(MAP_W / 2, 0, MAP_H / 2);
    mesh.receiveShadow = true;
    return mesh;
  }

  private applyCamera(ui: UiState): void {
    const cam = this.camera;
    cam.left = -ui.viewW / ui.zoom / 2;
    cam.right = ui.viewW / ui.zoom / 2;
    cam.top = ui.viewH / ui.zoom / 2;
    cam.bottom = -ui.viewH / ui.zoom / 2;
    cam.position.set(
      ui.camX,
      SIN_PITCH * CAMERA_DISTANCE,
      ui.camZ + COS_PITCH * CAMERA_DISTANCE,
    );
    cam.lookAt(ui.camX, 0, ui.camZ);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  /** The point on the ground under a screen position, in cells. */
  screenToGround(ui: UiState, sx: number, sy: number): { x: number; z: number } {
    this.applyCamera(ui);
    this.ndc.set((sx / ui.viewW) * 2 - 1, -((sy / ui.viewH) * 2 - 1));
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.ground, this.tmp);
    return hit ? { x: hit.x, z: hit.z } : { x: -1, z: -1 };
  }

  /** Where a world position lands on screen, in pixels. */
  worldToScreen(ui: UiState, x: number, y: number, z: number): { x: number; y: number } {
    this.applyCamera(ui);
    this.tmp.set(x, y, z).project(this.camera);
    return { x: ((this.tmp.x + 1) / 2) * ui.viewW, y: ((1 - this.tmp.y) / 2) * ui.viewH };
  }

  /** The building under a screen position, including its walls and roof. */
  pickBuilding(ui: UiState, sx: number, sy: number): number | null {
    this.applyCamera(ui);
    this.ndc.set((sx / ui.viewW) * 2 - 1, -((sy / ui.viewH) * 2 - 1));
    this.raycaster.setFromCamera(this.ndc, this.camera);
    let best: number | null = null;
    let bestDist = Infinity;
    for (const [id, view] of this.buildingViews) {
      if (!view.obj.visible) continue;
      const hit = this.raycaster.intersectObject(view.obj, true)[0];
      if (hit && hit.distance < bestDist) {
        best = id;
        bestDist = hit.distance;
      }
    }
    return best;
  }

  draw(world: World, ui: UiState, alpha: number, now: number): void {
    const dt = Math.min(0.1, (now - this.lastDraw) / 1000);
    this.lastDraw = now;

    this.applyCamera(ui);
    this.sun.position.set(ui.camX - 24, 30, ui.camZ + 20);
    this.sun.target.position.set(ui.camX, 0, ui.camZ);
    this.sun.target.updateMatrixWorld();

    this.syncFog(world);
    this.syncOre(world);
    this.syncUnits(world, ui, alpha, dt);
    this.syncBuildings(world, ui, now);
    this.syncOverlays(world, ui, now);
    this.syncHealth(world, ui, alpha);
    this.effects.update(now);

    this.gl.render(this.scene, this.camera);
  }

  private syncOre(world: World): void {
    let changed = !this.oreDrawn;
    for (let i = 0; i < world.ore.length && !changed; i++) {
      if (oreNuggets(world.ore[i]) !== this.oreSeen[i]) changed = true;
    }
    if (!changed) return;
    for (let i = 0; i < world.ore.length; i++) this.oreSeen[i] = oreNuggets(world.ore[i]);
    this.oreDrawn = true;

    if (this.oreMesh) {
      this.scene.remove(this.oreMesh);
      this.oreMesh.dispose();
    }
    const spots: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const count = oreNuggets(world.ore[cellIndex(x, y)]);
        for (let i = 0; i < count; i++) {
          const s = 0.09 + noise(x, y, 60 + i) * 0.08;
          e.set(noise(x, y, 70 + i) * 0.8, noise(x, y, 80 + i) * 6.28, noise(x, y, 90 + i) * 0.8);
          spots.push(
            new THREE.Matrix4().compose(
              new THREE.Vector3(
                x + 0.15 + noise(x, y, 40 + i) * 0.7,
                s * 0.7,
                y + 0.15 + noise(x, y, 50 + i) * 0.7,
              ),
              q.setFromEuler(e),
              new THREE.Vector3(s, s * 1.5, s),
            ),
          );
        }
      }
    }
    const material = new THREE.MeshLambertMaterial({
      color: 0xf0b429,
      emissive: 0x6b4500,
      flatShading: true,
    });
    this.oreMesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1), material, spots.length);
    spots.forEach((m, i) => this.oreMesh!.setMatrixAt(i, m));
    this.oreMesh.castShadow = true;
    this.oreMesh.receiveShadow = true;
    this.scene.add(this.oreMesh);
  }

  private syncUnits(world: World, ui: UiState, alpha: number, dt: number): void {
    const vision = world.vision[LOCAL_PLAYER];
    const alive = new Set<number>();
    for (const u of world.units) {
      alive.add(u.id);
      // Facing 0 is east, then clockwise as seen from above.
      const target = (-u.facing * Math.PI) / 4;
      let view = this.unitViews.get(u.id);
      if (!view) {
        const obj = makeUnit(u.type, u.owner);
        let cargo: THREE.Object3D | null = null;
        let drum: THREE.Object3D | null = null;
        obj.traverse((o) => {
          if (o.userData.cargo) cargo = o;
          if (o.userData.drum) drum = o;
        });
        const ring = new THREE.Mesh(this.ringGeo, this.overlayMat);
        ring.position.y = 0.04;
        ring.scale.setScalar(RING_SIZE[u.type] / obj.scale.x);
        ring.renderOrder = 2;
        obj.add(ring);
        this.scene.add(obj);
        view = { obj, ring, angle: target, cargo, drum };
        this.unitViews.set(u.id, view);
      }
      // Turn smoothly towards the new heading, taking the short way round.
      let diff = target - view.angle;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      const turn = TURN_RATE * dt;
      view.angle += Math.abs(diff) <= turn ? diff : Math.sign(diff) * turn;
      view.obj.rotation.y = view.angle;
      // Enemy units only show while one of ours can see them.
      view.obj.visible = u.owner === LOCAL_PLAYER || vision.visible[u.cell] === 1;
      view.obj.position.set(
        (u.prevX + (u.x - u.prevX) * alpha) / SUB,
        0,
        (u.prevY + (u.y - u.prevY) * alpha) / SUB,
      );
      view.ring.visible = ui.selectedUnits.has(u.id);
      if (view.cargo) {
        // The heap in the hopper rises as the harvester fills up.
        view.cargo.visible = u.cargo > 0;
        view.cargo.scale.y = Math.max(0.02, u.cargo / HARVEST_CAPACITY);
      }
      if (view.drum && u.job === 'harvest') view.drum.rotation.y += dt * 9;
    }
    for (const [id, view] of this.unitViews) {
      if (alive.has(id)) continue;
      this.scene.remove(view.obj);
      this.unitViews.delete(id);
    }
  }

  private syncBuildings(world: World, ui: UiState, now: number): void {
    const vision = world.vision[LOCAL_PLAYER];
    const alive = new Set<number>();
    for (const b of world.buildings) {
      alive.add(b.id);
      let view = this.buildingViews.get(b.id);
      if (!view) {
        const obj = makeBuilding(b.type, b.owner);
        obj.position.set(b.cx + b.w / 2, 0, b.cy + b.h / 2);
        const stages: THREE.Object3D[] = [];
        let arm: THREE.Object3D | null = null;
        obj.traverse((o) => {
          if (typeof o.userData.stage === 'number') stages[o.userData.stage] = o;
          if (o.userData.arm) arm = o;
        });
        const frame = new THREE.Mesh(frameGeometry(b.w + 0.1, b.h + 0.1, 0.06), this.frameMat);
        frame.position.y = 0.03;
        obj.add(frame);
        this.scene.add(obj);
        view = { obj, stages, arm, frame };
        this.buildingViews.set(b.id, view);
      }
      // Build-up: each part rises out of the ground in turn.
      const p = b.progress / b.total;
      const n = view.stages.length;
      view.stages.forEach((stage, i) => {
        const t = Math.min(1, Math.max(0, (p * (n + 1) - i) / 2));
        const eased = 1 - (1 - t) * (1 - t);
        stage.visible = t > 0;
        stage.scale.y = Math.max(0.001, eased);
      });
      if (view.arm && p >= 1) view.arm.rotation.y = Math.sin(now * 0.0005 + b.id) * 1.1 - 0.5;
      view.frame.visible = ui.selectedBuilding === b.id;
      // Enemy buildings stay on the map once they have been discovered.
      view.obj.visible = b.owner === LOCAL_PLAYER || footprintSeen(vision.explored, b);
    }
    for (const [id, view] of this.buildingViews) {
      if (alive.has(id)) continue;
      this.scene.remove(view.obj);
      this.buildingViews.delete(id);
    }
  }

  /** Repaints the fog whenever the simulation has refreshed what we can see. */
  private syncFog(world: World): void {
    if (world.tick === this.fogTick) return;
    this.fogTick = world.tick;
    const { visible, explored } = world.vision[LOCAL_PLAYER];
    const d = this.fogData;
    for (let y = 0; y < MAP_H; y++) {
      // The texture's first row is the south edge of the map.
      const row = (MAP_H - 1 - y) * MAP_W;
      for (let x = 0; x < MAP_W; x++) {
        const i = cellIndex(x, y);
        // Black where nothing has been seen, dimmed where it was seen earlier.
        d[(row + x) * 4 + 3] = visible[i] ? 0 : explored[i] ? 120 : 255;
      }
    }
    this.fogTexture.needsUpdate = true;
  }

  /** Passes a simulation event on to the battle effects. */
  onEvent(ev: SimEvent, now: number): void {
    this.effects.onEvent(ev, now);
  }

  /** Health bars for anything selected or damaged. */
  private syncHealth(world: World, ui: UiState, alpha: number): void {
    const vision = world.vision[LOCAL_PLAYER];
    this.healthBars.begin();
    for (const u of world.units) {
      const max = UNIT_DEFS[u.type].hp;
      if (u.hp >= max && !ui.selectedUnits.has(u.id)) continue;
      if (u.owner !== LOCAL_PLAYER && !vision.visible[u.cell]) continue;
      const size = RING_SIZE[u.type];
      this.healthBars.show(
        u.id,
        (u.prevX + (u.x - u.prevX) * alpha) / SUB,
        0.7 + size * 0.9,
        (u.prevY + (u.y - u.prevY) * alpha) / SUB,
        u.hp / max,
        0.4 + size * 0.9,
        this.camera,
      );
    }
    for (const b of world.buildings) {
      const max = BUILDING_DEFS[b.type].hp;
      if (b.hp >= max && ui.selectedBuilding !== b.id) continue;
      if (b.owner !== LOCAL_PLAYER && !footprintSeen(vision.visible, b)) continue;
      this.healthBars.show(b.id, b.cx + b.w / 2, 2.5, b.cy + b.h / 2, b.hp / max, b.w * 0.8, this.camera);
    }
    this.healthBars.end();
  }

  /** The see-through building and coloured footprint that follow the mouse. */
  private syncPlacement(world: World, ui: UiState): void {
    for (const ghost of this.ghosts.values()) ghost.visible = false;
    for (const cell of this.ghostCells) cell.visible = false;
    const type = ui.placing;
    if (!type || !ui.mouseInside) return;

    const def = BUILDING_DEFS[type];
    const { cx, cy } = placementOrigin(ui, type);
    const check = checkPlacement(world, LOCAL_PLAYER, type, cx, cy);
    check.cells.forEach((c, i) => {
      const mesh = this.ghostCells[i];
      if (!mesh) return;
      mesh.visible = true;
      mesh.position.set(c.x + 0.5, 0.03, c.y + 0.5);
      // Out of range of the base turns the whole footprint red.
      const good = c.ok && check.inRange;
      (mesh.material as THREE.MeshBasicMaterial).color.setHex(good ? 0x58e070 : 0xf04a40);
    });

    let ghost = this.ghosts.get(type);
    if (!ghost) {
      ghost = makeGhost(type);
      this.ghosts.set(type, ghost);
      this.scene.add(ghost);
    }
    ghost.visible = true;
    ghost.position.set(cx + def.w / 2, 0, cy + def.h / 2);
  }

  private syncOverlays(world: World, ui: UiState, now: number): void {
    // Footprint preview for a selected, stationary Pioneer.
    const pioneer = world.units.find(
      (u) => u.type === 'pioneer' && ui.selectedUnits.has(u.id) && u.path.length === 0,
    );
    this.preview.visible = this.previewFrame.visible = !!pioneer;
    if (pioneer) {
      const f = deployFootprint(pioneer);
      const colour = canDeploy(world, pioneer) ? 0x7dff8e : 0xff5a50;
      for (const mesh of [this.preview, this.previewFrame]) {
        mesh.position.set(f.cx + f.w / 2, 0.02, f.cy + f.h / 2);
        mesh.scale.set(f.w, 1, f.h);
        (mesh.material as THREE.MeshBasicMaterial).color.setHex(colour);
      }
    }

    this.syncPlacement(world, ui);

    // A flag shows where the selected Barracks or War Factory sends its units.
    const producer = world.buildings.find(
      (b) => b.id === ui.selectedBuilding && (b.type === 'barracks' || b.type === 'factory'),
    );
    this.rallyFlag.visible = !!producer;
    if (producer) {
      const r = rallyPoint(producer);
      this.rallyFlag.position.set(r.x + 0.5, 0, r.y + 0.5);
    }

    ui.flashes = ui.flashes.filter((f) => now - f.t < FLASH_MS);
    this.flashPool.forEach((mesh, i) => {
      const f = ui.flashes[i];
      mesh.visible = !!f;
      if (!f) return;
      const fade = 1 - (now - f.t) / FLASH_MS;
      const on = Math.floor((now - f.t) / 100) % 2 === 0;
      mesh.position.set(f.cx + f.w / 2, 0.03, f.cy + f.h / 2);
      mesh.scale.set(f.w, 1, f.h);
      (mesh.material as THREE.MeshBasicMaterial).opacity = (on ? 0.6 : 0.25) * fade;
    });

    ui.markers = ui.markers.filter((m) => now - m.t < MARKER_MS);
    this.markerPool.forEach((mesh, i) => {
      const m = ui.markers[ui.markers.length - 1 - i];
      mesh.visible = !!m;
      if (!m) return;
      const p = (now - m.t) / MARKER_MS;
      const r = 0.15 + (1 - p) * 0.4;
      mesh.position.set(m.x, 0.04, m.z);
      mesh.scale.set(r, 1, r);
      (mesh.material as THREE.MeshBasicMaterial).color.setHex(m.hostile ? 0xff5a50 : 0x7dff8e);
      (mesh.material as THREE.MeshBasicMaterial).opacity = 1 - p;
    });
  }
}
