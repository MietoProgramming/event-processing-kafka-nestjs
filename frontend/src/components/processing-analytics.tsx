import { useEffect, useMemo, useState } from 'react';
import {
    fetchDashboardAnalytics,
    selectionToProcessedBy,
    selectionToSourceId,
    type BackendSelection,
    type DashboardAnalyticsSnapshot,
    type ThroughputPoint,
} from '~/lib/api';
import { Badge } from './ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

type ProcessingAnalyticsProps = {
  selection: BackendSelection;
  windowMinutes: number;
  bucketSeconds: number;
};

export function ProcessingAnalytics({
  selection,
  windowMinutes,
  bucketSeconds,
}: ProcessingAnalyticsProps) {
  const [snapshot, setSnapshot] = useState<DashboardAnalyticsSnapshot | null>(null);
  const [lastErrorAt, setLastErrorAt] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const nextSnapshot = await fetchDashboardAnalytics({
          sourceId: selectionToSourceId(selection),
          processedBy: selectionToProcessedBy(selection),
          windowMinutes,
          bucketSeconds,
        });

        if (mounted) {
          setSnapshot(nextSnapshot);
        }
      } catch (_error) {
        if (mounted) {
          setLastErrorAt(new Date().toISOString());
        }
      }
    };

    void load();
    const timer = setInterval(() => {
      void load();
    }, 2000);

    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [selection, windowMinutes, bucketSeconds]);

  return (
    <section className="grid gap-6 lg:grid-cols-6">
      <Card className="animate-floatIn lg:col-span-4 [animation-delay:100ms]">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>Throughput Trend</CardTitle>
            <Badge variant="outline">{windowMinutes}m window</Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <ThroughputChart points={snapshot?.throughput ?? []} />
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span>Total in window: {(snapshot?.total_events_in_window ?? 0).toLocaleString()}</span>
            <span>Bucket: {bucketSeconds}s</span>
            {lastErrorAt ? <span>Last refresh error at {new Date(lastErrorAt).toLocaleTimeString()}</span> : null}
          </div>
        </CardContent>
      </Card>

      <Card className="animate-floatIn lg:col-span-2 [animation-delay:180ms]">
        <CardHeader>
          <CardTitle>Event Types</CardTitle>
        </CardHeader>

        <CardContent className="space-y-3">
          {(snapshot?.event_type_distribution ?? []).length === 0 ? (
            <p className="text-muted-foreground">Waiting for event type samples...</p>
          ) : (
            snapshot?.event_type_distribution.map((row) => (
              <DistributionBar
                key={row.event_type}
                label={row.event_type}
                value={row.count}
                maxValue={snapshot.event_type_distribution[0]?.count ?? 1}
                hue="bg-sky-500/75"
              />
            ))
          )}
        </CardContent>
      </Card>

      <Card className="animate-floatIn lg:col-span-2 [animation-delay:220ms]">
        <CardHeader>
          <CardTitle>Kafka Topics</CardTitle>
        </CardHeader>

        <CardContent className="space-y-3">
          {(snapshot?.topic_distribution ?? []).length === 0 ? (
            <p className="text-muted-foreground">Waiting for topic samples...</p>
          ) : (
            snapshot?.topic_distribution.map((row) => (
              <DistributionBar
                key={row.kafka_topic}
                label={row.kafka_topic}
                value={row.count}
                maxValue={snapshot.topic_distribution[0]?.count ?? 1}
                hue="bg-amber-500/75"
              />
            ))
          )}
        </CardContent>
      </Card>

      <Card className="animate-floatIn lg:col-span-2 [animation-delay:240ms]">
        <CardHeader>
          <CardTitle>Kafka Partition Load</CardTitle>
        </CardHeader>

        <CardContent className="space-y-3">
          {(snapshot?.partition_distribution ?? []).length === 0 ? (
            <p className="text-muted-foreground">No partition traffic in this window.</p>
          ) : (
            snapshot?.partition_distribution.map((row) => (
              <DistributionBar
                key={`${row.kafka_topic}-${row.kafka_partition}`}
                label={`${row.kafka_topic} / p${row.kafka_partition}`}
                value={row.count}
                maxValue={snapshot.partition_distribution.reduce(
                  (currentMax, currentRow) => Math.max(currentMax, currentRow.count),
                  0,
                )}
                hue="bg-emerald-500/75"
              />
            ))
          )}
        </CardContent>
      </Card>

      <Card className="animate-floatIn lg:col-span-2 [animation-delay:260ms]">
        <CardHeader>
          <CardTitle>Partition Ownership Matrix</CardTitle>
        </CardHeader>

        <CardContent className="space-y-3">
          {(snapshot?.partition_ownership ?? []).length === 0 ? (
            <p className="text-muted-foreground">Ownership data will appear once events are consumed.</p>
          ) : (
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {snapshot?.partition_ownership.map((row) => (
                <div
                  key={`${row.kafka_topic}-${row.kafka_partition}-${row.processed_by}`}
                  className="grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded-md border border-border/60 bg-white/50 px-2.5 py-1.5 text-[11px]"
                >
                  <Badge variant="secondary" className="font-mono text-[10px]">
                    {row.kafka_topic}
                  </Badge>
                  <span className="truncate font-mono text-foreground">
                    p{row.kafka_partition} / {row.processed_by}
                  </span>
                  <strong className="font-mono text-xs">{row.count.toLocaleString()}</strong>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

type ThroughputChartProps = {
  points: ThroughputPoint[];
};

function ThroughputChart({ points }: ThroughputChartProps) {
  const chart = useMemo(() => createThroughputPath(points), [points]);

  if (points.length === 0) {
    return (
      <div className="flex h-44 items-center justify-center rounded-lg border border-border/60 bg-white/45 text-muted-foreground">
        Waiting for throughput samples...
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <svg
        className="h-44 w-full rounded-lg border border-border/60 bg-white/45"
        viewBox={`0 0 ${chart.width} ${chart.height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Events throughput trend"
      >
        <defs>
          <linearGradient id="throughput-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(2, 132, 199, 0.35)" />
            <stop offset="100%" stopColor="rgba(2, 132, 199, 0.05)" />
          </linearGradient>
        </defs>

        <path d={chart.areaPath} fill="url(#throughput-fill)" />
        <path d={chart.linePath} fill="none" stroke="rgb(2, 132, 199)" strokeWidth="2.8" />
      </svg>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{new Date(points[0].bucket_start).toLocaleTimeString()}</span>
        <span>
          peak {chart.maxValue.toLocaleString()} / bucket, current {points[points.length - 1]?.count ?? 0}
        </span>
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

type ThroughputShape = {
  width: number;
  height: number;
  linePath: string;
  areaPath: string;
  maxValue: number;
};

function createThroughputPath(points: ThroughputPoint[]): ThroughputShape {
  const width = 900;
  const height = 240;
  const xPadding = 20;
  const yPadding = 22;
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
