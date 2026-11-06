import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { computeOverall } from '../../../core/ratings';
import { TalentPreview, previewTalent } from '../../../core/rpg/talent-preview';
import { I18nService } from '../../../core/services/i18n.service';
import { RpgService } from '../../../core/services/rpg.service';
import { TalentNode, talentsFor } from '../../../data/talents';
import { Player } from '../../../models/player.model';

type Status = ReturnType<RpgService['talentStatus']>;

interface TreeNode {
  talent: TalentNode;
  x: number;
  y: number;
  rank: number;
  status: Status;
}

/** Column and row of every node by the number at the end of its id; see the tree in data/talents.ts. */
const POSITIONS: Record<string, [number, number]> = {
  '1': [200, 42],
  '2': [50, 140],
  '6': [150, 140],
  '7': [250, 140],
  '3': [350, 140],
  '4': [50, 238],
  '9': [150, 238],
  '8': [250, 238],
  '5': [350, 238],
};

/**
 * The talent tree of an archetype: nine nodes in three tiers. Choosing a node shows what it would change; the
 * points are spent only when the choice is confirmed.
 */
@Component({
  selector: 'app-talent-tree',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      viewBox="0 0 400 290"
      role="group"
      [attr.aria-label]="i18n.pick('Talentbaum', 'Talent tree')"
    >
      @for (edge of edges(); track edge.id) {
        <line
          [attr.x1]="edge.x1"
          [attr.y1]="edge.y1"
          [attr.x2]="edge.x2"
          [attr.y2]="edge.y2"
          [class.lit]="edge.lit"
        />
      }
      @for (node of nodes(); track node.talent.id) {
        <g
          class="node"
          tabindex="0"
          role="button"
          [attr.data-status]="node.status"
          [attr.data-kind]="node.talent.kind"
          [class.selected]="selected()?.talent?.id === node.talent.id"
          [attr.aria-label]="label(node)"
          [attr.aria-pressed]="selected()?.talent?.id === node.talent.id"
          (click)="choose(node)"
          (keydown.enter)="choose(node)"
          (keydown.space)="choose(node); $event.preventDefault()"
          (focus)="peek.set(node)"
          (mouseenter)="peek.set(node)"
        >
          <circle [attr.cx]="node.x" [attr.cy]="node.y" r="27" />
          @if (node.talent.kind === 'action') {
            <text [attr.x]="node.x" [attr.y]="node.y - 11" class="star">★</text>
          }
          <text [attr.x]="node.x" [attr.y]="node.y + 1" class="tier">
            {{ ['I', 'II', 'III'][node.talent.tier - 1] }}
          </text>
          <text [attr.x]="node.x" [attr.y]="node.y + 15" class="rank">
            {{ node.rank }}/{{ node.talent.maxRank }}
          </text>
        </g>
      }
    </svg>
    <p class="legend">
      ★ {{ i18n.pick('schaltet eine Spielaktion frei', 'unlocks a match action') }}
    </p>
    @if (shown(); as node) {
      <div class="detail" aria-live="polite">
        <b>{{ i18n.pick(node.talent.nameDe ?? node.talent.name, node.talent.name) }}</b>
        <p>
          {{
            i18n.pick(node.talent.descriptionDe ?? node.talent.description, node.talent.description)
          }}
        </p>
        <small
          >{{ i18n.pick('Rang', 'Rank') }} {{ node.rank }}/{{ node.talent.maxRank }} · Lv
          {{ node.talent.unlockLevel }} · {{ node.talent.cost }} SP ·
          {{ statusText(node.status) }}</small
        >
      </div>
    }
    @if (preview(); as view) {
      <div class="preview" role="region" [attr.aria-label]="i18n.pick('Vorschau', 'Preview')">
        <b>{{ i18n.pick('Vorschau', 'Preview') }}</b>
        <ul>
          @for (change of view.attributes; track change.key) {
            <li>
              {{ attributeName(change.key) }}
              <b class="pos">+{{ change.delta }}</b>
            </li>
          }
          @for (line of view.effects; track line) {
            <li>{{ line }}</li>
          }
          @for (action of view.unlocks; track action.id) {
            <li class="unlock">
              ★ {{ i18n.pick('Neue Aktion', 'New action') }}: <b>{{ action.name }}</b>
              <small>{{ action.text }}</small>
            </li>
          }
        </ul>
        <p class="numbers">
          {{ i18n.pick('Gesamt', 'Overall') }} {{ view.overallBefore }} →
          <b>{{ view.overallAfter }}</b> · SP {{ view.pointsBefore }} →
          <b>{{ view.pointsAfter }}</b>
        </p>
        <div class="actions">
          <button type="button" class="btn btn--primary btn--sm" (click)="confirm()">
            {{ i18n.pick('Bestätigen', 'Confirm') }} ({{ view.cost }} SP)
          </button>
          <button type="button" class="btn btn--ghost btn--sm" (click)="selected.set(null)">
            {{ i18n.pick('Abbrechen', 'Cancel') }}
          </button>
        </div>
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    svg {
      width: 100%;
      max-height: 300px;
    }
    line {
      stroke: var(--border);
      stroke-width: 3;
    }
    line.lit {
      stroke: var(--accent-2);
    }
    .node {
      cursor: pointer;
      outline: none;
    }
    .node circle {
      fill: var(--surface-2);
      stroke: var(--border);
      stroke-width: 3;
      transition:
        stroke 0.15s,
        fill 0.15s;
    }
    .node text {
      fill: var(--text);
      text-anchor: middle;
      pointer-events: none;
      font: 700 11px var(--font-pixel, monospace);
    }
    .node .rank {
      fill: var(--muted);
      font-size: 10px;
    }
    .node .star {
      fill: var(--accent);
      font-size: 11px;
    }
    .node[data-status='owned'] circle {
      fill: var(--accent-2);
      stroke: var(--accent-2);
    }
    .node[data-status='owned'] text {
      fill: var(--on-accent);
    }
    .node[data-status='open'] circle {
      stroke: var(--accent);
      animation: ready 1.6s ease-in-out infinite;
    }
    .node[data-status='excluded'],
    .node[data-status='needs-parent'] {
      opacity: 0.45;
    }
    .node.selected circle,
    .node:focus-visible circle {
      stroke: #fff;
    }
    @keyframes ready {
      50% {
        stroke-width: 5;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .node[data-status='open'] circle {
        animation: none;
      }
    }
    .legend {
      margin: 2px 0 0;
      color: var(--muted);
      font-size: 10px;
      text-align: right;
    }
    .detail,
    .preview {
      margin-top: 6px;
      padding: 8px 10px;
      border: 1px solid var(--border);
      background: var(--surface-2);
    }
    .preview {
      border-color: var(--accent);
    }
    .detail b {
      font-size: 13px;
    }
    .detail p {
      margin: 3px 0;
      font-size: 12px;
    }
    .detail small {
      color: var(--muted);
      font-size: 10px;
    }
    .preview ul {
      margin: 4px 0;
      padding-left: 16px;
      font-size: 12px;
    }
    .preview .pos {
      color: var(--accent-2);
    }
    .preview .unlock small {
      display: block;
      color: var(--muted);
    }
    .preview .numbers {
      margin: 4px 0;
      font-size: 12px;
    }
    .preview .actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
  `,
})
export class TalentTreeComponent {
  protected readonly i18n = inject(I18nService);
  private readonly rpg = inject(RpgService);

  readonly player = input.required<Player>();
  /** A player of another club: the tree is shown, nothing can be spent. */
  readonly viewOnly = input(false);
  /** Emitted when a choice is confirmed, never on the first click. */
  readonly unlock = output<string>();
  /** The node chosen for the preview; the points are spent only on `confirm`. */
  protected readonly selected = signal<TreeNode | null>(null);
  protected readonly peek = signal<TreeNode | null>(null);

  protected readonly nodes = computed<TreeNode[]>(() => {
    const player = this.player();
    return talentsFor(player.archetype).map((talent) => {
      const [x, y] = POSITIONS[talent.id.split('-').pop()!] ?? [200, 42];
      return {
        talent,
        x,
        y,
        rank: player.talentRanks?.[talent.id] ?? 0,
        status: this.rpg.talentStatus(player, talent),
      };
    });
  });

  /** The node the details describe: the chosen one, else the one under the pointer or focus. */
  protected readonly shown = computed<TreeNode | null>(() => {
    const byId = new Map(this.nodes().map((node) => [node.talent.id, node]));
    const id = this.selected()?.talent.id ?? this.peek()?.talent.id;
    return id ? (byId.get(id) ?? null) : null;
  });

  protected readonly preview = computed<TalentPreview | null>(() => {
    const chosen = this.selected();
    if (!chosen || this.viewOnly()) return null;
    const live = this.nodes().find((node) => node.talent.id === chosen.talent.id);
    if (!live || live.status !== 'open') return null;
    return previewTalent(
      this.player(),
      live.talent.id,
      this.i18n.locale() === 'de' ? 'de' : 'en',
      (attributes) => computeOverall(attributes, this.player().positionGroup),
    );
  });

  protected readonly edges = computed(() => {
    const byId = new Map(this.nodes().map((node) => [node.talent.id, node]));
    return this.nodes()
      .filter((node) => node.talent.requires)
      .map((node) => {
        const parent = byId.get(node.talent.requires!)!;
        return {
          id: node.talent.id,
          x1: parent.x,
          y1: parent.y + 27,
          x2: node.x,
          y2: node.y - 27,
          lit: parent.rank > 0 && node.rank > 0,
        };
      });
  });

  protected statusText(status: Status): string {
    return {
      owned: this.i18n.pick('Voll ausgebaut', 'Maxed out'),
      open: this.i18n.pick('Bereit zum Freischalten', 'Ready to unlock'),
      'needs-points': this.i18n.pick('Zu wenige Skillpunkte', 'Not enough skill points'),
      'needs-level': this.i18n.pick('Level zu niedrig', 'Level too low'),
      'needs-parent': this.i18n.pick('Vorheriger Knoten fehlt', 'Needs the node above'),
      excluded: this.i18n.pick('Anderer Zweig gewählt', 'Other branch chosen'),
    }[status];
  }

  protected attributeName(key: string): string {
    const names: Record<string, [string, string]> = {
      pace: ['Tempo', 'Pace'],
      shooting: ['Schuss', 'Shooting'],
      passing: ['Passen', 'Passing'],
      dribbling: ['Dribbling', 'Dribbling'],
      defending: ['Verteidigen', 'Defending'],
      physical: ['Physis', 'Physical'],
      stamina: ['Ausdauer', 'Stamina'],
      goalkeeping: ['Torwart', 'Goalkeeping'],
    };
    const pair = names[key] ?? [key, key];
    return this.i18n.pick(pair[0], pair[1]);
  }

  protected label(node: TreeNode): string {
    const name = this.i18n.pick(node.talent.nameDe ?? node.talent.name, node.talent.name);
    return `${name}, ${this.i18n.pick('Rang', 'rank')} ${node.rank}/${node.talent.maxRank}, ${this.statusText(node.status)}`;
  }

  /** Choosing a node only opens its preview. */
  protected choose(node: TreeNode): void {
    this.selected.set(this.selected()?.talent.id === node.talent.id ? null : node);
  }

  /** The player confirms: now the points are spent. */
  protected confirm(): void {
    const view = this.preview();
    if (!view) return;
    this.unlock.emit(view.talent.id);
    // A node with ranks left can be taken again at once; the preview follows the new state.
  }
}
