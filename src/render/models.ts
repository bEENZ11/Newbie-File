// Low-poly placeholder models built from simple shapes.
// One cell is one unit. Models face east (+x) and sit on the ground at y = 0.

import * as THREE from 'three';

const TEAM = 0x3f86e0;
const TEAM_DARK = 0x24569c;
const TEAM_LIGHT = 0x9cc4f7;
const STEEL = 0x66717c;
const STEEL_DARK = 0x3a424b;
const CONCRETE = 0x7d868f;
const RUBBER = 0x1c1f23;
const HAZARD = 0xe8b730;
const GLASS = 0xbfe3ff;

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

function finish<T extends THREE.Object3D>(root: T): T {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return root;
}

function buildPioneer(): THREE.Group {
  const g = new THREE.Group();
  // Tracks and chassis.
  g.add(box(1.7, 0.26, 0.26, RUBBER, 0, 0, -0.42));
  g.add(box(1.7, 0.26, 0.26, RUBBER, 0, 0, 0.42));
  g.add(box(1.6, 0.2, 0.62, TEAM_DARK, 0, 0.16, 0));
  // Cab at the front with a windscreen and a beacon.
  g.add(box(0.44, 0.4, 0.7, TEAM, 0.55, 0.36, 0));
  g.add(box(0.06, 0.18, 0.58, GLASS, 0.77, 0.52, 0));
  g.add(box(0.1, 0.07, 0.1, HAZARD, 0.5, 0.76, 0.2));
  // The folded-up yard carried on the back.
  g.add(box(1.02, 0.44, 0.8, STEEL, -0.26, 0.36, 0));
  g.add(box(0.9, 0.06, 0.62, TEAM, -0.26, 0.8, 0));
  g.add(box(0.94, 0.05, 0.1, TEAM_LIGHT, -0.26, 0.8, -0.37));
  g.add(box(0.94, 0.05, 0.1, TEAM_LIGHT, -0.26, 0.8, 0.37));
  // Crane boom strapped along the roof.
  g.add(box(1.1, 0.08, 0.1, HAZARD, -0.2, 0.86, 0));
  g.add(box(0.14, 0.14, 0.18, STEEL_DARK, -0.72, 0.86, 0));
  g.scale.setScalar(1.12);
  return finish(g);
}

/**
 * The Construction Yard. Children tagged with userData.stage rise in that
 * order during the build-up animation, and userData.arm marks the crane arm.
 */
function buildConyard(): THREE.Group {
  const g = new THREE.Group();
  const stage = (index: number, ...parts: THREE.Object3D[]): void => {
    const holder = new THREE.Group();
    holder.userData.stage = index;
    for (const p of parts) holder.add(p);
    g.add(holder);
  };

  // 0: foundation slab.
  stage(0, box(2.84, 0.12, 2.84, CONCRETE, 0, 0, 0));

  // 1: assembly pad with hazard edging.
  stage(
    1,
    box(1.05, 0.05, 1.7, STEEL_DARK, 0.8, 0.12, 0.42),
    box(1.05, 0.06, 0.07, HAZARD, 0.8, 0.12, -0.4),
    box(1.05, 0.06, 0.07, HAZARD, 0.8, 0.12, 1.24),
    box(0.07, 0.06, 1.7, HAZARD, 0.31, 0.12, 0.42),
    box(0.07, 0.06, 1.7, HAZARD, 1.29, 0.12, 0.42),
  );

  // 2: main workshop.
  stage(
    2,
    box(1.45, 1.25, 1.95, TEAM, -0.6, 0.12, -0.3),
    box(0.8, 0.7, 0.06, STEEL_DARK, -0.6, 0.12, 0.69),
    box(1.49, 0.12, 1.99, TEAM_LIGHT, -0.6, 1.05, -0.3),
    box(0.2, 0.16, 0.06, GLASS, -1.05, 0.72, 0.69),
    box(0.2, 0.16, 0.06, GLASS, -0.15, 0.72, 0.69),
  );

  // 3: roof and chimney.
  const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.5, 8), mat(STEEL_DARK));
  chimney.position.set(-0.95, 1.7, -0.9);
  stage(3, box(1.6, 0.1, 2.1, TEAM_DARK, -0.6, 1.37, -0.3), chimney);

  // 4: side annex.
  stage(
    4,
    box(1.0, 0.62, 0.7, STEEL, -0.82, 0.12, 1.02),
    box(1.06, 0.06, 0.76, TEAM_DARK, -0.82, 0.74, 1.02),
  );

  // 5: crane tower.
  stage(5, box(0.22, 2.15, 0.22, HAZARD, 0.8, 0.12, -0.95), box(0.34, 0.22, 0.34, STEEL_DARK, 0.8, 2.27, -0.95));

  // 6: crane arm, which swings once the yard is working.
  const arm = new THREE.Group();
  arm.position.set(0.8, 2.49, -0.95);
  arm.userData.arm = true;
  arm.add(box(1.9, 0.09, 0.12, HAZARD, 0.55, 0, 0));
  arm.add(box(0.3, 0.22, 0.26, STEEL_DARK, -0.42, -0.06, 0));
  arm.add(box(0.03, 0.55, 0.03, RUBBER, 1.35, -0.55, 0));
  stage(6, arm);

  return finish(g);
}

let pioneerTemplate: THREE.Group | null = null;
let conyardTemplate: THREE.Group | null = null;

// Clones share geometry and materials, so extra copies are cheap.
export function makePioneer(): THREE.Group {
  pioneerTemplate ??= buildPioneer();
  return pioneerTemplate.clone();
}

export function makeConyard(): THREE.Group {
  conyardTemplate ??= buildConyard();
  return conyardTemplate.clone();
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
