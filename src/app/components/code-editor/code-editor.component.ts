import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  inject,
  output,
  signal,
} from '@angular/core';
import type * as Monaco from 'monaco-editor';
import { MonacoBridgeService } from '../../services/monaco-bridge.service';
import { RuntimeOrchestratorService } from '../../services/runtime-orchestrator.service';
import { VfsStateService } from '../../services/vfs-state.service';
import { getBaseName } from '../../utils/path.utils';
import { ButtonDirective } from '../ui/button.directive';
import { UiIconComponent } from '../ui/icon.component';

@Component({
  selector: 'app-code-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonDirective, UiIconComponent],
  template: `
    <section class="flex h-full flex-col bg-card overflow-hidden">
      <!-- Editor Tabs Bar -->
      <div
        class="flex h-9 shrink-0 items-center overflow-x-auto border-b border-border bg-background/60"
        role="tablist"
        aria-label="Open files"
      >
        @for (tabPath of vfs.openTabsSignal(); track tabPath) {
          <div
            role="tab"
            [attr.aria-selected]="tabPath === vfs.activeFileSignal()"
            class="group flex h-full shrink-0 items-center gap-2 border-r border-border px-3 text-xs transition-colors cursor-pointer"
            [class.bg-card]="tabPath === vfs.activeFileSignal()"
            [class.text-foreground]="tabPath === vfs.activeFileSignal()"
            [class.border-t-2]="tabPath === vfs.activeFileSignal()"
            [class.border-t-primary]="tabPath === vfs.activeFileSignal()"
            [class.text-muted-foreground]="tabPath !== vfs.activeFileSignal()"
            [class.hover:bg-card/50]="tabPath !== vfs.activeFileSignal()"
            (click)="vfs.selectFile(tabPath)"
          >
            <span class="font-mono text-[12px]">{{ fileName(tabPath) }}</span>
            @if (vfs.dirtyFilesSignal().has(tabPath)) {
              <span class="h-1.5 w-1.5 rounded-full bg-amber-400" title="Modified"></span>
            }
            @if (vfs.openTabsSignal().length > 1) {
              <button
                type="button"
                class="rounded p-0.5 text-muted-foreground opacity-60 hover:bg-accent hover:text-foreground group-hover:opacity-100 cursor-pointer"
                aria-label="Close tab"
                (click)="closeTab($event, tabPath)"
              >
                <ui-icon name="x" iconClass="h-3 w-3" />
              </button>
            }
          </div>
        }
      </div>

      <!-- Breadcrumb / Editor Subbar -->
      <div class="flex h-7 shrink-0 items-center justify-between border-b border-border/70 bg-card px-3 text-[11px] text-muted-foreground">
        <div class="flex items-center gap-2 min-w-0">
          <span class="truncate font-mono text-slate-300">{{ vfs.activeFileSignal() }}</span>
          @if (activeLanguage()) {
            <span class="rounded bg-secondary px-1.5 py-px text-[10px] uppercase tracking-wide text-secondary-foreground">
              {{ activeLanguage() }}
            </span>
          }
        </div>
        <div class="flex items-center gap-2">
          <span class="hidden xl:inline text-[10px] text-muted-foreground">
            ⌘S Share · ⌘↵ Run · ⇧⌥F Format
          </span>
          <button
            cpButton
            variant="ghost"
            size="xs"
            type="button"
            (click)="formatActiveFile()"
          >
            <ui-icon name="sparkles" iconClass="h-3 w-3 text-amber-300" />
            Format
          </button>
        </div>
      </div>

      <!-- Monaco Container -->
      <div class="relative flex-1 min-h-0">
        @if (editorLoading()) {
          <div class="absolute inset-0 z-10 flex items-center justify-center bg-card text-xs text-muted-foreground">
            Loading Monaco Editor...
          </div>
        }
        <div #editorHost class="h-full w-full"></div>
      </div>
    </section>
  `,
})
export class CodeEditorComponent implements AfterViewInit, OnDestroy {
  @ViewChild('editorHost', { static: true })
  private readonly editorHost!: ElementRef<HTMLDivElement>;

  protected readonly vfs = inject(VfsStateService);
  private readonly monacoBridge = inject(MonacoBridgeService);
  private readonly runtime = inject(RuntimeOrchestratorService);

  readonly shareShortcut = output<void>();

  protected readonly editorLoading = signal(true);
  protected readonly activeLanguage = computed(
    () => this.vfs.activeFileContent()?.language ?? '',
  );

  private monaco: typeof Monaco | null = null;
  private editor: Monaco.editor.IStandaloneCodeEditor | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private contentSub: Monaco.IDisposable | null = null;
  private currentAttachedPath: string | null = null;
  private isApplyingModel = false;

  constructor() {
    // Sync active VFS file & full model set into Monaco reactively
    effect(() => {
      const files = this.vfs.filesSignal();
      const activePath = this.vfs.activeFileSignal();
      if (!this.monaco || !this.editor) return;

      this.syncMonacoToState(files, activePath);
    });
  }

  async ngAfterViewInit(): Promise<void> {
    const monaco = await this.monacoBridge.ensureInitialized();
    this.monaco = monaco;

    const editor = monaco.editor.create(this.editorHost.nativeElement, {
      theme: 'codepad-dark',
      automaticLayout: false,
      minimap: { enabled: false },
      fontSize: 13.5,
      lineHeight: 21,
      fontFamily:
        "'JetBrains Mono', 'SF Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, monospace",
      fontLigatures: true,
      tabSize: 2,
      insertSpaces: true,
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      bracketPairColorization: { enabled: true },
      padding: { top: 12, bottom: 12 },
      renderWhitespace: 'selection',
    });

    this.editor = editor;
    this.editorLoading.set(false);

    // Keyboard shortcuts inside Monaco
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      this.shareShortcut.emit();
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      void this.runtime.runActiveWorkspace();
    });

    editor.addCommand(
      monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF,
      () => {
        void this.formatActiveFile();
      },
    );

    this.contentSub = editor.onDidChangeModelContent(() => {
      if (this.isApplyingModel) return;
      const model = editor.getModel();
      if (!model) return;
      const path = model.uri.path;
      this.vfs.updateFileContent(path, model.getValue());
      this.runtime.scheduleAutoRun();
    });

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        editor.layout();
      });
      this.resizeObserver.observe(this.editorHost.nativeElement);
    }

    // Initial sync
    this.syncMonacoToState(this.vfs.filesSignal(), this.vfs.activeFileSignal());
  }

  ngOnDestroy(): void {
    this.contentSub?.dispose();
    this.resizeObserver?.disconnect();
    this.editor?.dispose();
  }

  async formatActiveFile(): Promise<void> {
    const active = this.vfs.activeFileContent();
    if (!active) return;

    try {
      const { formatted, supported } = await this.monacoBridge.formatWithPrettier(
        active.path,
        active.content,
      );
      if (!supported) {
        this.vfs.notify(`Prettier formatting is not applicable to ${active.language} files.`, 'info');
        return;
      }
      if (formatted !== active.content) {
        this.vfs.updateFileContent(active.path, formatted);
        this.runtime.scheduleAutoRun();
        this.vfs.notify('Formatted with Prettier', 'success');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Formatting failed';
      this.vfs.notify(`Format error: ${message}`, 'error');
    }
  }

  protected closeTab(event: MouseEvent, path: string): void {
    event.stopPropagation();
    this.vfs.closeTab(path);
  }

  protected fileName(path: string): string {
    return getBaseName(path);
  }

  private syncMonacoToState(
    files: Record<string, ReturnType<typeof this.vfs.filesSignal>[string]>,
    activePath: string,
  ): void {
    if (!this.monaco || !this.editor) return;

    this.isApplyingModel = true;
    try {
      this.monacoBridge.syncModels(this.monaco, files);

      if (this.currentAttachedPath !== activePath) {
        this.monacoBridge.saveViewState(this.editor, this.currentAttachedPath);
        const nextModel = this.monacoBridge.getModelForPath(this.monaco, activePath);
        if (nextModel) {
          this.editor.setModel(nextModel);
          this.monacoBridge.restoreViewState(this.editor, activePath);
          this.currentAttachedPath = activePath;
          this.editor.focus();
        }
      }
    } finally {
      this.isApplyingModel = false;
    }
  }
}
