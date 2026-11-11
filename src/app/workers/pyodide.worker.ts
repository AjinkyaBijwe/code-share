/// <reference lib="webworker" />

interface PyodideInstance {
  FS: {
    mkdirTree(path: string): void;
    writeFile(path: string, data: string): void;
    analyzePath(path: string): { exists: boolean };
    readdir(path: string): string[];
    isDir(mode: number): boolean;
    stat(path: string): { mode: number };
    unlink(path: string): void;
    rmdir(path: string): void;
  };
  globals: {
    set(key: string, value: unknown): void;
  };
  setStdout(options: { batched: (msg: string) => void }): void;
  setStderr(options: { batched: (msg: string) => void }): void;
  loadPackage(packages: string | string[]): Promise<void>;
  pyimport(name: string): {
    install(pkgs: string[]): Promise<void>;
  };
  runPythonAsync(code: string): Promise<unknown>;
}

interface RunPythonRequest {
  type: 'RUN_PYTHON';
  runId: number;
  entryPath: string;
  files: Record<string, string>;
  requirementsTxt: string;
}

const PYODIDE_BASE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.27.5/full/';
const WORKSPACE_ROOT = '/workspace';

let pyodidePromise: Promise<PyodideInstance> | null = null;
let installedSignature = '';

function postStatus(status: 'initializing' | 'installing' | 'running' | 'ready' | 'error', detail?: string): void {
  self.postMessage({ type: 'STATUS', status, detail });
}

async function getPyodide(): Promise<PyodideInstance> {
  if (!pyodidePromise) {
    postStatus('initializing', 'Downloading Pyodide CPython WASM runtime...');
    const dynamicImport = new Function('url', 'return import(url);') as (
      url: string,
    ) => Promise<{ loadPyodide: (opts: { indexURL: string }) => Promise<PyodideInstance> }>;

    pyodidePromise = dynamicImport(`${PYODIDE_BASE_URL}pyodide.mjs`).then((mod) =>
      mod.loadPyodide({ indexURL: PYODIDE_BASE_URL }),
    );
  }
  return pyodidePromise;
}

function removeDirectoryRecursive(fs: PyodideInstance['FS'], dirPath: string): void {
  if (!fs.analyzePath(dirPath).exists) {
    return;
  }
  for (const entry of fs.readdir(dirPath)) {
    if (entry === '.' || entry === '..') continue;
    const fullPath = `${dirPath}/${entry}`;
    const stat = fs.stat(fullPath);
    if (fs.isDir(stat.mode)) {
      removeDirectoryRecursive(fs, fullPath);
      fs.rmdir(fullPath);
    } else {
      fs.unlink(fullPath);
    }
  }
}

function parseRequirements(requirementsTxt: string): string[] {
  return requirementsTxt
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter((line) => line.length > 0);
}

self.onmessage = async (event: MessageEvent<RunPythonRequest>) => {
  const msg = event.data;
  if (!msg || msg.type !== 'RUN_PYTHON') {
    return;
  }

  const startedAt = performance.now();

  try {
    const pyodide = await getPyodide();

    pyodide.setStdout({
      batched: (text: string) => {
        self.postMessage({ type: 'PY_STDOUT', msg: text });
      },
    });

    pyodide.setStderr({
      batched: (text: string) => {
        self.postMessage({ type: 'PY_STDERR', msg: text });
      },
    });

    // Clean & remount VFS workspace cleanly
    removeDirectoryRecursive(pyodide.FS, WORKSPACE_ROOT);
    pyodide.FS.mkdirTree(WORKSPACE_ROOT);

    for (const [rawPath, content] of Object.entries(msg.files)) {
      const cleanRel = rawPath.replace(/^\/+/, '');
      if (!cleanRel) continue;
      const targetPath = `${WORKSPACE_ROOT}/${cleanRel}`;
      const lastSlash = targetPath.lastIndexOf('/');
      if (lastSlash > 0) {
        pyodide.FS.mkdirTree(targetPath.slice(0, lastSlash));
      }
      pyodide.FS.writeFile(targetPath, content);
    }

    // Install micropip packages from requirements.txt when changed
    const packages = parseRequirements(msg.requirementsTxt);
    const signature = packages.join('|');
    if (packages.length > 0 && signature !== installedSignature) {
      postStatus('installing', `Installing packages: ${packages.join(', ')}`);
      await pyodide.loadPackage('micropip');
      const micropip = pyodide.pyimport('micropip');
      await micropip.install(packages);
      installedSignature = signature;
    }

    postStatus('running', `Executing ${msg.entryPath}`);

    const cleanEntry = msg.entryPath.replace(/^\/+/, '');
    const entryFullPath = `${WORKSPACE_ROOT}/${cleanEntry}`;
    const entryContent = msg.files[msg.entryPath] ?? msg.files[`/${cleanEntry}`] ?? '';

    pyodide.globals.set('__codepad_entry_code__', entryContent);
    pyodide.globals.set('__codepad_entry_file__', entryFullPath);

    await pyodide.runPythonAsync(`
import importlib, os, sys
os.chdir('${WORKSPACE_ROOT}')
if '${WORKSPACE_ROOT}' not in sys.path:
    sys.path.insert(0, '${WORKSPACE_ROOT}')
for _name, _mod in list(sys.modules.items()):
    _mod_file = getattr(_mod, '__file__', None)
    if isinstance(_mod_file, str) and _mod_file.startswith('${WORKSPACE_ROOT}'):
        sys.modules.pop(_name, None)
importlib.invalidate_caches()
_ns = {'__name__': '__main__', '__file__': __codepad_entry_file__}
exec(compile(__codepad_entry_code__, __codepad_entry_file__, 'exec'), _ns)
`);

    const durationMs = Math.round(performance.now() - startedAt);
    self.postMessage({
      type: 'RUN_COMPLETE',
      runId: msg.runId,
      durationMs,
      packages,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    self.postMessage({
      type: 'RUN_ERROR',
      runId: msg.runId,
      error: errorMessage,
    });
  }
};

