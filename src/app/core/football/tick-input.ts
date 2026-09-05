import { MatchCommand } from '../../models/match.model';

export type BufferedButton = 'pass' | 'through' | 'lob' | 'shoot' | 'skill' | 'switchPlayer' | 'sprint';
const BUTTONS: readonly BufferedButton[] = ['pass', 'through', 'lob', 'shoot', 'skill', 'switchPlayer', 'sprint'];

/** Events survive render frames with no simulation tick, including a whole tap between two frames. */
export class TickInputBuffer {
  private readonly sources = new Map<string, { button: BufferedButton; active: boolean }>();
  private readonly queues = new Map<BufferedButton, { active: boolean; at: number }[]>();
  private readonly consumed = new Map<BufferedButton, boolean>();

  set(source: string, button: BufferedButton, active: boolean, at: number): void {
    const before = this.held(button);
    if (active) this.sources.set(source, { button, active });
    else this.sources.delete(source);
    const after = this.held(button);
    if (before === after) return;
    const queue = this.queues.get(button) ?? [];
    queue.push({ active: after, at });
    if (queue.length > 16) queue.splice(0, queue.length - 16);
    this.queues.set(button, queue);
  }

  consume(base: MatchCommand, now: number): MatchCommand {
    const command = { ...base };
    for (const button of BUTTONS) {
      const queue = this.queues.get(button);
      while (queue?.length && now - queue[0].at > 120) {
        this.consumed.set(button, queue.shift()!.active);
      }
      const edge = queue?.shift();
      if (edge) this.consumed.set(button, edge.active);
      else if (!queue?.length) this.consumed.set(button, this.held(button));
      command[button] = this.consumed.get(button) ?? false;
    }
    command.keeperRush = command.through;
    return command;
  }

  clear(): void { this.sources.clear(); this.queues.clear(); this.consumed.clear(); }
  private held(button: BufferedButton): boolean {
    return [...this.sources.values()].some((source) => source.button === button && source.active);
  }
}
