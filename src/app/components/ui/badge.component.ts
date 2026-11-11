import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

export const badgeVariants = cva(
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary/15 text-blue-300 border-blue-500/30',
        secondary: 'border-border bg-secondary text-secondary-foreground',
        destructive: 'border-red-500/30 bg-red-500/15 text-red-300',
        success: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300',
        warning: 'border-amber-500/30 bg-amber-500/15 text-amber-300',
        outline: 'border-border text-muted-foreground bg-transparent',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export type BadgeVariant = VariantProps<typeof badgeVariants>['variant'];

@Component({
  selector: 'ui-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ng-content />`,
  host: {
    '[class]': 'computedClass()',
  },
})
export class UiBadgeComponent {
  readonly variant = input<BadgeVariant>('default');
  readonly class = input<string>('');

  protected readonly computedClass = computed(() =>
    cn(badgeVariants({ variant: this.variant() }), this.class()),
  );
}

