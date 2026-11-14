import { stepWorld } from './step';
import { createWorld, hashWorld, type Scenario } from './world';
import type { Command, SimEvent, World } from './types';

export interface LoggedCommand {
  tick: number;
  cmd: Command;
}

/**
 * Owns the world and is the only way to change it. Commands go in, ticks come
 * out. The same seed and command log always produce the same game, which is
 * what multiplayer, replays and saved games will all rely on.
 */
export class Sim {
  readonly world: World;
  /** Every command issued so far, with the tick it took effect on. */
  readonly log: LoggedCommand[] = [];
  /** Events raised by the most recent tick. */
  events: SimEvent[] = [];
  private pending: Command[] = [];

  constructor(
    readonly seed: number,
    readonly scenario: Scenario = {},
  ) {
    this.world = createWorld(seed, scenario);
  }

  /** Queues a command to take effect on the next tick. */
  issue(cmd: Command): void {
    this.pending.push(cmd);
    this.log.push({ tick: this.world.tick, cmd });
  }

  step(): void {
    const commands = this.pending;
    this.pending = [];
    this.events = [];
    stepWorld(this.world, commands, this.events);
  }

  hash(): number {
    return hashWorld(this.world);
  }

  /** Rebuilds a game from its seed and command log. */
  static replay(
    seed: number,
    log: readonly LoggedCommand[],
    ticks: number,
    scenario: Scenario = {},
  ): Sim {
    const sim = new Sim(seed, scenario);
    let next = 0;
    while (sim.world.tick < ticks) {
      while (next < log.length && log[next].tick === sim.world.tick) sim.issue(log[next++].cmd);
      sim.step();
    }
    return sim;
  }
}
