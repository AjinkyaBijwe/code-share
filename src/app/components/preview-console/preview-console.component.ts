import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  ConsoleFilter,
  ConsoleLevel,
  ViewportPreset,
  WebSandboxEngine,
} from '../../models/workspace.models';
import { RuntimeOrchestratorService } from '../../services/runtime-orchestrator.service';
import { VfsStateService } from '../../services/vfs-state.service';
import { UiBadgeComponent, BadgeVariant } from '../ui/badge.component';
import { ButtonDirective } from '../ui/button.directive';
import { UiIconComponent } from '../ui/icon.component';

@Component({
  selector: 'app-preview-console',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonDirective, UiBadgeComponent, UiIconComponent],
  template: `
    <section #splitContainer class="flex h-full flex-col bg-card overflow-hidden">
      <!-- Top Pane: Live DOM Preview / Python Stage -->
      <div
        class="flex flex-col min-h-0"
        [class.fixed]="isFullscreen()"
        [class.inset-0]="isFullscreen()"
        [class.z-40]="isFullscreen()"
        [class.bg-card]="isFullscreen()"
        [style.height.%]="isFullscreen() ? null : previewRatioPct()"
      >
        <!-- Preview Toolbar -->
        <div class="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border px-2.5 overflow-x-auto">
          <div class="flex shrink-0 items-center gap-2 whitespace-nowrap">
            <span class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Preview
            </span>
            <ui-badge [variant]="statusBadgeVariant()">
              {{ statusLabel() }}
            </ui-badge>
          </div>

          <div class="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
            @if (vfs.envSignal() !== 'python') {
              <!-- Sandbox Engine Switcher (Browser ESM vs Sandpack) -->
              <div class="hidden xl:flex shrink-0 items-center rounded-md border border-border bg-background p-0.5">
                <button
                  type="button"
                  class="whitespace-nowrap rounded px-2 py-0.5 text-[10px] font-medium transition-colors cursor-pointer"
                  [class.bg-accent]="runtime.webEngineSignal() === 'esm'"
                  [class.text-foreground]="runtime.webEngineSignal() === 'esm'"
                  [class.text-muted-foreground]="runtime.webEngineSignal() !== 'esm'"
                  title="Browser ESM: Instant in-memory TypeScript + ESM importmap sandbox"
                  (click)="setEngine('esm')"
                >
                  ESM
                </button>
                <button
                  type="button"
                  class="whitespace-nowrap rounded px-2 py-0.5 text-[10px] font-medium transition-colors cursor-pointer"
                  [class.bg-accent]="runtime.webEngineSignal() === 'sandpack'"
                  [class.text-foreground]="runtime.webEngineSignal() === 'sandpack'"
                  [class.text-muted-foreground]="runtime.webEngineSignal() !== 'sandpack'"
                  title="CodeSandbox Sandpack Client bundler"
                  (click)="setEngine('sandpack')"
                >
                  Sandpack
                </button>
              </div>

              <!-- Responsive Viewport Toggles -->
              <div class="flex shrink-0 items-center rounded-md border border-border bg-background p-0.5">
                <button
                  type="button"
                  class="rounded p-1 transition-colors cursor-pointer"
                  [class.bg-accent]="runtime.viewportSignal() === 'desktop'"
                  [class.text-foreground]="runtime.viewportSignal() === 'desktop'"
                  [class.text-muted-foreground]="runtime.viewportSignal() !== 'desktop'"
                  title="Desktop viewport (100%)"
                  (click)="setViewport('desktop')"
                >
                  <ui-icon name="monitor" iconClass="h-3 w-3" />
                </button>
                <button
                  type="button"
                  class="rounded p-1 transition-colors cursor-pointer"
                  [class.bg-accent]="runtime.viewportSignal() === 'tablet'"
                  [class.text-foreground]="runtime.viewportSignal() === 'tablet'"
                  [class.text-muted-foreground]="runtime.viewportSignal() !== 'tablet'"
                  title="Tablet viewport (768px)"
                  (click)="setViewport('tablet')"
                >
                  <ui-icon name="tablet" iconClass="h-3 w-3" />
                </button>
                <button
                  type="button"
                  class="rounded p-1 transition-colors cursor-pointer"
                  [class.bg-accent]="runtime.viewportSignal() === 'mobile'"
                  [class.text-foreground]="runtime.viewportSignal() === 'mobile'"
                  [class.text-muted-foreground]="runtime.viewportSignal() !== 'mobile'"
                  title="Mobile viewport (375px)"
                  (click)="setViewport('mobile')"
                >
                  <ui-icon name="smartphone" iconClass="h-3 w-3" />
                </button>
              </div>
            }

            <button
              cpButton
              variant="ghost"
              size="icon"
              type="button"
              class="h-6 w-6"
              title="Reload execution"
              aria-label="Reload execution"
              (click)="runtime.runActiveWorkspace()"
            >
              <ui-icon name="refresh" iconClass="h-3.5 w-3.5" />
            </button>

            <button
              cpButton
              [variant]="isFullscreen() ? 'secondary' : 'ghost'"
              [size]="isFullscreen() ? 'xs' : 'icon'"
              [class]="isFullscreen() ? 'h-6' : 'h-6 w-6'"
              type="button"
              [title]="isFullscreen() ? 'Exit fullscreen preview (Esc)' : 'Fullscreen preview'"
              [attr.aria-label]="isFullscreen() ? 'Exit fullscreen preview' : 'Fullscreen preview'"
              [attr.aria-pressed]="isFullscreen()"
              (click)="toggleFullscreen()"
            >
              <ui-icon
                [name]="isFullscreen() ? 'minimize' : 'maximize'"
                iconClass="h-3.5 w-3.5"
              />
              @if (isFullscreen()) {
                <span>Exit Fullscreen</span>
              }
            </button>
          </div>
        </div>

        <!-- Stage Content -->
        <div class="relative flex-1 min-h-0 overflow-auto preview-stage-grid">
          <!-- Web Preview Iframes (ESM uses opaque origin sandbox; Sandpack uses cross-origin bundler iframe) -->
          <div
            class="h-full w-full flex justify-center"
            [class.hidden]="vfs.envSignal() === 'python' || runtime.webEngineSignal() === 'sandpack'"
            [class.p-3]="runtime.viewportSignal() !== 'desktop'"
          >
            <iframe
              #previewFrame
              title="CodePad Live Preview"
              sandbox="allow-scripts allow-modals allow-forms"
              class="h-full bg-[#0b0f19] transition-[width] duration-200"
              [class.w-full]="runtime.viewportSignal() === 'desktop'"
              [class.rounded-lg]="runtime.viewportSignal() !== 'desktop'"
              [class.border]="runtime.viewportSignal() !== 'desktop'"
              [class.border-border]="runtime.viewportSignal() !== 'desktop'"
              [class.shadow-2xl]="runtime.viewportSignal() !== 'desktop'"
              [style.width]="iframeWidth()"
            ></iframe>
          </div>

          <div
            class="h-full w-full flex justify-center"
            [class.hidden]="vfs.envSignal() === 'python' || runtime.webEngineSignal() !== 'sandpack'"
            [class.p-3]="runtime.viewportSignal() !== 'desktop'"
          >
            <iframe
              #sandpackFrame
              title="CodePad Sandpack Preview"
              sandbox="allow-scripts allow-modals allow-forms allow-same-origin allow-popups"
              class="h-full bg-[#0b0f19] transition-[width] duration-200"
              [class.w-full]="runtime.viewportSignal() === 'desktop'"
              [class.rounded-lg]="runtime.viewportSignal() !== 'desktop'"
              [class.border]="runtime.viewportSignal() !== 'desktop'"
              [class.border-border]="runtime.viewportSignal() !== 'desktop'"
              [class.shadow-2xl]="runtime.viewportSignal() !== 'desktop'"
              [style.width]="iframeWidth()"
            ></iframe>
          </div>

          <!-- Prevent iframe from stealing mouse events while dragging split dividers -->
          @if (isDraggingSplit() || isDraggingVertical()) {
            <div class="absolute inset-0 z-20 cursor-row-resize"></div>
          }

          <!-- Python Pyodide Stage -->
          @if (vfs.envSignal() === 'python') {
            <div class="flex h-full flex-col gap-3 p-4 overflow-auto">
              <div class="rounded-lg border border-border bg-card/95 p-4 shadow-sm">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 class="text-xs font-semibold text-foreground">
                      Pyodide CPython WASM Worker
                    </h3>
                    <p class="mt-0.5 text-[11px] text-muted-foreground">
                      {{ runtime.summarySignal().detail ?? 'Click Run (Cmd/Ctrl + Enter) to execute main.py' }}
                    </p>
                  </div>
                  <div class="flex items-center gap-1.5">
                    <button
                      cpButton
                      variant="secondary"
                      size="xs"
                      type="button"
                      (click)="runtime.runActiveWorkspace()"
                    >
                      <ui-icon name="play" iconClass="h-3 w-3 text-emerald-400" />
                      Run Python
                    </button>
                  </div>
                </div>

                @if (runtime.summarySignal().pythonPackages?.length) {
                  <div class="mt-3 flex flex-wrap items-center gap-1.5">
                    <span class="text-[10px] uppercase tracking-wider text-muted-foreground">
                      micropip:
                    </span>
                    @for (pkg of runtime.summarySignal().pythonPackages; track pkg) {
                      <ui-badge variant="default">{{ pkg }}</ui-badge>
                    }
                  </div>
                }
              </div>

              <div class="flex-1 min-h-24 rounded-lg border border-border bg-background/90 p-3 font-mono text-xs text-emerald-300 overflow-auto whitespace-pre-wrap">
                @if (runtime.summarySignal().pythonOutputPreview) {
                  {{ runtime.summarySignal().pythonOutputPreview }}
                } @else {
                  <span class="text-muted-foreground">Stdout output will appear here and stream into the console below...</span>
                }
              </div>
            </div>
          }
        </div>
      </div>

      <!-- Vertical Split Divider -->
      <div
        class="h-1.5 shrink-0 cursor-row-resize border-y border-border bg-background hover:bg-primary/40 transition-colors"
        title="Drag to resize preview and console (double-click to reset)"
        (pointerdown)="startVerticalResize($event)"
        (dblclick)="previewRatioPct.set(58)"
      ></div>

      <!-- Bottom Pane: Unified Console / Terminal -->
      <div class="flex flex-1 flex-col min-h-0 bg-card">
        <!-- Console Header & Filters -->
        <div class="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border px-3 overflow-x-auto">
          <div class="flex items-center gap-2 shrink-0">
            <ui-icon name="terminal" iconClass="h-3.5 w-3.5 text-muted-foreground" />
            <span class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Console
            </span>
          </div>

          <div class="flex items-center gap-1 shrink-0">
            @for (tab of filterTabs; track tab.id) {
              <button
                type="button"
                class="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer"
                [class.bg-accent]="runtime.filterSignal() === tab.id"
                [class.text-foreground]="runtime.filterSignal() === tab.id"
                [class.text-muted-foreground]="runtime.filterSignal() !== tab.id"
                [class.hover:bg-accent/50]="runtime.filterSignal() !== tab.id"
                (click)="setFilter(tab.id)"
              >
                <span>{{ tab.label }}</span>
                <span class="rounded bg-background/80 px-1 text-[10px] text-muted-foreground">
                  {{ runtime.logCountsSignal()[tab.id] }}
                </span>
              </button>
            }

            <div class="h-3.5 w-px bg-border mx-1"></div>

            <button
              cpButton
              variant="ghost"
              size="xs"
              type="button"
              (click)="runtime.clearLogs()"
            >
              Clear
            </button>
          </div>
        </div>

        <!-- Log Output Stream -->
        <div #consoleScroll class="flex-1 overflow-y-auto p-2 font-mono text-[12px] leading-relaxed">
          @if (runtime.filteredLogsSignal().length === 0) {
            <div class="flex h-full items-center justify-center text-xs text-muted-foreground">
              No console output matching filter.
            </div>
          } @else {
            @for (entry of runtime.filteredLogsSignal(); track entry.id) {
              <div
                class="flex items-start gap-2 rounded px-2 py-1 hover:bg-accent/30"
                [class.bg-red-500/5]="entry.level === 'error'"
                [class.bg-amber-500/5]="entry.level === 'warn'"
              >
                <span class="shrink-0 text-[10px] text-slate-500 pt-0.5">{{ entry.timestamp }}</span>
                <span
                  class="shrink-0 rounded px-1.5 py-px text-[9px] font-bold uppercase tracking-wider mt-0.5"
                  [class]="levelBadgeClass(entry.level)"
                >
                  {{ levelShort(entry.level) }}
                </span>
                <pre class="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-[12px] m-0" [class]="levelTextClass(entry.level)">{{ entry.message }}</pre>
              </div>
            }
          }
        </div>
      </div>
    </section>
  `,
})
export class PreviewConsoleComponent implements AfterViewInit, OnDestroy {
  @ViewChild('previewFrame', { static: true })
  private readonly previewFrame!: ElementRef<HTMLIFrameElement>;

  @ViewChild('sandpackFrame', { static: true })
  private readonly sandpackFrame!: ElementRef<HTMLIFrameElement>;

  @ViewChild('splitContainer', { static: true })
  private readonly splitContainer!: ElementRef<HTMLElement>;

  @ViewChild('consoleScroll', { static: true })
  private readonly consoleScroll!: ElementRef<HTMLDivElement>;

  readonly isDraggingSplit = input<boolean>(false);

  protected readonly vfs = inject(VfsStateService);
  protected readonly runtime = inject(RuntimeOrchestratorService);

  protected readonly previewRatioPct = signal(58);
  protected readonly isDraggingVertical = signal(false);
  protected readonly isFullscreen = signal(false);

  protected readonly filterTabs: ReadonlyArray<{ id: ConsoleFilter; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'info', label: 'Info' },
    { id: 'warn', label: 'Warn' },
    { id: 'error', label: 'Error' },
    { id: 'python-stdout', label: 'Python' },
  ];

  protected readonly iframeWidth = computed(() => {
    switch (this.runtime.viewportSignal()) {
      case 'tablet':
        return '768px';
      case 'mobile':
        return '375px';
      default:
        return '100%';
    }
  });

  protected readonly statusBadgeVariant = computed<BadgeVariant>(() => {
    switch (this.runtime.statusSignal()) {
      case 'ready':
        return 'success';
      case 'error':
        return 'destructive';
      case 'installing':
      case 'initializing':
      case 'transpiling':
      case 'running':
        return 'warning';
      default:
        return 'secondary';
    }
  });

  protected readonly statusLabel = computed(() => {
    const summary = this.runtime.summarySignal();
    if (summary.status === 'ready' && summary.durationMs !== undefined) {
      return `Ready · ${summary.durationMs}ms`;
    }
    switch (summary.status) {
      case 'initializing':
        return 'Loading Runtime';
      case 'installing':
        return 'Installing Deps';
      case 'transpiling':
        return 'Transpiling';
      case 'running':
        return 'Running';
      case 'error':
        return 'Error';
      case 'ready':
        return 'Ready';
      default:
        return 'Idle';
    }
  });

  private activePointerCleanup: (() => void) | null = null;

  constructor() {
    effect(() => {
      // Auto-scroll console when logs append
      this.runtime.filteredLogsSignal();
      queueMicrotask(() => {
        const el = this.consoleScroll?.nativeElement;
        if (el) {
          el.scrollTop = el.scrollHeight;
        }
      });
    });
  }

  ngAfterViewInit(): void {
    this.runtime.attachPreviewIframe(this.previewFrame.nativeElement);
    this.runtime.attachSandpackIframe(this.sandpackFrame.nativeElement);
    void this.runtime.runActiveWorkspace();
  }

  ngOnDestroy(): void {
    this.activePointerCleanup?.();
    this.runtime.attachPreviewIframe(null);
    this.runtime.attachSandpackIframe(null);
  }

  @HostListener('document:keydown.escape')
  protected onEscapeFullscreen(): void {
    if (this.isFullscreen()) {
      this.isFullscreen.set(false);
    }
  }

  protected toggleFullscreen(): void {
    this.isFullscreen.update((v) => !v);
  }

  protected setViewport(preset: ViewportPreset): void {
    this.runtime.setViewport(preset);
  }

  protected setEngine(engine: WebSandboxEngine): void {
    this.runtime.setWebEngine(engine);
  }

  protected setFilter(filter: ConsoleFilter): void {
    this.runtime.setFilter(filter);
  }

  protected startVerticalResize(event: PointerEvent): void {
    event.preventDefault();
    this.isDraggingVertical.set(true);

    const container = this.splitContainer.nativeElement;
    const onMove = (moveEvt: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      if (rect.height <= 0) return;
      const pct = ((moveEvt.clientY - rect.top) / rect.height) * 100;
      this.previewRatioPct.set(Math.min(82, Math.max(22, pct)));
    };

    const onUp = () => {
      this.isDraggingVertical.set(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      this.activePointerCleanup = null;
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    this.activePointerCleanup = onUp;
  }

  protected levelShort(level: ConsoleLevel): string {
    switch (level) {
      case 'python-stdout':
        return 'PY';
      case 'warn':
        return 'WARN';
      case 'error':
        return 'ERR';
      case 'system':
        return 'SYS';
      default:
        return 'INFO';
    }
  }

  protected levelBadgeClass(level: ConsoleLevel): string {
    switch (level) {
      case 'python-stdout':
        return 'bg-amber-500/20 text-amber-300';
      case 'warn':
        return 'bg-amber-500/20 text-amber-300';
      case 'error':
        return 'bg-red-500/20 text-red-300';
      case 'system':
        return 'bg-slate-500/20 text-slate-300';
      default:
        return 'bg-blue-500/20 text-blue-300';
    }
  }

  protected levelTextClass(level: ConsoleLevel): string {
    switch (level) {
      case 'error':
        return 'text-red-300';
      case 'warn':
        return 'text-amber-200';
      case 'python-stdout':
        return 'text-emerald-300';
      case 'system':
        return 'text-slate-400';
      default:
        return 'text-slate-200';
    }
  }
}

