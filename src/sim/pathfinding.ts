// A* over the cell grid with integer costs and deterministic tie-breaking.

const STRAIGHT = 10;
const DIAGONAL = 14;

const DIRS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, STRAIGHT],
  [0, 1, STRAIGHT],
  [-1, 0, STRAIGHT],
  [0, -1, STRAIGHT],
  [1, 1, DIAGONAL],
  [-1, 1, DIAGONAL],
  [-1, -1, DIAGONAL],
  [1, -1, DIAGONAL],
];

/** Min-heap ordered by priority, then by insertion order. */
class Heap {
  private cells: number[] = [];
  private prio: number[] = [];
  private seq: number[] = [];
  private counter = 0;

  get size(): number {
    return this.cells.length;
  }

  push(cell: number, priority: number): void {
    let i = this.cells.length;
    this.cells.push(cell);
    this.prio.push(priority);
    this.seq.push(this.counter++);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.cells[0];
    const last = this.cells.length - 1;
    this.swap(0, last);
    this.cells.pop();
    this.prio.pop();
    this.seq.pop();
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let best = i;
      if (l < last && this.less(l, best)) best = l;
      if (r < last && this.less(r, best)) best = r;
      if (best === i) break;
      this.swap(i, best);
      i = best;
    }
    return top;
  }

  private less(a: number, b: number): boolean {
    return this.prio[a] !== this.prio[b] ? this.prio[a] < this.prio[b] : this.seq[a] < this.seq[b];
  }

  private swap(a: number, b: number): void {
    [this.cells[a], this.cells[b]] = [this.cells[b], this.cells[a]];
    [this.prio[a], this.prio[b]] = [this.prio[b], this.prio[a]];
    [this.seq[a], this.seq[b]] = [this.seq[b], this.seq[a]];
  }
}

/** The closest passable cell to the goal, searching outwards in rings. */
export function nearestFree(blocked: Uint8Array, w: number, h: number, gx: number, gy: number): number {
  const max = Math.max(w, h);
  for (let r = 0; r < max; r++) {
    let best = -1;
    let bestDist = 0;
    for (let y = gy - r; y <= gy + r; y++) {
      for (let x = gx - r; x <= gx + r; x++) {
        if (Math.max(Math.abs(x - gx), Math.abs(y - gy)) !== r) continue;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const i = y * w + x;
        if (blocked[i]) continue;
        const d = (x - gx) * (x - gx) + (y - gy) * (y - gy);
        if (best === -1 || d < bestDist) {
          best = i;
          bestDist = d;
        }
      }
    }
    if (best !== -1) return best;
  }
  return -1;
}

/**
 * Returns the cells to walk through, excluding the start and including the
 * destination. If the goal is blocked, heads for the nearest free cell.
 * Returns an empty list when already there or when no route exists.
 */
export function findPath(
  blocked: Uint8Array,
  w: number,
  h: number,
  start: number,
  goalX: number,
  goalY: number,
): number[] {
  const gx = Math.min(w - 1, Math.max(0, goalX));
  const gy = Math.min(h - 1, Math.max(0, goalY));
  const goal = nearestFree(blocked, w, h, gx, gy);
  if (goal === -1 || goal === start) return [];
  const tx = goal % w;
  const ty = (goal - tx) / w;

  const size = w * h;
  const g = new Int32Array(size).fill(-1);
  const from = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);
  const open = new Heap();
  g[start] = 0;
  open.push(start, 0);

  while (open.size > 0) {
    const cur = open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goal) break;
    const x = cur % w;
    const y = (cur - x) / w;
    for (const [dx, dy, cost] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = ny * w + nx;
      if (blocked[n] || closed[n]) continue;
      // No squeezing diagonally past the corner of an obstacle.
      if (dx !== 0 && dy !== 0 && (blocked[y * w + nx] || blocked[ny * w + x])) continue;
      const ng = g[cur] + cost;
      if (g[n] !== -1 && ng >= g[n]) continue;
      g[n] = ng;
      from[n] = cur;
      const ax = Math.abs(nx - tx);
      const ay = Math.abs(ny - ty);
      const heuristic = STRAIGHT * (ax + ay) - (2 * STRAIGHT - DIAGONAL) * Math.min(ax, ay);
      open.push(n, ng + heuristic);
    }
  }

  if (from[goal] === -1) return [];
  const path: number[] = [];
  for (let c = goal; c !== start; c = from[c]) path.push(c);
  return path.reverse();
}
