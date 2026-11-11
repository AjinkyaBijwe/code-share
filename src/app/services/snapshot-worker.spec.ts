import {
  KvNamespaceLike,
  SnapshotWorkerEnv,
  handleSnapshotRequest,
} from '../../../edge/snapshot-worker';

class MemoryKv implements KvNamespaceLike {
  readonly store = new Map<string, { value: string; ttl?: number }>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key)?.value ?? null;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    this.store.set(key, { value, ttl: options?.expirationTtl });
  }
}

describe('Snapshot Edge Worker (<= 8-char slugs)', () => {
  it('stores and resolves <= 8-char Base62 short snapshots with CORS and TTL refresh', async () => {
    const kv = new MemoryKv();
    const env: SnapshotWorkerEnv = { CODEPAD_KV: kv };

    const preflight = await handleSnapshotRequest(
      new Request('https://short.workers.dev/api/snapshot', { method: 'OPTIONS' }),
      env,
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('*');

    const createRes = await handleSnapshotRequest(
      new Request('https://short.workers.dev/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: 'z1.abc123', ttlSeconds: 3600 }),
      }),
      env,
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string; expiresAt: string; url?: string };
    expect(created.id).toMatch(/^[A-Za-z0-9]{1,8}$/);
    expect(created.id.length).toBeLessThanOrEqual(8);
    expect(created.url).toBeUndefined();

    const waitTasks: Promise<unknown>[] = [];
    const getRes = await handleSnapshotRequest(
      new Request(`https://short.workers.dev/${created.id}`, { method: 'GET' }),
      env,
      { waitUntil: (p) => waitTasks.push(p) },
    );
    expect(getRes.status).toBe(200);
    const resolved = (await getRes.json()) as { id: string; payload: string };
    expect(resolved).toEqual({ id: created.id, payload: 'z1.abc123' });
    expect(waitTasks.length).toBe(1);
    await Promise.all(waitTasks);
  });

  it('rejects IDs longer than 8 chars and unknown IDs cleanly', async () => {
    const kv = new MemoryKv();
    const env: SnapshotWorkerEnv = { CODEPAD_KV: kv };

    const tooLong = await handleSnapshotRequest(
      new Request('https://short.workers.dev/123456789', { method: 'GET' }),
      env,
    );
    expect(tooLong.status).toBe(400);

    const missing = await handleSnapshotRequest(
      new Request('https://short.workers.dev/api/snapshot/Ab3k9Z', { method: 'GET' }),
      env,
    );
    expect(missing.status).toBe(404);
  });
});

