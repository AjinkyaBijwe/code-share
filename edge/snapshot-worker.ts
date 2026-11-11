/**
 * Zero-Auth Short Snapshot Worker for CodePad (`<= 8`-char Base62 slugs).
 *
 * Supports:
 * - Cloudflare Workers KV (`env.CODEPAD_KV`)
 * - Upstash Redis REST (`env.UPSTASH_REDIS_REST_URL` + `env.UPSTASH_REDIS_REST_TOKEN`)
 *
 * Endpoints (both `/api/snapshot` prefix and root `/` are accepted):
 * - `POST /api/snapshot` or `POST /`      -> creates short ID (6..8 Base62 chars) with 30-day TTL
 * - `GET  /api/snapshot/:id` or `GET /:id` -> returns `{ id, payload }` and refreshes sliding TTL
 */

export interface KvNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface SnapshotWorkerEnv {
  CODEPAD_KV?: KvNamespaceLike;
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
  /** Optional canonical web origin+base path, e.g. https://user.github.io/code-share/ */
  SNAPSHOT_PUBLIC_APP_URL?: string;
  /** Optional comma-separated allowed CORS origins; defaults to '*' */
  ALLOWED_ORIGINS?: string;
}

export interface WorkerExecutionContext {
  waitUntil?(promise: Promise<unknown>): void;
}

interface StoredSnapshotRecord {
  payload: string;
  ttlSeconds: number;
  createdAt: string;
}

const SLUG_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const SLUG_PATTERN = /^[A-Za-z0-9_-]{1,8}$/;
const DEFAULT_SLUG_LENGTH = 6;
const MAX_SLUG_LENGTH = 8;
const MAX_PAYLOAD_CHARS = 512_000;
const MIN_TTL_SECONDS = 60;
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_WRITES = 30;

export function generateShortId(length = DEFAULT_SLUG_LENGTH): string {
  const clamped = Math.max(1, Math.min(MAX_SLUG_LENGTH, length));
  const random = new Uint8Array(clamped);
  crypto.getRandomValues(random);
  let out = '';
  for (let i = 0; i < clamped; i += 1) {
    out += SLUG_ALPHABET[random[i] % SLUG_ALPHABET.length];
  }
  return out;
}

function buildCorsHeaders(request: Request, env: SnapshotWorkerEnv): Record<string, string> {
  const origin = request.headers.get('Origin');
  let allowOrigin = '*';
  if (env.ALLOWED_ORIGINS && origin) {
    const allowed = env.ALLOWED_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (allowed.includes(origin)) {
      allowOrigin = origin;
    } else if (allowed.length > 0 && !allowed.includes('*')) {
      allowOrigin = allowed[0];
    }
  }

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(
  body: unknown,
  status: number,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders,
    },
  });
}

function createStorageClient(env: SnapshotWorkerEnv): {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, ttlSeconds: number): Promise<void>;
  incrRateLimit?(key: string, windowSeconds: number): Promise<number>;
} | null {
  if (env.CODEPAD_KV) {
    const kv = env.CODEPAD_KV;
    return {
      get: (key) => kv.get(key),
      put: (key, value, ttlSeconds) => kv.put(key, value, { expirationTtl: ttlSeconds }),
    };
  }

  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
    const baseUrl = env.UPSTASH_REDIS_REST_URL.replace(/\/$/, '');
    const authHeader = `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`;

    const exec = async <T>(command: unknown[]): Promise<T> => {
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(command),
      });
      if (!res.ok) {
        throw new Error(`Upstash REST returned HTTP ${res.status}`);
      }
      const data = (await res.json()) as { result?: T; error?: string };
      if (data.error) {
        throw new Error(data.error);
      }
      return data.result as T;
    };

    return {
      get: async (key) => (await exec<string | null>(['GET', key])) ?? null,
      put: async (key, value, ttlSeconds) => {
        await exec(['SET', key, value, 'EX', ttlSeconds]);
      },
      incrRateLimit: async (key, windowSeconds) => {
        const count = await exec<number>(['INCR', key]);
        if (count === 1) {
          await exec(['EXPIRE', key, windowSeconds]);
        }
        return count;
      },
    };
  }

  return null;
}

function extractSnapshotIdFromPath(pathname: string): string | null {
  const clean = pathname.replace(/\/+$/, '');
  const apiPrefix = '/api/snapshot/';
  if (clean.startsWith(apiPrefix)) {
    const candidate = decodeURIComponent(clean.slice(apiPrefix.length));
    return SLUG_PATTERN.test(candidate) ? candidate : null;
  }
  const shortPrefix = '/s/';
  if (clean.startsWith(shortPrefix)) {
    const candidate = decodeURIComponent(clean.slice(shortPrefix.length));
    return SLUG_PATTERN.test(candidate) ? candidate : null;
  }
  const singleSegment = clean.slice(1);
  if (singleSegment && !singleSegment.includes('/') && SLUG_PATTERN.test(singleSegment)) {
    return singleSegment;
  }
  return null;
}

export async function handleSnapshotRequest(
  request: Request,
  env: SnapshotWorkerEnv,
  ctx?: WorkerExecutionContext,
): Promise<Response> {
  const corsHeaders = buildCorsHeaders(request, env);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const storage = createStorageClient(env);
  if (!storage) {
    return jsonResponse(
      { error: 'Snapshot storage is not configured (bind CODEPAD_KV or Upstash Redis secrets).' },
      503,
      corsHeaders,
    );
  }

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (request.method === 'POST' && (path === '/' || path === '/api/snapshot')) {
    const ip = request.headers.get('CF-Connecting-IP') || 'anon';
    if (storage.incrRateLimit) {
      const rateKey = `rl:${ip}`;
      const hits = await storage.incrRateLimit(rateKey, RATE_LIMIT_WINDOW_SECONDS);
      if (hits > RATE_LIMIT_MAX_WRITES) {
        return jsonResponse({ error: 'Rate limit exceeded. Try again in a minute.' }, 429, corsHeaders);
      }
    }

    let body: { payload?: unknown; ttlSeconds?: unknown };
    try {
      body = (await request.json()) as { payload?: unknown; ttlSeconds?: unknown };
    } catch {
      return jsonResponse({ error: 'Invalid JSON request body' }, 400, corsHeaders);
    }

    if (typeof body.payload !== 'string' || body.payload.length === 0) {
      return jsonResponse({ error: 'Missing non-empty string "payload"' }, 400, corsHeaders);
    }
    if (body.payload.length > MAX_PAYLOAD_CHARS) {
      return jsonResponse(
        { error: `Payload exceeds ${MAX_PAYLOAD_CHARS} char limit` },
        413,
        corsHeaders,
      );
    }

    const requestedTtl =
      typeof body.ttlSeconds === 'number' && Number.isFinite(body.ttlSeconds)
        ? Math.floor(body.ttlSeconds)
        : DEFAULT_TTL_SECONDS;
    const ttlSeconds = Math.max(MIN_TTL_SECONDS, Math.min(DEFAULT_TTL_SECONDS, requestedTtl));

    let allocatedId: string | null = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const length = attempt < 3 ? DEFAULT_SLUG_LENGTH : Math.min(MAX_SLUG_LENGTH, DEFAULT_SLUG_LENGTH + attempt - 2);
      const candidate = generateShortId(length);
      const existing = await storage.get(`snap:${candidate}`);
      if (existing === null) {
        allocatedId = candidate;
        break;
      }
    }

    if (!allocatedId) {
      return jsonResponse({ error: 'Failed to allocate unique short ID' }, 503, corsHeaders);
    }

    const record: StoredSnapshotRecord = {
      payload: body.payload,
      ttlSeconds,
      createdAt: new Date().toISOString(),
    };
    await storage.put(`snap:${allocatedId}`, JSON.stringify(record), ttlSeconds);

    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const publicBase = env.SNAPSHOT_PUBLIC_APP_URL?.trim();
    return jsonResponse(
      {
        id: allocatedId,
        expiresAt,
        ...(publicBase ? { url: `${publicBase.replace(/\/?$/, '/')}#s=${allocatedId}` } : {}),
      },
      201,
      corsHeaders,
    );
  }

  if (request.method === 'GET' && path === '/') {
    return jsonResponse(
      { ok: true, service: 'codepad-snapshot-worker', maxSlugLength: MAX_SLUG_LENGTH },
      200,
      corsHeaders,
    );
  }

  if (request.method === 'GET') {
    const id = extractSnapshotIdFromPath(url.pathname);
    if (!id) {
      return jsonResponse({ error: 'Invalid or missing snapshot ID (max 8 chars)' }, 400, corsHeaders);
    }

    const raw = await storage.get(`snap:${id}`);
    if (!raw) {
      return jsonResponse({ error: 'Snapshot not found or expired' }, 404, corsHeaders);
    }

    let payload = raw;
    let ttlSeconds = DEFAULT_TTL_SECONDS;
    try {
      const parsed = JSON.parse(raw) as Partial<StoredSnapshotRecord>;
      if (typeof parsed.payload === 'string') {
        payload = parsed.payload;
        if (typeof parsed.ttlSeconds === 'number') {
          ttlSeconds = Math.max(MIN_TTL_SECONDS, Math.min(DEFAULT_TTL_SECONDS, parsed.ttlSeconds));
        }
        const refreshPromise = storage.put(`snap:${id}`, raw, ttlSeconds);
        ctx?.waitUntil?.(refreshPromise);
      }
    } catch {
      // Plain payload string stored directly in KV
    }

    return jsonResponse({ id, payload }, 200, corsHeaders);
  }

  return jsonResponse({ error: 'Method or route not found' }, 404, corsHeaders);
}

export default {
  fetch(request: Request, env: SnapshotWorkerEnv, ctx: WorkerExecutionContext): Promise<Response> {
    return handleSnapshotRequest(request, env, ctx);
  },
};
