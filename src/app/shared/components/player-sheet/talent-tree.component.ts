import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
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

const POSITIONS: Record<string, [number, number]> = {
  '1': [180, 42],
  '2': [92, 140],
  '3': [268, 140],
  '4': [92, 238],
  '5': [268, 238],
};

/** The talent tree of an archetype: a root, two exclusive branches and one elite node below each. */
@Component({
  selector: 'app-talent-tree',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      viewBox="0 0 360 290"
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
          [class.selected]="selected()?.talent?.id === node.talent.id"
          [attr.aria-label]="label(node)"
          [attr.aria-disabled]="node.status !== 'open'"
          (click)="choose(node)"
          (keydown.enter)="activate(node)"
          (keydown.space)="activate(node); $event.preventDefault()"
          (focus)="selected.set(node)"
          (mouseenter)="selected.set(node)"
        >
          <circle [attr.cx]="node.x" [attr.cy]="node.y" r="27" />
          <text [attr.x]="node.x" [attr.y]="node.y - 3" class="tier">
            {{ ['I', 'II', 'III'][node.talent.tier - 1] }}
          </text>
          <text [attr.x]="node.x" [attr.y]="node.y + 13" class="rank">
            {{ node.rank }}/{{ node.talent.maxRank }}
          </text>
        </g>
      }
    </svg>
    @if (selected(); as node) {
      <div class="detail" aria-live="polite">
        <b>{{ node.talent.name }}</b>
        <p>{{ node.talent.description }}</p>
        <small
          >{{ i18n.pick('Rang', 'Rank') }} {{ node.rank }}/{{ node.talent.maxRank }} · Lv
          {{ node.talent.unlockLevel }} · {{ node.talent.cost }} SP ·
          {{ statusText(node.status) }}</small
        >
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
    .detail {
      margin-top: 6px;
      padding: 8px 10px;
      border: 1px solid var(--border);
      background: var(--surface-2);
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
  `,
})
export class TalentTreeComponent {
  protected readonly i18n = inject(I18nService);
  private readonly rpg = inject(RpgService);

  readonly player = input.required<Player>();
  readonly unlock = output<string>();
  protected readonly selected = signal<TreeNode | null>(null);

  protected readonly nodes = computed<TreeNode[]>(() => {
    const player = this.player();
    return talentsFor(player.archetype).map((talent) => {
      const [x, y] = POSITIONS[talent.id.split('-').pop()!] ?? [180, 42];
      return {
        talent,
        x,
        y,
        rank: player.talentRanks?.[talent.id] ?? 0,
        status: this.rpg.talentStatus(player, talent),
      };
    });
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

  protected label(node: TreeNode): string {
    return `${node.talent.name}, ${this.i18n.pick('Rang', 'rank')} ${node.rank}/${node.talent.maxRank}, ${this.statusText(node.status)}`;
  }

  protected choose(node: TreeNode): void {
    this.selected.set(node);
    this.activate(node);
  }

  protected activate(node: TreeNode): void {
    if (node.status === 'open') this.unlock.emit(node.talent.id);
  }
}
