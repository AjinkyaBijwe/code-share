import {
  buildFileTree,
  detectLanguageFromPath,
  getBaseName,
  getParentPath,
  normalizeVirtualPath,
} from './path.utils';

describe('path.utils', () => {
  it('normalizes paths and strips traversal segments', () => {
    expect(normalizeVirtualPath('src//app/../index.ts')).toBe('/src/app/index.ts');
    expect(normalizeVirtualPath('  \\components\\Card.tsx  ')).toBe('/components/Card.tsx');
    expect(normalizeVirtualPath('/')).toBe('/');
  });

  it('extracts parent path and base name', () => {
    expect(getParentPath('/components/MetricPill.tsx')).toBe('/components');
    expect(getParentPath('/index.ts')).toBe('/');
    expect(getBaseName('/components/MetricPill.tsx')).toBe('MetricPill.tsx');
  });

  it('detects languages from file extensions', () => {
    expect(detectLanguageFromPath('/App.tsx')).toBe('typescript');
    expect(detectLanguageFromPath('/main.py')).toBe('python');
    expect(detectLanguageFromPath('/styles.css')).toBe('css');
    expect(detectLanguageFromPath('/index.html')).toBe('html');
    expect(detectLanguageFromPath('/package.json')).toBe('json');
    expect(detectLanguageFromPath('/requirements.txt')).toBe('plaintext');
  });

  it('builds sorted tree with folders before files and includes empty folders', () => {
    const tree = buildFileTree(
      {
        '/z.ts': { path: '/z.ts', content: '', language: 'typescript' },
        '/components/Button.tsx': {
          path: '/components/Button.tsx',
          content: '',
          language: 'typescript',
          isEntry: true,
        },
        '/a.ts': { path: '/a.ts', content: '', language: 'typescript' },
      },
      ['/empty-dir'],
      new Set(['/a.ts']),
    );

    expect(tree.map((n) => `${n.type}:${n.name}`)).toEqual([
      'folder:components',
      'folder:empty-dir',
      'file:a.ts',
      'file:z.ts',
    ]);

    expect(tree[0].children?.[0]).toMatchObject({
      name: 'Button.tsx',
      isEntry: true,
      depth: 1,
    });
    expect(tree[2].isDirty).toBe(true);
  });
});

