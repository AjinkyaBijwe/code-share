import { FileTreeNode, VirtualFile } from '../models/workspace.models';

/**
 * Normalizes a virtual file or folder path to a canonical POSIX path starting with `/`.
 * Strips duplicate slashes, `./` segments, and trailing slashes.
 * Rejects parent directory traversal (`..`) by dropping `..` segments cleanly.
 */
export function normalizeVirtualPath(rawPath: string): string {
  const cleaned = rawPath.trim().replace(/\\/g, '/');
  const segments = cleaned
    .split('/')
    .filter((seg) => seg.length > 0 && seg !== '.' && seg !== '..');

  return '/' + segments.join('/');
}

/**
 * Returns the parent directory path of a normalized virtual path (or `/` for top-level entries).
 */
export function getParentPath(normalizedPath: string): string {
  const path = normalizeVirtualPath(normalizedPath);
  const lastSlash = path.lastIndexOf('/');
  if (lastSlash <= 0) {
    return '/';
  }
  return path.slice(0, lastSlash);
}

/**
 * Returns the final path segment (file or folder name).
 */
export function getBaseName(normalizedPath: string): string {
  const path = normalizeVirtualPath(normalizedPath);
  const lastSlash = path.lastIndexOf('/');
  return path.slice(lastSlash + 1);
}

/**
 * Infers a Monaco language identifier from a file path or filename.
 */
export function detectLanguageFromPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.tsx') || lower.endsWith('.ts')) return 'typescript';
  if (lower.endsWith('.jsx') || lower.endsWith('.js') || lower.endsWith('.mjs')) return 'javascript';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.scss')) return 'scss';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.py')) return 'python';
  if (lower.endsWith('.md')) return 'markdown';
  if (lower.endsWith('.txt')) return 'plaintext';
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'yaml';
  return 'plaintext';
}

/**
 * Builds a deterministic sorted file tree (folders first, then files, both alphabetically)
 * from flat VirtualFile records and optional explicit empty folder paths.
 */
export function buildFileTree(
  files: Record<string, VirtualFile>,
  explicitFolders: readonly string[] = [],
  dirtyPaths: ReadonlySet<string> = new Set(),
): FileTreeNode[] {
  interface MutableFolder {
    name: string;
    path: string;
    folders: Map<string, MutableFolder>;
    files: FileTreeNode[];
  }

  const root: MutableFolder = {
    name: '',
    path: '/',
    folders: new Map(),
    files: [],
  };

  const ensureFolder = (folderPath: string): MutableFolder => {
    const normalized = normalizeVirtualPath(folderPath);
    if (normalized === '/') {
      return root;
    }
    const parts = normalized.slice(1).split('/');
    let current = root;
    let builtPath = '';
    for (const part of parts) {
      builtPath += '/' + part;
      let child = current.folders.get(part);
      if (!child) {
        child = {
          name: part,
          path: builtPath,
          folders: new Map(),
          files: [],
        };
        current.folders.set(part, child);
      }
      current = child;
    }
    return current;
  };

  for (const folderPath of explicitFolders) {
    ensureFolder(folderPath);
  }

  for (const file of Object.values(files)) {
    const normalized = normalizeVirtualPath(file.path);
    const parent = ensureFolder(getParentPath(normalized));
    parent.files.push({
      name: getBaseName(normalized),
      path: normalized,
      type: 'file',
      depth: 0,
      language: file.language || detectLanguageFromPath(normalized),
      isEntry: Boolean(file.isEntry),
      isDirty: dirtyPaths.has(normalized),
    });
  }

  const finalize = (folder: MutableFolder, depth: number): FileTreeNode[] => {
    const folderNodes: FileTreeNode[] = Array.from(folder.folders.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((sub) => ({
        name: sub.name,
        path: sub.path,
        type: 'folder' as const,
        depth,
        children: finalize(sub, depth + 1),
      }));

    const fileNodes: FileTreeNode[] = folder.files
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((f) => ({
        ...f,
        depth,
      }));

    return [...folderNodes, ...fileNodes];
  };

  return finalize(root, 0);
}

