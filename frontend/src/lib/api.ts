export type LatestEvent = {
  id: string;
  user_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export type StatsSnapshot = {
  instanceId: string;
  localConsumed: number;
  totalEvents: number;
  eventsPerSecond: number;
  latestEventAt: string | null;
};

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001/api';
const API_FALLBACK = import.meta.env.VITE_API_BASE_URL_FALLBACK ?? 'http://localhost:3002/api';

type JsonRequestInit = RequestInit & { timeoutMs?: number };

async function fetchJson<T>(url: string, init: JsonRequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = init.timeoutMs ?? 4000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function withFallback<T>(path: string): Promise<T> {
  try {
    return await fetchJson<T>(`${API_BASE}${path}`);
  } catch (_error) {
    return fetchJson<T>(`${API_FALLBACK}${path}`);
  }
}

export async function fetchLatestEvents(limit = 100): Promise<LatestEvent[]> {
  return withFallback<LatestEvent[]>(`/events/latest?limit=${limit}`);
}

export async function fetchStats(): Promise<StatsSnapshot> {
  return withFallback<StatsSnapshot>('/stats');
}

export function startStatsPolling(
  onData: (snapshot: StatsSnapshot) => void,
  intervalMs = 1000,
): () => void {
  const timer = setInterval(() => {
    void fetchStats().then(onData).catch(() => undefined);
  }, intervalMs);

  void fetchStats().then(onData).catch(() => undefined);

  return () => clearInterval(timer);
}

export function subscribeToStats(
  onData: (snapshot: StatsSnapshot) => void,
  onError?: () => void,
): () => void {
  let eventSource: EventSource | null = null;
  let closed = false;
  let triedFallback = false;

  const open = (baseUrl: string) => {
    if (closed) {
      return;
    }

    eventSource = new EventSource(`${baseUrl}/stats/stream`);

    eventSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as StatsSnapshot;
        onData(parsed);
      } catch (_error) {
        // Ignore malformed SSE payloads and wait for the next message.
      }
    };

    eventSource.onerror = () => {
      eventSource?.close();

      if (!triedFallback) {
        triedFallback = true;
        open(API_FALLBACK);
        return;
      }

      onError?.();
    };
  };

  open(API_BASE);

  return () => {
    closed = true;
    eventSource?.close();
  };
}
