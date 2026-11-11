import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CodeEditorComponent } from './components/code-editor/code-editor.component';
import { FileExplorerComponent } from './components/file-explorer/file-explorer.component';
import { PreviewConsoleComponent } from './components/preview-console/preview-console.component';
import { ShareDialogComponent } from './components/share-dialog/share-dialog.component';
import { TopBarComponent } from './components/top-bar/top-bar.component';
import { ButtonDirective } from './components/ui/button.directive';
import { UiDialogComponent } from './components/ui/dialog.component';
import { UiIconComponent } from './components/ui/icon.component';
import { RuntimeOrchestratorService } from './services/runtime-orchestrator.service';
import { VfsStateService } from './services/vfs-state.service';

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TopBarComponent,
    FileExplorerComponent,
    CodeEditorComponent,
    PreviewConsoleComponent,
    ShareDialogComponent,
    UiDialogComponent,
    ButtonDirective,
    UiIconComponent,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class App implements OnDestroy {
  @ViewChild('workspaceGrid', { static: true })
  private readonly workspaceGrid!: ElementRef<HTMLElement>;

  @ViewChild(CodeEditorComponent)
  private readonly codeEditor?: CodeEditorComponent;

  protected readonly vfs = inject(VfsStateService);
  protected readonly runtime = inject(RuntimeOrchestratorService);

  protected readonly leftWidthPx = signal(236);
  protected readonly rightWidthPx = signal(460);
  protected readonly isDraggingDivider = signal(false);
  protected readonly shareModalOpen = signal(false);
  protected readonly resetModalOpen = signal(false);

  protected readonly gridTemplateColumns = computed(
    () => `${this.leftWidthPx()}px 6px minmax(280px, 1fr) 6px ${this.rightWidthPx()}px`,
  );

  private activeDragCleanup: (() => void) | null = null;
  private envInitialized = false;

  constructor() {
    effect(() => {
      this.vfs.envSignal();
      if (!this.envInitialized) {
        this.envInitialized = true;
        return;
      }
      queueMicrotask(() => {
        void this.runtime.runActiveWorkspace();
      });
    });
  }

  ngOnDestroy(): void {
    this.activeDragCleanup?.();
  }

  @HostListener('window:keydown', ['$event'])
  protected onGlobalKeyDown(event: KeyboardEvent): void {
    const isModifier = event.metaKey || event.ctrlKey;
    if (isModifier && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void this.handleQuickShareSave();
      return;
    }
    if (isModifier && event.key === 'Enter') {
      event.preventDefault();
      void this.runtime.runActiveWorkspace();
    }
  }

  protected async handleQuickShareSave(): Promise<void> {
    const url = this.vfs.syncShareToUrl();
    if (this.vfs.envSignal() !== 'python') {
      void this.runtime.runActiveWorkspace();
    }
    try {
      await navigator.clipboard.writeText(url);
      this.vfs.notify('Synced to URL hash & copied share link!', 'success');
    } catch {
      this.vfs.notify('Synced workspace to URL hash (#code=...)', 'info');
    }
  }

  protected openShareDialog(): void {
    this.vfs.syncShareToUrl();
    this.shareModalOpen.set(true);
  }

  protected formatActiveFile(): void {
    void this.codeEditor?.formatActiveFile();
  }

  protected confirmReset(): void {
    this.resetModalOpen.set(false);
    this.vfs.resetToTemplate();
    void this.runtime.runActiveWorkspace();
  }

  protected startLeftResize(event: PointerEvent): void {
    event.preventDefault();
    this.isDraggingDivider.set(true);

    const gridEl = this.workspaceGrid.nativeElement;
    const onMove = (moveEvt: PointerEvent) => {
      const rect = gridEl.getBoundingClientRect();
      const maxLeft = Math.max(200, rect.width - this.rightWidthPx() - 320);
      const next = Math.min(maxLeft, Math.max(170, moveEvt.clientX - rect.left));
      this.leftWidthPx.set(Math.round(next));
    };

    const onUp = () => {
      this.isDraggingDivider.set(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      this.activeDragCleanup = null;
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    this.activeDragCleanup = onUp;
  }

  protected startRightResize(event: PointerEvent): void {
    event.preventDefault();
    this.isDraggingDivider.set(true);

    const gridEl = this.workspaceGrid.nativeElement;
    const onMove = (moveEvt: PointerEvent) => {
      const rect = gridEl.getBoundingClientRect();
      const maxRight = Math.max(280, rect.width - this.leftWidthPx() - 320);
      const next = Math.min(maxRight, Math.max(280, rect.right - moveEvt.clientX));
      this.rightWidthPx.set(Math.round(next));
    };

    const onUp = () => {
      this.isDraggingDivider.set(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      this.activeDragCleanup = null;
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    this.activeDragCleanup = onUp;
  }
}
