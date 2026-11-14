// Short-lived battle effects: tracers, shells, muzzle flashes and explosions.
// Purely visual. The simulation has already applied the damage.

import * as THREE from 'three';
import { SUB, type SimEvent } from '../sim/types';

interface Effect {
  obj: THREE.Mesh;
  start: number;
  life: number;
  /** Called every frame with progress from 0 to 1. */
  update: (t: number, obj: THREE.Mesh) => void;
}

const SPHERE = new THREE.SphereGeometry(1, 12, 8);
const BOX = new THREE.BoxGeometry(1, 1, 1);
const DISC = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
const SHOT_HEIGHT = 0.4;

export class Effects {
  private live: Effect[] = [];

  constructor(private scene: THREE.Scene) {}

  private add(
    geometry: THREE.BufferGeometry,
    colour: number,
    start: number,
    life: number,
    update: Effect['update'],
  ): THREE.Mesh {
    const material = new THREE.MeshBasicMaterial({ color: colour, transparent: true, depthWrite: false });
    const obj = new THREE.Mesh(geometry, material);
    obj.visible = false;
    this.scene.add(obj);
    this.live.push({ obj, start, life, update });
    return obj;
  }

  /** A ball of fire that swells and fades, followed by a puff of smoke. */
  private blast(x: number, y: number, z: number, size: number, start: number): void {
    const fire = this.add(SPHERE, 0xffb347, start, 380, (t, o) => {
      o.scale.setScalar(size * (0.25 + 0.75 * Math.sqrt(t)));
      (o.material as THREE.MeshBasicMaterial).opacity = 1 - t * t;
    });
    fire.position.set(x, y, z);
    const core = this.add(SPHERE, 0xfff3c4, start, 180, (t, o) => {
      o.scale.setScalar(size * 0.5 * (0.4 + 0.6 * t));
      (o.material as THREE.MeshBasicMaterial).opacity = 1 - t;
    });
    core.position.set(x, y, z);
    const smoke = this.add(SPHERE, 0x2b2b2b, start + 120, 700, (t, o) => {
      o.scale.setScalar(size * (0.5 + 0.7 * t));
      o.position.y = y + t * size * 0.9;
      (o.material as THREE.MeshBasicMaterial).opacity = 0.45 * (1 - t);
    });
    smoke.position.set(x, y, z);
  }

  /** A wisp of smoke or steam that drifts up and thins out. */
  puff(x: number, y: number, z: number, size: number, colour: number, now: number): void {
    if (this.live.length > 260) return;
    const drift = (Math.random() - 0.5) * 0.5;
    const puff = this.add(SPHERE, colour, now, 1400 + Math.random() * 600, (t, o) => {
      o.scale.setScalar(size * (0.5 + 1.1 * t));
      o.position.set(x + drift * t + 0.35 * t, y + 1.3 * t, z + drift * t * 0.5);
      (o.material as THREE.MeshBasicMaterial).opacity = 0.42 * (1 - t) * Math.min(1, t * 6);
    });
    puff.position.set(x, y, z);
  }

  /** A lick of flame, for buildings that are badly damaged. */
  flame(x: number, y: number, z: number, size: number, now: number): void {
    if (this.live.length > 260) return;
    const f = this.add(SPHERE, Math.random() < 0.5 ? 0xff8a2a : 0xffc04a, now, 320, (t, o) => {
      o.scale.set(size * (1 - t * 0.5), size * (1 + t * 1.6), size * (1 - t * 0.5));
      o.position.y = y + t * 0.3;
      (o.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t);
    });
    f.position.set(x, y, z);
  }

  /** A burn mark left on the ground, which fades over the next minute. */
  private scorch(x: number, z: number, size: number, now: number): void {
    const mark = this.add(DISC, 0x000000, now, 60000, (t, o) => {
      (o.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - t * t) * Math.min(1, t * 400);
    });
    mark.position.set(x, 0.012, z);
    mark.scale.setScalar(size);
    mark.renderOrder = 1;
  }

  onEvent(ev: SimEvent, now: number): void {
    if (ev.type === 'shot') {
      const from = new THREE.Vector3(ev.fromX / SUB, SHOT_HEIGHT, ev.fromY / SUB);
      const to = new THREE.Vector3(ev.toX / SUB, SHOT_HEIGHT, ev.toY / SUB);
      const dir = to.clone().sub(from);
      const length = dir.length();
      if (length > 0) from.addScaledVector(dir, 0.45 / length);

      const flash = this.add(SPHERE, 0xfff1a8, now, 70, (t, o) => {
        o.scale.setScalar((ev.kind === 'shell' ? 0.22 : 0.1) * (1 - t * 0.5));
        (o.material as THREE.MeshBasicMaterial).opacity = 1 - t;
      });
      flash.position.copy(from);

      if (ev.kind === 'bullet') {
        // A streak of light along the line of fire.
        const tracer = this.add(BOX, 0xffe680, now, 90, (t, o) => {
          (o.material as THREE.MeshBasicMaterial).opacity = 1 - t;
        });
        tracer.position.copy(from).lerp(to, 0.5);
        tracer.scale.set(0.03, 0.03, from.distanceTo(to));
        tracer.lookAt(to);
        const spark = this.add(SPHERE, 0xffd27a, now + 40, 120, (t, o) => {
          o.scale.setScalar(0.07 + 0.08 * t);
          (o.material as THREE.MeshBasicMaterial).opacity = 1 - t;
        });
        spark.position.copy(to);
      } else {
        // A shell that flies across, then bursts where it lands.
        const flight = 130;
        this.add(SPHERE, 0x222222, now, flight, (t, o) => {
          o.position.copy(from).lerp(to, t);
          o.position.y += Math.sin(t * Math.PI) * 0.25;
          o.scale.setScalar(0.07);
        });
        this.blast(to.x, to.y, to.z, 0.38, now + flight);
      }
    } else if (ev.type === 'unitDied') {
      const size = ev.unit === 'rifleman' ? 0.3 : 0.9;
      this.blast(ev.x / SUB, 0.35, ev.y / SUB, size, now);
      if (ev.unit !== 'rifleman') this.scorch(ev.x / SUB, ev.y / SUB, 0.55, now);
    } else if (ev.type === 'buildingDestroyed') {
      // A string of blasts across the footprint, then one big one.
      const cx = ev.cx + ev.w / 2;
      const cz = ev.cy + ev.h / 2;
      for (let i = 0; i < 5; i++) {
        const ox = (((i * 37) % 10) / 10 - 0.5) * ev.w * 0.8;
        const oz = (((i * 53) % 10) / 10 - 0.5) * ev.h * 0.8;
        this.blast(cx + ox, 0.6, cz + oz, 0.7, now + i * 90);
      }
      this.blast(cx, 0.8, cz, Math.max(ev.w, ev.h) * 0.75, now + 380);
      this.scorch(cx, cz, Math.max(ev.w, ev.h) * 0.62, now);
    }
  }

  update(now: number): void {
    this.live = this.live.filter((e) => {
      const t = (now - e.start) / e.life;
      if (t >= 1) {
        this.scene.remove(e.obj);
        (e.obj.material as THREE.Material).dispose();
        return false;
      }
      e.obj.visible = t >= 0;
      if (t >= 0) e.update(t, e.obj);
      return true;
    });
  }
}
