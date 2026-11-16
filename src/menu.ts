// The screen shown before a game starts, for choosing a side and the settings.

import { RoomClient, type Lobby } from './net/client';
import type { StartInfo } from './net/protocol';
import { css, setFactions, palettes } from './render/teams';
import {
  DIFFICULTIES,
  FACTIONS,
  FACTION_DEFS,
  MAP_KINDS,
  UNIT_DEFS,
  type Difficulty,
  type Faction,
  type MapKind,
} from './sim/types';
import type { Seat } from './sim/world';

/** How many players, and who is on whose side. */
export type Mode = 'duel' | 'teams' | 'ffa';
const MODES: readonly Mode[] = ['duel', 'teams', 'ffa'];
const MODE_NAMES: Record<Mode, string> = { duel: '1 v 1', teams: '2 v 2', ffa: 'Free for all' };
const MODE_NOTES: Record<Mode, string> = {
  duel: 'You against one opponent, in opposite corners',
  teams: 'You and a computer ally in the west, against two in the east',
  ffa: 'Four players, one in each corner, every side for itself',
};

export interface GameOptions {
  mode: Mode;
  map: MapKind;
  faction: Faction;
  enemy: Faction;
  difficulty: Difficulty;
  credits: number;
  seed: number;
  /** Set for a game against other people: the room, which seat is ours, and what the room decided. */
  online?: { client: RoomClient; you: number; info: StartInfo };
}

const MAP_NAMES: Record<MapKind, string> = { lakes: 'Lakeland', islands: 'Five Islands', desert: 'Dry Reach' };
const MAP_NOTES: Record<MapKind, string> = {
  lakes: 'Green country with big lakes, woods and ore everywhere',
  islands: 'An island each, joined by narrow causeways, with the gems on a fifth in the middle',
  desert: 'Open sand broken up by rocks, scrub and small pools',
};

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

/**
 * Who sits where. Seat 0 is always the player, in the north-west. Seat 1 is
 * the far corner, seat 2 the north-east and seat 3 the south-west.
 */
export function seatsFor(o: Pick<GameOptions, 'mode' | 'faction' | 'enemy'>): Seat[] {
  const you: Seat = { faction: o.faction, team: 0, ai: false };
  const foe = (team: number, faction: Faction = o.enemy): Seat => ({ faction, team, ai: true });
  if (o.mode === 'teams') {
    // West against east: your ally holds the south-west corner.
    return [you, foe(1), foe(1), { faction: o.faction, team: 0, ai: true }];
  }
  if (o.mode === 'ffa') {
    // A mix of both factions, so no two neighbours are quite alike.
    return [you, foe(1), foe(2, o.faction), foe(3)];
  }
  return [you, foe(1)];
}

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
  const mode = q.get('mode') as Mode | null;
  const map = q.get('map') as MapKind | null;
  return {
    mode: mode && MODES.includes(mode) ? mode : 'duel',
    map: map && MAP_KINDS.includes(map) ? map : 'lakes',
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
    mode: last.mode && MODES.includes(last.mode) ? last.mode : 'duel',
    map: last.map && MAP_KINDS.includes(last.map) ? last.map : 'lakes',
    faction: last.faction && FACTIONS.includes(last.faction) ? last.faction : 'aegis',
    enemy: last.enemy && FACTIONS.includes(last.enemy) ? last.enemy : 'dominion',
    difficulty: last.difficulty && DIFFICULTIES.includes(last.difficulty) ? last.difficulty : 'normal',
    credits: CREDIT_CHOICES.includes(last.credits ?? 0) ? last.credits! : 5000,
    seed: 0,
  };

  const cards = menu.querySelector('#factions')!;
  const enemyRow = menu.querySelector('#enemy')!;
  const modeRow = menu.querySelector('#mode')!;
  const modeNote = menu.querySelector('#mode-note')!;
  const mapRow = menu.querySelector('#map')!;
  const mapNote = menu.querySelector('#map-note')!;
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
    setFactions(seatsFor(state).map((s) => s.faction));
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
    mark(modeRow, state.mode);
    modeNote.textContent = MODE_NOTES[state.mode];
    mark(mapRow, state.map);
    mapNote.textContent = MAP_NOTES[state.map];
    // Preview the colours as they will be in the game, for however many are playing.
    setFactions(seatsFor(state).map((s) => s.faction));
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

  choices(modeRow, MODES, (m) => MODE_NAMES[m], (m) => (state.mode = m));
  choices(mapRow, MAP_KINDS, (m) => MAP_NAMES[m], (m) => (state.map = m));
  choices(enemyRow, FACTIONS, (f) => FACTION_DEFS[f].name, (f) => (state.enemy = f));
  choices(difficultyRow, DIFFICULTIES, (d) => DIFFICULTY_NAMES[d], (d) => (state.difficulty = d));
  choices(creditsRow, CREDIT_CHOICES, (c) => c.toLocaleString('en-GB'), (c) => (state.credits = c));
  draw();

  return new Promise((resolve) => {
    // ---- Playing online: create a room or join one, then wait in its lobby for the host to start.
    const local = menu.querySelector<HTMLElement>('#local')!;
    const lobbyBox = menu.querySelector<HTMLElement>('#lobby')!;
    const onlineNote = menu.querySelector<HTMLElement>('#online-note')!;
    const codeInput = menu.querySelector<HTMLInputElement>('#code')!;
    let client: RoomClient | null = null;

    const showLobby = (lobby: Lobby): void => {
      local.hidden = true;
      lobbyBox.hidden = false;
      const mine = lobby.players.find((p) => p.seat === lobby.you)!;
      state.faction = mine.faction;
      draw();
      lobbyBox.querySelector('#lobby-code')!.textContent = lobby.code;
      lobbyBox.querySelector('#lobby-players')!.replaceChildren(
        ...lobby.players.map((p) => {
          const row = document.createElement('div');
          row.className = 'seat';
          row.innerHTML =
            `<span class="who">Player ${p.seat + 1}${p.seat === lobby.you ? ' (you)' : ''}${p.host ? ', host' : ''}</span>` +
            `<span class="side">${FACTION_DEFS[p.faction].name}</span>`;
          return row;
        }),
      );
      const row = lobbyBox.querySelector('#lobby-mode')!;
      choices(row, MODES, (m) => MODE_NAMES[m], (m) => client?.chooseMode(m));
      mark(row, lobby.mode);
      for (const b of row.querySelectorAll<HTMLButtonElement>('button')) b.disabled = !mine.host;
      const maps = lobbyBox.querySelector('#lobby-map')!;
      choices(maps, MAP_KINDS, (m) => MAP_NAMES[m], (m) => client?.chooseMap(m));
      mark(maps, lobby.map);
      for (const b of maps.querySelectorAll<HTMLButtonElement>('button')) b.disabled = !mine.host;
      lobbyBox.querySelector('#lobby-map-note')!.textContent = MAP_NOTES[lobby.map];
      const go = lobbyBox.querySelector<HTMLButtonElement>('#lobby-start')!;
      go.disabled = !mine.host;
      go.textContent = mine.host ? 'Start the game' : 'Waiting for the host to start';
      go.style.setProperty('--team', css(palettes[0].main));
      const filled = lobby.mode === 'duel' && lobby.players.length <= 2 ? 2 : 4;
      const spare = filled - lobby.players.length;
      lobbyBox.querySelector('#lobby-note')!.textContent =
        `Share the code with your friends. ${spare > 0 ? `The computer will take the other ${spare === 1 ? 'seat' : `${spare} seats`}.` : 'Every seat is taken.'}`;
    };

    const enter = (code: string): void => {
      onlineNote.textContent = 'Connecting';
      client = new RoomClient(code);
      client.onLobby = showLobby;
      client.onError = (message) => {
        // Back to the main menu, with the reason.
        onlineNote.textContent = message;
        local.hidden = false;
        lobbyBox.hidden = true;
        client = null;
      };
      const room = client;
      client.onStart = (you, info) => {
        room.onError = () => {};
        menu.remove();
        const foe = info.seats.find((seat, i) => i !== you && seat.team !== info.seats[you].team);
        resolve({
          mode: info.mode,
          map: info.map,
          faction: info.seats[you].faction,
          enemy: foe?.faction ?? otherThan(info.seats[you].faction),
          difficulty: info.difficulty,
          credits: 5000,
          seed: info.seed,
          online: { client: room, you, info },
        });
      };
    };

    menu.querySelector('#host')!.addEventListener('click', () => {
      // Four letters, easy to read out, with none that look like numbers.
      const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
      enter(Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join(''));
    });
    menu.querySelector('#join')!.addEventListener('click', () => {
      const code = codeInput.value.trim().toUpperCase();
      if (/^[A-Z]{4}$/.test(code)) enter(code);
      else onlineNote.textContent = 'A game code is four letters';
    });
    lobbyBox.querySelector('#lobby-start')!.addEventListener('click', () => client?.start());
    // In a lobby, choosing a faction card tells the room.
    cards.addEventListener('click', () => client?.chooseFaction(state.faction));

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
