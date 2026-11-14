// Low-poly placeholder models built from simple shapes.
// One cell is one unit. Models face east (+x) and sit on the ground at y = 0.
// Buildings are centred on their footprint, with their front facing south (+z).

import * as THREE from 'three';
import type { BuildingType, UnitType } from '../sim/types';

const STEEL = 0x66717c;
const STEEL_DARK = 0x3a424b;
const STEEL_LIGHT = 0x9aa5af;
const CONCRETE = 0x7d868f;
const RUBBER = 0x1c1f23;
const HAZARD = 0xe8b730;
const GLASS = 0xbfe3ff;

interface Palette {
  main: number;
  dark: number;
  light: number;
}

/** Team colours, by player number. */
const PALETTES: Palette[] = [
  { main: 0x3f86e0, dark: 0x24569c, light: 0x9cc4f7 },
  { main: 0xd8483c, dark: 0x8f2a22, light: 0xf5a59c },
];

/** The palette the model currently being built should use. */
let team = PALETTES[0];

const materials = new Map<number, THREE.MeshLambertMaterial>();
function mat(colour: number): THREE.MeshLambertMaterial {
  let m = materials.get(colour);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: colour });
    materials.set(colour, m);
  }
  return m;
}

/** A box whose origin is the centre of its base, so it can grow from the ground. */
function box(
  w: number,
  h: number,
  d: number,
  colour: number,
  x: number,
  baseY: number,
  z: number,
): THREE.Mesh {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.translate(0, h / 2, 0);
  const mesh = new THREE.Mesh(geo, mat(colour));
  mesh.position.set(x, baseY, z);
  return mesh;
}

/** An upright cylinder, also with its origin at the centre of its base. */
function cyl(
  rTop: number,
  rBottom: number,
  h: number,
  colour: number,
  x: number,
  baseY: number,
  z: number,
): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(rTop, rBottom, h, 12);
  geo.translate(0, h / 2, 0);
  const mesh = new THREE.Mesh(geo, mat(colour));
  mesh.position.set(x, baseY, z);
  return mesh;
}

function finish<T extends THREE.Object3D>(root: T): T {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return root;
}

/**
 * Starts a building. Each call to the returned function adds the next group
 * of parts, and the groups rise out of the ground in that order during the
 * build-up animation.
 */
function staged(): { root: THREE.Group; stage: (...parts: THREE.Object3D[]) => void } {
  const root = new THREE.Group();
  let index = 0;
  return {
    root,
    stage: (...parts) => {
      const holder = new THREE.Group();
      holder.userData.stage = index++;
      for (const p of parts) holder.add(p);
      root.add(holder);
    },
  };
}

/** A flat pad edged with hazard stripes. */
function hazardPad(w: number, d: number, x: number, y: number, z: number): THREE.Object3D[] {
  return [
    box(w, 0.05, d, STEEL_DARK, x, y, z),
    box(w, 0.06, 0.07, HAZARD, x, y, z - d / 2 + 0.035),
    box(w, 0.06, 0.07, HAZARD, x, y, z + d / 2 - 0.035),
    box(0.07, 0.06, d, HAZARD, x - w / 2 + 0.035, y, z),
    box(0.07, 0.06, d, HAZARD, x + w / 2 - 0.035, y, z),
  ];
}

function buildPioneer(): THREE.Group {
  const g = new THREE.Group();
  // Tracks and chassis.
  g.add(box(1.7, 0.26, 0.26, RUBBER, 0, 0, -0.42));
  g.add(box(1.7, 0.26, 0.26, RUBBER, 0, 0, 0.42));
  g.add(box(1.6, 0.2, 0.62, team.dark, 0, 0.16, 0));
  // Cab at the front with a windscreen and a beacon.
  g.add(box(0.44, 0.4, 0.7, team.main, 0.55, 0.36, 0));
  g.add(box(0.06, 0.18, 0.58, GLASS, 0.77, 0.52, 0));
  g.add(box(0.1, 0.07, 0.1, HAZARD, 0.5, 0.76, 0.2));
  // The folded-up yard carried on the back.
  g.add(box(1.02, 0.44, 0.8, STEEL, -0.26, 0.36, 0));
  g.add(box(0.9, 0.06, 0.62, team.main, -0.26, 0.8, 0));
  g.add(box(0.94, 0.05, 0.1, team.light, -0.26, 0.8, -0.37));
  g.add(box(0.94, 0.05, 0.1, team.light, -0.26, 0.8, 0.37));
  // Crane boom strapped along the roof.
  g.add(box(1.1, 0.08, 0.1, HAZARD, -0.2, 0.86, 0));
  g.add(box(0.14, 0.14, 0.18, STEEL_DARK, -0.72, 0.86, 0));
  g.scale.setScalar(1.12);
  return finish(g);
}

/**
 * userData.cargo marks the ore heap, which grows as the hopper fills, and
 * userData.drum marks the cutting drum, which spins while digging.
 */
function buildHarvester(): THREE.Group {
  const g = new THREE.Group();
  // Tracks and chassis.
  g.add(box(1.36, 0.24, 0.24, RUBBER, -0.04, 0, -0.36));
  g.add(box(1.36, 0.24, 0.24, RUBBER, -0.04, 0, 0.36));
  g.add(box(1.26, 0.18, 0.56, team.dark, -0.04, 0.14, 0));
  // Open hopper at the back.
  g.add(box(0.78, 0.36, 0.06, team.main, -0.3, 0.32, -0.34));
  g.add(box(0.78, 0.36, 0.06, team.main, -0.3, 0.32, 0.34));
  g.add(box(0.06, 0.36, 0.74, team.main, -0.69, 0.32, 0));
  g.add(box(0.06, 0.36, 0.74, team.dark, 0.09, 0.32, 0));
  g.add(box(0.72, 0.04, 0.62, STEEL_DARK, -0.3, 0.32, 0));
  const cargo = box(0.7, 0.36, 0.6, 0xf0b429, -0.3, 0.34, 0);
  cargo.userData.cargo = true;
  g.add(cargo);
  // Cab.
  g.add(box(0.3, 0.34, 0.5, team.light, 0.28, 0.32, 0));
  g.add(box(0.05, 0.14, 0.4, GLASS, 0.44, 0.46, 0));
  // Cutting drum on arms at the front.
  g.add(box(0.3, 0.07, 0.07, STEEL, 0.58, 0.2, -0.3));
  g.add(box(0.3, 0.07, 0.07, STEEL, 0.58, 0.2, 0.3));
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.74, 8), mat(STEEL_LIGHT));
  drum.rotation.x = Math.PI / 2;
  drum.position.set(0.78, 0.19, 0);
  drum.userData.drum = true;
  const teeth = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.66, 0.05), mat(HAZARD));
  drum.add(teeth);
  g.add(drum);
  g.scale.setScalar(1.15);
  return finish(g);
}

function buildRifleman(): THREE.Group {
  const g = new THREE.Group();
  // Legs, body and helmeted head.
  g.add(box(0.07, 0.2, 0.07, STEEL_DARK, 0, 0, -0.05));
  g.add(box(0.07, 0.2, 0.07, STEEL_DARK, 0, 0, 0.05));
  g.add(box(0.13, 0.22, 0.2, team.main, 0, 0.2, 0));
  g.add(box(0.12, 0.05, 0.08, team.dark, -0.09, 0.26, 0));
  g.add(box(0.1, 0.1, 0.1, 0xe0b48c, 0, 0.42, 0));
  g.add(box(0.13, 0.05, 0.13, team.dark, 0, 0.5, 0));
  // Rifle held forward.
  g.add(box(0.3, 0.035, 0.035, RUBBER, 0.14, 0.3, 0.09));
  g.scale.setScalar(1.35);
  return finish(g);
}

function buildTank(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(1.1, 0.22, 0.22, RUBBER, 0, 0, -0.32));
  g.add(box(1.1, 0.22, 0.22, RUBBER, 0, 0, 0.32));
  g.add(box(1.0, 0.2, 0.5, team.dark, 0, 0.1, 0));
  g.add(box(0.86, 0.1, 0.78, team.main, -0.02, 0.24, 0));
  // Turret and gun.
  g.add(box(0.44, 0.2, 0.44, team.main, -0.08, 0.34, 0));
  g.add(box(0.46, 0.04, 0.46, team.light, -0.08, 0.54, 0));
  g.add(box(0.62, 0.07, 0.07, STEEL_DARK, 0.42, 0.41, 0));
  g.add(box(0.1, 0.1, 0.1, STEEL_DARK, 0.7, 0.395, 0));
  g.scale.setScalar(1.1);
  return finish(g);
}

/** userData.arm marks the crane arm, which swings once the yard is working. */
function buildConyard(): THREE.Group {
  const { root, stage } = staged();
  stage(box(2.84, 0.12, 2.84, CONCRETE, 0, 0, 0));
  stage(...hazardPad(1.05, 1.7, 0.8, 0.12, 0.42));
  // Main workshop.
  stage(
    box(1.45, 1.25, 1.95, team.main, -0.6, 0.12, -0.3),
    box(0.8, 0.7, 0.06, STEEL_DARK, -0.6, 0.12, 0.69),
    box(1.49, 0.12, 1.99, team.light, -0.6, 1.05, -0.3),
    box(0.2, 0.16, 0.06, GLASS, -1.05, 0.72, 0.69),
    box(0.2, 0.16, 0.06, GLASS, -0.15, 0.72, 0.69),
  );
  stage(box(1.6, 0.1, 2.1, team.dark, -0.6, 1.37, -0.3), cyl(0.11, 0.13, 0.5, STEEL_DARK, -0.95, 1.45, -0.9));
  // Side annex.
  stage(box(1.0, 0.62, 0.7, STEEL, -0.82, 0.12, 1.02), box(1.06, 0.06, 0.76, team.dark, -0.82, 0.74, 1.02));
  // Crane tower, then its arm.
  stage(box(0.22, 2.15, 0.22, HAZARD, 0.8, 0.12, -0.95), box(0.34, 0.22, 0.34, STEEL_DARK, 0.8, 2.27, -0.95));
  const arm = new THREE.Group();
  arm.position.set(0.8, 2.49, -0.95);
  arm.userData.arm = true;
  arm.add(box(1.9, 0.09, 0.12, HAZARD, 0.55, 0, 0));
  arm.add(box(0.3, 0.22, 0.26, STEEL_DARK, -0.42, -0.06, 0));
  arm.add(box(0.03, 0.55, 0.03, RUBBER, 1.35, -0.55, 0));
  stage(arm);
  return finish(root);
}

function buildPowerPlant(): THREE.Group {
  const { root, stage } = staged();
  stage(box(1.86, 0.1, 1.86, CONCRETE, 0, 0, 0));
  // Generator hall.
  stage(
    box(0.8, 0.75, 1.5, team.main, -0.42, 0.1, 0),
    box(0.84, 0.1, 1.54, team.light, -0.42, 0.55, 0),
    box(0.4, 0.4, 0.05, STEEL_DARK, -0.42, 0.1, 0.76),
  );
  stage(box(0.9, 0.08, 1.6, team.dark, -0.42, 0.85, 0), box(0.3, 0.14, 0.3, STEEL, -0.42, 0.93, -0.4));
  // Two cooling towers.
  stage(cyl(0.25, 0.36, 1.05, STEEL_LIGHT, 0.45, 0.1, -0.42), cyl(0.27, 0.27, 0.06, HAZARD, 0.45, 1.1, -0.42));
  stage(cyl(0.25, 0.36, 1.05, STEEL_LIGHT, 0.45, 0.1, 0.42), cyl(0.27, 0.27, 0.06, HAZARD, 0.45, 1.1, 0.42));
  return finish(root);
}

function buildRefinery(): THREE.Group {
  const { root, stage } = staged();
  stage(box(2.84, 0.12, 2.84, CONCRETE, 0, 0, 0));
  // Unloading dock at the front, where harvesters will pull in.
  stage(...hazardPad(1.2, 1.25, 0.72, 0.12, 0.7));
  // Processing hall.
  stage(
    box(1.5, 1.05, 1.5, team.main, -0.58, 0.12, -0.55),
    box(1.54, 0.12, 1.54, team.light, -0.58, 0.85, -0.55),
    box(0.7, 0.55, 0.05, STEEL_DARK, -0.58, 0.12, 0.21),
  );
  stage(box(1.6, 0.1, 1.6, team.dark, -0.58, 1.17, -0.55), box(0.5, 0.3, 0.9, STEEL, -0.58, 1.27, -0.55));
  // Conveyor from the dock up into the hall.
  stage(box(0.9, 0.3, 0.3, STEEL, 0.4, 0.5, 0.1), box(0.25, 0.6, 0.25, STEEL_DARK, 0.75, 0.12, 0.1));
  // Storage silos.
  stage(
    cyl(0.36, 0.36, 1.0, STEEL_LIGHT, 0.7, 0.12, -0.95),
    cyl(0.2, 0.36, 0.2, HAZARD, 0.7, 1.12, -0.95),
    cyl(0.3, 0.3, 0.8, STEEL_LIGHT, -0.95, 0.12, 0.85),
    cyl(0.16, 0.3, 0.18, HAZARD, -0.95, 0.92, 0.85),
  );
  // Smokestack.
  stage(cyl(0.12, 0.16, 1.5, STEEL_DARK, -1.05, 1.27, -1.0), cyl(0.15, 0.15, 0.08, HAZARD, -1.05, 2.5, -1.0));
  return finish(root);
}

function buildBarracks(): THREE.Group {
  const { root, stage } = staged();
  stage(box(1.86, 0.1, 1.86, CONCRETE, 0, 0, 0));
  // Long hut with a stepped roof.
  stage(
    box(1.5, 0.55, 1.0, STEEL, 0, 0.1, -0.3),
    box(0.34, 0.42, 0.05, STEEL_DARK, -0.35, 0.1, 0.21),
    box(0.22, 0.14, 0.05, GLASS, 0.3, 0.38, 0.21),
  );
  stage(box(1.6, 0.14, 1.12, team.main, 0, 0.65, -0.3), box(1.6, 0.14, 0.62, team.light, 0, 0.79, -0.3));
  // Parade square and kit lockers.
  stage(
    box(1.5, 0.03, 0.5, STEEL_DARK, 0, 0.1, 0.6),
    box(0.3, 0.26, 0.26, team.dark, 0.55, 0.1, 0.6),
    box(0.26, 0.2, 0.22, team.dark, 0.2, 0.1, 0.62),
  );
  // Flagpole.
  stage(box(0.04, 1.3, 0.04, STEEL_LIGHT, -0.7, 0.1, 0.65), box(0.34, 0.2, 0.03, team.main, -0.51, 1.18, 0.65));
  return finish(root);
}

function buildFactory(): THREE.Group {
  const { root, stage } = staged();
  stage(box(2.84, 0.12, 2.84, CONCRETE, 0, 0, 0));
  // Exit ramp in front of the main door.
  stage(...hazardPad(1.5, 0.8, 0.2, 0.12, 0.98));
  // Assembly hall with a large door.
  stage(
    box(2.5, 1.15, 1.9, STEEL, 0, 0.12, -0.4),
    box(1.4, 0.85, 0.06, STEEL_DARK, 0.2, 0.12, 0.55),
    box(1.5, 0.08, 0.08, HAZARD, 0.2, 0.97, 0.57),
  );
  stage(
    box(2.6, 0.12, 2.0, team.main, 0, 1.27, -0.4),
    box(0.12, 0.1, 2.0, team.light, -0.8, 1.39, -0.4),
    box(0.12, 0.1, 2.0, team.light, 0, 1.39, -0.4),
    box(0.12, 0.1, 2.0, team.light, 0.8, 1.39, -0.4),
  );
  // Control tower beside the door.
  stage(
    box(0.5, 1.5, 0.5, team.dark, -1.05, 0.12, 0.85),
    box(0.56, 0.24, 0.56, GLASS, -1.05, 1.62, 0.85),
    box(0.6, 0.06, 0.6, team.main, -1.05, 1.86, 0.85),
  );
  // Vents on the roof.
  stage(cyl(0.12, 0.12, 0.35, STEEL_DARK, 0.9, 1.39, -1.0), cyl(0.12, 0.12, 0.35, STEEL_DARK, 0.5, 1.39, -1.0));
  return finish(root);
}

const BUILDERS: Record<BuildingType, () => THREE.Group> = {
  conyard: buildConyard,
  power: buildPowerPlant,
  refinery: buildRefinery,
  barracks: buildBarracks,
  factory: buildFactory,
};

const UNIT_BUILDERS: Record<UnitType, () => THREE.Group> = {
  pioneer: buildPioneer,
  harvester: buildHarvester,
  rifleman: buildRifleman,
  tank: buildTank,
};

const templates = new Map<string, THREE.Group>();

/** Builds each model once per team, then hands out cheap copies that share its geometry. */
function fromTemplate(key: string, owner: number, build: () => THREE.Group): THREE.Group {
  const id = `${key}:${owner}`;
  let template = templates.get(id);
  if (!template) {
    team = PALETTES[owner % PALETTES.length];
    template = build();
    templates.set(id, template);
  }
  return template.clone();
}

export function makeUnit(type: UnitType, owner: number): THREE.Group {
  return fromTemplate(type, owner, UNIT_BUILDERS[type]);
}

export function makeBuilding(type: BuildingType, owner: number): THREE.Group {
  return fromTemplate(type, owner, BUILDERS[type]);
}

const ghostMaterial = new THREE.MeshBasicMaterial({
  color: 0xd8ecff,
  transparent: true,
  opacity: 0.4,
  depthWrite: false,
});

/** A see-through copy of a building, shown while choosing where to place it. */
export function makeGhost(type: BuildingType): THREE.Group {
  const ghost = makeBuilding(type, 0);
  ghost.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.material = ghostMaterial;
      o.castShadow = false;
      o.receiveShadow = false;
    }
  });
  return ghost;
}

/** A flat rectangular outline lying on the ground, centred on the origin. */
export function frameGeometry(w: number, d: number, thickness: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, -d / 2);
  shape.lineTo(w / 2, -d / 2);
  shape.lineTo(w / 2, d / 2);
  shape.lineTo(-w / 2, d / 2);
  shape.closePath();
  const hole = new THREE.Path();
  const iw = w / 2 - thickness;
  const id = d / 2 - thickness;
  hole.moveTo(-iw, -id);
  hole.lineTo(-iw, id);
  hole.lineTo(iw, id);
  hole.lineTo(iw, -id);
  hole.closePath();
  shape.holes.push(hole);
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/** The flag marking where a building sends its new units. */
export function makeRallyFlag(): THREE.Group {
  const g = new THREE.Group();
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const green = new THREE.MeshBasicMaterial({ color: 0x7dff8e });
  const pole = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.1, 0.05), white);
  pole.position.y = 0.55;
  const flag = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.26, 0.03), green);
  flag.position.set(0.22, 0.95, 0);
  const base = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.3, 24).rotateX(-Math.PI / 2), green);
  base.position.y = 0.03;
  g.add(pole, flag, base);
  return g;
}
