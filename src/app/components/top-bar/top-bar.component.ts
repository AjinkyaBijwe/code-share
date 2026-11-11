import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { ENVIRONMENT_LIST, ENVIRONMENT_META } from '../../config/templates.config';
import { RuntimeEnvironment } from '../../models/workspace.models';
import { RuntimeOrchestratorService } from '../../services/runtime-orchestrator.service';
import { VfsStateService } from '../../services/vfs-state.service';
import { UiBadgeComponent } from '../ui/badge.component';
import { ButtonDirective } from '../ui/button.directive';
import { UiIconComponent } from '../ui/icon.component';

@Component({
  selector: 'app-top-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonDirective, UiBadgeComponent, UiIconComponent],
  template: `
    <header
      class="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border bg-card/95 px-3 select-none"
    >
      <!-- Left: Brand + Environment Selector -->
      <div class="flex items-center gap-2.5 min-w-0">
        <div class="flex items-center gap-2">
          <div
            class="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 border border-primary/30 text-blue-400"
          >
            <ui-icon name="code" iconClass="h-4 w-4" />
          </div>
          <div class="flex items-baseline gap-1.5">
            <span class="text-sm font-semibold tracking-tight text-foreground">CodePad</span>
            <span class="hidden sm:inline text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Zero-Auth
            </span>
          </div>
        </div>

        <div class="h-4 w-px bg-border mx-0.5"></div>

        <!-- Environment Dropdown -->
        <div class="relative">
          <button
            cpButton
            variant="outline"
            size="sm"
            type="button"
            class="h-7 gap-2 px-2.5 font-medium"
            [attr.aria-expanded]="envMenuOpen()"
            aria-haspopup="listbox"
            (click)="toggleEnvMenu($event)"
          >
            <span
              class="inline-flex h-4 min-w-5 items-center justify-center rounded px-1 text-[10px] font-bold border"
              [class]="currentMeta().badgeClasses"
            >
              {{ currentMeta().shortLabel }}
            </span>
            <span>{{ currentMeta().label }}</span>
            <ui-icon name="chevron-down" iconClass="h-3 w-3 text-muted-foreground" />
          </button>

          @if (envMenuOpen()) {
            <div
              class="absolute left-0 top-full z-40 mt-1.5 w-72 rounded-lg border border-border bg-popover p-1.5 shadow-2xl"
              role="listbox"
              (click)="$event.stopPropagation()"
            >
              <div class="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Starter Environments
              </div>
              @for (env of environments; track env.id) {
                <button
                  type="button"
                  role="option"
                  [attr.aria-selected]="env.id === vfs.envSignal()"
                  class="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-accent cursor-pointer"
                  [class.bg-accent/70]="env.id === vfs.envSignal()"
                  (click)="selectEnvironment(env.id)"
                >
                  <span
                    class="mt-0.5 inline-flex h-5 min-w-7 items-center justify-center rounded px-1 text-[10px] font-bold border"
                    [class]="env.badgeClasses"
                  >
                    {{ env.shortLabel }}
                  </span>
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center justify-between gap-2">
                      <span class="text-xs font-semibold text-foreground">{{ env.label }}</span>
                      @if (env.id === vfs.envSignal()) {
                        <ui-icon name="check" iconClass="h-3.5 w-3.5 text-primary" />
                      }
                    </div>
                    <p class="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                      {{ env.description }}
                    </p>
                  </div>
                </button>
              }
            </div>
          }
        </div>

        <!-- Persistence / Dirty Indicator -->
        <div class="hidden lg:flex items-center gap-1.5">
          @if (vfs.dirtyStateSignal()) {
            <ui-badge variant="warning">Unsaved hash</ui-badge>
          } @else {
            <ui-badge variant="secondary">{{ hydrationLabel() }}</ui-badge>
          }
        </div>
      </div>

      <!-- Center / Right: Execution + Sharing Actions -->
      <div class="flex items-center gap-1.5">
        @if (vfs.envSignal() !== 'python') {
          <button
            cpButton
            [variant]="runtime.autoRunSignal() ? 'secondary' : 'ghost'"
            size="sm"
            type="button"
            class="hidden md:inline-flex"
            title="Toggle automatic live preview reload on edit"
            (click)="runtime.toggleAutoRun()"
          >
            <span
              class="h-1.5 w-1.5 rounded-full"
              [class.bg-emerald-400]="runtime.autoRunSignal()"
              [class.bg-slate-500]="!runtime.autoRunSignal()"
            ></span>
            Auto-Run
          </button>
        }

        <button
          cpButton
          variant="secondary"
          size="sm"
          type="button"
          title="Run code (Cmd/Ctrl + Enter)"
          (click)="runRequested.emit()"
        >
          <ui-icon name="play" iconClass="h-3.5 w-3.5 text-emerald-400" />
          <span>Run</span>
        </button>

        @if (runtime.isRunningSignal() || vfs.envSignal() === 'python') {
          <button
            cpButton
            variant="outline"
            size="sm"
            type="button"
            [disabled]="!runtime.isRunningSignal()"
            title="Stop execution / terminate Python worker"
            (click)="runtime.stopExecution()"
          >
            <ui-icon name="square" iconClass="h-3 w-3 text-rose-400" />
            <span class="hidden sm:inline">Stop</span>
          </button>
        }

        <button
          cpButton
          variant="outline"
          size="sm"
          type="button"
          class="hidden sm:inline-flex"
          title="Format active file with Prettier (Shift + Alt + F)"
          (click)="formatRequested.emit()"
        >
          <ui-icon name="sparkles" iconClass="h-3.5 w-3.5 text-amber-300" />
          <span>Format</span>
        </button>

        <div class="h-4 w-px bg-border mx-0.5"></div>

        <button
          cpButton
          variant="default"
          size="sm"
          type="button"
          title="Share URL hash or short snapshot (Cmd/Ctrl + S)"
          (click)="shareRequested.emit()"
        >
          <ui-icon name="share" iconClass="h-3.5 w-3.5" />
          <span>Share</span>
        </button>

        <button
          cpButton
          variant="outline"
          size="icon"
          type="button"
          title="Download workspace as ZIP"
          aria-label="Download workspace as ZIP"
          (click)="vfs.exportWorkspaceZip()"
        >
          <ui-icon name="download" iconClass="h-3.5 w-3.5" />
        </button>

        <button
          cpButton
          variant="ghost"
          size="icon"
          type="button"
          title="Reset workspace to template"
          aria-label="Reset workspace to template"
          (click)="resetRequested.emit()"
        >
          <ui-icon name="rotate-ccw" iconClass="h-3.5 w-3.5" />
        </button>
      </div>
    </header>
  `,
})
export class TopBarComponent {
  protected readonly vfs = inject(VfsStateService);
  protected readonly runtime = inject(RuntimeOrchestratorService);

  readonly runRequested = output<void>();
  readonly formatRequested = output<void>();
  readonly shareRequested = output<void>();
  readonly resetRequested = output<void>();

  protected readonly environments = ENVIRONMENT_LIST;
  protected readonly envMenuOpen = signal(false);

  protected readonly currentMeta = computed(() => ENVIRONMENT_META[this.vfs.envSignal()]);

  protected readonly hydrationLabel = computed(() => {
    switch (this.vfs.hydrationSourceSignal()) {
      case 'url-hash':
      case 'url-query':
        return 'Loaded from URL';
      case 'snapshot':
        return 'Snapshot';
      case 'indexeddb':
        return 'Saved locally';
      default:
        return 'Template';
    }
  });

  @HostListener('document:click')
  protected closeEnvMenu(): void {
    this.envMenuOpen.set(false);
  }

  protected toggleEnvMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.envMenuOpen.update((v) => !v);
  }

  protected selectEnvironment(env: RuntimeEnvironment): void {
    this.envMenuOpen.set(false);
    if (env !== this.vfs.envSignal()) {
      this.vfs.switchEnvironment(env);
    }
  }
}

