import {
  EnvironmentMeta,
  RuntimeEnvironment,
  VirtualFile,
  WorkspacePayload,
} from '../models/workspace.models';
import { detectLanguageFromPath } from '../utils/path.utils';

export const ENVIRONMENT_META: Record<RuntimeEnvironment, EnvironmentMeta> = {
  typescript: {
    id: 'typescript',
    label: 'TypeScript',
    shortLabel: 'TS',
    runtimeLabel: 'Browser ESM + TS Compiler',
    description: 'Zero-config multi-file TypeScript with strict typing & DOM preview',
    accentColor: '#3178c6',
    badgeClasses: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
    defaultEntry: '/index.ts',
    isWeb: true,
  },
  angular: {
    id: 'angular',
    label: 'Angular',
    shortLabel: 'NG',
    runtimeLabel: 'Angular Standalone + Signals JIT',
    description: 'Standalone Angular component with Signals compiled in-browser',
    accentColor: '#f43f5e',
    badgeClasses: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    defaultEntry: '/main.ts',
    isWeb: true,
  },
  react: {
    id: 'react',
    label: 'React + TS',
    shortLabel: 'JSX',
    runtimeLabel: 'React 19 + TSX ESM / Sandpack',
    description: 'Modern React TSX multi-file starter with hooks & components',
    accentColor: '#06b6d4',
    badgeClasses: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
    defaultEntry: '/main.tsx',
    isWeb: true,
  },
  python: {
    id: 'python',
    label: 'Python 3',
    shortLabel: 'PY',
    runtimeLabel: 'Pyodide CPython WASM Worker',
    description: 'CPython 3 running in a non-blocking Web Worker with micropip',
    accentColor: '#eab308',
    badgeClasses: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    defaultEntry: '/main.py',
    isWeb: false,
  },
};

export const ENVIRONMENT_LIST: readonly EnvironmentMeta[] = [
  ENVIRONMENT_META.typescript,
  ENVIRONMENT_META.angular,
  ENVIRONMENT_META.react,
  ENVIRONMENT_META.python,
];

function makeFile(path: string, content: string, isEntry = false): VirtualFile {
  return {
    path,
    content,
    language: detectLanguageFromPath(path),
    ...(isEntry ? { isEntry: true } : {}),
  };
}

const TYPESCRIPT_TEMPLATE: WorkspacePayload = {
  v: 1,
  env: 'typescript',
  activeFile: '/index.ts',
  files: {
    '/index.ts': makeFile(
      '/index.ts',
      `import { createReactiveCounter, formatCompact } from './utils';

const app = document.getElementById('app');
if (!app) {
  throw new Error('Mount element #app not found');
}

const counter = createReactiveCounter(4);

function render(count: number): void {
  const squared = count * count;
  app!.innerHTML = \`
    <div class="card">
      <div class="badge">TypeScript 5 · Strict Mode</div>
      <h1>CodePad TypeScript Sandbox</h1>
      <p class="subtitle">Multi-file ESM execution with instant cross-file IntelliSense.</p>
      <div class="metrics">
        <div class="metric">
          <span class="label">Count</span>
          <strong class="value">\${formatCompact(count)}</strong>
        </div>
        <div class="metric">
          <span class="label">Squared</span>
          <strong class="value accent">\${formatCompact(squared)}</strong>
        </div>
      </div>
      <div class="actions">
        <button id="dec" type="button">-1</button>
        <button id="inc" class="primary" type="button">+1 Increment</button>
        <button id="reset" type="button">Reset</button>
      </div>
    </div>
  \`;

  document.getElementById('inc')?.addEventListener('click', () => {
    counter.increment();
    console.log('[TS] Incremented count ->', counter.value);
  });
  document.getElementById('dec')?.addEventListener('click', () => {
    counter.decrement();
    console.log('[TS] Decremented count ->', counter.value);
  });
  document.getElementById('reset')?.addEventListener('click', () => {
    counter.reset();
    console.warn('[TS] Counter reset to initial value');
  });
}

counter.subscribe(render);
console.info('TypeScript sandbox booted successfully!');
`,
      true,
    ),
    '/utils.ts': makeFile(
      '/utils.ts',
      `export interface ReactiveCounter {
  readonly value: number;
  increment(): void;
  decrement(): void;
  reset(): void;
  subscribe(listener: (value: number) => void): () => void;
}

export function createReactiveCounter(initialValue = 0): ReactiveCounter {
  let current = initialValue;
  const listeners = new Set<(value: number) => void>();

  const notify = (): void => {
    for (const listener of listeners) {
      listener(current);
    }
  };

  return {
    get value(): number {
      return current;
    },
    increment(): void {
      current += 1;
      notify();
    },
    decrement(): void {
      current -= 1;
      notify();
    },
    reset(): void {
      current = initialValue;
      notify();
    },
    subscribe(listener: (value: number) => void): () => void {
      listeners.add(listener);
      listener(current);
      return () => listeners.delete(listener);
    },
  };
}

export function formatCompact(num: number): string {
  return new Intl.NumberFormat('en-US').format(num);
}
`,
    ),
    '/tsconfig.json': makeFile(
      '/tsconfig.json',
      `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noImplicitAny": true,
    "esModuleInterop": true
  }
}
`,
    ),
    '/index.html': makeFile(
      '/index.html',
      `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>TypeScript Starter</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
        font-family: Inter, system-ui, -apple-system, sans-serif;
        background: radial-gradient(circle at top, #172033, #0b0f19 65%);
        color: #e2e8f0;
      }
      .card {
        width: min(440px, 100%);
        background: rgba(17, 24, 39, 0.85);
        border: 1px solid rgba(148, 163, 184, 0.18);
        border-radius: 16px;
        padding: 24px;
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.4);
      }
      .badge {
        display: inline-block;
        padding: 4px 10px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 600;
        color: #93c5fd;
        background: rgba(59, 130, 246, 0.16);
        border: 1px solid rgba(59, 130, 246, 0.35);
      }
      h1 { margin: 14px 0 6px; font-size: 20px; }
      .subtitle { margin: 0 0 18px; color: #94a3b8; font-size: 13.5px; line-height: 1.5; }
      .metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 18px; }
      .metric {
        background: rgba(15, 23, 42, 0.8);
        border: 1px solid rgba(148, 163, 184, 0.14);
        border-radius: 12px;
        padding: 12px 14px;
      }
      .label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; }
      .value { font-size: 26px; font-weight: 700; color: #f8fafc; }
      .value.accent { color: #38bdf8; }
      .actions { display: flex; gap: 8px; }
      button {
        flex: 1;
        padding: 10px 12px;
        border-radius: 10px;
        border: 1px solid rgba(148, 163, 184, 0.2);
        background: #1e293b;
        color: #e2e8f0;
        font-weight: 600;
        cursor: pointer;
      }
      button:hover { background: #334155; }
      button.primary { background: #2563eb; border-color: #3b82f6; color: #fff; }
      button.primary:hover { background: #1d4ed8; }
    </style>
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>
`,
    ),
  },
};

const ANGULAR_TEMPLATE: WorkspacePayload = {
  v: 1,
  env: 'angular',
  activeFile: '/app.component.ts',
  files: {
    '/main.ts': makeFile(
      '/main.ts',
      `import 'zone.js';
import '@angular/compiler';
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app.component';

bootstrapApplication(AppComponent)
  .then(() => console.info('[Angular] Standalone app bootstrapped with Signals'))
  .catch((err) => console.error('[Angular] Bootstrap error:', err));
`,
      true,
    ),
    '/app.component.ts': makeFile(
      '/app.component.ts',
      `import { Component, computed, signal } from '@angular/core';

interface TaskItem {
  id: number;
  title: string;
  done: boolean;
}

@Component({
  selector: 'app-root',
  standalone: true,
  template: \`
    <main class="shell">
      <div class="header">
        <span class="pill">Angular Standalone · Signals</span>
        <h1>Signal Task Tracker</h1>
        <p>{{ completedCount() }} of {{ tasks().length }} tasks completed ({{ progressPct() }}%)</p>
      </div>

      <div class="add-row">
        <input
          type="text"
          [value]="draft()"
          (input)="draft.set(asValue($event))"
          (keydown.enter)="addTask()"
          placeholder="Add a task and press Enter..."
        />
        <button type="button" (click)="addTask()">Add</button>
      </div>

      <ul class="list">
        @for (task of tasks(); track task.id) {
          <li [class.done]="task.done" (click)="toggle(task.id)">
            <span class="check">{{ task.done ? '✓' : '○' }}</span>
            <span class="title">{{ task.title }}</span>
          </li>
        }
      </ul>
    </main>
  \`,
  styles: [\`
    .shell {
      max-width: 440px;
      margin: 32px auto;
      padding: 24px;
      border-radius: 16px;
      background: #111827;
      border: 1px solid #263043;
      color: #f1f5f9;
      font-family: Inter, system-ui, sans-serif;
    }
    .pill {
      display: inline-block;
      font-size: 11px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 999px;
      background: rgba(244, 63, 94, 0.16);
      color: #fda4af;
      border: 1px solid rgba(244, 63, 94, 0.35);
    }
    h1 { margin: 12px 0 4px; font-size: 20px; }
    p { margin: 0 0 16px; font-size: 13px; color: #94a3b8; }
    .add-row { display: flex; gap: 8px; margin-bottom: 16px; }
    input {
      flex: 1;
      padding: 9px 12px;
      border-radius: 10px;
      border: 1px solid #334155;
      background: #0f172a;
      color: #f8fafc;
      font-size: 13px;
    }
    button {
      padding: 9px 16px;
      border-radius: 10px;
      border: none;
      background: #e11d48;
      color: #fff;
      font-weight: 600;
      cursor: pointer;
    }
    button:hover { background: #be123c; }
    .list { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
    li {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border-radius: 10px;
      background: #1e293b;
      cursor: pointer;
      user-select: none;
      font-size: 13.5px;
    }
    li.done { opacity: 0.6; text-decoration: line-through; }
    .check { color: #fb7185; font-weight: 700; width: 16px; }
  \`],
})
export class AppComponent {
  readonly draft = signal('');
  readonly tasks = signal<TaskItem[]>([
    { id: 1, title: 'Edit app.component.ts & watch live reload', done: true },
    { id: 2, title: 'Try toggling Signals state interactively', done: false },
    { id: 3, title: 'Share instant compressed URL without login', done: false },
  ]);

  readonly completedCount = computed(() => this.tasks().filter((t) => t.done).length);
  readonly progressPct = computed(() => {
    const total = this.tasks().length;
    return total === 0 ? 0 : Math.round((this.completedCount() / total) * 100);
  });

  asValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  addTask(): void {
    const title = this.draft().trim();
    if (!title) return;
    this.tasks.update((list) => [...list, { id: Date.now(), title, done: false }]);
    this.draft.set('');
    console.log('[Angular] Added task:', title);
  }

  toggle(id: number): void {
    this.tasks.update((list) =>
      list.map((item) => (item.id === id ? { ...item, done: !item.done } : item)),
    );
  }
}
`,
    ),
    '/index.html': makeFile(
      '/index.html',
      `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Angular Standalone Starter</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        padding: 16px;
        background: radial-gradient(circle at top, #1f1422, #0b0f19 65%);
      }
    </style>
  </head>
  <body>
    <app-root></app-root>
  </body>
</html>
`,
    ),
    '/package.json': makeFile(
      '/package.json',
      `{
  "name": "codepad-angular-starter",
  "private": true,
  "dependencies": {
    "@angular/common": "^19.2.0",
    "@angular/compiler": "^19.2.0",
    "@angular/core": "^19.2.0",
    "@angular/platform-browser": "^19.2.0",
    "rxjs": "^7.8.1",
    "zone.js": "^0.15.0"
  }
}
`,
    ),
  },
};

const REACT_TEMPLATE: WorkspacePayload = {
  v: 1,
  env: 'react',
  activeFile: '/App.tsx',
  files: {
    '/main.tsx': makeFile(
      '/main.tsx',
      `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found');
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`,
      true,
    ),
    '/App.tsx': makeFile(
      '/App.tsx',
      `import { useMemo, useState } from 'react';
import { MetricPill } from './components/MetricPill';

export default function App() {
  const [step, setStep] = useState<number>(1);
  const [count, setCount] = useState<number>(12);

  const parity = useMemo(() => (count % 2 === 0 ? 'Even' : 'Odd'), [count]);

  const handleIncrement = () => {
    const next = count + step;
    setCount(next);
    console.log(\`[React] count=\${next} (step=\${step})\`);
  };

  return (
    <div className="container">
      <div className="card">
        <span className="eyebrow">React 19 · Vite TypeScript Starter</span>
        <h1>Interactive Component Sandbox</h1>
        <p className="muted">
          Multi-file TSX imports with live state, hooks, and CSS hot updates.
        </p>

        <div className="grid">
          <MetricPill label="Current Count" value={String(count)} accent />
          <MetricPill label="Parity" value={parity} />
        </div>

        <label className="slider-row">
          <span>Step size: <strong>{step}</strong></span>
          <input
            type="range"
            min={1}
            max={10}
            value={step}
            onChange={(e) => setStep(Number(e.target.value))}
          />
        </label>

        <div className="btn-row">
          <button type="button" onClick={() => setCount((c) => c - step)}>
            -{step}
          </button>
          <button type="button" className="primary" onClick={handleIncrement}>
            +{step} Increment
          </button>
        </div>
      </div>
    </div>
  );
}
`,
    ),
    '/components/MetricPill.tsx': makeFile(
      '/components/MetricPill.tsx',
      `interface MetricPillProps {
  label: string;
  value: string;
  accent?: boolean;
}

export function MetricPill({ label, value, accent = false }: MetricPillProps) {
  return (
    <div className="metric-pill">
      <span className="metric-label">{label}</span>
      <strong className={accent ? 'metric-value accent' : 'metric-value'}>
        {value}
      </strong>
    </div>
  );
}
`,
    ),
    '/styles.css': makeFile(
      '/styles.css',
      `* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 20px;
  font-family: Inter, system-ui, -apple-system, sans-serif;
  background: radial-gradient(circle at top, #0f293a, #090d16 65%);
  color: #f1f5f9;
}

.container {
  width: min(440px, 100%);
}

.card {
  background: rgba(15, 23, 42, 0.88);
  border: 1px solid rgba(56, 189, 248, 0.2);
  border-radius: 16px;
  padding: 24px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
}

.eyebrow {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  color: #67e8f9;
  background: rgba(6, 182, 212, 0.14);
  border: 1px solid rgba(6, 182, 212, 0.35);
}

h1 {
  margin: 14px 0 6px;
  font-size: 20px;
}

.muted {
  margin: 0 0 18px;
  color: #94a3b8;
  font-size: 13px;
  line-height: 1.5;
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 16px;
}

.metric-pill {
  padding: 12px 14px;
  border-radius: 12px;
  background: #0b1220;
  border: 1px solid rgba(148, 163, 184, 0.14);
}

.metric-label {
  display: block;
  font-size: 11px;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.metric-value {
  font-size: 24px;
  color: #f8fafc;
}

.metric-value.accent {
  color: #22d3ee;
}

.slider-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
  font-size: 13px;
  color: #cbd5e1;
}

.btn-row {
  display: flex;
  gap: 8px;
}

button {
  flex: 1;
  padding: 10px 14px;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  background: #1e293b;
  color: #f8fafc;
  font-weight: 600;
  cursor: pointer;
}

button:hover {
  background: #334155;
}

button.primary {
  background: #0891b2;
  border-color: #06b6d4;
}

button.primary:hover {
  background: #0e7490;
}
`,
    ),
    '/index.html': makeFile(
      '/index.html',
      `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>React + Vite TS Starter</title>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`,
    ),
    '/package.json': makeFile(
      '/package.json',
      `{
  "name": "codepad-react-starter",
  "private": true,
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0"
  }
}
`,
    ),
  },
};

const PYTHON_TEMPLATE: WorkspacePayload = {
  v: 1,
  env: 'python',
  activeFile: '/main.py',
  files: {
    '/main.py': makeFile(
      '/main.py',
      `import sys
from utils import render_sparkline, summarize_series

latencies_ms = [42.0, 38.5, 45.2, 91.4, 40.1, 36.8, 52.0, 44.3, 39.2, 41.0]

print(f"Python {sys.version.split()[0]} (Pyodide WebAssembly Worker)")
print("Trend:", render_sparkline(latencies_ms))
print("-" * 42)

stats = summarize_series(latencies_ms)
for key, value in stats.items():
    print(f"{key:<10}: {value:.2f} ms")

if stats["max"] > 80:
    print("[warn] Spike detected above 80ms SLA threshold!", file=sys.stderr)
`,
      true,
    ),
    '/utils.py': makeFile(
      '/utils.py',
      `import statistics
from typing import Dict, List

SPARK_BLOCKS = "▁▂▃▄▅▆▇█"


def summarize_series(values: List[float]) -> Dict[str, float]:
    """Compute descriptive summary metrics for a numeric series."""
    if not values:
        raise ValueError("Input series must not be empty")

    return {
        "min": min(values),
        "mean": statistics.mean(values),
        "median": statistics.median(values),
        "stdev": statistics.pstdev(values),
        "max": max(values),
    }


def render_sparkline(values: List[float]) -> str:
    """Render an ASCII Unicode sparkline for quick terminal inspection."""
    if not values:
        return ""
    lo, hi = min(values), max(values)
    span = (hi - lo) or 1.0
    chars = [
        SPARK_BLOCKS[min(len(SPARK_BLOCKS) - 1, int(((v - lo) / span) * (len(SPARK_BLOCKS) - 1)))]
        for v in values
    ]
    return "".join(chars)
`,
    ),
    '/requirements.txt': makeFile(
      '/requirements.txt',
      `# Pure-Python packages listed here are installed via micropip inside the Pyodide Web Worker.
# Example:
# tabulate
# numpy
`,
    ),
  },
};

const TEMPLATE_MAP: Record<RuntimeEnvironment, WorkspacePayload> = {
  typescript: TYPESCRIPT_TEMPLATE,
  angular: ANGULAR_TEMPLATE,
  react: REACT_TEMPLATE,
  python: PYTHON_TEMPLATE,
};

/**
 * Returns a deep clone of the pre-configured template workspace for the requested environment.
 */
export function createTemplateWorkspace(env: RuntimeEnvironment): WorkspacePayload {
  const source = TEMPLATE_MAP[env];
  const clonedFiles: Record<string, VirtualFile> = {};
  for (const [path, file] of Object.entries(source.files)) {
    clonedFiles[path] = { ...file };
  }
  return {
    v: source.v,
    env: source.env,
    activeFile: source.activeFile,
    files: clonedFiles,
    folders: source.folders ? [...source.folders] : [],
  };
}

