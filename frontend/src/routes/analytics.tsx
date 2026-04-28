import { Link, createFileRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '~/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
import {
  fetchDashboardAggregates,
  getBackendSources,
  selectionToProcessedBy,
  selectionToSourceId,
  type AggregateBucketKey,
  type AggregateRangeKey,
  type AggregateSeriesPoint,
  type BackendSelection,
  type DashboardAggregateSnapshot,
  type HourDistributionRow,
  type WeekdayDistributionRow,
} from '~/lib/api';

const RANGE_OPTIONS: Array<{ value: AggregateRangeKey; label: string }> = [
  { value: '24h', label: 'Last 24 Hours' },
  { value: '7d', label: 'Last 7 Days' },
  { value: '30d', label: 'Last 30 Days' },
  { value: '365d', label: 'Last 365 Days' },
  { value: '5y', label: 'Last 5 Years' },
];

const BUCKET_OPTIONS: Array<{ value: AggregateBucketKey; label: string }> = [
  { value: '1h', label: '1 Hour Buckets' },
  { value: '1d', label: '1 Day Buckets' },
  { value: '1m', label: '1 Month Buckets' },
  { value: '1y', label: '1 Year Buckets' },
];

const TOP_N_OPTIONS = [5, 8, 12, 20];
const REFRESH_OPTIONS: Array<{ label: string; value: number }> = [
  { label: 'Manual', value: 0 },
  { label: '5s', value: 5000 },
  { label: '15s', value: 15000 },
  { label: '30s', value: 30000 },
  { label: '60s', value: 60000 },
];

export const Route = createFileRoute('/analytics')({
  component: AnalyticsPage,
});

export function AnalyticsPage() {
  const backendSources = useMemo(() => getBackendSources(), []);
  const [selection, setSelection] = useState<BackendSelection>('all');
  const [rangeKey, setRangeKey] = useState<AggregateRangeKey>('30d');
  const [bucketKey, setBucketKey] = useState<AggregateBucketKey>('1d');
  const [topN, setTopN] = useState<number>(8);
  const [refreshMs, setRefreshMs] = useState<number>(15000);
  const [showMovingAverage, setShowMovingAverage] = useState<boolean>(false);
  const [snapshot, setSnapshot] = useState<DashboardAggregateSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [lastSuccessAt, setLastSuccessAt] = useState<string | null>(null);
  const [lastErrorAt, setLastErrorAt] = useState<string | null>(null);
  const [lastLoadMs, setLastLoadMs] = useState<number | null>(null);
  const [loadingElapsedMs, setLoadingElapsedMs] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;
    let refreshTimer: ReturnType<typeof setInterval> | null = null;
    let loadTimer: ReturnType<typeof setInterval> | null = null;
    let loadStartMs = 0;

    const startLoadTimer = () => {
      loadStartMs = performance.now();

      if (mounted) {
        setLoadingElapsedMs(0);
      }

      if (loadTimer) {
        clearInterval(loadTimer);
      }

      loadTimer = setInterval(() => {
        if (mounted) {
          setLoadingElapsedMs(performance.now() - loadStartMs);
        }
      }, 100);
    };

    const stopLoadTimer = (didSucceed: boolean) => {
      if (loadTimer) {
        clearInterval(loadTimer);
        loadTimer = null;
      }

      if (mounted) {
        setLoadingElapsedMs(null);

        if (didSucceed) {
          setLastLoadMs(performance.now() - loadStartMs);
        }
      }
    };

    const load = async () => {
      setIsLoading(true);
      startLoadTimer();
      let didSucceed = false;

      try {
        const nextSnapshot = await fetchDashboardAggregates({
          sourceId: selectionToSourceId(selection),
          processedBy: selectionToProcessedBy(selection),
          rangeKey,
          bucketKey,
          topN,
        });

        if (mounted) {
          setSnapshot(nextSnapshot);
          setLastSuccessAt(new Date().toISOString());
        }
        didSucceed = true;
      } catch (_error) {
        if (mounted) {
          setLastErrorAt(new Date().toISOString());
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
        stopLoadTimer(didSucceed);
      }
    };

    void load();

    if (refreshMs > 0) {
      refreshTimer = setInterval(() => {
        void load();
      }, refreshMs);
    }

    return () => {
      mounted = false;

      if (refreshTimer) {
        clearInterval(refreshTimer);
      }

      if (loadTimer) {
        clearInterval(loadTimer);
      }
    };
  }, [bucketKey, rangeKey, refreshMs, selection, topN]);

  const peakPoint = useMemo(() => {
    const points = snapshot?.series ?? [];

    return points.reduce<AggregateSeriesPoint | null>((currentPeak, point) => {
      if (!currentPeak || point.count > currentPeak.count) {
        return point;
      }

      return currentPeak;
    }, null);
  }, [snapshot?.series]);

  const loadTimeLabel =
    loadingElapsedMs !== null
      ? `Loading: ${formatDuration(loadingElapsedMs)}`
      : lastLoadMs !== null
      ? `Last load: ${formatDuration(lastLoadMs)}`
      : null;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-8">
      <header className="animate-floatIn">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Link
            to="/"
            className="rounded-full border border-border/80 bg-white/70 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-foreground transition hover:bg-white"
          >
            Realtime Dashboard
          </Link>
          <Badge variant="outline">Historical Analytics</Badge>
        </div>

        <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">
          Event Intelligence Studio
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-muted-foreground sm:text-base">
          Explore database event patterns with configurable aggregation windows, flexible bucket sizes,
          and rollups for events per 1h, 1d, 1m, and 1y.
        </p>
      </header>

      <section className="animate-floatIn rounded-xl border border-border/70 bg-card/80 p-4 shadow-glass [animation-delay:70ms] sm:p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          <label className="space-y-2 text-xs uppercase tracking-wide text-muted-foreground">
            Backend Scope
            <select
              className="w-full rounded-lg border border-border/80 bg-white/75 px-3 py-2 text-sm font-medium text-foreground"
              value={selection}
              onChange={(event) => setSelection(event.target.value)}
            >
              <option value="all">all-instances</option>
              {backendSources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.label}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2 text-xs uppercase tracking-wide text-muted-foreground">
            Time Range
            <select
              className="w-full rounded-lg border border-border/80 bg-white/75 px-3 py-2 text-sm font-medium text-foreground"
              value={rangeKey}
              onChange={(event) => setRangeKey(event.target.value as AggregateRangeKey)}
            >
              {RANGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2 text-xs uppercase tracking-wide text-muted-foreground">
            Bucket Granularity
            <select
              className="w-full rounded-lg border border-border/80 bg-white/75 px-3 py-2 text-sm font-medium text-foreground"
              value={bucketKey}
              onChange={(event) => setBucketKey(event.target.value as AggregateBucketKey)}
            >
              {BUCKET_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2 text-xs uppercase tracking-wide text-muted-foreground">
            Top-N Categories
            <select
              className="w-full rounded-lg border border-border/80 bg-white/75 px-3 py-2 text-sm font-medium text-foreground"
              value={topN}
              onChange={(event) => setTopN(Number(event.target.value))}
            >
              {TOP_N_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  Top {value}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2 text-xs uppercase tracking-wide text-muted-foreground">
            Refresh
            <select
              className="w-full rounded-lg border border-border/80 bg-white/75 px-3 py-2 text-sm font-medium text-foreground"
              value={refreshMs}
              onChange={(event) => setRefreshMs(Number(event.target.value))}
            >
              {REFRESH_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 rounded-lg border border-border/80 bg-white/70 px-3 py-2 text-sm font-medium text-foreground">
            <input
              className="size-4 rounded border-border text-primary focus:ring-primary"
              type="checkbox"
              checked={showMovingAverage}
              onChange={(event) => setShowMovingAverage(event.target.checked)}
            />
            Moving Average
          </label>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard
          title="Total Events"
          value={snapshot?.total_events ?? 0}
          hint={`Range ${rangeKey} in ${bucketKey} buckets`}
        />
        <MetricCard
          title="Unique Users"
          value={snapshot?.unique_users ?? 0}
          hint="Distinct user_id count"
        />
        <MetricCard
          title="Avg / Bucket"
          value={snapshot?.average_events_per_bucket ?? 0}
          hint="Mean events per selected bucket"
        />
        <MetricCard
          title="Previous Period"
          value={snapshot?.previous_period_total_events ?? 0}
          hint="Same duration immediately before"
        />
        <MetricCard
          title="Delta vs Previous"
          value={formatDelta(snapshot?.delta_percentage_vs_previous ?? null)}
          hint="Growth compared to previous range"
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-6">
        <Card className="animate-floatIn lg:col-span-4 [animation-delay:110ms]">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>Event Volume Trend</CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{bucketKey}</Badge>
                <Badge variant="secondary">{rangeKey}</Badge>
                {isLoading ? <Badge variant="outline">loading</Badge> : null}
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            <AggregateSeriesChart
              points={snapshot?.series ?? []}
              bucketKey={bucketKey}
              showMovingAverage={showMovingAverage}
            />

            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span>
                Peak bucket:{' '}
                {peakPoint
                  ? `${peakPoint.count.toLocaleString()} at ${formatBucketLabel(peakPoint.bucket_start, bucketKey)}`
                  : 'n/a'}
              </span>
              {loadTimeLabel ? <span>{loadTimeLabel}</span> : null}
              {lastSuccessAt ? (
                <span>Last updated at {new Date(lastSuccessAt).toLocaleTimeString()}</span>
              ) : null}
              {lastErrorAt ? (
                <span>Last refresh error at {new Date(lastErrorAt).toLocaleTimeString()}</span>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card className="animate-floatIn lg:col-span-2 [animation-delay:140ms]">
          <CardHeader>
            <CardTitle>Events by Type</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(snapshot?.event_type_distribution ?? []).length === 0 ? (
              <p className="text-muted-foreground">No event type data in this range.</p>
            ) : (
              (snapshot?.event_type_distribution ?? []).map((row) => (
                <DistributionBar
                  key={row.event_type}
                  label={row.event_type}
                  value={row.count}
                  maxValue={snapshot?.event_type_distribution[0]?.count ?? 1}
                  hue="bg-sky-500/80"
                />
              ))
            )}
          </CardContent>
        </Card>

        <Card className="animate-floatIn lg:col-span-2 [animation-delay:170ms]">
          <CardHeader>
            <CardTitle>Events by Topic</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(snapshot?.topic_distribution ?? []).length === 0 ? (
              <p className="text-muted-foreground">No topic distribution data.</p>
            ) : (
              (snapshot?.topic_distribution ?? []).map((row) => (
                <DistributionBar
                  key={row.kafka_topic}
                  label={row.kafka_topic}
                  value={row.count}
                  maxValue={snapshot?.topic_distribution[0]?.count ?? 1}
                  hue="bg-amber-500/80"
                />
              ))
            )}
          </CardContent>
        </Card>

        <Card className="animate-floatIn lg:col-span-2 [animation-delay:200ms]">
          <CardHeader>
            <CardTitle>Events by Backend Instance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(snapshot?.instance_distribution ?? []).length === 0 ? (
              <p className="text-muted-foreground">No instance data in this scope.</p>
            ) : (
              (snapshot?.instance_distribution ?? []).map((row) => (
                <DistributionBar
                  key={row.processed_by}
                  label={row.processed_by}
                  value={row.count}
                  maxValue={snapshot?.instance_distribution[0]?.count ?? 1}
                  hue="bg-emerald-500/80"
                />
              ))
            )}
          </CardContent>
        </Card>

        <Card className="animate-floatIn lg:col-span-2 [animation-delay:220ms]">
          <CardHeader>
            <CardTitle>Weekday Pattern</CardTitle>
          </CardHeader>
          <CardContent>
            <TemporalHeatStrip
              rows={snapshot?.weekday_distribution ?? []}
              labelForKey={(row) => row.label}
              keyForRow={(row) => row.weekday}
              valueForRow={(row) => row.count}
            />
          </CardContent>
        </Card>

        <Card className="animate-floatIn lg:col-span-6 [animation-delay:240ms]">
          <CardHeader>
            <CardTitle>Hourly Pattern (0-23)</CardTitle>
          </CardHeader>
          <CardContent>
            <TemporalHeatStrip
              rows={snapshot?.hour_distribution ?? []}
              labelForKey={(row) => `${row.hour.toString().padStart(2, '0')}:00`}
              keyForRow={(row) => row.hour}
              valueForRow={(row) => row.count}
              columns={12}
            />
          </CardContent>
        </Card>

        <Card className="animate-floatIn lg:col-span-3 [animation-delay:260ms]">
          <CardHeader>
            <CardTitle>Cumulative Events</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <CumulativeSeriesChart points={snapshot?.series ?? []} bucketKey={bucketKey} />
          </CardContent>
        </Card>

        <Card className="animate-floatIn lg:col-span-3 [animation-delay:280ms]">
          <CardHeader>
            <CardTitle>Bucket Momentum</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <BucketDeltaChart points={snapshot?.series ?? []} bucketKey={bucketKey} />
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

type MetricCardProps = {
  title: string;
  value: number | string;
  hint: string;
};

function MetricCard({ title, value, hint }: MetricCardProps) {
  return (
    <Card className="animate-floatIn [animation-delay:90ms]">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="font-display text-3xl font-bold tracking-tight text-foreground">
          {typeof value === 'number' ? value.toLocaleString() : value}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

type AggregateSeriesChartProps = {
  points: AggregateSeriesPoint[];
  bucketKey: AggregateBucketKey;
  showMovingAverage: boolean;
};

function AggregateSeriesChart({ points, bucketKey, showMovingAverage }: AggregateSeriesChartProps) {
  const shape = useMemo(() => createSeriesShape(points), [points]);
  const movingAverageShape = useMemo(() => {
    if (!showMovingAverage) {
      return null;
    }

    return createSeriesShape(calculateMovingAverage(points, 7));
  }, [points, showMovingAverage]);

  if (points.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center rounded-lg border border-border/60 bg-white/45 text-muted-foreground">
        Waiting for aggregate samples...
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <svg
        className="h-56 w-full rounded-lg border border-border/60 bg-white/45"
        viewBox={`0 0 ${shape.width} ${shape.height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Aggregate events trend"
      >
        <defs>
          <linearGradient id="aggregate-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(14, 116, 144, 0.34)" />
            <stop offset="100%" stopColor="rgba(14, 116, 144, 0.06)" />
          </linearGradient>
        </defs>

        <path d={shape.areaPath} fill="url(#aggregate-fill)" />
        <path d={shape.linePath} fill="none" stroke="rgb(14, 116, 144)" strokeWidth="2.8" />

        {movingAverageShape ? (
          <path
            d={movingAverageShape.linePath}
            fill="none"
            stroke="rgb(245, 158, 11)"
            strokeWidth="2"
            strokeDasharray="6 5"
          />
        ) : null}
      </svg>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{formatBucketLabel(points[0]?.bucket_start ?? '', bucketKey)}</span>
        <span>
          peak {shape.maxValue.toLocaleString()} / bucket, current{' '}
          {points[points.length - 1]?.count.toLocaleString() ?? 0}
        </span>
        <span>{formatBucketLabel(points[points.length - 1]?.bucket_start ?? '', bucketKey)}</span>
      </div>
    </div>
  );
}

type CumulativeSeriesChartProps = {
  points: AggregateSeriesPoint[];
  bucketKey: AggregateBucketKey;
};

function CumulativeSeriesChart({ points, bucketKey }: CumulativeSeriesChartProps) {
  const cumulativePoints = useMemo(() => calculateCumulativeSeries(points), [points]);
  const shape = useMemo(() => createSeriesShape(cumulativePoints), [cumulativePoints]);

  if (points.length === 0) {
    return (
      <div className="flex h-52 items-center justify-center rounded-lg border border-border/60 bg-white/45 text-muted-foreground">
        Waiting for cumulative samples...
      </div>
    );
  }

  const total = cumulativePoints[cumulativePoints.length - 1]?.count ?? 0;

  return (
    <div className="space-y-2">
      <svg
        className="h-52 w-full rounded-lg border border-border/60 bg-white/45"
        viewBox={`0 0 ${shape.width} ${shape.height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Cumulative events trend"
      >
        <defs>
          <linearGradient id="cumulative-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(16, 185, 129, 0.35)" />
            <stop offset="100%" stopColor="rgba(16, 185, 129, 0.06)" />
          </linearGradient>
        </defs>

        <path d={shape.areaPath} fill="url(#cumulative-fill)" />
        <path d={shape.linePath} fill="none" stroke="rgb(16, 185, 129)" strokeWidth="2.8" />
      </svg>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{formatBucketLabel(points[0]?.bucket_start ?? '', bucketKey)}</span>
        <span>Total {total.toLocaleString()}</span>
        <span>{formatBucketLabel(points[points.length - 1]?.bucket_start ?? '', bucketKey)}</span>
      </div>
    </div>
  );
}

type BucketDeltaChartProps = {
  points: AggregateSeriesPoint[];
  bucketKey: AggregateBucketKey;
};

function BucketDeltaChart({ points, bucketKey }: BucketDeltaChartProps) {
  const chart = useMemo(() => createDeltaShape(points), [points]);

  if (points.length === 0) {
    return (
      <div className="flex h-52 items-center justify-center rounded-lg border border-border/60 bg-white/45 text-muted-foreground">
        Waiting for momentum samples...
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <svg
        className="h-52 w-full rounded-lg border border-border/60 bg-white/45"
        viewBox={`0 0 ${chart.width} ${chart.height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Events per bucket change"
      >
        <line
          x1={chart.xPadding}
          x2={chart.width - chart.xPadding}
          y1={chart.baseline}
          y2={chart.baseline}
          stroke="rgba(15, 23, 42, 0.25)"
          strokeDasharray="6 5"
        />
        {chart.bars.map((bar, index) => (
          <rect
            key={`${bar.x}-${index}`}
            x={bar.x}
            y={bar.y}
            width={bar.width}
            height={bar.height}
            fill={bar.isPositive ? 'rgba(16, 185, 129, 0.75)' : 'rgba(244, 63, 94, 0.7)'}
            rx={2}
          />
        ))}
      </svg>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{formatBucketLabel(points[0]?.bucket_start ?? '', bucketKey)}</span>
        <span>max swing {chart.maxAbs.toLocaleString()}</span>
        <span>last change {formatSignedCount(chart.lastDelta)}</span>
      </div>
    </div>
  );
}

type DistributionBarProps = {
  label: string;
  value: number;
  maxValue: number;
  hue: string;
};

function DistributionBar({ label, value, maxValue, hue }: DistributionBarProps) {
  const normalizedMax = maxValue > 0 ? maxValue : 1;
  const widthPercentage = Math.max((value / normalizedMax) * 100, 4);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="truncate font-mono text-foreground">{label}</span>
        <span className="text-muted-foreground">{value.toLocaleString()}</span>
      </div>
      <div className="h-2 rounded-full bg-muted/80">
        <div className={`h-full rounded-full ${hue}`} style={{ width: `${widthPercentage}%` }} />
      </div>
    </div>
  );
}

type TemporalHeatStripProps<T extends WeekdayDistributionRow | HourDistributionRow> = {
  rows: T[];
  labelForKey: (row: T) => string;
  keyForRow: (row: T) => number;
  valueForRow: (row: T) => number;
  columns?: number;
};

function TemporalHeatStrip<T extends WeekdayDistributionRow | HourDistributionRow>({
  rows,
  labelForKey,
  keyForRow,
  valueForRow,
  columns = 7,
}: TemporalHeatStripProps<T>) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground">No temporal distribution available.</p>;
  }

  const maxValue = rows.reduce((currentMax, row) => Math.max(currentMax, valueForRow(row)), 0);
  const normalizedMax = maxValue > 0 ? maxValue : 1;

  return (
    <div className={`grid gap-2 ${columns === 12 ? 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-6' : 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-7'}`}>
      {rows.map((row) => {
        const value = valueForRow(row);
        const ratio = value / normalizedMax;
        const alpha = 0.15 + ratio * 0.75;

        return (
          <div
            key={keyForRow(row)}
            className="space-y-1 rounded-md border border-border/70 px-2.5 py-2"
            style={{ backgroundColor: `rgba(14, 116, 144, ${alpha.toFixed(3)})` }}
          >
            <div className="text-[11px] font-semibold uppercase tracking-wide text-white/95">
              {labelForKey(row)}
            </div>
            <div className="font-mono text-xs text-white/95">{value.toLocaleString()} events</div>
          </div>
        );
      })}
    </div>
  );
}

type SeriesShape = {
  width: number;
  height: number;
  linePath: string;
  areaPath: string;
  maxValue: number;
};

function createSeriesShape(points: AggregateSeriesPoint[]): SeriesShape {
  const width = 1100;
  const height = 260;
  const xPadding = 20;
  const yPadding = 20;
  const maxValue = Math.max(
    1,
    ...points.map((point) => {
      return point.count;
    }),
  );

  const xRange = Math.max(width - xPadding * 2, 1);
  const yRange = Math.max(height - yPadding * 2, 1);
  const denominator = Math.max(points.length - 1, 1);

  const coordinates = points.map((point, index) => {
    const x = xPadding + (xRange * index) / denominator;
    const ratio = point.count / maxValue;
    const y = yPadding + (1 - ratio) * yRange;

    return { x, y };
  });

  const linePath = coordinates
    .map((coordinate, index) => `${index === 0 ? 'M' : 'L'} ${coordinate.x.toFixed(2)} ${coordinate.y.toFixed(2)}`)
    .join(' ');

  const firstCoordinate = coordinates[0] ?? { x: xPadding, y: height - yPadding };
  const lastCoordinate = coordinates[coordinates.length - 1] ?? firstCoordinate;
  const areaPath = `${linePath} L ${lastCoordinate.x.toFixed(2)} ${(height - yPadding).toFixed(2)} L ${firstCoordinate.x.toFixed(2)} ${(height - yPadding).toFixed(2)} Z`;

  return {
    width,
    height,
    linePath,
    areaPath,
    maxValue,
  };
}

type DeltaBar = {
  x: number;
  y: number;
  width: number;
  height: number;
  isPositive: boolean;
};

type DeltaShape = {
  width: number;
  height: number;
  baseline: number;
  maxAbs: number;
  lastDelta: number;
  bars: DeltaBar[];
  xPadding: number;
};

function createDeltaShape(points: AggregateSeriesPoint[]): DeltaShape {
  const width = 1100;
  const height = 240;
  const xPadding = 24;
  const yPadding = 24;
  const deltas = points.map((point, index) => {
    const previous = points[index - 1];
    return previous ? point.count - previous.count : 0;
  });
  const maxAbs = Math.max(1, ...deltas.map((value) => Math.abs(value)));
  const barCount = Math.max(deltas.length, 1);
  const slotWidth = (width - xPadding * 2) / barCount;
  const barWidth = Math.max(slotWidth * 0.82, 1);
  const usableHalf = Math.max((height - yPadding * 2) / 2, 1);
  const baseline = yPadding + usableHalf;

  const bars = deltas.map((delta, index) => {
    const magnitude = Math.abs(delta);
    const barHeight = (magnitude / maxAbs) * usableHalf;
    const x = xPadding + index * slotWidth + (slotWidth - barWidth) / 2;
    const y = delta >= 0 ? baseline - barHeight : baseline;

    return {
      x,
      y,
      width: barWidth,
      height: barHeight,
      isPositive: delta >= 0,
    };
  });

  return {
    width,
    height,
    baseline,
    maxAbs,
    lastDelta: deltas[deltas.length - 1] ?? 0,
    bars,
    xPadding,
  };
}

function calculateCumulativeSeries(points: AggregateSeriesPoint[]): AggregateSeriesPoint[] {
  let total = 0;

  return points.map((point) => {
    total += point.count;
    return {
      bucket_start: point.bucket_start,
      count: total,
    };
  });
}

function calculateMovingAverage(
  points: AggregateSeriesPoint[],
  windowSize: number,
): AggregateSeriesPoint[] {
  if (points.length <= 2 || windowSize <= 1) {
    return points;
  }

  const result: AggregateSeriesPoint[] = [];

  for (let index = 0; index < points.length; index += 1) {
    const start = Math.max(index - windowSize + 1, 0);
    const window = points.slice(start, index + 1);
    const sum = window.reduce((currentSum, point) => currentSum + point.count, 0);

    result.push({
      bucket_start: points[index]?.bucket_start ?? '',
      count: Number((sum / window.length).toFixed(2)),
    });
  }

  return result;
}

function formatSignedCount(value: number): string {
  const rounded = Math.round(value);
  const prefix = rounded >= 0 ? '+' : '';
  return `${prefix}${rounded.toLocaleString()}`;
}

function formatBucketLabel(value: string, bucketKey: AggregateBucketKey): string {
  if (!value) {
    return '-';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  if (bucketKey === '1h') {
    return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  if (bucketKey === '1d') {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  if (bucketKey === '1m') {
    return date.toLocaleDateString([], { month: 'short', year: 'numeric' });
  }

  return date.getFullYear().toString();
}

function formatDelta(value: number | null): string {
  if (value === null) {
    return 'n/a';
  }

  const prefix = value >= 0 ? '+' : '';
  return `${prefix}${value.toFixed(2)}%`;
}

function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return '-';
  }

  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`;
  }

  if (durationMs < 10000) {
    return `${(durationMs / 1000).toFixed(2)}s`;
  }

  return `${(durationMs / 1000).toFixed(1)}s`;
}
