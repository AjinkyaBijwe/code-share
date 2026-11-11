import { Directive, computed, input } from '@angular/core';
import { cn } from '../../lib/utils';

@Directive({
  selector: 'input[cpInput], select[cpInput], textarea[cpInput]',
  standalone: true,
  host: {
    '[class]': 'computedClass()',
  },
})
export class InputDirective {
  readonly class = input<string>('');

  protected readonly computedClass = computed(() =>
    cn(
      'flex h-8 w-full rounded-md border border-input bg-background px-2.5 py-1 text-xs text-foreground shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
      this.class(),
    ),
  );
}

