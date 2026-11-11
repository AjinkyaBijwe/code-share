import { Injectable, computed, inject, signal } from '@angular/core';
import type { SandpackClient, SandpackMessage } from '@codesandbox/sandpack-client';
import {
  ConsoleEntry,
  ConsoleFilter,
  ConsoleLevel,
  ExecutionStatus,
  ExecutionSummary,
  RuntimeEnvironment,
  ViewportPreset,
  VirtualFile,
  WebSandboxEngine,
} from '../models/workspace.models';
import { normalizeVirtualPath } from '../utils/path.utils';
import { MonacoBridgeService } from './monaco-bridge.service';
import { VfsStateService } from './vfs-state.service';

export interface SandboxExecutionContext {
  env: RuntimeEnvironment;
  files: Record<string, VirtualFile>;
  iframe: HTMLIFrameElement | null;
  engine: WebSandboxEngine;
}

export interface SandboxRunner {
  run(context: SandboxExecutionContext): Promise<void>;
  stop(): void;
  dispose(): void;
}

const DEFAULT_IMPORTS_REACT: Record<string, string> = {
  react: 'https://esm.sh/react@19.1.0',
  'react/': 'https://esm.sh/react@19.1.0/',
  'react/jsx-runtime': 'https://esm.sh/react@19.1.0/jsx-runtime',
  'react/jsx-dev-runtime': 'https://esm.sh/react@19.1.0/jsx-dev-runtime',
  'react-dom': 'https://esm.sh/react-dom@19.1.0',
  'react-dom/': 'https://esm.sh/react-dom@19.1.0/',
  'react-dom/client': 'https://esm.sh/react-dom@19.1.0/client',
};

const DEFAULT_IMPORTS_ANGULAR: Record<string, string> = {
  '@angular/core': 'https://esm.sh/@angular/core@19.2.0',
  '@angular/common':
    'https://esm.sh/@angular/common@19.2.0?deps=@angular/core@19.2.0',
  '@angular/platform-browser':
    'https://esm.sh/@angular/platform-browser@19.2.0?deps=@angular/core@19.2.0,@angular/common@19.2.0',
  '@angular/compiler': 'https://esm.sh/@angular/compiler@19.2.0',
  rxjs: 'https://esm.sh/rxjs@7.8.2',
  'rxjs/operators': 'https://esm.sh/rxjs@7.8.2/operators',
  'zone.js': 'https://esm.sh/zone.js@0.15.0',
};

function resolveRelativeVfsPath(
  fromFilePath: string,
  specifier: string,
  files: Record<string, VirtualFile>,
): string | null {
  if (!specifier.startsWith('./') && !specifier.startsWith('../') && !specifier.startsWith('/')) {
    return null;
  }

  const baseSegments = specifier.startsWith('/')
    ? []
    : fromFilePath.split('/').slice(1, -1);

  for (const part of specifier.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      baseSegments.pop();
    } else {
      baseSegments.push(part);
    }
  }

  const candidate = '/' + baseSegments.join('/');
  const tryOrder = [
    candidate,
    `${candidate}.ts`,
    `${candidate}.tsx`,
    `${candidate}.js`,
    `${candidate}.jsx`,
    `${candidate}.mjs`,
    `${candidate}.css`,
    `${candidate}.json`,
    `${candidate}/index.ts`,
    `${candidate}/index.tsx`,
    `${candidate}/index.js`,
  ];

  for (const probe of tryOrder) {
    if (files[probe]) {
      return probe;
    }
  }
  return null;
}

function rewriteModuleSpecifiers(
  jsCode: string,
  fromFilePath: string,
  files: Record<string, VirtualFile>,
): string {
  const rewriteSpecifier = (specifier: string): string => {
    const resolved = resolveRelativeVfsPath(fromFilePath, specifier, files);
    return resolved ? `@vfs${resolved}` : specifier;
  };

  // Rewrite ES static import/export specifiers and dynamic import('...') calls
  return jsCode
    .replace(
      /(\b(?:import|export)\b[\s\S]*?\bfrom\s*['"])([^'"]+)(['"])/g,
      (_m, pre: string, spec: string, post: string) => `${pre}${rewriteSpecifier(spec)}${post}`,
    )
    .replace(
      /(\bimport\s*['"])([^'"]+)(['"])/g,
      (_m, pre: string, spec: string, post: string) => `${pre}${rewriteSpecifier(spec)}${post}`,
    )
    .replace(
      /(\bimport\s*\(\s*['"])([^'"]+)(['"]\s*\))/g,
      (_m, pre: string, spec: string, post: string) => `${pre}${rewriteSpecifier(spec)}${post}`,
    );
}

function toJsDataUrl(code: string): string {
  const bytes = new TextEncoder().encode(code);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:text/javascript;base64,${btoa(binary)}`;
}

function buildConsoleBootstrapScript(runToken: string): string {
  return `<script>
(function () {
  const RUN_TOKEN = ${JSON.stringify(runToken)};
  function serializeArg(val, depth) {
    if (depth > 3) return '[MaxDepth]';
    if (val === null) return 'null';
    if (val === undefined) return 'undefined';
    if (typeof val === 'string') return val;
    if (typeof val === 'number' || typeof val === 'boolean' || typeof val === 'bigint') return String(val);
    if (val instanceof Error) return val.stack || (val.name + ': ' + val.message);
    if (typeof val === 'function') return '[Function ' + (val.name || 'anonymous') + ']';
    try {
      const seen = new WeakSet();
      return JSON.stringify(val, function (_k, v) {
        if (typeof v === 'object' && v !== null) {
          if (seen.has(v)) return '[Circular]';
          seen.add(v);
        }
        return v;
      }, 2);
    } catch (_) {
      return String(val);
    }
  }
  function emit(level, args) {
    try {
      window.parent.postMessage({
        source: 'codepad-sandbox',
        runToken: RUN_TOKEN,
        type: 'CONSOLE_LOG',
        level: level,
        args: Array.from(args).map(function (a) { return serializeArg(a, 0); })
      }, '*');
    } catch (_) {}
  }
  ['log', 'info', 'debug', 'warn', 'error'].forEach(function (method) {
    const orig = console[method] ? console[method].bind(console) : function () {};
    console[method] = function () {
      const mapped = method === 'warn' ? 'warn' : method === 'error' ? 'error' : 'info';
      emit(mapped, arguments);
      return orig.apply(console, arguments);
    };
  });
  console.clear = function () {
    try {
      window.parent.postMessage({ source: 'codepad-sandbox', runToken: RUN_TOKEN, type: 'CONSOLE_CLEAR' }, '*');
    } catch (_) {}
  };
  window.addEventListener('error', function (event) {
    emit('error', [event.error || event.message || 'Runtime Error']);
  });
  window.addEventListener('unhandledrejection', function (event) {
    emit('error', ['Unhandled Promise Rejection:', event.reason]);
  });
})();
</script>`;
}

@Injectable({ providedIn: 'root' })
export class RuntimeOrchestratorService {
  private readonly vfs = inject(VfsStateService);
  private readonly monacoBridge = inject(MonacoBridgeService);

  private readonly logsState = signal<ConsoleEntry[]>([]);
  private readonly filterState = signal<ConsoleFilter>('all');
  private readonly statusState = signal<ExecutionStatus>('idle');
  private readonly summaryState = signal<ExecutionSummary>({ status: 'idle' });
  private readonly viewportState = signal<ViewportPreset>('desktop');
  private readonly webEngineState = signal<WebSandboxEngine>('esm');
  private readonly autoRunState = signal<boolean>(true);
  private readonly activeRunTokenState = signal<string>('');

  private previewIframe: HTMLIFrameElement | null = null;
  private sandpackIframe: HTMLIFrameElement | null = null;
  private sandpackClient: SandpackClient | null = null;
  private sandpackUnsubscribe: (() => void) | null = null;
  private pyodideWorker: Worker | null = null;
  private autoRunTimer: ReturnType<typeof setTimeout> | null = null;
  private logSeq = 0;
  private pythonRunSeq = 0;
  private activePythonRunId = 0;
  private webRunSeq = 0;
  private messageListenerBound = false;

  readonly logsSignal = this.logsState.asReadonly();
  readonly filterSignal = this.filterState.asReadonly();
  readonly statusSignal = this.statusState.asReadonly();
  readonly summarySignal = this.summaryState.asReadonly();
  readonly viewportSignal = this.viewportState.asReadonly();
  readonly webEngineSignal = this.webEngineState.asReadonly();
  readonly autoRunSignal = this.autoRunState.asReadonly();

  readonly filteredLogsSignal = computed(() => {
    const filter = this.filterState();
    const all = this.logsState();
    if (filter === 'all') return all;
    return all.filter((entry) => entry.level === filter);
  });

  readonly logCountsSignal = computed(() => {
    const counts: Record<ConsoleFilter, number> = {
      all: 0,
      info: 0,
      warn: 0,
      error: 0,
      'python-stdout': 0,
      system: 0,
    };
    for (const item of this.logsState()) {
      counts.all += 1;
      counts[item.level] += 1;
    }
    return counts;
  });

  readonly isRunningSignal = computed(() => {
    const s = this.statusState();
    return s === 'initializing' || s === 'installing' || s === 'transpiling' || s === 'running';
  });

  constructor() {
    this.bindWindowMessageListener();
  }

  attachPreviewIframe(iframe: HTMLIFrameElement | null): void {
    if (this.previewIframe !== iframe) {
      this.previewIframe = iframe;
    }
  }

  attachSandpackIframe(iframe: HTMLIFrameElement | null): void {
    if (this.sandpackIframe !== iframe) {
      this.disposeSandpack();
      this.sandpackIframe = iframe;
    }
  }

  setFilter(filter: ConsoleFilter): void {
    this.filterState.set(filter);
  }

  setViewport(preset: ViewportPreset): void {
    this.viewportState.set(preset);
  }

  setWebEngine(engine: WebSandboxEngine): void {
    if (this.webEngineState() !== engine) {
      this.disposeSandpack();
      this.webEngineState.set(engine);
      void this.runActiveWorkspace();
    }
  }

  toggleAutoRun(): void {
    this.autoRunState.update((v) => !v);
  }

  clearLogs(): void {
    this.logsState.set([]);
  }

  scheduleAutoRun(): void {
    if (!this.autoRunState() || this.vfs.envSignal() === 'python') {
      return;
    }
    if (this.autoRunTimer) {
      clearTimeout(this.autoRunTimer);
    }
    this.autoRunTimer = setTimeout(() => {
      void this.runActiveWorkspace();
    }, 300);
  }

  async runActiveWorkspace(): Promise<void> {
    if (this.autoRunTimer) {
      clearTimeout(this.autoRunTimer);
      this.autoRunTimer = null;
    }

    const env = this.vfs.envSignal();
    const files = this.vfs.filesSignal();

    if (env === 'python') {
      this.disposeSandpack();
      await this.runPythonWorkspace(files);
      return;
    }

    if (this.webEngineState() === 'sandpack') {
      await this.runWithSandpack(env, files);
    } else {
      this.disposeSandpack();
      await this.runWithLocalBrowserEsm(env, files);
    }
  }

  stopExecution(): void {
    if (this.vfs.envSignal() === 'python') {
      if (this.pyodideWorker) {
        this.pyodideWorker.terminate();
        this.pyodideWorker = null;
      }
      this.activePythonRunId = 0;
      this.statusState.set('idle');
      this.summaryState.set({
        status: 'idle',
        detail: 'Worker terminated by user',
      });
      this.appendLog('warn', 'Python execution stopped (Web Worker terminated).', 'python');
      return;
    }

    if (this.previewIframe) {
      this.disposeSandpack();
      this.previewIframe.srcdoc =
        '<!doctype html><html><body style="background:#0b0d12;color:#94a3b8;font-family:sans-serif;padding:24px;">Execution stopped.</body></html>';
    }
    this.statusState.set('idle');
    this.summaryState.set({ status: 'idle', detail: 'Stopped' });
  }

  private async runWithLocalBrowserEsm(
    env: RuntimeEnvironment,
    files: Record<string, VirtualFile>,
  ): Promise<void> {
    const iframe = this.previewIframe;
    if (!iframe) return;

    const currentRun = ++this.webRunSeq;
    const runToken = `run-${currentRun}-${Date.now()}`;
    this.activeRunTokenState.set(runToken);

    const startedAt = performance.now();
    this.statusState.set('transpiling');
    this.summaryState.set({ status: 'transpiling', detail: 'Transpiling modules in memory...' });
    this.clearLogs();

    try {
      const entryFile = this.resolveEntryFile(env, files);
      if (!entryFile) {
        throw new Error(`No entry file found for ${env} workspace.`);
      }

      const importMap: Record<string, string> = {};
      if (env === 'react') {
        Object.assign(importMap, DEFAULT_IMPORTS_REACT);
      } else if (env === 'angular') {
        Object.assign(importMap, DEFAULT_IMPORTS_ANGULAR);
      }

      // Merge any custom package.json dependencies via esm.sh
      const pkgFile = files['/package.json'];
      if (pkgFile) {
        try {
          const parsed = JSON.parse(pkgFile.content) as {
            dependencies?: Record<string, string>;
          };
          for (const [pkg, rawVer] of Object.entries(parsed.dependencies ?? {})) {
            if (importMap[pkg]) continue;
            const ver = rawVer.replace(/^[\^~]/, '');
            importMap[pkg] = `https://esm.sh/${pkg}@${ver}`;
            importMap[`${pkg}/`] = `https://esm.sh/${pkg}@${ver}/`;
          }
        } catch {
          this.appendLog('warn', 'Could not parse /package.json; using default import map.', 'bundler');
        }
      }

      // Transpile all workspace code/css/json modules into self-contained ESM data URLs
      for (const file of Object.values(files)) {
        const lower = file.path.toLowerCase();
        const key = `@vfs${file.path}`;

        if (
          lower.endsWith('.ts') ||
          lower.endsWith('.tsx') ||
          lower.endsWith('.js') ||
          lower.endsWith('.jsx') ||
          lower.endsWith('.mjs')
        ) {
          const emitted = await this.monacoBridge.emitJavaScript(files, file.path);
          if (currentRun !== this.webRunSeq) return;
          const rewritten = rewriteModuleSpecifiers(emitted, file.path, files);
          importMap[key] = toJsDataUrl(rewritten);
        } else if (lower.endsWith('.css')) {
          const styleInjector = `
const __style = document.createElement('style');
__style.setAttribute('data-vfs-path', ${JSON.stringify(file.path)});
__style.textContent = ${JSON.stringify(file.content)};
document.head.appendChild(__style);
export default ${JSON.stringify(file.content)};
`;
          importMap[key] = toJsDataUrl(styleInjector);
        } else if (lower.endsWith('.json')) {
          importMap[key] = toJsDataUrl(`export default ${file.content};`);
        }
      }

      if (currentRun !== this.webRunSeq) return;

      // Collect non-imported standalone CSS files when index.html exists without explicit CSS import
      const htmlTemplate =
        files['/index.html']?.content ??
        '<!doctype html><html><head></head><body><div id="app"></div><div id="root"></div><app-root></app-root></body></html>';

      const importMapTag = `<script type="importmap">${JSON.stringify({ imports: importMap })}</script>`;
      const bootstrapTag = buildConsoleBootstrapScript(runToken);
      const entryImportTag = `<script type="module">import ${JSON.stringify(`@vfs${entryFile.path}`)};</script>`;

      let finalHtml = htmlTemplate;
      if (/<head[^>]*>/i.test(finalHtml)) {
        finalHtml = finalHtml.replace(
          /<head([^>]*)>/i,
          `<head$1>\n${bootstrapTag}\n${importMapTag}`,
        );
      } else {
        finalHtml = `${bootstrapTag}\n${importMapTag}\n${finalHtml}`;
      }

      if (/<\/body>/i.test(finalHtml)) {
        finalHtml = finalHtml.replace(/<\/body>/i, `${entryImportTag}\n</body>`);
      } else {
        finalHtml = `${finalHtml}\n${entryImportTag}`;
      }

      iframe.srcdoc = finalHtml;

      const durationMs = Math.round(performance.now() - startedAt);
      this.statusState.set('ready');
      this.summaryState.set({
        status: 'ready',
        durationMs,
        detail: `ESM ready in ${durationMs}ms`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.statusState.set('error');
      this.summaryState.set({ status: 'error', detail: message });
      this.appendLog('error', message, 'bundler');
    }
  }

  private async runWithSandpack(
    env: RuntimeEnvironment,
    files: Record<string, VirtualFile>,
  ): Promise<void> {
    const iframe = this.sandpackIframe ?? this.previewIframe;
    if (!iframe) return;

    this.statusState.set('installing');
    this.summaryState.set({
      status: 'installing',
      detail: 'Connecting to Sandpack bundler...',
    });
    this.clearLogs();

    try {
      const sandpackFiles: Record<string, { code: string; active?: boolean }> = {};
      for (const file of Object.values(files)) {
        sandpackFiles[file.path] = {
          code: file.content,
          active: file.path === this.vfs.activeFileSignal(),
        };
      }

      const template =
        env === 'angular'
          ? 'angular-cli'
          : env === 'react'
            ? 'create-react-app-typescript'
            : 'parcel';

      const entryFile = this.resolveEntryFile(env, files);

      if (this.sandpackClient) {
        this.sandpackClient.updateSandbox({
          files: sandpackFiles,
          entry: entryFile?.path,
          template,
        });
        return;
      }

      const { loadSandpackClient } = await import('@codesandbox/sandpack-client');
      const client = await loadSandpackClient(
        iframe,
        {
          files: sandpackFiles,
          entry: entryFile?.path,
          template,
        },
        {
          showErrorScreen: true,
          showLoadingScreen: true,
          clearConsoleOnFirstCompile: true,
        },
      );

      this.sandpackClient = client;
      this.sandpackUnsubscribe = client.listen((msg: SandpackMessage) => {
        this.handleSandpackMessage(msg);
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.statusState.set('error');
      this.summaryState.set({ status: 'error', detail: message });
      this.appendLog('error', `Sandpack error: ${message}`, 'sandpack');
    }
  }

  private handleSandpackMessage(msg: SandpackMessage): void {
    const m = msg as unknown as Record<string, unknown>;
    if (m['type'] === 'status') {
      const s = String(m['status'] ?? '');
      if (s === 'installing-dependencies') {
        this.statusState.set('installing');
        this.summaryState.set({ status: 'installing', detail: 'Sandpack installing npm deps...' });
      } else if (s === 'transpiling' || s === 'evaluating') {
        this.statusState.set('transpiling');
        this.summaryState.set({ status: 'transpiling', detail: `Sandpack ${s}...` });
      } else if (s === 'idle' || s === 'done') {
        this.statusState.set('ready');
        this.summaryState.set({ status: 'ready', detail: 'Sandpack ready' });
      }
      return;
    }

    if (m['type'] === 'done') {
      this.statusState.set('ready');
      this.summaryState.set({ status: 'ready', detail: 'Sandpack ready' });
      return;
    }

    if (m['type'] === 'action' && m['action'] === 'show-error') {
      this.statusState.set('error');
      const text = String(m['message'] ?? m['title'] ?? 'Sandpack bundle error');
      this.summaryState.set({ status: 'error', detail: text });
      this.appendLog('error', text, 'sandpack');
      return;
    }

    if (m['type'] === 'console' && Array.isArray(m['log'])) {
      for (const item of m['log'] as Array<{ method?: string; data?: unknown[] }>) {
        const method = item.method ?? 'log';
        if (method === 'clear') {
          this.clearLogs();
          continue;
        }
        const level: ConsoleLevel =
          method === 'warn' ? 'warn' : method === 'error' ? 'error' : 'info';
        const formatted = (item.data ?? [])
          .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
          .join(' ');
        this.appendLog(level, formatted, 'sandpack');
      }
    }
  }

  private disposeSandpack(): void {
    if (this.sandpackUnsubscribe) {
      this.sandpackUnsubscribe();
      this.sandpackUnsubscribe = null;
    }
    if (this.sandpackClient) {
      this.sandpackClient.destroy();
      this.sandpackClient = null;
    }
    if (this.sandpackIframe) {
      this.sandpackIframe.removeAttribute('src');
    }
  }

  private async runPythonWorkspace(files: Record<string, VirtualFile>): Promise<void> {
    this.clearLogs();
    const runId = ++this.pythonRunSeq;
    this.activePythonRunId = runId;

    const entryFile = this.resolveEntryFile('python', files);
    if (!entryFile) {
      this.statusState.set('error');
      this.appendLog('error', 'No Python entry file (.py) found in workspace.', 'python');
      return;
    }

    const worker = this.ensurePyodideWorker();
    const flatFiles: Record<string, string> = {};
    for (const [path, file] of Object.entries(files)) {
      flatFiles[path] = file.content;
    }

    const requirementsTxt = files['/requirements.txt']?.content ?? '';

    this.statusState.set('running');
    this.summaryState.set({
      status: 'running',
      detail: `Running ${entryFile.path} in Pyodide Worker...`,
      pythonOutputPreview: '',
    });

    worker.postMessage({
      type: 'RUN_PYTHON',
      runId,
      entryPath: entryFile.path,
      files: flatFiles,
      requirementsTxt,
    });
  }

  private ensurePyodideWorker(): Worker {
    if (this.pyodideWorker) {
      return this.pyodideWorker;
    }

    const worker = new Worker(new URL('../workers/pyodide.worker', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (event: MessageEvent<Record<string, unknown>>) => {
      const msg = event.data;
      if (!msg) return;

      switch (msg['type']) {
        case 'STATUS': {
          const status = msg['status'] as ExecutionStatus;
          const detail = typeof msg['detail'] === 'string' ? msg['detail'] : undefined;
          this.statusState.set(status);
          this.summaryState.update((prev) => ({ ...prev, status, detail }));
          if (detail) {
            this.appendLog('system', detail, 'pyodide');
          }
          break;
        }
        case 'PY_STDOUT': {
          const text = String(msg['msg'] ?? '');
          this.appendLog('python-stdout', text, 'stdout');
          this.summaryState.update((prev) => ({
            ...prev,
            pythonOutputPreview: prev.pythonOutputPreview
              ? `${prev.pythonOutputPreview}\n${text}`
              : text,
          }));
          break;
        }
        case 'PY_STDERR': {
          const text = String(msg['msg'] ?? '');
          this.appendLog('error', text, 'stderr');
          break;
        }
        case 'RUN_COMPLETE': {
          if (Number(msg['runId']) !== this.activePythonRunId) return;
          const durationMs = Number(msg['durationMs'] ?? 0);
          const packages = Array.isArray(msg['packages'])
            ? (msg['packages'] as string[])
            : [];
          this.statusState.set('ready');
          this.summaryState.update((prev) => ({
            ...prev,
            status: 'ready',
            durationMs,
            pythonPackages: packages,
            detail: `Completed in ${durationMs}ms`,
          }));
          break;
        }
        case 'RUN_ERROR': {
          if (Number(msg['runId']) !== this.activePythonRunId) return;
          const errText = String(msg['error'] ?? 'Python execution failed');
          this.statusState.set('error');
          this.summaryState.update((prev) => ({
            ...prev,
            status: 'error',
            detail: errText,
          }));
          this.appendLog('error', errText, 'python');
          break;
        }
      }
    };

    worker.onerror = (err) => {
      this.statusState.set('error');
      this.appendLog('error', err.message || 'Pyodide Web Worker crashed', 'pyodide');
    };

    this.pyodideWorker = worker;
    return worker;
  }

  private resolveEntryFile(
    env: RuntimeEnvironment,
    files: Record<string, VirtualFile>,
  ): VirtualFile | null {
    const explicit = Object.values(files).find((f) => f.isEntry);
    if (explicit) return explicit;

    const fallbacks: Record<RuntimeEnvironment, string[]> = {
      typescript: ['/index.ts', '/main.ts', '/src/index.ts'],
      angular: ['/main.ts', '/src/main.ts'],
      react: ['/main.tsx', '/index.tsx', '/App.tsx', '/src/main.tsx'],
      python: ['/main.py', '/app.py'],
    };

    for (const candidate of fallbacks[env]) {
      const normalized = normalizeVirtualPath(candidate);
      if (files[normalized]) {
        return files[normalized];
      }
    }

    const firstCodeFile = Object.values(files).find((f) =>
      /\.(tsx?|jsx?|py)$/i.test(f.path),
    );
    return firstCodeFile ?? Object.values(files)[0] ?? null;
  }

  private bindWindowMessageListener(): void {
    if (this.messageListenerBound || typeof window === 'undefined') {
      return;
    }
    this.messageListenerBound = true;

    window.addEventListener('message', (event: MessageEvent<Record<string, unknown>>) => {
      const data = event.data;
      if (!data || data['source'] !== 'codepad-sandbox') {
        return;
      }
      if (data['runToken'] !== this.activeRunTokenState()) {
        return;
      }
      if (data['type'] === 'CONSOLE_CLEAR') {
        this.clearLogs();
        return;
      }
      if (data['type'] === 'CONSOLE_LOG') {
        const level = (data['level'] as ConsoleLevel) ?? 'info';
        const args = Array.isArray(data['args']) ? data['args'].map(String) : [];
        this.appendLog(level, args.join(' '), 'preview');
      }
    });
  }

  private appendLog(level: ConsoleLevel, message: string, source: string): void {
    this.logSeq += 1;
    const now = new Date();
    const timestamp = now.toTimeString().slice(0, 8);
    this.logsState.update((list) => [
      ...list.slice(-299),
      {
        id: `log-${this.logSeq}`,
        level,
        message,
        timestamp,
        source,
      },
    ]);
  }
}

