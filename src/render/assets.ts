// Loads the 3D models that come from an asset pack. If any of them fail to
// load, the game carries on with its own built-in models instead.

import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

const FILES = {
  soldier: 'soldier.gltf',
  tank: 'tank.gltf',
  tree1: 'tree1.gltf',
  tree2: 'tree2.gltf',
  tree3: 'tree3.gltf',
  tree4: 'tree4.gltf',
} as const;

export type AssetName = keyof typeof FILES;

const loaded = new Map<AssetName, GLTF>();

export function asset(name: AssetName): GLTF | null {
  return loaded.get(name) ?? null;
}

export async function loadAssets(): Promise<void> {
  const loader = new GLTFLoader();
  const base = `${import.meta.env.BASE_URL}models/`;
  await Promise.all(
    (Object.keys(FILES) as AssetName[]).map(async (name) => {
      try {
        const gltf = await loader.loadAsync(base + FILES[name]);
        gltf.scene.updateMatrixWorld(true);
        loaded.set(name, gltf);
      } catch (error) {
        console.warn(`Could not load ${FILES[name]}, using the built-in model instead.`, error);
      }
    }),
  );
}

/** The size of a model as loaded, before the game scales it. */
export function sizeOf(object: THREE.Object3D): THREE.Vector3 {
  return new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
}
