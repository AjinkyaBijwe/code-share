import {
  ChangeDetectionStrategy,
  Component,
  computed,
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
        <!-- Tier 1: Stateless URL Compression -->
        <div class="rounded-lg border border-border bg-background/60 p-3.5 space-y-2.5">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <ui-icon name="link" iconClass="h-4 w-4 text-blue-400" />
              <span class="text-xs font-semibold text-foreground">
                Tier 1 · Stateless URL Compression (LZ-String)
              </span>
            </div>
            <ui-badge [variant]="stats().exceedsHashRecommendation ? 'warning' : 'success'">
              {{ stats().compressedChars }} chars
            </ui-badge>
          </div>

          <p class="text-[11px] text-muted-foreground">
            {{ stats().fileCount }} files ({{ stats().rawBytes }} B raw) compressed with
            <code class="text-foreground">compressToEncodedURIComponent</code>.
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
              variant="default"
              size="sm"
              type="button"
              (click)="copyDisplayedUrl()"
            >
              <ui-icon name="copy" iconClass="h-3.5 w-3.5" />
              {{ copiedUrl() ? 'Copied' : 'Copy' }}
            </button>
          </div>
        </div>

        <!-- Tier 2: Optional Ephemeral Cloud Snapshot -->
        <div class="rounded-lg border border-border bg-background/60 p-3.5 space-y-2.5">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <ui-icon name="cloud" iconClass="h-4 w-4 text-cyan-400" />
              <span class="text-xs font-semibold text-foreground">
                Tier 2 · Ephemeral Cloud Snapshot (/s/:id, 30-day TTL)
              </span>
            </div>
            @if (stats().exceedsHashRecommendation) {
              <ui-badge variant="warning">Recommended (&gt;8k chars)</ui-badge>
            } @else {
              <ui-badge variant="outline">Optional</ui-badge>
            }
          </div>

          <p class="text-[11px] text-muted-foreground">
            POSTs compressed workspace state to an anonymous KV edge endpoint (Upstash Redis / Cloudflare KV).
          </p>

          <div class="flex items-center gap-2">
            <input
              cpInput
              type="text"
              class="font-mono text-[11px]"
              placeholder="/api/snapshot"
              [value]="vfs.snapshotEndpointSignal()"
              (input)="vfs.setSnapshotEndpoint(asInputValue($event))"
            />
            <button
              cpButton
              variant="outline"
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
  protected readonly snapshotUrl = signal<string | null>(null);
  protected readonly snapshotError = signal<string | null>(null);

  protected readonly stats = this.vfs.payloadStatsSignal;
  protected readonly displayedUrl = computed(() =>
    this.urlFormat() === 'hash'
      ? this.vfs.shareUrlSignal()
      : this.vfs.queryShareUrlSignal(),
  );

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
    this.snapshotUrl.set(null);

    try {
      const result = await this.vfs.createShortSnapshot();
      this.snapshotUrl.set(result.url);
      this.vfs.notify(`Created short snapshot ${result.id}`, 'success');
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Request failed';
      this.snapshotError.set(
        `No snapshot KV endpoint active at "${this.vfs.snapshotEndpointSignal()}" (${detail}). Use Tier 1 URL compression above or point this field to a Cloudflare KV / Upstash Redis /api/snapshot function.`,
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

