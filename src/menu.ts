// The screen shown before a game starts, for choosing a side and the settings.

import { css, setFactions, palettes } from './render/teams';
import { DIFFICULTIES, FACTIONS, FACTION_DEFS, UNIT_DEFS, type Difficulty, type Faction } from './sim/types';

export interface GameOptions {
  faction: Faction;
  enemy: Faction;
  difficulty: Difficulty;
  credits: number;
  seed: number;
}

const CREDIT_CHOICES = [5000, 10000, 20000];
const DIFFICULTY_NAMES: Record<Difficulty, string> = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };
const DIFFICULTY_NOTES: Record<Difficulty, string> = {
  easy: 'First attack after six minutes',
  normal: 'First attack after four minutes',
  hard: 'First attack after two and a half minutes',
};

/** Each faction's badge, drawn as a simple shape so it needs no image files. */
export const EMBLEMS: Record<Faction, string> = {
  // A shield with a chevron.
  aegis:
    '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 4 56 12v18c0 15-10 25-24 30C18 55 8 45 8 30V12z" fill="currentColor" opacity=".22"/><path d="M32 4 56 12v18c0 15-10 25-24 30C18 55 8 45 8 30V12z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M20 26l12 10 12-10M20 36l12 10 12-10" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  // A star inside an octagon.
  dominion:
    '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M22 5h20l17 17v20L42 59H22L5 42V22z" fill="currentColor" opacity=".22"/><path d="M22 5h20l17 17v20L42 59H22L5 42V22z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M32 15l5 11 12 1-9 8 3 12-11-6-11 6 3-12-9-8 12-1z" fill="currentColor"/></svg>',
};

/** The units one side has that the other does not, as a readable list. */
function ownUnits(faction: Faction): string {
  return FACTION_DEFS[otherThan(faction)].withoutUnits.map((u) => UNIT_DEFS[u].name).join(', ');
}

function otherThan(faction: Faction): Faction {
  return FACTIONS.find((f) => f !== faction) ?? faction;
}

function remembered(): Partial<GameOptions> {
  try {
    return JSON.parse(localStorage.getItem('options') ?? '{}') as Partial<GameOptions>;
  } catch {
    return {};
  }
}

/** Reads a choice from the page address, so a game can be started with a link. */
function fromAddress(): GameOptions | null {
  const q = new URLSearchParams(location.search);
  const faction = q.get('faction') as Faction | null;
  if (!faction || !FACTIONS.includes(faction)) return null;
  const enemy = q.get('enemy') as Faction | null;
  const difficulty = q.get('difficulty') as Difficulty | null;
  const seed = Number(q.get('seed'));
  return {
    faction,
    enemy: enemy && FACTIONS.includes(enemy) ? enemy : otherThan(faction),
    difficulty: difficulty && DIFFICULTIES.includes(difficulty) ? difficulty : 'normal',
    credits: Number(q.get('credits')) || 5000,
    seed: Number.isInteger(seed) && seed !== 0 ? seed : Date.now() & 0x7fffffff,
  };
}

/** Shows the menu and waits for the player to start. Skipped if the address already says what to play. */
export function chooseOptions(): Promise<GameOptions> {
  const preset = fromAddress();
  const menu = document.getElementById('menu')!;
  if (preset) {
    menu.remove();
    return Promise.resolve(preset);
  }

  const last = remembered();
  const state: GameOptions = {
    faction: last.faction && FACTIONS.includes(last.faction) ? last.faction : 'aegis',
    enemy: last.enemy && FACTIONS.includes(last.enemy) ? last.enemy : 'dominion',
    difficulty: last.difficulty && DIFFICULTIES.includes(last.difficulty) ? last.difficulty : 'normal',
    credits: CREDIT_CHOICES.includes(last.credits ?? 0) ? last.credits! : 5000,
    seed: 0,
  };

  const cards = menu.querySelector('#factions')!;
  const enemyRow = menu.querySelector('#enemy')!;
  const difficultyRow = menu.querySelector('#difficulty')!;
  const creditsRow = menu.querySelector('#credits-choice')!;
  const note = menu.querySelector('#difficulty-note')!;
  const seedInput = menu.querySelector<HTMLInputElement>('#seed')!;
  const start = menu.querySelector<HTMLButtonElement>('#start')!;

  /** A row of buttons where exactly one is picked. */
  function choices<T>(row: Element, items: readonly T[], label: (item: T) => string, pick: (item: T) => void): void {
    row.replaceChildren(
      ...items.map((item) => {
        const button = document.createElement('button');
        button.textContent = label(item);
        button.addEventListener('click', () => {
          pick(item);
          draw();
        });
        button.dataset.value = String(item);
        return button;
      }),
    );
  }

  function mark(row: Element, value: unknown): void {
    for (const b of row.querySelectorAll<HTMLElement>('button')) b.classList.toggle('on', b.dataset.value === String(value));
  }

  function draw(): void {
    // Colours follow the factions, including the alternate set for a mirror match.
    setFactions([state.faction, state.enemy]);
    cards.replaceChildren(
      ...FACTIONS.map((f) => {
        const def = FACTION_DEFS[f];
        const card = document.createElement('button');
        card.className = 'faction';
        card.classList.toggle('on', state.faction === f);
        card.style.setProperty('--team', css(f === state.faction ? palettes[0].main : otherColour(f)));
        card.innerHTML =
          `<span class="emblem">${EMBLEMS[f]}</span>` +
          `<span class="fname">${def.name}</span>` +
          `<span class="motto">${def.motto}</span>` +
          `<span class="about">${def.about}</span>` +
          `<span class="own">Only ${def.name} fields: ${ownUnits(f)}</span>`;
        card.addEventListener('click', () => {
          // Picking the side the opponent has swaps them over, which is usually what is wanted.
          if (state.enemy === f && state.faction !== f) state.enemy = state.faction;
          state.faction = f;
          draw();
        });
        return card;
      }),
    );
    mark(enemyRow, state.enemy);
    mark(difficultyRow, state.difficulty);
    mark(creditsRow, state.credits);
    note.textContent = DIFFICULTY_NOTES[state.difficulty];
    start.textContent = `Command ${FACTION_DEFS[state.faction].name}`;
    start.style.setProperty('--team', css(palettes[0].main));
  }

  /** The colour a faction's card shows when it is not the one picked. */
  function otherColour(f: Faction): number {
    return f === state.enemy ? palettes[1].main : f === 'aegis' ? 0x3f86e0 : 0xd8483c;
  }

  choices(enemyRow, FACTIONS, (f) => FACTION_DEFS[f].name, (f) => (state.enemy = f));
  choices(difficultyRow, DIFFICULTIES, (d) => DIFFICULTY_NAMES[d], (d) => (state.difficulty = d));
  choices(creditsRow, CREDIT_CHOICES, (c) => c.toLocaleString('en-GB'), (c) => (state.credits = c));
  draw();

  return new Promise((resolve) => {
    start.addEventListener('click', () => {
      const typed = Number(seedInput.value);
      state.seed = seedInput.value.trim() !== '' && Number.isInteger(typed) && typed !== 0 ? typed : Date.now() & 0x7fffffff;
      try {
        const { seed: _seed, ...keep } = state;
        localStorage.setItem('options', JSON.stringify(keep));
      } catch {
        // Storage can be unavailable in private windows. The choices just won't be remembered.
      }
      menu.remove();
      resolve(state);
    });
  });
}
