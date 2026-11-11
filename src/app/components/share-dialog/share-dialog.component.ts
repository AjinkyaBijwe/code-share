import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { VfsStateService } from '../../services/vfs-state.service';
import { UiBadgeComponent } from '../ui/badge.component';
import { ButtonDirective } from '../ui/button.directive';
import { UiDialogComponent } from '../ui/dialog.component';
import { UiIconComponent } from '../ui/icon.component';
import { InputDirective } from '../ui/input.directive';

@Component({
  selector: 'app-share-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ButtonDirective,
    InputDirective,
    UiBadgeComponent,
    UiDialogComponent,
    UiIconComponent,
  ],
  template: `
    <ui-dialog
      [open]="open()"
      title="Share CodePad Workspace"
      description="Zero-login sharing: every file and active tab is serialized directly into your link."
      (close)="close.emit()"
    >
      <div class="space-y-4">
        <!-- Tier 2: <=8-Char Short Snapshot Link -->
        <div class="rounded-lg border border-border bg-background/60 p-3.5 space-y-2.5">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <ui-icon name="cloud" iconClass="h-4 w-4 text-cyan-400" />
              <span class="text-xs font-semibold text-foreground">
                Short Link (#s=:id, max 8-char ID)
              </span>
            </div>
            @if (snapshotId()) {
              <ui-badge variant="success">{{ snapshotId()!.length }} chars ID</ui-badge>
            } @else if (stats().exceedsHashRecommendation) {
              <ui-badge variant="warning">Recommended (&gt;8k chars)</ui-badge>
            } @else {
              <ui-badge variant="outline">30-day KV TTL</ui-badge>
            }
          </div>

          <p class="text-[11px] text-muted-foreground">
            Generates a compact <code class="text-foreground">6-8 char</code> Base62 slug via
            Cloudflare KV / Upstash Redis (<code class="text-foreground">edge/snapshot-worker.ts</code>). Saved per browser.
          </p>

          <div class="flex items-center gap-2">
            <input
              cpInput
              type="text"
              class="font-mono text-[11px]"
              placeholder="https://your-worker.workers.dev or /api/snapshot"
              [value]="vfs.snapshotEndpointSignal()"
              (input)="vfs.setSnapshotEndpoint(asInputValue($event))"
            />
            <button
              cpButton
              variant="default"
              size="sm"
              type="button"
              [disabled]="creatingSnapshot()"
              (click)="createSnapshot()"
            >
              {{ creatingSnapshot() ? 'Creating...' : 'Create Short Link' }}
            </button>
          </div>

          @if (snapshotUrl()) {
            <div class="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2">
              <input
                cpInput
                type="text"
                readonly
                class="h-7 font-mono text-[11px]"
                [value]="snapshotUrl()!"
                (focus)="selectAll($event)"
              />
              <button
                cpButton
                variant="secondary"
                size="xs"
                type="button"
                (click)="copyText(snapshotUrl()!)"
              >
                Copy
              </button>
            </div>
          }

          @if (snapshotError()) {
            <div class="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
              {{ snapshotError() }}
            </div>
          }
        </div>

        <!-- Tier 1: Compact Stateless URL Compression -->
        <div class="rounded-lg border border-border bg-background/60 p-3.5 space-y-2.5">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <ui-icon name="link" iconClass="h-4 w-4 text-blue-400" />
              <span class="text-xs font-semibold text-foreground">
                Stateless URL Compression (Zero-Backend)
              </span>
            </div>
            <ui-badge [variant]="stats().exceedsHashRecommendation ? 'warning' : 'success'">
              @if (vfs.compressedHashSignal().startsWith('z0')) {
                Template · {{ stats().compressedChars }} chars
              } @else {
                Token · {{ stats().compressedChars }} chars
              }
            </ui-badge>
          </div>

          <p class="text-[11px] text-muted-foreground">
            @if (vfs.compressedHashSignal().startsWith('z0')) {
              Unmodified starter template encoded as <code class="text-foreground">{{ vfs.compressedHashSignal() }}</code> (edits switch to deflated delta).
            } @else {
              {{ stats().fileCount }} files ({{ stats().rawBytes }} B raw) compacted with
              template-delta + DEFLATE / LZ-String.
            }
          </p>

          <div class="flex items-center gap-2">
            <button
              type="button"
              class="rounded px-2 py-1 text-[11px] font-medium border transition-colors cursor-pointer"
              [class.border-primary]="urlFormat() === 'hash'"
              [class.bg-primary/15]="urlFormat() === 'hash'"
              [class.text-foreground]="urlFormat() === 'hash'"
              [class.border-border]="urlFormat() !== 'hash'"
              [class.text-muted-foreground]="urlFormat() !== 'hash'"
              (click)="urlFormat.set('hash')"
            >
              #code=... (Recommended)
            </button>
            <button
              type="button"
              class="rounded px-2 py-1 text-[11px] font-medium border transition-colors cursor-pointer"
              [class.border-primary]="urlFormat() === 'query'"
              [class.bg-primary/15]="urlFormat() === 'query'"
              [class.text-foreground]="urlFormat() === 'query'"
              [class.border-border]="urlFormat() !== 'query'"
              [class.text-muted-foreground]="urlFormat() !== 'query'"
              (click)="urlFormat.set('query')"
            >
              ?pad=... Query Param
            </button>
          </div>

          <div class="flex items-center gap-2">
            <input
              cpInput
              type="text"
              readonly
              class="font-mono text-[11px]"
              [value]="displayedUrl()"
              (focus)="selectAll($event)"
            />
            <button
              cpButton
              variant="outline"
              size="sm"
              type="button"
              (click)="copyDisplayedUrl()"
            >
              <ui-icon name="copy" iconClass="h-3.5 w-3.5" />
              {{ copiedUrl() ? 'Copied' : 'Copy' }}
            </button>
          </div>
        </div>
      </div>
    </ui-dialog>
  `,
})
export class ShareDialogComponent {
  protected readonly vfs = inject(VfsStateService);

  readonly open = input<boolean>(false);
  readonly close = output<void>();

  protected readonly urlFormat = signal<'hash' | 'query'>('hash');
  protected readonly copiedUrl = signal(false);
  protected readonly creatingSnapshot = signal(false);
  protected readonly snapshotId = signal<string | null>(null);
  protected readonly snapshotUrl = signal<string | null>(null);
  protected readonly snapshotError = signal<string | null>(null);

  protected readonly stats = this.vfs.payloadStatsSignal;
  protected readonly displayedUrl = computed(() =>
    this.urlFormat() === 'hash'
      ? this.vfs.shareUrlSignal()
      : this.vfs.queryShareUrlSignal(),
  );

  constructor() {
    effect(() => {
      if (this.open()) {
        this.snapshotId.set(null);
        this.snapshotUrl.set(null);
        this.snapshotError.set(null);
      }
    });
  }

  protected async copyDisplayedUrl(): Promise<void> {
    this.vfs.syncShareToUrl();
    const ok = await this.copyText(this.displayedUrl());
    if (ok) {
      this.copiedUrl.set(true);
      setTimeout(() => this.copiedUrl.set(false), 1800);
    }
  }

  protected async createSnapshot(): Promise<void> {
    this.creatingSnapshot.set(true);
    this.snapshotError.set(null);
    this.snapshotId.set(null);
    this.snapshotUrl.set(null);

    try {
      const result = await this.vfs.createShortSnapshot();
      this.snapshotId.set(result.id);
      this.snapshotUrl.set(result.url);
      this.vfs.notify(`Created short snapshot #s=${result.id}`, 'success');
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Request failed';
      this.snapshotError.set(
        `No snapshot KV worker reachable at "${this.vfs.snapshotEndpointSignal()}" (${detail}). Deploy edge/snapshot-worker.ts via "npx wrangler deploy" and paste its URL above, or use Stateless URL below.`,
      );
    } finally {
      this.creatingSnapshot.set(false);
    }
  }

  protected async copyText(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      this.vfs.notify('Link copied to clipboard!', 'success');
      return true;
    } catch {
      this.vfs.notify('Copy failed — select and copy the URL manually.', 'warn');
      return false;
    }
  }

  protected selectAll(event: FocusEvent): void {
    (event.target as HTMLInputElement).select();
  }

  protected asInputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
}

