// Health bars that float above units and buildings and always face the camera.

import * as THREE from 'three';

interface Bar {
  group: THREE.Group;
  fill: THREE.Mesh;
  used: boolean;
}

const PLANE = new THREE.PlaneGeometry(1, 1);
const BACK = new THREE.MeshBasicMaterial({ color: 0x0b0d0f, depthTest: false, transparent: true, opacity: 0.85 });
const colours = [0x4fd16a, 0xe8c13a, 0xe8483f].map(
  // Transparent so it is drawn in the same pass as the backing, and on top of it.
  (c) => new THREE.MeshBasicMaterial({ color: c, depthTest: false, transparent: true }),
);

export class HealthBars {
  private bars = new Map<number, Bar>();

  constructor(private scene: THREE.Scene) {}

  /** Call before a frame's bars are shown. */
  begin(): void {
    for (const bar of this.bars.values()) bar.used = false;
  }

  show(id: number, x: number, y: number, z: number, fraction: number, width: number, camera: THREE.Camera): void {
    let bar = this.bars.get(id);
    if (!bar) {
      const group = new THREE.Group();
      const back = new THREE.Mesh(PLANE, BACK);
      back.scale.set(1.06, 0.14, 1);
      back.renderOrder = 5;
      const fill = new THREE.Mesh(PLANE, colours[0]);
      fill.renderOrder = 6;
      group.add(back, fill);
      this.scene.add(group);
      bar = { group, fill, used: true };
      this.bars.set(id, bar);
    }
    bar.used = true;
    const f = Math.min(1, Math.max(0, fraction));
    bar.group.position.set(x, y, z);
    bar.group.quaternion.copy(camera.quaternion);
    bar.group.scale.setScalar(width);
    bar.fill.scale.set(Math.max(0.001, f), 0.085, 1);
    // Anchor the fill to the left end as it shrinks.
    bar.fill.position.x = -(1 - f) / 2;
    bar.fill.material = colours[f > 0.5 ? 0 : f > 0.25 ? 1 : 2];
  }

  /** Call after a frame's bars are shown. Removes any that were not wanted. */
  end(): void {
    for (const [id, bar] of this.bars) {
      if (bar.used) continue;
      this.scene.remove(bar.group);
      this.bars.delete(id);
    }
  }
}
