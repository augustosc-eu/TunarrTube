// Shared reliability helpers for the MusicBrainz/iTunes providers (lib/metadata-lookup/musicbrainz.ts,
// itunes.ts) -- kept separate from lib/system/process.ts's retry-free runProcess() since this is HTTP-
// specific (status-code-aware) rather than a subprocess concern.

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

// One retry on a transient failure (network error, or a 5xx/429/408 the server itself flagged as
// temporary) with a short fixed backoff -- a real 4xx (bad query, unauthorized, etc.) is never retried
// since trying the exact same request again cannot succeed. Aborts (explicit or via the caller's
// signal) are never retried either.
export async function fetchJsonWithRetry(url: string, init: RequestInit, signal?: AbortSignal, attempts = 2): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { ...init, signal });
      if (response.ok || !RETRYABLE_STATUS.has(response.status) || attempt === attempts) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

// A cheap, dependency-free relevance score (0-100) for a provider (iTunes) that doesn't return its own
// ranking. Token-overlap (Jaccard-style) rather than edit distance: cheap, order-independent (an
// "Artist - Title" query still matches a "Title (feat. Artist)" result), and good enough to compare
// against MusicBrainz's own 0-100 score for the shared auto-apply threshold in
// lib/metadata-lookup/service.ts:autoApplyMetadata.
export function similarityScore(query: string, candidate: string): number {
  const tokenize = (value: string) => new Set(value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean));
  const queryTokens = tokenize(query);
  const candidateTokens = tokenize(candidate);
  if (!queryTokens.size || !candidateTokens.size) return 0;
  let overlap = 0;
  for (const token of queryTokens) if (candidateTokens.has(token)) overlap += 1;
  return Math.round((overlap / Math.max(queryTokens.size, candidateTokens.size)) * 100);
}

// Tiny in-process cache so a title that gets looked up repeatedly (a resync re-triggering
// autoApplyMetadata's caller, or several videos sharing a title) doesn't re-hit the network every time.
// Module-level (not globalThis) is fine here -- unlike lib/jobs/runner.ts's worker state, this is a pure
// cache with no correctness requirement to survive a hot reload, and losing it just means one extra
// network round-trip.
const CACHE_TTL_MS = 6 * 60 * 60_000;
const CACHE_LIMIT = 500;
const cache = new Map<string, { expiresAt: number; value: unknown }>();

export async function withProviderCache<T>(key: string, load: () => Promise<T>): Promise<T> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value as T;
  const value = await load();
  if (cache.size >= CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  return value;
}
