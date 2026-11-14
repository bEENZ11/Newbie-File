// The build sidebar: credits, power and the list of structures.

import { canProduce, missingFor, powerOf } from './sim/production';
import type { Sim } from './sim/sim';
import { BUILDING_DEFS, BUILDING_TYPES, TICK_RATE, type BuildingType } from './sim/types';
import { LOCAL_PLAYER, type UiState } from './ui';

interface Entry {
  type: BuildingType;
  button: HTMLButtonElement;
  status: HTMLElement;
}

export class Sidebar {
  private credits: HTMLElement;
  private powerFill: HTMLElement;
  private powerText: HTMLElement;
  private powerBox: HTMLElement;
  private sellButton: HTMLButtonElement;
  private entries: Entry[] = [];
  /** Credits shown on screen, which roll towards the real figure. */
  private shownCredits = -1;

  constructor(
    root: HTMLElement,
    private sim: Sim,
    private ui: UiState,
  ) {
    this.credits = root.querySelector('#credits')!;
    this.powerBox = root.querySelector('#power')!;
    this.powerFill = root.querySelector('#power-fill')!;
    this.powerText = root.querySelector('#power-text')!;
    this.sellButton = root.querySelector('#sell')!;
    const list = root.querySelector('#structures')!;

    for (const type of BUILDING_TYPES) {
      const def = BUILDING_DEFS[type];
      if (def.produceTicks <= 0) continue;
      const button = document.createElement('button');
      button.className = 'build';
      button.dataset.type = type;
      button.innerHTML =
        `<span class="clock"></span>` +
        `<span class="name">${def.name}</span>` +
        `<span class="cost">${def.cost.toLocaleString('en-GB')}</span>` +
        `<span class="status"></span>`;
      button.addEventListener('click', () => this.onClick(type));
      button.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.onRightClick(type);
      });
      list.appendChild(button);
      this.entries.push({ type, button, status: button.querySelector('.status')! });
    }

    this.sellButton.addEventListener('click', () => {
      ui.sellMode = !ui.sellMode;
      ui.placing = null;
    });
    // Clicks on the sidebar should never fall through to the map.
    root.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  private onClick(type: BuildingType): void {
    const prod = this.sim.world.players[LOCAL_PLAYER].production;
    this.ui.sellMode = false;
    if (!prod) {
      this.sim.issue({ type: 'build', player: LOCAL_PLAYER, building: type });
    } else if (prod.type === type && prod.state === 'held') {
      this.sim.issue({ type: 'build', player: LOCAL_PLAYER, building: type });
    } else if (prod.type === type && prod.state === 'ready') {
      this.ui.placing = this.ui.placing === type ? null : type;
    }
  }

  /** First right-click puts the item on hold, the second cancels it. */
  private onRightClick(type: BuildingType): void {
    const prod = this.sim.world.players[LOCAL_PLAYER].production;
    if (!prod || prod.type !== type) return;
    if (prod.state === 'active') {
      this.sim.issue({ type: 'hold', player: LOCAL_PLAYER });
    } else {
      this.sim.issue({ type: 'cancel', player: LOCAL_PLAYER });
      this.ui.placing = null;
    }
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

    const prod = player.production;
    for (const { type, button, status } of this.entries) {
      const mine = prod?.type === type ? prod : null;
      const unlocked = canProduce(world, LOCAL_PLAYER, type);
      let label = '';
      let state = 'idle';
      if (mine) {
        state = mine.state;
        const pct = Math.floor((mine.progress / mine.total) * 100);
        button.style.setProperty('--p', `${(mine.progress / mine.total) * 360}deg`);
        if (mine.state === 'ready') label = this.ui.placing === type ? 'Choose a spot' : 'Ready';
        else if (mine.state === 'held') label = `On hold ${pct}%`;
        else label = `${pct}%`;
      } else if (!unlocked) {
        state = 'locked';
        const missing = missingFor(world, LOCAL_PLAYER, type);
        label = missing.length ? `Needs ${BUILDING_DEFS[missing[0]].name}` : '';
      } else if (prod) {
        state = 'busy';
      } else {
        label = `${Math.round(BUILDING_DEFS[type].produceTicks / TICK_RATE)}s`;
      }
      if (button.dataset.state !== state) button.dataset.state = state;
      button.classList.toggle('placing', this.ui.placing === type);
      setText(status, label);
    }

    this.sellButton.classList.toggle('on', this.ui.sellMode);
  }
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}
