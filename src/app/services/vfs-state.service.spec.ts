import { TestBed } from '@angular/core/testing';
import { createTemplateWorkspace } from '../config/templates.config';
import {
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
});

