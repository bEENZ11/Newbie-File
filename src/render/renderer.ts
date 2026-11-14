import { canDeploy, deployFootprint } from '../sim/step';
import { MAP_H, MAP_W, SUB, cellIndex, type Building, type Unit, type World } from '../sim/types';
import type { UiState } from '../ui';

/** Pixels per cell. Purely a display choice, the simulation never sees it. */
export const CELL = 32;
export const MAP_PX_W = MAP_W * CELL;
export const MAP_PX_H = MAP_H * CELL;
const TO_PX = CELL / SUB;

const TEAM = '#3f86e0';
const TEAM_LIGHT = '#8fbcf5';
const TEAM_DARK = '#1f4f94';

const MARKER_MS = 450;
const FLASH_MS = 600;

/** Cheap repeatable noise so terrain and ore look the same on every redraw. */
function noise(x: number, y: number, salt: number): number {
  let h = Math.imul(x * 374761393 + y * 668265263 + salt * 2246822519, 3266489917);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private terrain: HTMLCanvasElement;
  private dpr = 1;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.terrain = this.paintTerrain();
  }

  resize(ui: UiState): void {
    this.dpr = window.devicePixelRatio || 1;
    ui.viewW = this.canvas.clientWidth;
    ui.viewH = this.canvas.clientHeight;
    this.canvas.width = Math.round(ui.viewW * this.dpr);
    this.canvas.height = Math.round(ui.viewH * this.dpr);
  }

  private paintTerrain(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = MAP_PX_W;
    c.height = MAP_PX_H;
    const g = c.getContext('2d')!;
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const light = 28 + noise(x, y, 1) * 1.6;
        const hue = 92 + noise(x, y, 2) * 5;
        g.fillStyle = `hsl(${hue} 24% ${light}%)`;
        g.fillRect(x * CELL, y * CELL, CELL, CELL);
        for (let i = 0; i < 3; i++) {
          g.fillStyle = noise(x, y, 10 + i) > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.09)';
          const sx = x * CELL + Math.floor(noise(x, y, 20 + i) * (CELL - 4));
          const sy = y * CELL + Math.floor(noise(x, y, 30 + i) * (CELL - 4));
          g.fillRect(sx, sy, 3, 2);
        }
      }
    }
    g.strokeStyle = 'rgba(0,0,0,0.05)';
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i <= MAP_W; i++) {
      g.moveTo(i * CELL + 0.5, 0);
      g.lineTo(i * CELL + 0.5, MAP_PX_H);
    }
    for (let i = 0; i <= MAP_H; i++) {
      g.moveTo(0, i * CELL + 0.5);
      g.lineTo(MAP_PX_W, i * CELL + 0.5);
    }
    g.stroke();
    return c;
  }

  draw(world: World, ui: UiState, alpha: number, now: number): void {
    const g = this.ctx;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = '#101214';
    g.fillRect(0, 0, ui.viewW, ui.viewH);

    const camX = Math.round(ui.camX);
    const camY = Math.round(ui.camY);
    g.translate(-camX, -camY);
    g.drawImage(this.terrain, 0, 0);

    const x0 = Math.max(0, Math.floor(camX / CELL));
    const y0 = Math.max(0, Math.floor(camY / CELL));
    const x1 = Math.min(MAP_W - 1, Math.floor((camX + ui.viewW) / CELL));
    const y1 = Math.min(MAP_H - 1, Math.floor((camY + ui.viewH) / CELL));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const amount = world.ore[cellIndex(x, y)];
        if (amount > 0) this.drawOre(x, y, amount);
      }
    }

    for (const unit of world.units) {
      if (unit.type === 'pioneer' && ui.selectedUnits.has(unit.id) && unit.path.length === 0) {
        this.drawDeployPreview(world, unit);
      }
    }

    for (const b of world.buildings) this.drawBuilding(b, ui.selectedBuilding === b.id);
    for (const u of world.units) this.drawUnit(u, alpha, ui.selectedUnits.has(u.id));

    ui.flashes = ui.flashes.filter((f) => now - f.t < FLASH_MS);
    for (const f of ui.flashes) {
      const fade = 1 - (now - f.t) / FLASH_MS;
      const on = Math.floor((now - f.t) / 100) % 2 === 0;
      g.fillStyle = `rgba(230,60,50,${(on ? 0.45 : 0.2) * fade})`;
      g.fillRect(f.cx * CELL, f.cy * CELL, f.w * CELL, f.h * CELL);
      g.strokeStyle = `rgba(255,90,80,${fade})`;
      g.lineWidth = 2;
      g.strokeRect(f.cx * CELL + 1, f.cy * CELL + 1, f.w * CELL - 2, f.h * CELL - 2);
    }

    ui.markers = ui.markers.filter((m) => now - m.t < MARKER_MS);
    for (const m of ui.markers) {
      const p = (now - m.t) / MARKER_MS;
      g.strokeStyle = `rgba(120,255,140,${1 - p})`;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(m.x, m.y, 4 + (1 - p) * 12, 0, Math.PI * 2);
      g.stroke();
    }

    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (ui.dragBox) {
      const { x0: bx0, y0: by0, x1: bx1, y1: by1 } = ui.dragBox;
      g.fillStyle = 'rgba(120,255,140,0.12)';
      g.strokeStyle = 'rgba(160,255,170,0.9)';
      g.lineWidth = 1;
      const x = Math.min(bx0, bx1) + 0.5;
      const y = Math.min(by0, by1) + 0.5;
      g.fillRect(x, y, Math.abs(bx1 - bx0), Math.abs(by1 - by0));
      g.strokeRect(x, y, Math.abs(bx1 - bx0), Math.abs(by1 - by0));
    }
  }

  private drawOre(cx: number, cy: number, amount: number): void {
    const g = this.ctx;
    const count = 2 + Math.min(4, Math.floor(amount / 220));
    for (let i = 0; i < count; i++) {
      const x = cx * CELL + 5 + noise(cx, cy, 40 + i) * (CELL - 10);
      const y = cy * CELL + 5 + noise(cx, cy, 50 + i) * (CELL - 10);
      const r = 3 + noise(cx, cy, 60 + i) * 2.5;
      g.fillStyle = '#8a5a12';
      this.diamond(x, y + 1, r + 0.5);
      g.fillStyle = '#e0a526';
      this.diamond(x, y, r);
      g.fillStyle = '#ffe08a';
      this.diamond(x - r * 0.25, y - r * 0.3, r * 0.35);
    }
  }

  private diamond(x: number, y: number, r: number): void {
    const g = this.ctx;
    g.beginPath();
    g.moveTo(x, y - r);
    g.lineTo(x + r, y);
    g.lineTo(x, y + r);
    g.lineTo(x - r, y);
    g.closePath();
    g.fill();
  }

  private drawDeployPreview(world: World, unit: Unit): void {
    const g = this.ctx;
    const f = deployFootprint(unit);
    const ok = canDeploy(world, unit);
    g.fillStyle = ok ? 'rgba(120,255,140,0.10)' : 'rgba(255,90,80,0.14)';
    g.strokeStyle = ok ? 'rgba(160,255,170,0.7)' : 'rgba(255,110,100,0.8)';
    g.lineWidth = 1;
    g.setLineDash([6, 4]);
    g.fillRect(f.cx * CELL, f.cy * CELL, f.w * CELL, f.h * CELL);
    g.strokeRect(f.cx * CELL + 0.5, f.cy * CELL + 0.5, f.w * CELL - 1, f.h * CELL - 1);
    g.setLineDash([]);
  }

  private drawBuilding(b: Building, selected: boolean): void {
    const g = this.ctx;
    const px = b.cx * CELL;
    const py = b.cy * CELL;
    const w = b.w * CELL;
    const h = b.h * CELL;
    const p = b.progress / b.total;

    g.save();
    g.translate(px + w / 2, py + h / 2);
    if (p < 1) {
      // Build-up: the structure unfolds outwards from the vehicle's position.
      const ease = 1 - (1 - p) * (1 - p);
      g.scale(0.38 + 0.62 * ease, 0.38 + 0.62 * ease);
      g.globalAlpha = 0.55 + 0.45 * p;
    }
    const hw = w / 2 - 3;
    const hh = h / 2 - 3;

    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(-hw + 3, -hh + 4, hw * 2, hh * 2);
    g.fillStyle = '#2a3038';
    g.fillRect(-hw, -hh, hw * 2, hh * 2);
    g.fillStyle = '#3c4651';
    g.fillRect(-hw + 4, -hh + 4, hw * 2 - 8, hh * 2 - 8);

    // Workshop block in team colours.
    g.fillStyle = TEAM_DARK;
    g.fillRect(-hw + 9, -hh + 9, hw * 1.05, hh * 2 - 18);
    g.fillStyle = TEAM;
    g.fillRect(-hw + 9, -hh + 9, hw * 1.05, hh * 0.9);
    g.fillStyle = TEAM_LIGHT;
    g.fillRect(-hw + 9, -hh + 9, hw * 1.05, 4);

    // Assembly pad with a crane arm.
    g.fillStyle = '#20252b';
    g.fillRect(hw * 0.22, -hh + 9, hw * 0.78 - 9, hh * 2 - 18);
    g.strokeStyle = '#e4b53a';
    g.lineWidth = 2;
    g.setLineDash([5, 4]);
    g.strokeRect(hw * 0.22 + 4, -hh + 13, hw * 0.78 - 17, hh * 2 - 26);
    g.setLineDash([]);
    g.fillStyle = '#c9ced6';
    g.beginPath();
    g.arc(-hw + 9 + hw * 0.52, hh * 0.38, 7, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#c9ced6';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(-hw + 9 + hw * 0.52, hh * 0.38);
    g.lineTo(hw * 0.6, -hh * 0.25);
    g.stroke();
    g.restore();

    if (p < 1) {
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(px + 8, py + h - 10, w - 16, 5);
      g.fillStyle = '#7dff8e';
      g.fillRect(px + 8, py + h - 10, (w - 16) * p, 5);
    }
    if (selected) this.brackets(px + 1, py + 1, w - 2, h - 2);
  }

  private drawUnit(u: Unit, alpha: number, selected: boolean): void {
    const g = this.ctx;
    const x = (u.prevX + (u.x - u.prevX) * alpha) * TO_PX;
    const y = (u.prevY + (u.y - u.prevY) * alpha) * TO_PX;

    g.save();
    g.translate(x, y);
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.beginPath();
    g.ellipse(3, 5, 27, 20, 0, 0, Math.PI * 2);
    g.fill();
    g.rotate((u.facing * Math.PI) / 4);
    // The Pioneer is a big vehicle, drawn larger than its single cell.
    g.scale(1.35, 1.35);

    // Tracks.
    g.fillStyle = '#1b1e22';
    g.fillRect(-19, -14, 38, 6);
    g.fillRect(-19, 8, 38, 6);
    // Hull.
    g.fillStyle = TEAM_DARK;
    g.fillRect(-17, -10, 34, 20);
    g.fillStyle = TEAM;
    g.fillRect(-17, -10, 24, 20);
    // Folded structure on the back.
    g.fillStyle = '#3c4651';
    g.fillRect(-14, -7, 16, 14);
    g.strokeStyle = '#e4b53a';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(-12, -4);
    g.lineTo(0, 4);
    g.moveTo(-12, 4);
    g.lineTo(0, -4);
    g.stroke();
    // Cab at the front.
    g.fillStyle = TEAM_LIGHT;
    g.fillRect(9, -7, 6, 14);
    g.restore();

    if (selected) this.brackets(x - 29, y - 29, 58, 58);
  }

  private brackets(x: number, y: number, w: number, h: number): void {
    const g = this.ctx;
    const n = 8;
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x, y + n);
    g.lineTo(x, y);
    g.lineTo(x + n, y);
    g.moveTo(x + w - n, y);
    g.lineTo(x + w, y);
    g.lineTo(x + w, y + n);
    g.moveTo(x + w, y + h - n);
    g.lineTo(x + w, y + h);
    g.lineTo(x + w - n, y + h);
    g.moveTo(x + n, y + h);
    g.lineTo(x, y + h);
    g.lineTo(x, y + h - n);
    g.stroke();
  }
}
