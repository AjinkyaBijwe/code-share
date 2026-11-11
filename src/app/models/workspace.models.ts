export type RuntimeEnvironment = 'typescript' | 'angular' | 'react' | 'python';

export type WebSandboxEngine = 'esm' | 'sandpack';

export type ViewportPreset = 'desktop' | 'tablet' | 'mobile';

export type ConsoleLevel = 'info' | 'warn' | 'error' | 'python-stdout' | 'system';

export type ConsoleFilter = 'all' | ConsoleLevel;

export type ExecutionStatus =
  | 'idle'
  | 'initializing'
  | 'installing'
  | 'transpiling'
  | 'running'
  | 'ready'
  | 'error';

export type HydrationSource = 'url-hash' | 'url-query' | 'snapshot' | 'indexeddb' | 'template';

export interface VirtualFile {
  path: string;
  content: string;
  language: string;
  isEntry?: boolean;
}

export interface WorkspacePayload {
  v: number;
  env: RuntimeEnvironment;
  activeFile: string;
  files: Record<string, VirtualFile>;
  folders?: string[];
}

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  depth: number;
  language?: string;
  isEntry?: boolean;
  isDirty?: boolean;
  children?: FileTreeNode[];
}

export interface ConsoleEntry {
  id: string;
  level: ConsoleLevel;
  message: string;
  timestamp: string;
  source: string;
}

export interface EnvironmentMeta {
  id: RuntimeEnvironment;
  label: string;
  shortLabel: string;
  runtimeLabel: string;
  description: string;
  accentColor: string;
  badgeClasses: string;
  defaultEntry: string;
  isWeb: boolean;
}

export interface SnapshotCreateResult {
  id: string;
  url: string;
  expiresAt?: string;
}

export interface SnapshotStorageAdapter {
  createSnapshot(compressedPayload: string): Promise<SnapshotCreateResult>;
  resolveSnapshot(id: string): Promise<string | null>;
}

export interface ExecutionSummary {
  status: ExecutionStatus;
  durationMs?: number;
  detail?: string;
  pythonPackages?: string[];
  pythonOutputPreview?: string;
}

