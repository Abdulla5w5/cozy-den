// Thin fetch wrapper. `credentials: 'include'` so the staff httpOnly session
// cookie is sent with requests. All calls go through /api (proxied in dev).

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : {};

  if (!res.ok) {
    throw new ApiError(res.status, data.error || res.statusText, data.details);
  }
  return data as T;
}

/**
 * GET cache + in-flight de-duplication.
 *
 * Every page refetched its data on every visit, so moving between menu items
 * meant a fresh round trip each time — invisible on localhost at ~10ms, but a
 * visible stall from Kuwait to the FRA1 region at ~150ms, on top of an
 * /auth/me call the layout fired on every route change.
 *
 * Two behaviours, both aimed at the second visit rather than the first:
 *   - de-duplication: concurrent callers for the same path share one request
 *     instead of racing (this is also what stops the double fetch you see in
 *     development, where StrictMode mounts every effect twice);
 *   - stale-while-revalidate: a cached body renders IMMEDIATELY, and a refresh
 *     runs in the background, so a repeat visit is instant but never stale for
 *     long.
 *
 * Only for public catalogue data — games, menu, events, promo — which is the
 * same for everyone. Anything per-user stays uncached, and the whole cache is
 * dropped on sign-in and sign-out so one person's data can never survive into
 * another's session.
 */
const TTL_MS = 60_000;
const cache = new Map<string, { at: number; data: unknown }>();
const inFlight = new Map<string, Promise<unknown>>();

export function clearApiCache() {
  cache.clear();
  inFlight.clear();
}

/**
 * Announce that the signed-in identity changed.
 *
 * The layout used to notice indirectly, by refetching /auth/me on every route
 * change — which is why every menu click carried an auth round trip. Sign-in
 * and sign-out now say so explicitly, and the cache is dropped at the same
 * moment so nothing from the previous session can be served to the next one.
 */
export const AUTH_CHANGED = 'cd-auth-changed';

export function notifyAuthChanged() {
  clearApiCache();
  window.dispatchEvent(new Event(AUTH_CHANGED));
}

function deduped<T>(path: string): Promise<T> {
  const existing = inFlight.get(path);
  if (existing) return existing as Promise<T>;
  const p = request<T>(path)
    .then((data) => {
      cache.set(path, { at: Date.now(), data });
      return data;
    })
    .finally(() => inFlight.delete(path));
  inFlight.set(path, p);
  return p;
}

export const api = {
  get: <T>(path: string) => deduped<T>(path),

  /**
   * Cached read. `onFresh` fires only when revalidation returns something
   * different, so a component can render instantly from cache and quietly
   * update if the server has moved on.
   */
  getCached: <T>(path: string, onFresh?: (data: T) => void): Promise<T> => {
    const hit = cache.get(path);
    if (hit) {
      const fresh = Date.now() - hit.at < TTL_MS;
      if (!fresh) {
        void deduped<T>(path)
          .then((d) => {
            if (onFresh && JSON.stringify(d) !== JSON.stringify(hit.data)) onFresh(d);
          })
          .catch(() => {
            /* keep showing the cached copy */
          });
      }
      return Promise.resolve(hit.data as T);
    }
    return deduped<T>(path);
  },
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
