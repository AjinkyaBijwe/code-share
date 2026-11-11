import { Injectable } from '@angular/core';
import type * as Monaco from 'monaco-editor';
import type { Plugin } from 'prettier';
import { VirtualFile } from '../models/workspace.models';
import { detectLanguageFromPath } from '../utils/path.utils';

const AMBIENT_EXTRA_LIBS: ReadonlyArray<{ filePath: string; content: string }> = [
  {
    filePath: 'file:///node_modules/@types/react/index.d.ts',
    content: `
declare namespace React {
  type ReactNode = any;
  type FC<P = {}> = (props: P) => ReactNode;
  interface CSSProperties { [key: string]: string | number | undefined; }
}
declare module 'react' {
  export const StrictMode: any;
  export function useState<T>(initial: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void];
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
  export function useCallback<T extends (...args: any[]) => any>(cb: T, deps: readonly unknown[]): T;
  export function useRef<T>(initial: T): { current: T };
  export default React;
}
declare module 'react/jsx-runtime' {
  export function jsx(type: any, props: any, key?: any): any;
  export function jsxs(type: any, props: any, key?: any): any;
  export const Fragment: any;
}
declare module 'react-dom/client' {
  export interface Root {
    render(children: any): void;
    unmount(): void;
  }
  export function createRoot(container: Element | DocumentFragment): Root;
}
declare namespace JSX {
  interface IntrinsicElements {
    [elemName: string]: any;
  }
}
`,
  },
  {
    filePath: 'file:///node_modules/@angular/core/index.d.ts',
    content: `
declare module '@angular/core' {
  export interface WritableSignal<T> {
    (): T;
    set(value: T): void;
    update(updateFn: (value: T) => T): void;
    asReadonly(): Signal<T>;
  }
  export type Signal<T> = () => T;
  export function signal<T>(initialValue: T): WritableSignal<T>;
  export function computed<T>(computation: () => T): Signal<T>;
  export function effect(effectFn: () => void): { destroy(): void };
  export function inject<T>(token: any): T;
  export interface ComponentOptions {
    selector?: string;
    standalone?: boolean;
    imports?: any[];
    template?: string;
    templateUrl?: string;
    styles?: string[];
    styleUrls?: string[];
    changeDetection?: number;
  }
  export function Component(options: ComponentOptions): ClassDecorator;
  export function Injectable(options?: { providedIn?: string }): ClassDecorator;
  export const ChangeDetectionStrategy: { OnPush: number; Default: number };
}
declare module '@angular/common' {
  export const CommonModule: any;
}
declare module '@angular/platform-browser' {
  export function bootstrapApplication(rootComponent: any, options?: any): Promise<any>;
}
declare module '@angular/compiler' {}
declare module 'zone.js' {}
`,
  },
];

@Injectable({ providedIn: 'root' })
export class MonacoBridgeService {
  private monacoPromise: Promise<typeof Monaco> | null = null;
  private monacoRef: typeof Monaco | null = null;
  private readonly viewStates = new Map<string, Monaco.editor.ICodeEditorViewState>();

  async ensureInitialized(): Promise<typeof Monaco> {
    if (this.monacoRef) {
      return this.monacoRef;
    }

    if (!this.monacoPromise) {
      this.monacoPromise = this.loadAndConfigureMonaco();
    }

    return this.monacoPromise;
  }

  private async loadAndConfigureMonaco(): Promise<typeof Monaco> {
    (globalThis as Record<string, unknown>)['MonacoEnvironment'] = {
      getWorker(_workerId: string, label: string): Worker {
        switch (label) {
          case 'json':
            return new Worker(new URL('../workers/json.worker', import.meta.url), {
              type: 'module',
            });
          case 'css':
          case 'scss':
          case 'less':
            return new Worker(new URL('../workers/css.worker', import.meta.url), {
              type: 'module',
            });
          case 'html':
          case 'handlebars':
          case 'razor':
            return new Worker(new URL('../workers/html.worker', import.meta.url), {
              type: 'module',
            });
          case 'typescript':
          case 'javascript':
            return new Worker(new URL('../workers/ts.worker', import.meta.url), {
              type: 'module',
            });
          default:
            return new Worker(new URL('../workers/editor.worker', import.meta.url), {
              type: 'module',
            });
        }
      },
    };

    const monaco = await import('monaco-editor');

    monaco.editor.defineTheme('codepad-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '64748b', fontStyle: 'italic' },
        { token: 'keyword', foreground: '60a5fa' },
        { token: 'string', foreground: '34d399' },
        { token: 'number', foreground: 'fbbf24' },
        { token: 'type.identifier', foreground: '38bdf8' },
      ],
      colors: {
        'editor.background': '#0e121b',
        'editor.foreground': '#e2e8f0',
        'editor.lineHighlightBackground': '#161c2a',
        'editor.selectionBackground': '#2563eb44',
        'editorLineNumber.foreground': '#475569',
        'editorLineNumber.activeForeground': '#94a3b8',
        'editorCursor.foreground': '#60a5fa',
        'editorIndentGuide.background1': '#1e293b',
        'editorIndentGuide.activeBackground1': '#334155',
      },
    });

    const compilerOptions = this.createCompilerOptions(monaco, monaco.typescript.ScriptTarget.Latest);

    monaco.typescript.typescriptDefaults.setCompilerOptions(compilerOptions);
    monaco.typescript.javascriptDefaults.setCompilerOptions(compilerOptions);

    monaco.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
      diagnosticCodesToIgnore: [2792],
    });

    monaco.typescript.typescriptDefaults.setEagerModelSync(true);
    monaco.typescript.javascriptDefaults.setEagerModelSync(true);

    monaco.typescript.typescriptDefaults.setExtraLibs(
      AMBIENT_EXTRA_LIBS.map((lib) => ({
        filePath: lib.filePath,
        content: lib.content,
      })),
    );

    await this.ensureTypeScriptLanguageRegistered(monaco);

    this.monacoRef = monaco;
    return monaco;
  }

  private async ensureTypeScriptLanguageRegistered(monaco: typeof Monaco): Promise<void> {
    const probeUri = monaco.Uri.file('/__codepad_ts_probe__.ts');
    const existing = monaco.editor.getModel(probeUri);
    const probe = existing ?? monaco.editor.createModel('', 'typescript', probeUri);
    try {
      for (let i = 0; i < 60; i += 1) {
        try {
          await monaco.typescript.getTypeScriptWorker();
          return;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      }
    } finally {
      if (!existing) {
        probe.dispose();
      }
    }
  }

  /**
   * Synchronizes all VFS files into Monaco ITextModel instances using Uri.file(path).
   * Preserves existing models & undo/redo stacks unless content differs externally.
   */
  syncModels(monaco: typeof Monaco, files: Record<string, VirtualFile>): void {
    const activeUris = new Set<string>();

    for (const file of Object.values(files)) {
      const uri = monaco.Uri.file(file.path);
      activeUris.add(uri.toString());
      const language = file.language || detectLanguageFromPath(file.path);
      const existing = monaco.editor.getModel(uri);

      if (existing) {
        if (existing.getValue() !== file.content) {
          existing.setValue(file.content);
        }
        if (existing.getLanguageId() !== language) {
          monaco.editor.setModelLanguage(existing, language);
        }
      } else {
        monaco.editor.createModel(file.content, language, uri);
      }
    }

    for (const model of monaco.editor.getModels()) {
      const uriStr = model.uri.toString();
      if (!uriStr.includes('node_modules') && !activeUris.has(uriStr)) {
        this.viewStates.delete(uriStr);
        model.dispose();
      }
    }
  }

  saveViewState(editor: Monaco.editor.IStandaloneCodeEditor, path: string | null): void {
    if (!path || !this.monacoRef) return;
    const uri = this.monacoRef.Uri.file(path).toString();
    const state = editor.saveViewState();
    if (state) {
      this.viewStates.set(uri, state);
    }
  }

  restoreViewState(editor: Monaco.editor.IStandaloneCodeEditor, path: string): void {
    if (!this.monacoRef) return;
    const uri = this.monacoRef.Uri.file(path).toString();
    const state = this.viewStates.get(uri);
    if (state) {
      editor.restoreViewState(state);
    }
  }

  getModelForPath(monaco: typeof Monaco, path: string): Monaco.editor.ITextModel | null {
    return monaco.editor.getModel(monaco.Uri.file(path));
  }

  private createCompilerOptions(
    monaco: typeof Monaco,
    target: Monaco.typescript.ScriptTarget,
  ): Monaco.typescript.CompilerOptions {
    return {
      target,
      module: monaco.typescript.ModuleKind.ESNext,
      moduleResolution: monaco.typescript.ModuleResolutionKind.NodeJs,
      jsx: monaco.typescript.JsxEmit.ReactJSX,
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
      useDefineForClassFields: false,
      strict: true,
      allowNonTsExtensions: true,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      resolveJsonModule: true,
      isolatedModules: true,
      noEmit: false,
      allowJs: true,
    };
  }

  /**
   * Transpiles a TypeScript / TSX / JSX file using Monaco's background TypeScript worker.
   * Ensures all workspace files are synced so cross-file module imports resolve cleanly.
   */
  async emitJavaScript(
    files: Record<string, VirtualFile>,
    targetPath: string,
    target: 'latest' | 'es2019' = 'latest',
  ): Promise<string> {
    const monaco = await this.ensureInitialized();
    this.syncModels(monaco, files);

    if (target === 'es2019') {
      monaco.typescript.typescriptDefaults.setCompilerOptions(
        this.createCompilerOptions(monaco, monaco.typescript.ScriptTarget.ES2019),
      );
    }

    try {
      const uri = monaco.Uri.file(targetPath);
      const workerFactory = await monaco.typescript.getTypeScriptWorker();
      const client = await workerFactory(uri);
      const emitOutput = await client.getEmitOutput(uri.toString());

      const jsOutput = emitOutput.outputFiles.find(
        (f) => f.name.endsWith('.js') || f.name.endsWith('.jsx') || f.name.endsWith('.mjs'),
      );
      if (!jsOutput) {
        throw new Error(`TypeScript worker emitted no JavaScript for ${targetPath}`);
      }
      return jsOutput.text;
    } finally {
      if (target === 'es2019') {
        monaco.typescript.typescriptDefaults.setCompilerOptions(
          this.createCompilerOptions(monaco, monaco.typescript.ScriptTarget.Latest),
        );
      }
    }
  }

  /**
   * Formats source code client-side with Prettier standalone.
   */
  async formatWithPrettier(path: string, content: string): Promise<{
    formatted: string;
    supported: boolean;
  }> {
    const lower = path.toLowerCase();
    let parser: string | null = null;
    const plugins: Plugin[] = [];

    const prettier = await import('prettier/standalone');

    if (lower.endsWith('.ts') || lower.endsWith('.tsx')) {
      parser = 'typescript';
      const [tsPlugin, estreePlugin] = await Promise.all([
        import('prettier/plugins/typescript'),
        import('prettier/plugins/estree'),
      ]);
      plugins.push(tsPlugin as unknown as Plugin, estreePlugin as unknown as Plugin);
    } else if (lower.endsWith('.js') || lower.endsWith('.jsx') || lower.endsWith('.mjs')) {
      parser = 'babel';
      const [babelPlugin, estreePlugin] = await Promise.all([
        import('prettier/plugins/babel'),
        import('prettier/plugins/estree'),
      ]);
      plugins.push(babelPlugin as unknown as Plugin, estreePlugin as unknown as Plugin);
    } else if (lower.endsWith('.json')) {
      parser = 'json';
      const [babelPlugin, estreePlugin] = await Promise.all([
        import('prettier/plugins/babel'),
        import('prettier/plugins/estree'),
      ]);
      plugins.push(babelPlugin as unknown as Plugin, estreePlugin as unknown as Plugin);
    } else if (lower.endsWith('.html') || lower.endsWith('.htm')) {
      parser = 'html';
      const htmlPlugin = await import('prettier/plugins/html');
      plugins.push(htmlPlugin as unknown as Plugin);
    } else if (lower.endsWith('.css') || lower.endsWith('.scss')) {
      parser = lower.endsWith('.scss') ? 'scss' : 'css';
      const cssPlugin = await import('prettier/plugins/postcss');
      plugins.push(cssPlugin as unknown as Plugin);
    }

    if (!parser) {
      return { formatted: content, supported: false };
    }

    const formatted = await prettier.format(content, {
      parser,
      plugins,
      semi: true,
      singleQuote: true,
      tabWidth: 2,
      printWidth: 96,
    });

    return { formatted, supported: true };
  }
}
