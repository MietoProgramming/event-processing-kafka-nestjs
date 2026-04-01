export type LatestEvent = {
  id: string;
  user_id: string;
  event_type: string;
  processed_by: string;
  kafka_partition: number;
  kafka_topic: string;
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

export type ThroughputPoint = {
  bucket_start: string;
  count: number;
};

export type EventTypeDistributionRow = {
  event_type: string;
  count: number;
};

export type TopicDistributionRow = {
  kafka_topic: string;
  count: number;
};

export type PartitionDistributionRow = {
  kafka_topic: string;
  kafka_partition: number;
  count: number;
};

export type InstanceDistributionRow = {
  processed_by: string;
  count: number;
};

export type PartitionOwnershipRow = {
  kafka_topic: string;
  kafka_partition: number;
  processed_by: string;
  count: number;
};

export type DashboardAnalyticsSnapshot = {
  generated_at: string;
  window_minutes: number;
  bucket_seconds: number;
  processed_by_filter: string | null;
  total_events_in_window: number;
  throughput: ThroughputPoint[];
  event_type_distribution: EventTypeDistributionRow[];
  topic_distribution: TopicDistributionRow[];
  partition_distribution: PartitionDistributionRow[];
  instance_distribution: InstanceDistributionRow[];
  partition_ownership: PartitionOwnershipRow[];
};

export type AggregateRangeKey = '24h' | '7d' | '30d' | '365d' | '5y';
export type AggregateBucketKey = '1h' | '1d' | '1m' | '1y';

export type AggregateSeriesPoint = {
  bucket_start: string;
  count: number;
};

export type WeekdayDistributionRow = {
  weekday: number;
  label: string;
  count: number;
};

export type HourDistributionRow = {
  hour: number;
  count: number;
};

export type DashboardAggregateSnapshot = {
  generated_at: string;
  range_key: AggregateRangeKey;
  bucket_key: AggregateBucketKey;
  top_n: number;
  processed_by_filter: string | null;
  total_events: number;
  previous_period_total_events: number;
  delta_percentage_vs_previous: number | null;
  unique_users: number;
  average_events_per_bucket: number;
  series: AggregateSeriesPoint[];
  event_type_distribution: EventTypeDistributionRow[];
  topic_distribution: TopicDistributionRow[];
  instance_distribution: InstanceDistributionRow[];
  weekday_distribution: WeekdayDistributionRow[];
  hour_distribution: HourDistributionRow[];
};

export type BackendSource = {
  id: string;
  label: string;
  baseUrl: string;
};

export type BackendSelection = 'all' | string;

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001/api';
const API_FALLBACK = import.meta.env.VITE_API_BASE_URL_FALLBACK ?? 'http://localhost:3002/api';
const API_INSTANCES = import.meta.env.VITE_API_INSTANCES as string | undefined;
const API_BASE_LABEL = (import.meta.env.VITE_API_BASE_LABEL as string | undefined) ?? 'backend-1';
const API_FALLBACK_LABEL =
  (import.meta.env.VITE_API_FALLBACK_LABEL as string | undefined) ?? 'backend-2';

const BACKEND_SOURCES: BackendSource[] = resolveBackendSources();

type JsonRequestInit = RequestInit & { timeoutMs?: number };

type LatestEventsRequest = {
  limit?: number;
  processedBy?: string;
  sourceId?: string;
};

type DashboardAnalyticsRequest = {
  windowMinutes?: number;
  bucketSeconds?: number;
  processedBy?: string;
  sourceId?: string;
};

type DashboardAggregateRequest = {
  rangeKey?: AggregateRangeKey;
  bucketKey?: AggregateBucketKey;
  topN?: number;
  processedBy?: string;
  sourceId?: string;
};

type StatsPollingOptions = {
  selection?: BackendSelection;
  intervalMs?: number;
};

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

function resolveBackendSources(): BackendSource[] {
  const parsed = parseBackendSourcesFromEnv(API_INSTANCES);

  if (parsed.length > 0) {
    return parsed;
  }

  const defaultSources: BackendSource[] = [
    {
      id: API_BASE_LABEL,
      label: API_BASE_LABEL,
      baseUrl: normalizeBaseUrl(API_BASE),
    },
    {
      id: API_FALLBACK_LABEL,
      label: API_FALLBACK_LABEL,
      baseUrl: normalizeBaseUrl(API_FALLBACK),
    },
  ];

  return dedupeBackendSources(defaultSources);
}

function parseBackendSourcesFromEnv(rawSources: string | undefined): BackendSource[] {
  if (!rawSources) {
    return [];
  }

  const parsed = rawSources
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry): BackendSource | null => {
      const separatorIndex = entry.indexOf('=');

      if (separatorIndex < 1 || separatorIndex >= entry.length - 1) {
        return null;
      }

      const id = entry.slice(0, separatorIndex).trim();
      const url = entry.slice(separatorIndex + 1).trim();

      if (!id || !url) {
        return null;
      }

      return {
        id,
        label: id,
        baseUrl: normalizeBaseUrl(url),
      };
    })
    .filter((source): source is BackendSource => source !== null)
    .map((source, index) => ({
      ...source,
      id: source.id || `backend-${index + 1}`,
      label: source.label || source.id || `backend-${index + 1}`,
    }));

  return dedupeBackendSources(parsed);
}

function dedupeBackendSources(sources: BackendSource[]): BackendSource[] {
  const seenUrls = new Set<string>();
  const result: BackendSource[] = [];

  for (const source of sources) {
    if (!source.baseUrl || seenUrls.has(source.baseUrl)) {
      continue;
    }

    seenUrls.add(source.baseUrl);
    result.push(source);
  }

  return result.length > 0
    ? result
    : [
        {
          id: 'backend-1',
          label: 'backend-1',
          baseUrl: normalizeBaseUrl(API_BASE),
        },
      ];
}

function normalizeBaseUrl(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function getSourceById(sourceId: string): BackendSource | null {
  return BACKEND_SOURCES.find((source) => source.id === sourceId) ?? null;
}

async function fetchFromSource<T>(path: string, source: BackendSource): Promise<T> {
  return fetchJson<T>(`${source.baseUrl}${path}`);
}

async function withFailover<T>(path: string): Promise<T> {
  let lastError: Error | null = null;

  for (const source of BACKEND_SOURCES) {
    try {
      return await fetchFromSource<T>(path, source);
    } catch (error) {
      lastError = error as Error;
    }
  }

  throw lastError ?? new Error(`No backend source available for ${path}`);
}

function toQueryString(params: URLSearchParams): string {
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}

function resolveProcessedBy(selection: BackendSelection): string | undefined {
  return selection === 'all' ? undefined : selection;
}

function latestTimestampIso(snapshots: StatsSnapshot[]): string | null {
  const latestUnix = snapshots.reduce((currentMax, snapshot) => {
    if (!snapshot.latestEventAt) {
      return currentMax;
    }

    const candidate = Date.parse(snapshot.latestEventAt);
    if (!Number.isFinite(candidate)) {
      return currentMax;
    }

    return Math.max(currentMax, candidate);
  }, 0);

  return latestUnix > 0 ? new Date(latestUnix).toISOString() : null;
}

export function getBackendSources(): BackendSource[] {
  return BACKEND_SOURCES;
}

export async function fetchLatestEvents(options: LatestEventsRequest = {}): Promise<LatestEvent[]> {
  const params = new URLSearchParams();
  params.set('limit', String(options.limit ?? 100));

  if (options.processedBy) {
    params.set('processedBy', options.processedBy);
  }

  const path = `/events/latest${toQueryString(params)}`;
  const source = options.sourceId ? getSourceById(options.sourceId) : null;

  if (source) {
    return fetchFromSource<LatestEvent[]>(path, source);
  }

  return withFailover<LatestEvent[]>(path);
}

export async function fetchStats(sourceId?: string): Promise<StatsSnapshot> {
  const source = sourceId ? getSourceById(sourceId) : null;

  if (source) {
    return fetchFromSource<StatsSnapshot>('/stats', source);
  }

  return withFailover<StatsSnapshot>('/stats');
}

export async function fetchStatsForSelection(selection: BackendSelection): Promise<StatsSnapshot> {
  if (selection !== 'all') {
    return fetchStats(selection);
  }

  const settled = await Promise.allSettled(
    BACKEND_SOURCES.map((source) => fetchFromSource<StatsSnapshot>('/stats', source)),
  );
  const snapshots = settled
    .filter(
      (result): result is PromiseFulfilledResult<StatsSnapshot> => result.status === 'fulfilled',
    )
    .map((result) => result.value);

  if (snapshots.length === 0) {
    throw new Error('Unable to fetch stats from any backend source.');
  }

  const combinedInstanceId = snapshots.map((snapshot) => snapshot.instanceId).join(' + ');

  return {
    instanceId: `all (${combinedInstanceId})`,
    localConsumed: snapshots.reduce((acc, snapshot) => acc + snapshot.localConsumed, 0),
    totalEvents: Math.max(...snapshots.map((snapshot) => snapshot.totalEvents)),
    eventsPerSecond: Math.max(...snapshots.map((snapshot) => snapshot.eventsPerSecond)),
    latestEventAt: latestTimestampIso(snapshots),
  };
}

export async function fetchDashboardAnalytics(
  options: DashboardAnalyticsRequest = {},
): Promise<DashboardAnalyticsSnapshot> {
  const params = new URLSearchParams();
  params.set('windowMinutes', String(options.windowMinutes ?? 15));
  params.set('bucketSeconds', String(options.bucketSeconds ?? 10));

  if (options.processedBy) {
    params.set('processedBy', options.processedBy);
  }

  const path = `/dashboard/analytics${toQueryString(params)}`;
  const source = options.sourceId ? getSourceById(options.sourceId) : null;

  if (source) {
    return fetchFromSource<DashboardAnalyticsSnapshot>(path, source);
  }

  return withFailover<DashboardAnalyticsSnapshot>(path);
}

export async function fetchDashboardAggregates(
  options: DashboardAggregateRequest = {},
): Promise<DashboardAggregateSnapshot> {
  const params = new URLSearchParams();
  params.set('range', options.rangeKey ?? '30d');
  params.set('bucket', options.bucketKey ?? '1d');
  params.set('topN', String(options.topN ?? 8));

  if (options.processedBy) {
    params.set('processedBy', options.processedBy);
  }

  const path = `/dashboard/aggregates${toQueryString(params)}`;
  const source = options.sourceId ? getSourceById(options.sourceId) : null;

  if (source) {
    return fetchFromSource<DashboardAggregateSnapshot>(path, source);
  }

  return withFailover<DashboardAggregateSnapshot>(path);
}

export function startStatsPolling(
  onData: (snapshot: StatsSnapshot) => void,
  options: StatsPollingOptions = {},
): () => void {
  const intervalMs = options.intervalMs ?? 1000;
  const selection = options.selection ?? 'all';

  const timer = setInterval(() => {
    void fetchStatsForSelection(selection).then(onData).catch(() => undefined);
  }, intervalMs);

  void fetchStatsForSelection(selection).then(onData).catch(() => undefined);

  return () => clearInterval(timer);
}

export function subscribeToStats(
  onData: (snapshot: StatsSnapshot) => void,
  onError?: () => void,
  sourceId?: string,
): () => void {
  let eventSource: EventSource | null = null;
  let closed = false;
  const source = sourceId ? getSourceById(sourceId) : BACKEND_SOURCES[0] ?? null;

  if (!source) {
    onError?.();
    return () => undefined;
  }

  if (closed) {
    return () => undefined;
  }

  eventSource = new EventSource(`${source.baseUrl}/stats/stream`);

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
    onError?.();
  };

  return () => {
    closed = true;
    eventSource?.close();
  };
}

export function selectionToSourceId(selection: BackendSelection): string | undefined {
  if (selection === 'all') {
    return undefined;
  }

  return getSourceById(selection)?.id;
}

export function selectionToProcessedBy(selection: BackendSelection): string | undefined {
  return resolveProcessedBy(selection);
}
