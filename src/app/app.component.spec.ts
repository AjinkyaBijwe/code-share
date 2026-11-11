import { TestBed } from '@angular/core/testing';
import { App } from './app.component';
import { MonacoBridgeService } from './services/monaco-bridge.service';
import { RuntimeOrchestratorService } from './services/runtime-orchestrator.service';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        {
          provide: MonacoBridgeService,
          useValue: {
            ensureInitialized: () => new Promise(() => {}),
            syncModels: () => {},
            formatWithPrettier: async (_p: string, c: string) => ({
              formatted: c,
              supported: true,
            }),
          },
        },
        {
          provide: RuntimeOrchestratorService,
          useValue: {
            logsSignal: () => [],
            filteredLogsSignal: () => [],
            filterSignal: () => 'all',
            statusSignal: () => 'idle',
            summarySignal: () => ({ status: 'idle' }),
            viewportSignal: () => 'desktop',
            webEngineSignal: () => 'esm',
            autoRunSignal: () => true,
            isRunningSignal: () => false,
            logCountsSignal: () => ({
              all: 0,
              info: 0,
              warn: 0,
              error: 0,
              'python-stdout': 0,
              system: 0,
            }),
            attachPreviewIframe: () => {},
            attachSandpackIframe: () => {},
            runActiveWorkspace: async () => {},
            scheduleAutoRun: () => {},
            toggleAutoRun: () => {},
            stopExecution: () => {},
            setViewport: () => {},
            setWebEngine: () => {},
            setFilter: () => {},
            clearLogs: () => {},
          },
        },
      ],
    }).compileComponents();
  });

  it('should render CodePad shell with workspace controls and explorer', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('CodePad');
    expect(compiled.textContent).toContain('TypeScript');
    expect(compiled.textContent).toContain('index.ts');
    expect(compiled.textContent).toContain('Share');
  });

  it('should toggle preview fullscreen mode and exit on Escape', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const enterBtn = compiled.querySelector(
      'button[aria-label="Fullscreen preview"]',
    ) as HTMLButtonElement | null;
    expect(enterBtn).not.toBeNull();
    expect(enterBtn?.getAttribute('aria-pressed')).toBe('false');

    enterBtn!.click();
    fixture.detectChanges();

    const exitBtn = compiled.querySelector(
      'button[aria-label="Exit fullscreen preview"]',
    ) as HTMLButtonElement | null;
    expect(exitBtn).not.toBeNull();
    expect(exitBtn?.getAttribute('aria-pressed')).toBe('true');
    expect(exitBtn?.textContent).toContain('Exit Fullscreen');

    const previewPane = exitBtn?.closest('.fixed.inset-0');
    expect(previewPane).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();

    expect(
      compiled.querySelector('button[aria-label="Fullscreen preview"]')?.getAttribute('aria-pressed'),
    ).toBe('false');
  });
});
