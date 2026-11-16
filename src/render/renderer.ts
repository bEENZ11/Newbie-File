import * as THREE from 'three';
import { checkPlacement } from '../sim/production';
import { canDeploy, deployFootprint } from '../sim/step';
import {
  BUILDING_DEFS,
  HARVEST_CAPACITY,
  MAP_H,
  ROCK,
  TREES,
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
import { asset, sizeOf } from './assets';
import { Effects } from './effects';
import { paintGround } from './ground';
import { HealthBars } from './healthbars';
import { SIGNATURE, frameGeometry, makeBuilding, makeGhost, makeLabel, makeRallyFlag, makeUnit } from './models';
import { GEM_CELL, ORE_CELL } from '../sim/world';

// The view is 3D with a fixed camera: looking north, tilted down at the ground.
// One cell is one world unit, x runs east and z runs south.
const PITCH = (44 * Math.PI) / 180;
export const SIN_PITCH = Math.sin(PITCH);
const COS_PITCH = Math.cos(PITCH);
const CAMERA_DISTANCE = 120;

const MARKER_MS = 450;
const FLASH_MS = 600;
const TURN_RATE = 9;
const TERRAIN_TEXELS = 12;
/** The most nuggets ever drawn on one cell. */
const MAX_NUGGETS = 6;

/** Cheap repeatable noise so terrain and ore look the same every time. */
function noise(x: number, y: number, salt: number): number {
  let h = Math.imul(x * 374761393 + y * 668265263 + salt * 2246822519, 3266489917);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

/** Where each building gives off smoke or steam: offset from its centre, puff size and colour. */
const CHIMNEYS: Record<BuildingType, [number, number, number, number, number][]> = {
  conyard: [[-0.95, 2.0, -0.9, 0.13, 0x555555]],
  power: [
    [0.45, 1.2, -0.42, 0.2, 0xe8eef2],
    [0.45, 1.2, 0.42, 0.2, 0xe8eef2],
  ],
  refinery: [[-1.05, 2.65, -1.0, 0.17, 0x3a3a3a]],
  barracks: [],
  factory: [
    [0.9, 1.8, -1.0, 0.12, 0x555555],
    [0.5, 1.8, -1.0, 0.12, 0x555555],
  ],
  turret: [],
  radar: [],
  tech: [[0.5, 1.0, 0.62, 0.1, 0xdfe6ea]],
  depot: [],
  wall: [],
};

/** True if any cell under a building is set in the given vision layer. */
function footprintSeen(layer: Uint8Array, b: Building): boolean {
  for (let y = b.cy; y < b.cy + b.h; y++) {
    for (let x = b.cx; x < b.cx + b.w; x++) if (layer[cellIndex(x, y)]) return true;
  }
  return false;
}

/** Selection ring size for each kind of unit, as a share of the largest. */
const RING_SIZE: Record<UnitType, number> = {
  pioneer: 0.85,
  harvester: 0.62,
  tank: 0.52,
  rifleman: 0.28,
  rocket: 0.28,
  grenadier: 0.28,
  engineer: 0.28,
  scout: 0.42,
  artillery: 0.52,
  heavy: 0.68,
  guardian: 0.58,
  sniper: 0.28,
  flamer: 0.28,
  saboteur: 0.28,
  flametank: 0.58,
};

/** How high each building's name tag floats, where the default would sit inside the model. */
const LABEL_HEIGHT: Partial<Record<BuildingType, number>> = { conyard: 3.1, refinery: 3.0, factory: 2.4, radar: 2.5, power: 1.8 };

/** How many nuggets to draw on a cell, so a field visibly thins as it is mined. */
function oreNuggets(amount: number, gems: boolean): number {
  return amount <= 0 ? 0 : Math.min(MAX_NUGGETS, Math.ceil((amount * MAX_NUGGETS) / (gems ? GEM_CELL : ORE_CELL)));
}

interface UnitView {
  obj: THREE.Group;
  ring: THREE.Mesh;
  angle: number;
  cargo: THREE.Object3D | null;
  drum: THREE.Object3D | null;
  turret: THREE.Object3D | null;
  anim: UnitAnim | null;
  playing: THREE.AnimationAction | null;
}

/** The animation player on a pack model, and the clips the game switches between. */
interface UnitAnim {
  mixer: THREE.AnimationMixer;
  idle: THREE.AnimationAction | null;
  run: THREE.AnimationAction | null;
  shoot: THREE.AnimationAction | null;
  die: THREE.AnimationAction | null;
}

interface BuildingView {
  obj: THREE.Group;
  stages: THREE.Object3D[];
  arm: THREE.Object3D | null;
  head: THREE.Object3D | null;
  spin: THREE.Object3D | null;
  frame: THREE.Mesh;
  label: THREE.Sprite | null;
  /** Whose colours the model is painted in, so it can be rebuilt if the building changes hands. */
  owner: number;
}

export class Renderer {
  private gl: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  private sun = new THREE.DirectionalLight(0xffe2b4, 3.6);
  private raycaster = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private tmp = new THREE.Vector3();
  private ndc = new THREE.Vector2();

  private unitViews = new Map<number, UnitView>();
  private buildingViews = new Map<number, BuildingView>();
  private oreMeshes: { mesh: THREE.InstancedMesh; cells: number[] }[] | null = null;
  private oreSeen = new Int32Array(MAP_W * MAP_H);
  private oreSlot = new Int32Array(MAP_W * MAP_H);
  private oreMatrix = new THREE.Matrix4();
  private orePos = new THREE.Vector3();
  private oreScale = new THREE.Vector3();
  private oreQuat = new THREE.Quaternion();
  private oreEuler = new THREE.Euler();

  private ringGeo = new THREE.RingGeometry(1.08, 1.14, 56).rotateX(-Math.PI / 2);
  private overlayMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false });
  /** Building outlines sit on the ground, so walls in front hide them. */
  private frameMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  private repairMat = new THREE.MeshBasicMaterial({ color: 0x4fd16a, transparent: true });
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
  private lastSmoke = 0;
  private fallen: { obj: THREE.Object3D; mixer: THREE.AnimationMixer; at: number }[] = [];
  private effects = new Effects(this.scene);
  private healthBars = new HealthBars(this.scene);

  constructor(
    private canvas: HTMLCanvasElement,
    world: World,
  ) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    // Filmic tone mapping gives richer contrast and stops bright areas washing out.
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.25;
    this.scene.background = new THREE.Color(0x0e1012);

    // Cool light from the sky, warm light bounced off the ground, and a low golden sun.
    this.scene.add(new THREE.HemisphereLight(0xcfe2ff, 0x6a5c40, 1.25));
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
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);

    this.scene.add(this.makeTerrain(world));
    this.addScenery(world);

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

  /** Boulders on rock, and trees in the woods. Lakes are painted into the ground. */
  private addScenery(world: World): void {
    const rocks: THREE.Matrix4[] = [];
    const trunks: THREE.Matrix4[] = [];
    const crowns: THREE.Matrix4[] = [];
    const tops: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const type = world.terrain[cellIndex(x, y)];
        if (type === ROCK) {
          for (let i = 0; i < 3; i++) {
            const s = 0.22 + noise(x, y, 100 + i) * 0.26;
            e.set(noise(x, y, 110 + i) * 3, noise(x, y, 120 + i) * 6, noise(x, y, 130 + i) * 3);
            rocks.push(
              new THREE.Matrix4().compose(
                new THREE.Vector3(x + 0.2 + noise(x, y, 140 + i) * 0.6, s * 0.55, y + 0.2 + noise(x, y, 150 + i) * 0.6),
                q.setFromEuler(e),
                new THREE.Vector3(s, s * 0.8, s),
              ),
            );
          }
        } else if (type === TREES) {
          for (let i = 0; i < 2; i++) {
            const h = 0.7 + noise(x, y, 160 + i) * 0.5;
            const px = x + 0.25 + noise(x, y, 170 + i) * 0.5;
            const pz = y + 0.25 + noise(x, y, 180 + i) * 0.5;
            q.identity();
            trunks.push(new THREE.Matrix4().compose(new THREE.Vector3(px, 0.15, pz), q, new THREE.Vector3(0.07, 0.3, 0.07)));
            crowns.push(new THREE.Matrix4().compose(new THREE.Vector3(px, 0.3 + h * 0.4, pz), q, new THREE.Vector3(0.36, h * 0.8, 0.36)));
            tops.push(new THREE.Matrix4().compose(new THREE.Vector3(px, 0.3 + h * 0.85, pz), q, new THREE.Vector3(0.24, h * 0.6, 0.24)));
          }
        }
      }
    }
    const add = (geo: THREE.BufferGeometry, colour: number, spots: THREE.Matrix4[]): void => {
      if (spots.length === 0) return;
      const material = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.9, flatShading: true });
      const mesh = new THREE.InstancedMesh(geo, material, spots.length);
      spots.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    };
    add(new THREE.DodecahedronGeometry(1), world.map === 'desert' ? 0xa5846a : 0x7b7f86, rocks);
    if (this.addPackTrees(world)) return;
    add(new THREE.CylinderGeometry(1, 1, 1, 6), 0x5a4030, trunks);
    add(new THREE.ConeGeometry(1, 1, 7), 0x2c6431, crowns);
    add(new THREE.ConeGeometry(1, 1, 7), 0x3d7d3c, tops);
  }

  /** Plants trees from the asset pack in the woods. Returns false if the pack is missing. */
  private addPackTrees(world: World): boolean {
    const kinds = (['tree1', 'tree2', 'tree3', 'tree4'] as const)
      .map((name) => asset(name))
      .filter((g): g is NonNullable<typeof g> => g !== null);
    if (kinds.length === 0) return false;

    const spots: THREE.Matrix4[][] = kinds.map(() => []);
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (world.terrain[cellIndex(x, y)] !== TREES) continue;
        const k = Math.floor(noise(x, y, 200) * kinds.length) % kinds.length;
        // Desert scrub is lower than woodland.
        const height = (world.map === 'desert' ? 0.9 : 1.5) + noise(x, y, 201) * 0.8;
        const scale = height / sizeOf(kinds[k].scene).y;
        q.setFromAxisAngle(up, noise(x, y, 202) * Math.PI * 2);
        spots[k].push(
          new THREE.Matrix4().compose(
            new THREE.Vector3(x + 0.3 + noise(x, y, 203) * 0.4, 0, y + 0.3 + noise(x, y, 204) * 0.4),
            q,
            new THREE.Vector3(scale, scale, scale),
          ),
        );
      }
    }
    kinds.forEach((gltf, k) => {
      if (spots[k].length === 0) return;
      // Each tree is a trunk and a crown. Draw every copy of each part in one go.
      gltf.scene.traverse((part) => {
        if (!(part instanceof THREE.Mesh)) return;
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, spots[k].length);
        spots[k].forEach((m, i) => mesh.setMatrixAt(i, m.clone().multiply(part.matrixWorld)));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.scene.add(mesh);
      });
    });
    return true;
  }

  private makeTerrain(world: World): THREE.Mesh {
    const tex = new THREE.CanvasTexture(paintGround(world.terrain, TERRAIN_TEXELS, world.map));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.gl.capabilities.getMaxAnisotropy();
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(MAP_W, MAP_H).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 }),
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
    // The camera circles the point it is looking at as the view is turned.
    cam.position.set(
      ui.camX + Math.sin(ui.yaw) * COS_PITCH * CAMERA_DISTANCE,
      SIN_PITCH * CAMERA_DISTANCE,
      ui.camZ + Math.cos(ui.yaw) * COS_PITCH * CAMERA_DISTANCE,
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
    this.syncSmoke(world, now);
    this.syncFallen(now, dt);
    this.effects.update(now);

    this.gl.render(this.scene, this.camera);
  }

  /** Where one nugget on a cell sits, or a matrix that hides it if it has been mined away. */
  private nugget(cell: number, i: number, shown: boolean, gems: boolean): THREE.Matrix4 {
    const x = cell % MAP_W;
    const y = (cell - x) / MAP_W;
    const s = shown ? (gems ? 0.11 : 0.09) + noise(x, y, 60 + i) * 0.08 : 0;
    this.oreEuler.set(noise(x, y, 70 + i) * 0.8, noise(x, y, 80 + i) * 6.28, noise(x, y, 90 + i) * 0.8);
    return this.oreMatrix.compose(
      this.orePos.set(x + 0.15 + noise(x, y, 40 + i) * 0.7, s * 0.7, y + 0.15 + noise(x, y, 50 + i) * 0.7),
      this.oreQuat.setFromEuler(this.oreEuler),
      this.oreScale.set(s, s * (gems ? 2 : 1.5), s),
    );
  }

  /**
   * Ore is gold and gems are blue-green. Every cell that starts with any gets
   * its own fixed set of nuggets, so mining a cell only touches that cell.
   */
  private syncOre(world: World): void {
    if (!this.oreMeshes) {
      const build = (gems: boolean): { mesh: THREE.InstancedMesh; cells: number[] } => {
        const cells: number[] = [];
        for (let i = 0; i < world.ore.length; i++) {
          if (world.ore[i] > 0 && (world.rich[i] === 1) === gems) cells.push(i);
        }
        const material = new THREE.MeshStandardMaterial({
          color: gems ? 0x39d8c8 : 0xf2b22a,
          emissive: gems ? 0x0b5a66 : 0x5a3600,
          roughness: gems ? 0.12 : 0.28,
          metalness: gems ? 0.35 : 0.55,
          flatShading: true,
        });
        const mesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1), material, Math.max(1, cells.length * MAX_NUGGETS));
        cells.forEach((cell, slot) => {
          this.oreSlot[cell] = slot;
          for (let i = 0; i < MAX_NUGGETS; i++) mesh.setMatrixAt(slot * MAX_NUGGETS + i, this.nugget(cell, i, false, gems));
        });
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        // Nuggets are spread across the whole map, so the default bounds would hide them wrongly.
        mesh.frustumCulled = false;
        this.scene.add(mesh);
        return { mesh, cells };
      };
      this.oreSeen.fill(0);
      this.oreMeshes = [build(false), build(true)];
    }
    this.oreMeshes.forEach(({ mesh, cells }, kind) => {
      let touched = false;
      for (const cell of cells) {
        const count = oreNuggets(world.ore[cell], kind === 1);
        if (count === this.oreSeen[cell]) continue;
        this.oreSeen[cell] = count;
        const slot = this.oreSlot[cell];
        for (let i = 0; i < MAX_NUGGETS; i++) {
          mesh.setMatrixAt(slot * MAX_NUGGETS + i, this.nugget(cell, i, i < count, kind === 1));
        }
        touched = true;
      }
      if (touched) mesh.instanceMatrix.needsUpdate = true;
    });
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
        let turret: THREE.Object3D | null = null;
        obj.traverse((o) => {
          if (o.userData.cargo) cargo = o;
          if (o.userData.drum) drum = o;
          if (o.userData.turret) turret = o;
        });
        const ring = new THREE.Mesh(this.ringGeo, this.overlayMat);
        ring.position.y = 0.04;
        ring.scale.setScalar(RING_SIZE[u.type] / obj.scale.x);
        ring.renderOrder = 2;
        obj.add(ring);
        this.scene.add(obj);
        view = { obj, ring, angle: target, cargo, drum, turret, anim: (obj.userData.anim as UnitAnim) ?? null, playing: null };
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
        view.cargo.visible = u.load > 0;
        view.cargo.scale.y = Math.max(0.02, u.load / HARVEST_CAPACITY);
      }
      if (view.drum && u.job === 'harvest') view.drum.rotation.y += dt * 9;
      if (view.anim) {
        // Run while moving, fire while it has a target in its sights, otherwise stand easy.
        const moving = u.stepTo !== -1;
        const next = moving ? view.anim.run : u.attack !== 0 ? view.anim.shoot : view.anim.idle;
        if (next && next !== view.playing) {
          next.reset().fadeIn(0.12).play();
          view.playing?.fadeOut(0.12);
          view.playing = next;
        }
        view.anim.mixer.update(dt);
      }
      if (view.turret) {
        // Swing the turret onto the target, or back to straight ahead.
        let want = 0;
        const foe = u.attack !== 0 ? this.positionOf(world, u.attack) : null;
        if (foe) want = Math.atan2(-(foe.z - u.y / SUB), foe.x - u.x / SUB) - view.angle;
        let swing = want - view.turret.rotation.y;
        swing = Math.atan2(Math.sin(swing), Math.cos(swing));
        const rate = 6 * dt;
        view.turret.rotation.y += Math.abs(swing) <= rate ? swing : Math.sign(swing) * rate;
      }
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
      if (view && view.owner !== b.owner) {
        // Captured: take the old model down and put one up in the new owner's colours.
        this.scene.remove(view.obj);
        this.buildingViews.delete(b.id);
        view = undefined;
      }
      if (!view) {
        const obj = makeBuilding(b.type, b.owner);
        obj.position.set(b.cx + b.w / 2, 0, b.cy + b.h / 2);
        const stages: THREE.Object3D[] = [];
        let arm: THREE.Object3D | null = null;
        let head: THREE.Object3D | null = null;
        let spin: THREE.Object3D | null = null;
        obj.traverse((o) => {
          if (typeof o.userData.stage === 'number') stages[o.userData.stage] = o;
          if (o.userData.arm) arm = o;
          if (o.userData.head) head = o;
          if (o.userData.spin) spin = o;
        });
        const frame = new THREE.Mesh(frameGeometry(b.w + 0.1, b.h + 0.1, 0.06), this.frameMat);
        frame.position.y = 0.03;
        obj.add(frame);
        // Walls would be a forest of tags, and a turret is plain enough.
        let label: THREE.Sprite | null = null;
        if (b.type !== 'wall' && b.type !== 'turret') {
          label = makeLabel(BUILDING_DEFS[b.type].name, SIGNATURE[b.type]);
          label.position.y = LABEL_HEIGHT[b.type] ?? 1.7;
          obj.add(label);
        }
        this.scene.add(obj);
        view = { obj, stages, arm, head, spin, frame, label, owner: b.owner };
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
      if (view.spin && p >= 1) view.spin.rotation.y = now * 0.0014;
      if (view.head) {
        let turn = (-b.aim * Math.PI) / 4 - view.head.rotation.y;
        turn = Math.atan2(Math.sin(turn), Math.cos(turn));
        view.head.rotation.y += turn * 0.2;
      }
      // A building under repair pulses green.
      const mending = b.repairing && b.owner === LOCAL_PLAYER;
      view.frame.material = mending ? this.repairMat : this.frameMat;
      this.repairMat.opacity = 0.55 + 0.45 * Math.sin(now * 0.008);
      view.frame.visible = ui.selectedBuilding === b.id || mending;
      if (view.label) view.label.visible = ui.labels && p >= 1;
      // Enemy buildings stay on the map once they have been discovered.
      view.obj.visible = b.owner === LOCAL_PLAYER || footprintSeen(vision.explored, b);
    }
    for (const [id, view] of this.buildingViews) {
      if (alive.has(id)) continue;
      this.scene.remove(view.obj);
      this.buildingViews.delete(id);
    }
  }

  /** A soldier who has just been killed falls where he stood, then sinks away. */
  private addFallen(ev: Extract<SimEvent, { type: 'unitDied' }>, now: number): void {
    const obj = makeUnit(ev.unit, ev.owner);
    const anim = obj.userData.anim as UnitAnim | undefined;
    if (!anim?.die) return;
    obj.position.set(ev.x / SUB, 0, ev.y / SUB);
    obj.rotation.y = (-ev.facing * Math.PI) / 4;
    anim.die.setLoop(THREE.LoopOnce, 1);
    anim.die.clampWhenFinished = true;
    anim.die.play();
    this.scene.add(obj);
    this.fallen.push({ obj, mixer: anim.mixer, at: now });
  }

  private syncFallen(now: number, dt: number): void {
    this.fallen = this.fallen.filter((f) => {
      const age = now - f.at;
      if (age > 4000) {
        this.scene.remove(f.obj);
        return false;
      }
      f.mixer.update(dt);
      if (age > 2600) f.obj.position.y = -((age - 2600) / 1400) * 0.5;
      return true;
    });
  }

  /** Where a unit or building is, in cells, for aiming turrets at it. */
  private positionOf(world: World, id: number): { x: number; z: number } | null {
    const u = world.units.find((x) => x.id === id);
    if (u) return { x: u.x / SUB, z: u.y / SUB };
    const b = world.buildings.find((x) => x.id === id);
    return b ? { x: b.cx + b.w / 2, z: b.cy + b.h / 2 } : null;
  }

  /** Smoke from chimneys, steam from cooling towers, and fire from anything badly damaged. */
  private syncSmoke(world: World, now: number): void {
    if (now - this.lastSmoke < 260) return;
    this.lastSmoke = now;
    const vision = world.vision[LOCAL_PLAYER];
    for (const b of world.buildings) {
      if (b.progress < b.total || b.selling) continue;
      if (b.owner !== LOCAL_PLAYER && !footprintSeen(vision.visible, b)) continue;
      const x = b.cx + b.w / 2;
      const z = b.cy + b.h / 2;
      for (const [dx, dy, dz, size, colour] of CHIMNEYS[b.type]) {
        if (Math.random() < 0.6) this.effects.puff(x + dx, dy, z + dz, size, colour, now);
      }
      const health = b.hp / BUILDING_DEFS[b.type].hp;
      if (health < 0.5) {
        // The worse the damage, the more of the building is alight.
        const fires = health < 0.25 ? 2 : 1;
        for (let i = 0; i < fires; i++) {
          const fx = x + (Math.random() - 0.5) * b.w * 0.7;
          const fz = z + (Math.random() - 0.5) * b.h * 0.7;
          this.effects.flame(fx, 0.6 + Math.random() * 0.5, fz, 0.16, now);
          this.effects.puff(fx, 1.0, fz, 0.22, 0x1c1c1c, now);
        }
      }
    }
    for (const u of world.units) {
      if (UNIT_DEFS[u.type].armour !== 'vehicle' || u.hp * 5 >= UNIT_DEFS[u.type].hp * 2) continue;
      if (u.owner !== LOCAL_PLAYER && !vision.visible[u.cell]) continue;
      this.effects.puff(u.x / SUB, 0.5, u.y / SUB, 0.14, 0x2a2a2a, now);
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
    if (ev.type === 'unitDied' && ev.unit === 'rifleman') this.addFallen(ev, now);
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
