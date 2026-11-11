import { ChangeDetectionStrategy, Component, HostListener, input, output } from '@angular/core';

@Component({
  selector: 'ui-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4"
        role="dialog"
        aria-modal="true"
        [attr.aria-label]="title()"
        (click)="onBackdropClick($event)"
      >
        <div
          class="w-full max-w-lg rounded-lg border border-border bg-card text-card-foreground shadow-2xl overflow-hidden"
          (click)="$event.stopPropagation()"
        >
          <div class="flex items-center justify-between border-b border-border px-5 py-3.5">
            <div>
              <h2 class="text-sm font-semibold tracking-tight text-foreground">{{ title() }}</h2>
              @if (description()) {
                <p class="mt-0.5 text-xs text-muted-foreground">{{ description() }}</p>
              }
            </div>
            <button
              type="button"
              class="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
              aria-label="Close dialog"
              (click)="close.emit()"
            >
              <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div class="p-5">
            <ng-content />
          </div>
        </div>
      </div>
    }
  `,
})
export class UiDialogComponent {
  readonly open = input<boolean>(false);
  readonly title = input<string>('');
  readonly description = input<string>('');
  readonly close = output<void>();

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.open()) {
      this.close.emit();
    }
  }

  protected onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close.emit();
    }
  }
}

