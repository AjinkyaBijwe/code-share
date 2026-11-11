import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FileTreeNode } from '../../models/workspace.models';
import { VfsStateService } from '../../services/vfs-state.service';
import { buildFileTree, getBaseName, getParentPath } from '../../utils/path.utils';
import { ButtonDirective } from '../ui/button.directive';
import { UiIconComponent } from '../ui/icon.component';
import { InputDirective } from '../ui/input.directive';

interface CreationDraft {
  mode: 'file' | 'folder';
  parentPath: string;
}

@Component({
  selector: 'app-file-explorer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonDirective, InputDirective, UiIconComponent],
  template: `
    <aside class="flex h-full flex-col bg-card select-none">
      <!-- Explorer Header -->
      <div class="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
        <span class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Files
        </span>
        <div class="flex items-center gap-1">
          <button
            cpButton
            variant="ghost"
            size="icon"
            type="button"
            class="h-6 w-6"
            title="New File"
            aria-label="New File"
            (click)="startCreate('file', '/')"
          >
            <ui-icon name="file-plus" iconClass="h-3.5 w-3.5" />
          </button>
          <button
            cpButton
            variant="ghost"
            size="icon"
            type="button"
            class="h-6 w-6"
            title="New Folder"
            aria-label="New Folder"
            (click)="startCreate('folder', '/')"
          >
            <ui-icon name="folder-plus" iconClass="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <!-- Optional Root / Nested Creation Draft -->
      @if (creationDraft(); as draft) {
        <form
          class="border-b border-border bg-muted/40 p-2"
          (submit)="submitCreate($event)"
        >
          <div class="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>
              New {{ draft.mode }} in
              <code class="text-foreground">{{ draft.parentPath }}</code>
            </span>
            <button
              type="button"
              class="text-muted-foreground hover:text-foreground cursor-pointer"
              (click)="cancelCreate()"
            >
              Esc
            </button>
          </div>
          <input
            cpInput
            type="text"
            class="h-7 font-mono text-xs"
            [placeholder]="draft.mode === 'file' ? 'e.g. helpers.ts' : 'e.g. components'"
            [value]="draftValue()"
            (input)="draftValue.set(asInputValue($event))"
            (keydown.escape)="cancelCreate()"
            autofocus
          />
        </form>
      }

      <!-- File Tree List -->
      <div class="flex-1 overflow-y-auto py-1.5" role="tree" aria-label="Workspace files">
        @for (node of visibleNodes(); track node.path) {
          <div
            class="group flex h-7 items-center justify-between gap-1.5 pr-2 text-xs transition-colors cursor-pointer"
            [style.padding-left.px]="10 + node.depth * 14"
            [class.bg-accent]="node.type === 'file' && node.path === vfs.activeFileSignal()"
            [class.text-foreground]="node.type === 'file' && node.path === vfs.activeFileSignal()"
            [class.text-muted-foreground]="node.type !== 'file' || node.path !== vfs.activeFileSignal()"
            [class.hover:bg-accent/50]="node.type !== 'file' || node.path !== vfs.activeFileSignal()"
            role="treeitem"
            [attr.aria-selected]="node.type === 'file' && node.path === vfs.activeFileSignal()"
            (click)="onNodeClick(node)"
          >
            @if (renamingPath() === node.path) {
              <input
                cpInput
                type="text"
                class="h-6 flex-1 font-mono text-xs"
                [value]="renameValue()"
                (click)="$event.stopPropagation()"
                (input)="renameValue.set(asInputValue($event))"
                (keydown.enter)="commitRename(node)"
                (keydown.escape)="cancelRename()"
                (blur)="commitRename(node)"
                autofocus
              />
            } @else {
              <div class="flex min-w-0 flex-1 items-center gap-1.5">
                @if (node.type === 'folder') {
                  <ui-icon
                    [name]="isExpanded(node.path) ? 'chevron-down' : 'chevron-right'"
                    iconClass="h-3 w-3 shrink-0 text-muted-foreground"
                  />
                  <ui-icon
                    [name]="isExpanded(node.path) ? 'folder-open' : 'folder'"
                    iconClass="h-3.5 w-3.5 shrink-0 text-amber-400/90"
                  />
                } @else {
                  <span
                    class="inline-flex h-4 w-5 shrink-0 items-center justify-center rounded text-[9px] font-bold tracking-tight"
                    [class]="fileBadgeClass(node.name)"
                  >
                    {{ fileBadgeLabel(node.name) }}
                  </span>
                }

                <span class="truncate font-mono text-[12px]" [class.font-medium]="node.path === vfs.activeFileSignal()">
                  {{ node.name }}
                </span>

                @if (node.isEntry) {
                  <span
                    class="rounded bg-primary/15 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-blue-300"
                  >
                    entry
                  </span>
                }
                @if (node.isDirty) {
                  <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" title="Modified"></span>
                }
              </div>

              <!-- Row Hover Actions -->
              <div
                class="hidden items-center gap-0.5 group-hover:flex"
                (click)="$event.stopPropagation()"
              >
                @if (node.type === 'folder') {
                  <button
                    type="button"
                    class="rounded p-1 text-muted-foreground hover:bg-background/70 hover:text-foreground cursor-pointer"
                    title="New file in folder"
                    (click)="startCreate('file', node.path)"
                  >
                    <ui-icon name="file-plus" iconClass="h-3 w-3" />
                  </button>
                }
                <button
                  type="button"
                  class="rounded p-1 text-muted-foreground hover:bg-background/70 hover:text-foreground cursor-pointer"
                  title="Rename"
                  (click)="startRename(node)"
                >
                  <ui-icon name="pencil" iconClass="h-3 w-3" />
                </button>
                <button
                  type="button"
                  class="rounded p-1 text-muted-foreground hover:bg-destructive/20 hover:text-red-300 cursor-pointer"
                  title="Delete"
                  (click)="deleteNode(node)"
                >
                  <ui-icon name="trash" iconClass="h-3 w-3" />
                </button>
              </div>
            }
          </div>
        }
      </div>

      <!-- Footer Info -->
      <div class="flex items-center justify-between border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
        <span>{{ fileCount() }} files</span>
        <span class="font-mono text-[10px]">IndexedDB auto-save</span>
      </div>
    </aside>
  `,
})
export class FileExplorerComponent {
  protected readonly vfs = inject(VfsStateService);

  private readonly collapsedFolders = signal<Set<string>>(new Set());
  protected readonly creationDraft = signal<CreationDraft | null>(null);
  protected readonly draftValue = signal('');
  protected readonly renamingPath = signal<string | null>(null);
  protected readonly renameValue = signal('');

  protected readonly tree = computed(() =>
    buildFileTree(this.vfs.filesSignal(), this.vfs.foldersSignal(), this.vfs.dirtyFilesSignal()),
  );

  protected readonly visibleNodes = computed<FileTreeNode[]>(() => {
    const collapsed = this.collapsedFolders();
    const flat: FileTreeNode[] = [];

    const walk = (nodes: FileTreeNode[]): void => {
      for (const node of nodes) {
        flat.push(node);
        if (node.type === 'folder' && !collapsed.has(node.path) && node.children) {
          walk(node.children);
        }
      }
    };

    walk(this.tree());
    return flat;
  });

  protected readonly fileCount = computed(() => Object.keys(this.vfs.filesSignal()).length);

  protected isExpanded(folderPath: string): boolean {
    return !this.collapsedFolders().has(folderPath);
  }

  protected onNodeClick(node: FileTreeNode): void {
    if (node.type === 'folder') {
      this.collapsedFolders.update((prev) => {
        const next = new Set(prev);
        if (next.has(node.path)) {
          next.delete(node.path);
        } else {
          next.add(node.path);
        }
        return next;
      });
      return;
    }

    this.vfs.selectFile(node.path);
  }

  protected startCreate(mode: 'file' | 'folder', parentPath: string): void {
    this.renamingPath.set(null);
    this.creationDraft.set({ mode, parentPath });
    this.draftValue.set('');
  }

  protected cancelCreate(): void {
    this.creationDraft.set(null);
    this.draftValue.set('');
  }

  protected submitCreate(event: Event): void {
    event.preventDefault();
    const draft = this.creationDraft();
    const raw = this.draftValue().trim();
    if (!draft || !raw) {
      this.cancelCreate();
      return;
    }

    const base = draft.parentPath === '/' ? '' : draft.parentPath;
    const targetPath = raw.startsWith('/') ? raw : `${base}/${raw}`;

    const ok =
      draft.mode === 'file'
        ? this.vfs.createFile(targetPath)
        : this.vfs.createFolder(targetPath);

    if (ok) {
      if (draft.parentPath !== '/') {
        this.collapsedFolders.update((prev) => {
          const next = new Set(prev);
          next.delete(draft.parentPath);
          return next;
        });
      }
      this.cancelCreate();
    }
  }

  protected startRename(node: FileTreeNode): void {
    this.cancelCreate();
    this.renamingPath.set(node.path);
    this.renameValue.set(getBaseName(node.path));
  }

  protected cancelRename(): void {
    this.renamingPath.set(null);
    this.renameValue.set('');
  }

  protected commitRename(node: FileTreeNode): void {
    if (this.renamingPath() !== node.path) return;
    const nextName = this.renameValue().trim();
    this.cancelRename();
    if (!nextName || nextName === node.name) return;

    const parent = getParentPath(node.path);
    const nextPath = parent === '/' ? `/${nextName}` : `${parent}/${nextName}`;
    this.vfs.renameNode(node.path, nextPath);
  }

  protected deleteNode(node: FileTreeNode): void {
    this.vfs.deleteNode(node.path);
  }

  protected asInputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected fileBadgeLabel(name: string): string {
    const lower = name.toLowerCase();
    if (lower.endsWith('.tsx')) return 'TSX';
    if (lower.endsWith('.ts')) return 'TS';
    if (lower.endsWith('.jsx')) return 'JSX';
    if (lower.endsWith('.js') || lower.endsWith('.mjs')) return 'JS';
    if (lower.endsWith('.py')) return 'PY';
    if (lower.endsWith('.html')) return 'HTM';
    if (lower.endsWith('.css') || lower.endsWith('.scss')) return 'CSS';
    if (lower.endsWith('.json')) return '{}';
    if (lower.endsWith('.txt')) return 'TXT';
    return 'DOC';
  }

  protected fileBadgeClass(name: string): string {
    const lower = name.toLowerCase();
    if (lower.endsWith('.tsx') || lower.endsWith('.jsx')) return 'bg-cyan-500/15 text-cyan-300';
    if (lower.endsWith('.ts')) return 'bg-blue-500/15 text-blue-300';
    if (lower.endsWith('.js') || lower.endsWith('.mjs')) return 'bg-yellow-500/15 text-yellow-300';
    if (lower.endsWith('.py')) return 'bg-amber-500/15 text-amber-300';
    if (lower.endsWith('.html')) return 'bg-orange-500/15 text-orange-300';
    if (lower.endsWith('.css') || lower.endsWith('.scss')) return 'bg-indigo-500/15 text-indigo-300';
    if (lower.endsWith('.json')) return 'bg-emerald-500/15 text-emerald-300';
    return 'bg-slate-500/15 text-slate-300';
  }
}

