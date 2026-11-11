import { TestBed } from '@angular/core/testing';
import { compressToEncodedURIComponent } from 'lz-string';
import { createTemplateWorkspace } from '../config/templates.config';
import {
  SNAPSHOT_ID_PATTERN,
  VfsStateService,
  deserializeWorkspaceToken,
  serializeWorkspaceToken,
  validateWorkspacePayload,
} from './vfs-state.service';

describe('VfsStateService & Serialization', () => {
  let service: VfsStateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(VfsStateService);
    window.history.replaceState(null, '', '/');
  });

  it('round-trips workspace payload via lz-string token', () => {
    const original = createTemplateWorkspace('react');
    const token = serializeWorkspaceToken(original);
    const restored = deserializeWorkspaceToken(token);

    expect(restored).not.toBeNull();
    expect(restored?.env).toBe('react');
    expect(restored?.activeFile).toBe('/App.tsx');
    expect(restored?.files['/components/MetricPill.tsx']?.content).toContain('MetricPillProps');
  });

  it('rejects malformed or empty workspace payloads', () => {
    expect(validateWorkspacePayload(null)).toBeNull();
    expect(validateWorkspacePayload({ v: 1, env: 'ruby', files: {} })).toBeNull();
    expect(validateWorkspacePayload({ v: 1, env: 'typescript', files: {} })).toBeNull();
    expect(deserializeWorkspaceToken('invalid-corrupt-token')).toBeNull();
  });

  it('supports creating, renaming, and deleting files and nested folders', () => {
    service.switchEnvironment('typescript');
    expect(service.createFolder('/helpers')).toBe(true);
    expect(service.createFile('/helpers/math.ts', 'export const add = (a: number, b: number) => a + b;')).toBe(true);
    expect(service.activeFileSignal()).toBe('/helpers/math.ts');

    expect(service.renameNode('/helpers', '/lib')).toBe(true);
    expect(service.filesSignal()['/lib/math.ts']).toBeDefined();
    expect(service.filesSignal()['/helpers/math.ts']).toBeUndefined();
    expect(service.activeFileSignal()).toBe('/lib/math.ts');

    expect(service.deleteNode('/lib')).toBe(true);
    expect(service.filesSignal()['/lib/math.ts']).toBeUndefined();
    expect(service.filesSignal()['/index.ts']).toBeDefined();
  });

  it('prevents deleting the last remaining file in the workspace', () => {
    service.switchEnvironment('python');
    expect(service.deleteNode('/utils.py')).toBe(true);
    expect(service.deleteNode('/requirements.txt')).toBe(true);
    expect(service.deleteNode('/main.py')).toBe(false);
    expect(service.filesSignal()['/main.py']).toBeDefined();
  });

  it('hydrates from #code= URL hash and ?pad= query parameter', async () => {
    const py = createTemplateWorkspace('python');
    py.files['/main.py'].content = 'print("from hash")';
    const token = serializeWorkspaceToken(py);

    window.history.replaceState(null, '', `/#code=${token}`);
    await service.bootstrapHydration();
    expect(service.envSignal()).toBe('python');
    expect(service.filesSignal()['/main.py'].content).toBe('print("from hash")');
    expect(service.hydrationSourceSignal()).toBe('url-hash');

    const ng = createTemplateWorkspace('angular');
    const ngToken = serializeWorkspaceToken(ng);
    window.history.replaceState(null, '', `/?pad=${ngToken}`);
    await service.bootstrapHydration();
    expect(service.envSignal()).toBe('angular');
    expect(service.hydrationSourceSignal()).toBe('url-query');
  });

  it('compresses unchanged templates to 3 chars and delta edits compactly while remaining LZ-compatible', () => {
    const base = createTemplateWorkspace('typescript');
    const unmodifiedToken = serializeWorkspaceToken(base);
    expect(unmodifiedToken).toBe('z0t');
    expect(deserializeWorkspaceToken(unmodifiedToken)?.files['/index.ts'].content).toBe(
      base.files['/index.ts'].content,
    );

    const modified = createTemplateWorkspace('typescript');
    modified.files['/notes.txt'] = {
      path: '/notes.txt',
      content: 'hello world',
      language: 'plaintext',
    };
    modified.activeFile = '/notes.txt';
    const deltaToken = serializeWorkspaceToken(modified);
    const legacyToken = compressToEncodedURIComponent(JSON.stringify(modified));

    expect(deltaToken.startsWith('z1.')).toBe(true);
    expect(deltaToken.length).toBeLessThan(legacyToken.length / 4);
    const restoredDelta = deserializeWorkspaceToken(deltaToken);
    expect(restoredDelta?.activeFile).toBe('/notes.txt');
    expect(restoredDelta?.files['/notes.txt']?.content).toBe('hello world');

    const restoredLegacy = deserializeWorkspaceToken(legacyToken);
    expect(restoredLegacy?.files['/notes.txt']?.content).toBe('hello world');
  });

  it('creates and hydrates <=8-char #s= and ?s= snapshots via HttpSnapshotAdapter', async () => {
    const sample = createTemplateWorkspace('python');
    sample.files['/main.py'].content = 'print("short slug test")';
    const token = serializeWorkspaceToken(sample);

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'Ab3k9Z' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/Ab3k9Z')) {
        return new Response(JSON.stringify({ id: 'Ab3k9Z', payload: token }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      service.setSnapshotEndpoint('https://short.example.workers.dev');
      service.switchEnvironment('python');
      service.updateFileContent('/main.py', 'print("short slug test")');

      const created = await service.createShortSnapshot();
      expect(SNAPSHOT_ID_PATTERN.test(created.id)).toBe(true);
      expect(created.id.length).toBeLessThanOrEqual(8);
      expect(created.url).toContain('#s=Ab3k9Z');
      expect(window.location.hash).toBe('#s=Ab3k9Z');

      service.switchEnvironment('typescript');
      window.history.replaceState(null, '', '/code-share/#s=Ab3k9Z');
      await service.bootstrapHydration();
      expect(service.envSignal()).toBe('python');
      expect(service.hydrationSourceSignal()).toBe('snapshot');
      expect(service.filesSignal()['/main.py']?.content).toBe('print("short slug test")');

      service.switchEnvironment('typescript');
      window.history.replaceState(null, '', '/code-share/?s=Ab3k9Z');
      await service.bootstrapHydration();
      expect(service.envSignal()).toBe('python');
      expect(service.hydrationSourceSignal()).toBe('snapshot');
    } finally {
      vi.unstubAllGlobals();
      service.setSnapshotEndpoint('/api/snapshot');
    }
  });
});

