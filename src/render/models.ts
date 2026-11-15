// Low-poly placeholder models built from simple shapes.
// One cell is one unit. Models face east (+x) and sit on the ground at y = 0.
// Buildings are centred on their footprint, with their front facing south (+z).

import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { BuildingType, UnitType } from '../sim/types';
import { asset, sizeOf } from './assets';

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

const materials = new Map<number, THREE.MeshStandardMaterial>();
/** One shared material per colour. Glass is shiny, rubber is dull, the rest sit in between. */
function mat(colour: number): THREE.MeshStandardMaterial {
  let m = materials.get(colour);
  if (!m) {
    const glass = colour === GLASS;
    m = new THREE.MeshStandardMaterial({
      color: colour,
      roughness: glass ? 0.15 : colour === RUBBER ? 0.95 : 0.72,
      metalness: glass ? 0.7 : colour === STEEL || colour === STEEL_DARK || colour === STEEL_LIGHT ? 0.35 : 0.08,
      emissive: glass ? 0x24465c : 0x000000,
      flatShading: true,
    });
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

/** userData.turret marks the turret, which swings round to follow whatever the tank is shooting at. */
function buildTank(): THREE.Group {
  const g = new THREE.Group();
  // Tracks with guards, then the hull.
  g.add(box(1.14, 0.22, 0.22, RUBBER, 0, 0, -0.33));
  g.add(box(1.14, 0.22, 0.22, RUBBER, 0, 0, 0.33));
  g.add(box(1.04, 0.04, 0.26, team.dark, 0, 0.22, -0.33));
  g.add(box(1.04, 0.04, 0.26, team.dark, 0, 0.22, 0.33));
  g.add(box(1.0, 0.2, 0.46, team.dark, 0, 0.08, 0));
  g.add(box(0.9, 0.1, 0.5, team.main, -0.02, 0.26, 0));
  g.add(box(0.22, 0.08, 0.44, team.dark, 0.42, 0.22, 0));
  // Engine deck and exhausts at the back.
  g.add(box(0.26, 0.05, 0.4, STEEL_DARK, -0.36, 0.36, 0));
  g.add(box(0.06, 0.1, 0.06, STEEL_DARK, -0.5, 0.36, -0.16));
  g.add(box(0.06, 0.1, 0.06, STEEL_DARK, -0.5, 0.36, 0.16));

  const turret = new THREE.Group();
  turret.position.set(-0.04, 0.36, 0);
  turret.userData.turret = true;
  turret.add(box(0.44, 0.18, 0.42, team.main, 0, 0, 0));
  turret.add(box(0.3, 0.04, 0.3, team.light, -0.02, 0.18, 0));
  turret.add(box(0.1, 0.07, 0.1, STEEL_DARK, -0.08, 0.22, 0.1));
  turret.add(box(0.16, 0.12, 0.18, team.dark, 0.28, 0.03, 0));
  turret.add(box(0.6, 0.07, 0.07, STEEL_DARK, 0.62, 0.06, 0));
  turret.add(box(0.1, 0.1, 0.1, STEEL_DARK, 0.9, 0.045, 0));
  turret.add(box(0.02, 0.3, 0.02, RUBBER, -0.16, 0.18, -0.16));
  g.add(turret);

  g.scale.setScalar(1.1);
  return finish(g);
}

/** A light, open-topped car on four wheels, with a machine gun on a pintle. */
function buildScout(): THREE.Group {
  const g = new THREE.Group();
  for (const [x, z] of [[0.3, -0.26], [0.3, 0.26], [-0.3, -0.26], [-0.3, 0.26]]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.1, 10), mat(RUBBER));
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(x, 0.13, z);
    g.add(wheel);
  }
  g.add(box(0.86, 0.14, 0.42, team.main, 0, 0.12, 0));
  g.add(box(0.3, 0.08, 0.4, team.dark, 0.28, 0.26, 0));
  g.add(box(0.04, 0.16, 0.38, GLASS, 0.12, 0.26, 0));
  g.add(box(0.3, 0.12, 0.4, team.dark, -0.26, 0.26, 0));
  // Roll bar and gun.
  g.add(box(0.04, 0.24, 0.04, STEEL_DARK, -0.08, 0.26, -0.18));
  g.add(box(0.04, 0.24, 0.04, STEEL_DARK, -0.08, 0.26, 0.18));
  g.add(box(0.04, 0.04, 0.4, STEEL_DARK, -0.08, 0.5, 0));
  g.add(box(0.36, 0.05, 0.05, RUBBER, 0.1, 0.54, 0));
  g.scale.setScalar(1.1);
  return finish(g);
}

/** A tracked gun carriage with a long barrel raised for lobbing shells. */
function buildArtillery(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(1.1, 0.2, 0.2, RUBBER, 0, 0, -0.3));
  g.add(box(1.1, 0.2, 0.2, RUBBER, 0, 0, 0.3));
  g.add(box(1.0, 0.16, 0.44, team.dark, 0, 0.1, 0));
  g.add(box(0.5, 0.26, 0.56, team.main, -0.24, 0.26, 0));
  g.add(box(0.5, 0.04, 0.58, team.light, -0.24, 0.52, 0));
  g.add(box(0.3, 0.1, 0.4, STEEL, 0.2, 0.26, 0));
  const barrel = box(1.05, 0.09, 0.09, STEEL_DARK, 0.5, 0, 0);
  const mount = new THREE.Group();
  mount.position.set(-0.1, 0.4, 0);
  mount.rotation.z = 0.42;
  barrel.position.set(0.5, 0, 0);
  mount.add(barrel);
  mount.add(box(0.14, 0.13, 0.13, STEEL_DARK, 1.0, -0.02, 0));
  g.add(mount);
  // Spades at the back, which brace it when it fires.
  g.add(box(0.2, 0.06, 0.08, STEEL_DARK, -0.6, 0.06, -0.2));
  g.add(box(0.2, 0.06, 0.08, STEEL_DARK, -0.6, 0.06, 0.2));
  g.scale.setScalar(1.12);
  return finish(g);
}

/** userData.spin marks the dish, which turns while the station is working. */
function buildRadar(): THREE.Group {
  const { root, stage } = staged();
  stage(box(1.86, 0.1, 1.86, CONCRETE, 0, 0, 0));
  stage(
    box(1.1, 0.5, 1.0, team.main, -0.25, 0.1, 0.25),
    box(1.14, 0.08, 1.04, team.light, -0.25, 0.42, 0.25),
    box(0.4, 0.3, 0.05, STEEL_DARK, -0.25, 0.1, 0.76),
    box(0.5, 0.12, 0.05, GLASS, -0.25, 0.44, 0.76),
  );
  stage(box(1.2, 0.08, 1.1, team.dark, -0.25, 0.6, 0.25));
  stage(box(0.24, 1.3, 0.24, STEEL, 0.5, 0.1, -0.5), box(0.4, 0.1, 0.4, STEEL_DARK, 0.5, 1.4, -0.5));
  const dish = new THREE.Group();
  dish.position.set(0.5, 1.56, -0.5);
  dish.userData.spin = true;
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.2, 0.2, 14, 1, true), mat(STEEL_LIGHT));
  bowl.rotation.z = -1.1;
  bowl.position.set(0.16, 0.2, 0);
  const back = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 14), mat(STEEL_LIGHT));
  back.rotation.z = -1.1;
  back.position.set(0.07, 0.15, 0);
  dish.add(bowl, back, box(0.05, 0.05, 0.05, HAZARD, 0.42, 0.3, 0));
  stage(dish);
  return finish(root);
}

function buildTech(): THREE.Group {
  const { root, stage } = staged();
  stage(box(1.86, 0.1, 1.86, CONCRETE, 0, 0, 0));
  stage(
    box(1.5, 0.7, 1.2, STEEL_LIGHT, 0, 0.1, -0.2),
    box(1.54, 0.1, 1.24, team.main, 0, 0.5, -0.2),
    box(1.0, 0.2, 0.05, GLASS, 0, 0.26, 0.41),
  );
  stage(box(1.56, 0.08, 1.26, team.dark, 0, 0.8, -0.2));
  // A glass dome over the laboratory.
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(GLASS));
  dome.position.set(-0.3, 0.88, -0.2);
  stage(dome);
  stage(
    box(0.05, 0.9, 0.05, STEEL_DARK, 0.5, 0.88, -0.5),
    box(0.3, 0.04, 0.04, STEEL_DARK, 0.5, 1.5, -0.5),
    box(0.2, 0.04, 0.04, STEEL_DARK, 0.5, 1.66, -0.5),
    box(0.08, 0.08, 0.08, HAZARD, 0.5, 1.78, -0.5),
  );
  stage(box(0.6, 0.3, 0.4, team.main, 0.5, 0.1, 0.62), box(0.64, 0.05, 0.44, team.light, 0.5, 0.4, 0.62));
  return finish(root);
}

function buildDepot(): THREE.Group {
  const { root, stage } = staged();
  stage(box(1.86, 0.1, 1.86, CONCRETE, 0, 0, 0));
  stage(...hazardPad(1.3, 1.3, 0.2, 0.1, 0.2));
  // A gantry over the repair pad.
  stage(
    box(0.12, 1.0, 0.12, HAZARD, -0.5, 0.1, -0.5),
    box(0.12, 1.0, 0.12, HAZARD, 0.85, 0.1, -0.5),
    box(1.5, 0.12, 0.14, HAZARD, 0.18, 1.1, -0.5),
    box(0.16, 0.2, 0.18, STEEL_DARK, 0.2, 0.9, -0.5),
  );
  stage(
    box(0.5, 0.5, 0.7, team.main, -0.62, 0.1, 0.5),
    box(0.54, 0.06, 0.74, team.dark, -0.62, 0.6, 0.5),
    box(0.05, 0.16, 0.4, GLASS, -0.36, 0.34, 0.5),
  );
  stage(box(0.3, 0.24, 0.3, team.dark, -0.62, 0.1, -0.1), box(0.2, 0.2, 0.2, STEEL, 0.75, 0.1, 0.72));
  return finish(root);
}

/** A full cell of concrete, so neighbouring pieces join into a continuous wall. */
function buildWall(): THREE.Group {
  const { root, stage } = staged();
  stage(box(1.0, 0.5, 1.0, CONCRETE, 0, 0, 0), box(0.86, 0.08, 0.86, STEEL_DARK, 0, 0.5, 0), box(1.02, 0.07, 1.02, team.main, 0, 0.3, 0));
  return finish(root);
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

/** userData.head marks the gun, which swivels to track its target. */
function buildTurret(): THREE.Group {
  const { root, stage } = staged();
  stage(box(0.9, 0.1, 0.9, CONCRETE, 0, 0, 0));
  stage(cyl(0.3, 0.36, 0.3, STEEL, 0, 0.1, 0));
  const head = new THREE.Group();
  head.position.set(0, 0.4, 0);
  head.userData.head = true;
  head.add(box(0.5, 0.24, 0.46, team.main, 0, 0, 0));
  head.add(box(0.52, 0.05, 0.48, team.light, 0, 0.24, 0));
  head.add(box(0.5, 0.08, 0.08, STEEL_DARK, 0.45, 0.09, -0.1));
  head.add(box(0.5, 0.08, 0.08, STEEL_DARK, 0.45, 0.09, 0.1));
  stage(head);
  return finish(root);
}

const BUILDERS: Record<BuildingType, () => THREE.Group> = {
  conyard: buildConyard,
  power: buildPowerPlant,
  refinery: buildRefinery,
  barracks: buildBarracks,
  factory: buildFactory,
  turret: buildTurret,
  radar: buildRadar,
  tech: buildTech,
  depot: buildDepot,
  wall: buildWall,
};

const UNIT_BUILDERS: Record<UnitType, () => THREE.Group> = {
  pioneer: buildPioneer,
  harvester: buildHarvester,
  rifleman: buildRifleman,
  tank: buildTank,
  // Without the asset pack, the other infantry and the heavy tank reuse these built-in shapes.
  rocket: buildRifleman,
  grenadier: buildRifleman,
  engineer: buildRifleman,
  scout: buildScout,
  artillery: buildArtillery,
  heavy: buildTank,
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

/** Which of the pack soldier's weapons each kind of infantry carries. */
const SOLDIER_KIT: Partial<Record<UnitType, { weapon: string; trousers?: number }>> = {
  rifleman: { weapon: 'AK' },
  rocket: { weapon: 'RocketLauncher' },
  grenadier: { weapon: 'GrenadeLauncher' },
  engineer: { weapon: 'Shovel', trousers: HAZARD },
};

/** A copy of a pack material in a team's colour, made once per team and shared. */
const tinted = new Map<string, THREE.Material>();
function teamMaterial(source: THREE.Material, owner: number, colour: number): THREE.Material {
  const key = `${owner}:${source.uuid}`;
  let m = tinted.get(key);
  if (!m) {
    m = source.clone();
    (m as THREE.MeshStandardMaterial).color.setHex(colour);
    tinted.set(key, m);
  }
  return m;
}

/** Repaints the parts of a pack model that carry its team colour, and switches on shadows. */
function dress(root: THREE.Object3D, owner: number, colours: Record<string, number>): void {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.castShadow = true;
    o.receiveShadow = true;
    const swap = (m: THREE.Material): THREE.Material =>
      m.name in colours ? teamMaterial(m, owner, colours[m.name]) : m;
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
  });
}

/** Pack models face south and come in their own units, so turn them east and size them in cells. */
function fitted(model: THREE.Object3D, measure: 'height' | 'length', target: number): THREE.Group {
  const size = sizeOf(model);
  model.scale.multiplyScalar(target / (measure === 'height' ? size.y : size.z));
  model.rotation.y = Math.PI / 2;
  const group = new THREE.Group();
  group.add(model);
  return group;
}

/** The weapons the pack's soldier carries. Only one is shown at a time. */
const WEAPONS = [
  'AK', 'GrenadeLauncher', 'Knife_1', 'Knife_2', 'Pistol', 'Revolver', 'Revolver_Small',
  'RocketLauncher', 'ShortCannon', 'Shotgun', 'Shovel', 'SMG', 'Sniper', 'Sniper_2',
];

/**
 * The animated soldier from the asset pack. userData.anim holds its animation
 * player and the clips the game uses, which the renderer switches between.
 */
function packSoldier(owner: number, weapon: string, trousers?: number): THREE.Group | null {
  const gltf = asset('soldier');
  if (!gltf) return null;
  const model = cloneSkinned(gltf.scene);
  const palette = PALETTES[owner % PALETTES.length];
  // Engineers wear high-visibility trousers, so they stand out from the fighting troops.
  dress(model, owner + (trousers ? 200 : 0), { Character_Main: palette.main, Pants: trousers ?? palette.dark });
  model.traverse((o) => {
    if (WEAPONS.includes(o.name)) o.visible = o.name === weapon;
    // Animated meshes move outside their original bounds, so never skip drawing them.
    if (o instanceof THREE.SkinnedMesh) o.frustumCulled = false;
  });
  const group = fitted(model, 'height', 0.74);
  const mixer = new THREE.AnimationMixer(model);
  const clip = (name: string): THREE.AnimationAction | null => {
    const found = gltf.animations.find((a) => a.name === name);
    return found ? mixer.clipAction(found) : null;
  };
  group.userData.anim = { mixer, idle: clip('Idle'), run: clip('Run_Gun'), shoot: clip('Idle_Shoot'), die: clip('Death') };
  return group;
}

/** The pack's tank. The heavy version is bigger, with its colours the other way round. */
function packTank(length: number, heavy: boolean): THREE.Group | null {
  const gltf = asset('tank');
  if (!gltf) return null;
  const model = gltf.scene.clone();
  // team is set by fromTemplate to the palette of whoever this is being built for.
  dress(model, PALETTES.indexOf(team) + (heavy ? 100 : 0), {
    Tank_Main: heavy ? team.dark : team.main,
    Tank_Main2: heavy ? team.main : team.dark,
  });
  return fitted(model, 'length', length);
}

export function makeUnit(type: UnitType, owner: number): THREE.Group {
  // Animated models cannot share a template, so each soldier is built fresh.
  const kit = SOLDIER_KIT[type];
  if (kit) {
    const soldier = packSoldier(owner, kit.weapon, kit.trousers);
    if (soldier) return soldier;
  }
  if (type === 'tank' && asset('tank')) return fromTemplate('packTank', owner, () => packTank(1.3, false)!);
  if (type === 'heavy' && asset('tank')) return fromTemplate('packHeavy', owner, () => packTank(1.8, true)!);
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
