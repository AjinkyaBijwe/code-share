import { Injectable, computed, signal } from '@angular/core';
import { zipSync, strToU8 } from 'fflate';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import { createTemplateWorkspace } from '../config/templates.config';
import {
  HydrationSource,
  RuntimeEnvironment,
  SnapshotCreateResult,
  SnapshotStorageAdapter,
  VirtualFile,
  WorkspacePayload,
} from '../models/workspace.models';
import {
  detectLanguageFromPath,
  getParentPath,
  normalizeVirtualPath,
} from '../utils/path.utils';

const IDB_WORKSPACE_KEY = 'codepad:workspace:v1';
const LARGE_HASH_CHAR_LIMIT = 8000;
const VALID_ENVIRONMENTS: ReadonlySet<RuntimeEnvironment> = new Set([
  'typescript',
  'angular',
  'react',
  'python',
]);

export interface ToastNotice {
  id: number;
  text: string;
  tone: 'info' | 'success' | 'warn' | 'error';
}

export class HttpSnapshotAdapter implements SnapshotStorageAdapter {
  constructor(private readonly endpointBase: () => string) {}

  async createSnapshot(compressedPayload: string): Promise<SnapshotCreateResult> {
    const endpoint = this.endpointBase().replace(/\/$/, '');
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payload: compressedPayload,
        ttlSeconds: 60 * 60 * 24 * 30,
      }),
    });

    if (!res.ok) {
      throw new Error(`Snapshot API returned HTTP ${res.status}`);
    }

    const data = (await res.json()) as Partial<SnapshotCreateResult>;
    if (!data.id) {
      throw new Error('Snapshot response missing id');
    }

    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return {
      id: data.id,
      url: data.url ?? `${origin}/s/${data.id}`,
      expiresAt: data.expiresAt,
    };
  }

  async resolveSnapshot(id: string): Promise<string | null> {
    const endpoint = this.endpointBase().replace(/\/$/, '');
    const res = await fetch(`${endpoint}/${encodeURIComponent(id)}`);
    if (!res.ok) {
      return null;
    }
    const data = (await res.json()) as { payload?: string };
    return typeof data.payload === 'string' ? data.payload : null;
  }
}

export function validateWorkspacePayload(raw: unknown): WorkspacePayload | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const candidate = raw as Partial<WorkspacePayload>;
  if (!candidate.env || !VALID_ENVIRONMENTS.has(candidate.env)) {
    return null;
  }
  if (!candidate.files || typeof candidate.files !== 'object') {
    return null;
  }

  const normalizedFiles: Record<string, VirtualFile> = {};
  for (const [rawKey, entry] of Object.entries(candidate.files)) {
    if (!entry || typeof entry !== 'object' || typeof entry.content !== 'string') {
      continue;
    }
    const path = normalizeVirtualPath(entry.path || rawKey);
    if (path === '/') continue;
    normalizedFiles[path] = {
      path,
      content: entry.content,
      language:
        typeof entry.language === 'string' && entry.language.length > 0
          ? entry.language
          : detectLanguageFromPath(path),
      ...(entry.isEntry ? { isEntry: true } : {}),
    };
  }

  const filePaths = Object.keys(normalizedFiles);
  if (filePaths.length === 0) {
    return null;
  }

  const candidateActive = candidate.activeFile
    ? normalizeVirtualPath(candidate.activeFile)
    : filePaths[0];
  const activeFile = normalizedFiles[candidateActive] ? candidateActive : filePaths[0];

  const folders = Array.isArray(candidate.folders)
    ? candidate.folders
        .filter((f): f is string => typeof f === 'string')
        .map((f) => normalizeVirtualPath(f))
        .filter((f) => f !== '/')
    : [];

  return {
    v: typeof candidate.v === 'number' ? candidate.v : 1,
    env: candidate.env,
    activeFile,
    files: normalizedFiles,
    folders: Array.from(new Set(folders)),
  };
}

export function serializeWorkspaceToken(payload: WorkspacePayload): string {
  return compressToEncodedURIComponent(JSON.stringify(payload));
}

export function deserializeWorkspaceToken(token: string): WorkspacePayload | null {
  if (!token || !token.trim()) {
    return null;
  }
  try {
    const json = decompressFromEncodedURIComponent(token.trim());
    if (!json) {
      return null;
    }
    return validateWorkspacePayload(JSON.parse(json));
  } catch {
    return null;
  }
}

@Injectable({ providedIn: 'root' })
export class VfsStateService {
  private readonly workspaceState = signal<WorkspacePayload>(
    createTemplateWorkspace('typescript'),
  );
  private readonly openTabsState = signal<string[]>(['/index.ts']);
  private readonly dirtyFilesState = signal<Set<string>>(new Set());
  private readonly dirtyState = signal<boolean>(false);
  private readonly hydrationSourceState = signal<HydrationSource>('template');
  private readonly toastState = signal<ToastNotice | null>(null);
  private readonly snapshotEndpointState = signal<string>('/api/snapshot');

  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private toastSeq = 0;

  private readonly snapshotAdapter: SnapshotStorageAdapter = new HttpSnapshotAdapter(() =>
    this.snapshotEndpointState(),
  );

  // Public readonly signals
  readonly workspaceSignal = this.workspaceState.asReadonly();
  readonly envSignal = computed(() => this.workspaceState().env);
  readonly filesSignal = computed(() => this.workspaceState().files);
  readonly foldersSignal = computed(() => this.workspaceState().folders ?? []);
  readonly activeFileSignal = computed(() => this.workspaceState().activeFile);
  readonly openTabsSignal = this.openTabsState.asReadonly();
  readonly dirtyFilesSignal = this.dirtyFilesState.asReadonly();
  readonly dirtyStateSignal = this.dirtyState.asReadonly();
  readonly hydrationSourceSignal = this.hydrationSourceState.asReadonly();
  readonly toastSignal = this.toastState.asReadonly();
  readonly snapshotEndpointSignal = this.snapshotEndpointState.asReadonly();

  readonly activeFileContent = computed<VirtualFile | null>(() => {
    const ws = this.workspaceState();
    return ws.files[ws.activeFile] ?? null;
  });

  readonly compressedHashSignal = computed<string>(() =>
    serializeWorkspaceToken(this.workspaceState()),
  );

  readonly shareUrlSignal = computed<string>(() => {
    const token = this.compressedHashSignal();
    if (typeof window === 'undefined') {
      return `#code=${token}`;
    }
    return `${window.location.origin}${window.location.pathname}#code=${token}`;
  });

  readonly queryShareUrlSignal = computed<string>(() => {
    const token = this.compressedHashSignal();
    if (typeof window === 'undefined') {
      return `?pad=${token}`;
    }
    return `${window.location.origin}${window.location.pathname}?pad=${token}`;
  });

  readonly isLargeWorkspaceSignal = computed<boolean>(
    () => this.compressedHashSignal().length > LARGE_HASH_CHAR_LIMIT,
  );

  readonly payloadStatsSignal = computed(() => {
    const json = JSON.stringify(this.workspaceState());
    const compressedChars = this.compressedHashSignal().length;
    return {
      rawBytes: new TextEncoder().encode(json).length,
      compressedChars,
      fileCount: Object.keys(this.workspaceState().files).length,
      exceedsHashRecommendation: compressedChars > LARGE_HASH_CHAR_LIMIT,
    };
  });

  /**
   * Hydrates initial workspace in priority order:
   * 1) URL hash `#code=...`
   * 2) URL query `?pad=...`
   * 3) Short link `/s/:id` via SnapshotStorageAdapter
   * 4) IndexedDB persisted workspace
   * 5) Default TypeScript starter template
   */
  async bootstrapHydration(): Promise<void> {
    if (typeof window !== 'undefined') {
      const hash = window.location.hash;
      if (hash.startsWith('#code=')) {
        const token = hash.slice('#code='.length);
        const decoded = deserializeWorkspaceToken(token);
        if (decoded) {
          this.applyWorkspace(decoded, 'url-hash', false);
          return;
        }
        this.notify('Shared URL hash was invalid; loaded fallback workspace.', 'warn');
      }

      const params = new URLSearchParams(window.location.search);
      const padToken = params.get('pad');
      if (padToken) {
        const decoded = deserializeWorkspaceToken(padToken);
        if (decoded) {
          this.applyWorkspace(decoded, 'url-query', false);
          return;
        }
        this.notify('Shared ?pad parameter was invalid; loaded fallback workspace.', 'warn');
      }

      const shortMatch = window.location.pathname.match(/(?:^|\/)s\/([A-Za-z0-9_-]{4,32})\/?$/);
      if (shortMatch) {
        try {
          const compressed = await this.snapshotAdapter.resolveSnapshot(shortMatch[1]);
          if (compressed) {
            const decoded = deserializeWorkspaceToken(compressed);
            if (decoded) {
              this.applyWorkspace(decoded, 'snapshot', false);
              return;
            }
          }
        } catch {
          this.notify('Could not fetch short snapshot; fell back to local workspace.', 'warn');
        }
      }
    }

    const stored = await this.readFromIndexedDb();
    if (stored) {
      this.applyWorkspace(stored, 'indexeddb', false);
      return;
    }

    this.applyWorkspace(createTemplateWorkspace('typescript'), 'template', false);
  }

  switchEnvironment(env: RuntimeEnvironment): void {
    const template = createTemplateWorkspace(env);
    this.applyWorkspace(template, 'template', true);
    this.clearUrlFragment();
    this.notify(`Switched environment to ${env}`, 'info');
  }

  resetToTemplate(): void {
    const env = this.envSignal();
    const template = createTemplateWorkspace(env);
    this.applyWorkspace(template, 'template', true);
    this.clearUrlFragment();
    this.notify(`Reset ${env} workspace to starter template`, 'info');
  }

  selectFile(rawPath: string): void {
    const path = normalizeVirtualPath(rawPath);
    const ws = this.workspaceState();
    if (!ws.files[path]) return;

    if (ws.activeFile !== path) {
      this.workspaceState.set({ ...ws, activeFile: path });
      this.schedulePersist();
    }

    const tabs = this.openTabsState();
    if (!tabs.includes(path)) {
      this.openTabsState.set([...tabs, path]);
    }
  }

  closeTab(rawPath: string): void {
    const path = normalizeVirtualPath(rawPath);
    const tabs = this.openTabsState();
    if (!tabs.includes(path)) return;

    const remaining = tabs.filter((t) => t !== path);
    this.openTabsState.set(remaining);

    const ws = this.workspaceState();
    if (ws.activeFile === path) {
      const idx = tabs.indexOf(path);
      const nextActive =
        remaining[Math.min(idx, remaining.length - 1)] ?? Object.keys(ws.files)[0] ?? '';
      if (nextActive && ws.files[nextActive]) {
        this.workspaceState.set({ ...ws, activeFile: nextActive });
        if (!remaining.includes(nextActive)) {
          this.openTabsState.set([nextActive]);
        }
      }
    }
  }

  updateFileContent(rawPath: string, content: string): void {
    const path = normalizeVirtualPath(rawPath);
    const ws = this.workspaceState();
    const existing = ws.files[path];
    if (!existing || existing.content === content) {
      return;
    }

    this.workspaceState.set({
      ...ws,
      files: {
        ...ws.files,
        [path]: {
          ...existing,
          content,
        },
      },
    });

    const nextDirty = new Set(this.dirtyFilesState());
    nextDirty.add(path);
    this.dirtyFilesState.set(nextDirty);
    this.dirtyState.set(true);
    this.schedulePersist();
  }

  createFile(rawPath: string, initialContent = ''): boolean {
    const path = normalizeVirtualPath(rawPath);
    if (path === '/') {
      this.notify('Please enter a valid file name.', 'warn');
      return false;
    }

    const ws = this.workspaceState();
    if (ws.files[path]) {
      this.notify(`File ${path} already exists.`, 'warn');
      return false;
    }
    if ((ws.folders ?? []).includes(path)) {
      this.notify(`A folder named ${path} already exists.`, 'warn');
      return false;
    }

    const parent = getParentPath(path);
    const updatedFolders = (ws.folders ?? []).filter((f) => f !== parent);

    const newFile: VirtualFile = {
      path,
      content: initialContent,
      language: detectLanguageFromPath(path),
    };

    this.workspaceState.set({
      ...ws,
      activeFile: path,
      files: {
        ...ws.files,
        [path]: newFile,
      },
      folders: updatedFolders,
    });

    const tabs = this.openTabsState();
    if (!tabs.includes(path)) {
      this.openTabsState.set([...tabs, path]);
    }
    const dirty = new Set(this.dirtyFilesState());
    dirty.add(path);
    this.dirtyFilesState.set(dirty);
    this.dirtyState.set(true);
    this.schedulePersist();
    return true;
  }

  createFolder(rawPath: string): boolean {
    const path = normalizeVirtualPath(rawPath);
    if (path === '/') {
      this.notify('Please enter a valid folder name.', 'warn');
      return false;
    }
    const ws = this.workspaceState();
    if (ws.files[path]) {
      this.notify(`A file named ${path} already exists.`, 'warn');
      return false;
    }

    const existingFolders = new Set(ws.folders ?? []);
    if (existingFolders.has(path) || Object.keys(ws.files).some((fp) => fp.startsWith(`${path}/`))) {
      this.notify(`Folder ${path} already exists.`, 'warn');
      return false;
    }

    existingFolders.add(path);
    this.workspaceState.set({
      ...ws,
      folders: Array.from(existingFolders),
    });
    this.dirtyState.set(true);
    this.schedulePersist();
    return true;
  }

  renameNode(oldRawPath: string, newRawPath: string): boolean {
    const oldPath = normalizeVirtualPath(oldRawPath);
    const newPath = normalizeVirtualPath(newRawPath);
    if (oldPath === '/' || newPath === '/' || oldPath === newPath) {
      return false;
    }
    if (newPath.startsWith(`${oldPath}/`)) {
      this.notify('Cannot move a folder inside itself.', 'warn');
      return false;
    }

    const ws = this.workspaceState();
    const isFile = Boolean(ws.files[oldPath]);

    if (isFile) {
      if (ws.files[newPath] || (ws.folders ?? []).includes(newPath)) {
        this.notify(`${newPath} already exists.`, 'warn');
        return false;
      }

      const nextFiles = { ...ws.files };
      const oldFile = nextFiles[oldPath];
      delete nextFiles[oldPath];
      nextFiles[newPath] = {
        ...oldFile,
        path: newPath,
        language: detectLanguageFromPath(newPath),
      };

      const nextActive = ws.activeFile === oldPath ? newPath : ws.activeFile;
      this.workspaceState.set({ ...ws, activeFile: nextActive, files: nextFiles });
      this.openTabsState.set(
        this.openTabsState().map((t) => (t === oldPath ? newPath : t)),
      );

      const nextDirty = new Set(this.dirtyFilesState());
      if (nextDirty.delete(oldPath)) {
        nextDirty.add(newPath);
      } else {
        nextDirty.add(newPath);
      }
      this.dirtyFilesState.set(nextDirty);
      this.dirtyState.set(true);
      this.schedulePersist();
      return true;
    }

    // Folder rename: move all nested files and explicit subfolders
    const prefix = `${oldPath}/`;
    const affectedFiles = Object.keys(ws.files).filter((p) => p.startsWith(prefix));
    const affectedFolders = (ws.folders ?? []).filter(
      (f) => f === oldPath || f.startsWith(prefix),
    );

    if (affectedFiles.length === 0 && affectedFolders.length === 0) {
      return false;
    }

    const nextFiles: Record<string, VirtualFile> = {};
    for (const [p, file] of Object.entries(ws.files)) {
      if (p.startsWith(prefix)) {
        const moved = `${newPath}${p.slice(oldPath.length)}`;
        if (ws.files[moved]) {
          this.notify(`Conflict moving ${moved}.`, 'warn');
          return false;
        }
        nextFiles[moved] = { ...file, path: moved };
      } else {
        nextFiles[p] = file;
      }
    }

    const nextFolders = (ws.folders ?? []).map((f) =>
      f === oldPath || f.startsWith(prefix) ? `${newPath}${f.slice(oldPath.length)}` : f,
    );

    const nextActive = ws.activeFile.startsWith(prefix)
      ? `${newPath}${ws.activeFile.slice(oldPath.length)}`
      : ws.activeFile;

    this.workspaceState.set({
      ...ws,
      activeFile: nextActive,
      files: nextFiles,
      folders: Array.from(new Set(nextFolders)),
    });

    this.openTabsState.set(
      this.openTabsState().map((t) =>
        t.startsWith(prefix) ? `${newPath}${t.slice(oldPath.length)}` : t,
      ),
    );

    const nextDirty = new Set<string>();
    for (const d of this.dirtyFilesState()) {
      nextDirty.add(d.startsWith(prefix) ? `${newPath}${d.slice(oldPath.length)}` : d);
    }
    this.dirtyFilesState.set(nextDirty);
    this.dirtyState.set(true);
    this.schedulePersist();
    return true;
  }

  deleteNode(rawTargetPath: string): boolean {
    const targetPath = normalizeVirtualPath(rawTargetPath);
    if (targetPath === '/') return false;

    const ws = this.workspaceState();
    const isFile = Boolean(ws.files[targetPath]);
    const prefix = `${targetPath}/`;

    const remainingFiles: Record<string, VirtualFile> = {};
    for (const [p, file] of Object.entries(ws.files)) {
      const shouldRemove = isFile ? p === targetPath : p.startsWith(prefix);
      if (!shouldRemove) {
        remainingFiles[p] = file;
      }
    }

    const remainingKeys = Object.keys(remainingFiles);
    if (remainingKeys.length === 0) {
      this.notify('Workspace must keep at least one file.', 'warn');
      return false;
    }

    const remainingFolders = (ws.folders ?? []).filter(
      (f) => f !== targetPath && !f.startsWith(prefix),
    );

    const remainingTabs = this.openTabsState().filter((t) =>
      isFile ? t !== targetPath : !t.startsWith(prefix),
    );

    const activeDeleted = isFile
      ? ws.activeFile === targetPath
      : ws.activeFile.startsWith(prefix);
    const nextActive = activeDeleted
      ? remainingTabs[0] ?? remainingKeys[0]
      : ws.activeFile;

    this.workspaceState.set({
      ...ws,
      activeFile: nextActive,
      files: remainingFiles,
      folders: remainingFolders,
    });

    this.openTabsState.set(
      remainingTabs.length > 0 ? remainingTabs : [nextActive],
    );

    const nextDirty = new Set<string>();
    for (const d of this.dirtyFilesState()) {
      const removed = isFile ? d === targetPath : d.startsWith(prefix);
      if (!removed) nextDirty.add(d);
    }
    this.dirtyFilesState.set(nextDirty);
    this.dirtyState.set(true);
    this.schedulePersist();
    return true;
  }

  setEntryFile(rawPath: string): void {
    const path = normalizeVirtualPath(rawPath);
    const ws = this.workspaceState();
    if (!ws.files[path]) return;

    const updatedFiles: Record<string, VirtualFile> = {};
    for (const [p, f] of Object.entries(ws.files)) {
      updatedFiles[p] = {
        ...f,
        isEntry: p === path,
      };
    }

    this.workspaceState.set({ ...ws, files: updatedFiles });
    this.dirtyState.set(true);
    this.schedulePersist();
    this.notify(`Set ${path} as entry file`, 'info');
  }

  /**
   * Syncs the compressed workspace into the browser URL hash (`#code=...`),
   * marks workspace clean, and persists immediately to IndexedDB.
   */
  syncShareToUrl(): string {
    const token = this.compressedHashSignal();
    const url = this.shareUrlSignal();
    if (typeof window !== 'undefined') {
      try {
        window.history.replaceState(null, '', `#code=${token}`);
      } catch {
        // Ignore SecurityError in constrained test environments
      }
    }
    this.dirtyState.set(false);
    this.dirtyFilesState.set(new Set());
    void this.persistNow();
    return url;
  }

  setSnapshotEndpoint(endpoint: string): void {
    this.snapshotEndpointState.set(endpoint.trim() || '/api/snapshot');
  }

  async createShortSnapshot(): Promise<SnapshotCreateResult> {
    const token = this.compressedHashSignal();
    return this.snapshotAdapter.createSnapshot(token);
  }

  exportWorkspaceZip(): void {
    const ws = this.workspaceState();
    const entries: Record<string, Uint8Array> = {};
    for (const file of Object.values(ws.files)) {
      const relPath = file.path.replace(/^\/+/, '');
      if (relPath) {
        entries[relPath] = strToU8(file.content);
      }
    }
    const zipped = zipSync(entries, { level: 6 });
    const blob = new Blob([zipped.slice().buffer], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `codepad-${ws.env}.zip`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.notify(`Downloaded codepad-${ws.env}.zip`, 'success');
  }

  notify(text: string, tone: ToastNotice['tone'] = 'info'): void {
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
    }
    this.toastSeq += 1;
    this.toastState.set({ id: this.toastSeq, text, tone });
    this.toastTimer = setTimeout(() => {
      this.toastState.set(null);
    }, 3200);
  }

  clearToast(): void {
    this.toastState.set(null);
  }

  private applyWorkspace(
    payload: WorkspacePayload,
    source: HydrationSource,
    persist: boolean,
  ): void {
    this.workspaceState.set(payload);
    this.openTabsState.set([payload.activeFile]);
    this.dirtyFilesState.set(new Set());
    this.dirtyState.set(false);
    this.hydrationSourceState.set(source);
    if (persist) {
      void this.persistNow();
    }
  }

  private clearUrlFragment(): void {
    if (typeof window !== 'undefined' && (window.location.hash || window.location.search)) {
      try {
        window.history.replaceState(null, '', window.location.pathname);
      } catch {
        // Ignore in sandboxed test environments
      }
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }
    this.persistTimer = setTimeout(() => {
      void this.persistNow();
    }, 400);
  }

  private async persistNow(): Promise<void> {
    if (typeof indexedDB === 'undefined') {
      return;
    }
    try {
      await idbSet(IDB_WORKSPACE_KEY, this.workspaceState());
    } catch {
      // Non-fatal in private browsing or restricted contexts
    }
  }

  private async readFromIndexedDb(): Promise<WorkspacePayload | null> {
    if (typeof indexedDB === 'undefined') {
      return null;
    }
    try {
      const saved = await idbGet<unknown>(IDB_WORKSPACE_KEY);
      return validateWorkspacePayload(saved);
    } catch {
      return null;
    }
  }
}

