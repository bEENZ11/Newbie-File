// The build sidebar: credits, power, structures and units.

import { canProduce, missingFor, powerOf } from './sim/production';
import type { Sim } from './sim/sim';
import { canTrain, missingForUnit } from './sim/training';
import {
  BUILDING_DEFS,
  BUILDING_TYPES,
  UNIT_DEFS,
  UNIT_TYPES,
  type BuildingType,
  type UnitType,
} from './sim/types';
import { LOCAL_PLAYER, type UiState } from './ui';

/** Short names, so a locked button can say what it needs in one line. */
const SHORT: Record<BuildingType, string> = {
  conyard: 'Yard',
  power: 'Power',
  refinery: 'Refinery',
  barracks: 'Barracks',
  factory: 'Factory',
  turret: 'Turret',
  radar: 'Radar',
  tech: 'Tech Centre',
  depot: 'Depot',
  wall: 'Wall',
};

interface Entry {
  button: HTMLButtonElement;
  status: HTMLElement;
  count: HTMLElement;
  /** Works out how this button should look right now. */
  view: () => { state: string; label: string; progress: number; count: number; placing: boolean };
}

export class Sidebar {
  private credits: HTMLElement;
  private powerFill: HTMLElement;
  private powerText: HTMLElement;
  private powerBox: HTMLElement;
  private sellButton: HTMLButtonElement;
  private repairButton: HTMLButtonElement;
  private entries: Entry[] = [];
  private tabs: HTMLButtonElement[] = [];
  /** Credits shown on screen, which roll towards the real figure. */
  private shownCredits = -1;

  constructor(
    private root: HTMLElement,
    private sim: Sim,
    private ui: UiState,
    private icons: Record<string, string> = {},
  ) {
    this.credits = root.querySelector('#credits')!;
    this.powerBox = root.querySelector('#power')!;
    this.powerFill = root.querySelector('#power-fill')!;
    this.powerText = root.querySelector('#power-text')!;
    this.sellButton = root.querySelector('#sell')!;
    this.repairButton = root.querySelector('#repair')!;

    for (const type of BUILDING_TYPES) {
      if (BUILDING_DEFS[type].produceTicks > 0) this.addStructure(type);
    }
    for (const type of UNIT_TYPES) {
      if (UNIT_DEFS[type].queue) this.addUnit(type);
    }

    this.sellButton.addEventListener('click', () => {
      ui.sellMode = !ui.sellMode;
      ui.repairMode = false;
      ui.placing = null;
    });
    this.repairButton.addEventListener('click', () => {
      ui.repairMode = !ui.repairMode;
      ui.sellMode = false;
      ui.placing = null;
    });
    // Only one list shows at a time. The tabs along the top switch between them.
    this.tabs = [...root.querySelectorAll<HTMLButtonElement>('#tabs button')];
    for (const tab of this.tabs) {
      tab.addEventListener('click', () => this.showTab(tab.dataset.tab!));
    }
    this.showTab('structures');

    // Clicks on the sidebar should never fall through to the map.
    root.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  private showTab(name: string): void {
    for (const tab of this.tabs) {
      const on = tab.dataset.tab === name;
      tab.classList.toggle('on', on);
      (this.root.querySelector(`#${tab.dataset.tab}`) as HTMLElement).hidden = !on;
    }
  }

  private addButton(
    listId: string,
    key: string,
    name: string,
    cost: number,
    onClick: () => void,
    onRightClick: () => void,
    view: Entry['view'],
  ): void {
    const button = document.createElement('button');
    button.className = 'build';
    if (this.icons[key]) button.style.setProperty('--icon', `url(${this.icons[key]})`);
    button.title = name;
    button.innerHTML =
      `<span class="clock"></span>` +
      `<span class="count"></span>` +
      `<span class="name">${name}</span>` +
      `<span class="cost">${cost.toLocaleString('en-GB')}</span>` +
      `<span class="status"></span>`;
    button.addEventListener('click', onClick);
    button.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      onRightClick();
    });
    this.root.querySelector(listId)!.appendChild(button);
    this.entries.push({
      button,
      status: button.querySelector('.status')!,
      count: button.querySelector('.count')!,
      view,
    });
  }

  private addStructure(type: BuildingType): void {
    const def = BUILDING_DEFS[type];
    const { sim, ui } = this;
    const production = () => sim.world.players[LOCAL_PLAYER].production;

    const onClick = (): void => {
      const prod = production();
      ui.sellMode = false;
      ui.repairMode = false;
      if (!prod || (prod.type === type && prod.state === 'held')) {
        sim.issue({ type: 'build', player: LOCAL_PLAYER, building: type });
      } else if (prod.type === type && prod.state === 'ready') {
        ui.placing = ui.placing === type ? null : type;
      }
    };
    // First right-click puts the item on hold, the second cancels it.
    const onRightClick = (): void => {
      const prod = production();
      if (!prod || prod.type !== type) return;
      if (prod.state === 'active') {
        sim.issue({ type: 'hold', player: LOCAL_PLAYER });
      } else {
        sim.issue({ type: 'cancel', player: LOCAL_PLAYER });
        ui.placing = null;
      }
    };

    this.addButton('#structures', type, def.name, def.cost, onClick, onRightClick, () => {
      const prod = production();
      const mine = prod?.type === type ? prod : null;
      const placing = ui.placing === type;
      if (mine) {
        const progress = mine.progress / mine.total;
        const pct = Math.floor(progress * 100);
        const label =
          mine.state === 'ready'
            ? placing
              ? 'Choose a spot'
              : 'Ready'
            : mine.state === 'held'
              ? `On hold ${pct}%`
              : `${pct}%`;
        return { state: mine.state, label, progress, count: 0, placing };
      }
      if (!canProduce(sim.world, LOCAL_PLAYER, type)) {
        const missing = missingFor(sim.world, LOCAL_PLAYER, type);
        const label = missing.length ? `Needs ${SHORT[missing[0]]}` : '';
        return { state: 'locked', label, progress: 0, count: 0, placing };
      }
      if (prod) return { state: 'busy', label: '', progress: 0, count: 0, placing };
      return { state: 'idle', label: '', progress: 0, count: 0, placing };
    });
  }

  private addUnit(type: UnitType): void {
    const def = UNIT_DEFS[type];
    const kind = def.queue!;
    const { sim } = this;
    const queue = () => sim.world.players[LOCAL_PLAYER].queues[kind];

    // Each click queues one more. Right-click holds, then removes.
    const onClick = (): void => sim.issue({ type: 'train', player: LOCAL_PLAYER, unit: type });
    const onRightClick = (): void => sim.issue({ type: 'untrain', player: LOCAL_PLAYER, unit: type });

    this.addButton(`#${kind}`, type, def.name, def.cost, onClick, onRightClick, () => {
      const q = queue();
      const count = q.items.filter((t) => t === type).length;
      const head = q.items[0] === type;
      if (head) {
        const progress = q.progress / def.produceTicks;
        const pct = Math.floor(progress * 100);
        return q.held
          ? { state: 'held', label: `On hold ${pct}%`, progress, count, placing: false }
          : { state: 'active', label: `${pct}%`, progress, count, placing: false };
      }
      if (count > 0) return { state: 'queued', label: 'Queued', progress: 0, count, placing: false };
      if (!canTrain(sim.world, LOCAL_PLAYER, type)) {
        const missing = missingForUnit(sim.world, LOCAL_PLAYER, type);
        const label = missing.length ? `Needs ${SHORT[missing[0]]}` : '';
        return { state: 'locked', label, progress: 0, count: 0, placing: false };
      }
      return { state: 'idle', label: '', progress: 0, count: 0, placing: false };
    });
  }

  update(): void {
    const world = this.sim.world;
    const player = world.players[LOCAL_PLAYER];

    // Roll the counter instead of jumping, so spending is easy to follow.
    if (this.shownCredits < 0) this.shownCredits = player.credits;
    const gap = player.credits - this.shownCredits;
    if (gap !== 0) {
      const step = Math.max(1, Math.ceil(Math.abs(gap) / 8));
      this.shownCredits += Math.sign(gap) * Math.min(Math.abs(gap), step);
    }
    setText(this.credits, this.shownCredits.toLocaleString('en-GB'));

    const power = powerOf(world, LOCAL_PLAYER);
    const scale = Math.max(100, power.supply, power.demand);
    this.powerFill.style.width = `${(power.supply / scale) * 100}%`;
    this.powerBox.style.setProperty('--demand', `${(power.demand / scale) * 100}%`);
    this.powerBox.classList.toggle('low', power.low);
    setText(
      this.powerText,
      power.low ? `Low power  ${power.supply} / ${power.demand}` : `${power.supply} / ${power.demand}`,
    );

    for (const entry of this.entries) {
      const v = entry.view();
      if (entry.button.dataset.state !== v.state) entry.button.dataset.state = v.state;
      entry.button.style.setProperty('--p', `${v.progress * 360}deg`);
      entry.button.classList.toggle('placing', v.placing);
      setText(entry.status, v.label);
      setText(entry.count, v.count > 1 ? `×${v.count}` : '');
    }

    // Mark each tab with what is going on behind it, so nothing finishes unnoticed.
    for (const tab of this.tabs) {
      const name = tab.dataset.tab!;
      let state = '';
      if (name === 'structures') {
        const prod = player.production;
        state = prod ? (prod.state === 'ready' ? 'ready' : 'busy') : '';
      } else if (player.queues[name as 'infantry' | 'vehicle'].items.length > 0) {
        state = 'busy';
      }
      if (tab.dataset.state !== state) tab.dataset.state = state;
    }

    this.sellButton.classList.toggle('on', this.ui.sellMode);
    this.repairButton.classList.toggle('on', this.ui.repairMode);
  }
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}
