// Renders a small portrait of each building and unit, for the sidebar buttons.
// Done once at start-up from the same models the game uses, so the icons
// always match what appears on the map.

import * as THREE from 'three';
import { BUILDING_DEFS, BUILDING_TYPES, UNIT_DEFS, UNIT_TYPES } from '../sim/types';
import { makeBuilding, makeUnit } from './models';

const WIDTH = 160;
const HEIGHT = 120;

export function renderIcons(): Record<string, string> {
  const icons: Record<string, string> = {};
  const canvas = document.createElement('canvas');
  let gl: THREE.WebGLRenderer;
  try {
    gl = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  } catch {
    return icons;
  }
  gl.setSize(WIDTH, HEIGHT, false);
  gl.toneMapping = THREE.ACESFilmicToneMapping;
  gl.toneMappingExposure = 1.35;

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdcebff, 0x6a5c40, 1.5));
  const sun = new THREE.DirectionalLight(0xffe8c4, 3.2);
  sun.position.set(-4, 7, 5);
  scene.add(sun);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);

  const shoot = (key: string, obj: THREE.Object3D, turn: number): void => {
    obj.rotation.y = turn;
    // Animated models start in a stiff default pose, so put them at ease first.
    const anim = obj.userData.anim as { mixer: THREE.AnimationMixer; idle: THREE.AnimationAction | null } | undefined;
    if (anim?.idle) {
      anim.idle.play();
      anim.mixer.update(0.3);
    }
    scene.add(obj);
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    // Look down from the south at a three-quarter angle, framed to fit.
    camera.position.set(centre.x, centre.y + 12, centre.z + 14);
    camera.lookAt(centre);
    const reach = Math.max(size.x, size.z * 0.9 + size.y * 0.75, 0.6) * 0.62;
    camera.left = -reach * (WIDTH / HEIGHT);
    camera.right = reach * (WIDTH / HEIGHT);
    camera.top = reach;
    camera.bottom = -reach;
    camera.updateProjectionMatrix();
    gl.render(scene, camera);
    icons[key] = canvas.toDataURL('image/png');
    scene.remove(obj);
  };

  for (const type of BUILDING_TYPES) {
    if (BUILDING_DEFS[type].produceTicks > 0) shoot(type, makeBuilding(type, 0), 0.5);
  }
  for (const type of UNIT_TYPES) {
    if (UNIT_DEFS[type].queue) shoot(type, makeUnit(type, 0), -0.7);
  }

  gl.dispose();
  gl.forceContextLoss();
  return icons;
}
