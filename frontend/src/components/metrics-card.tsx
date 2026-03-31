import { useEffect, useState } from 'react';
import { fetchStats, startStatsPolling, subscribeToStats, type StatsSnapshot } from '~/lib/api';
import { Badge } from './ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

type StreamMode = 'sse' | 'polling';

export function MetricsCard() {
  const [snapshot, setSnapshot] = useState<StatsSnapshot | null>(null);
  const [streamMode, setStreamMode] = useState<StreamMode>('sse');

  useEffect(() => {
    let stopPolling: (() => void) | null = null;

    const stopSse = subscribeToStats(
      (nextSnapshot) => {
        setSnapshot(nextSnapshot);

        if (stopPolling) {
          stopPolling();
          stopPolling = null;
        }

        setStreamMode('sse');
      },
      () => {
        if (!stopPolling) {
          setStreamMode('polling');
          stopPolling = startStatsPolling(setSnapshot);
        }
      },
    );

    void fetchStats().then(setSnapshot).catch(() => undefined);

    return () => {
      stopSse();
      if (stopPolling) {
        stopPolling();
      }
    };
  }, []);

  return (
    <Card className="animate-floatIn">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Live Kafka Ingestion</CardTitle>
          <Badge variant={streamMode === 'sse' ? 'default' : 'secondary'}>
            {streamMode === 'sse' ? 'SSE' : 'Polling'}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Events/sec" value={snapshot?.eventsPerSecond ?? 0} />
        <Metric label="Total Consumed" value={snapshot?.totalEvents ?? 0} />
        <Metric label="Instance" value={snapshot?.instanceId ?? '-'} mono />
        <Metric label="Local Count" value={snapshot?.localConsumed ?? 0} />
      </CardContent>
    </Card>
  );
}

type MetricProps = {
  label: string;
  value: number | string;
  mono?: boolean;
};

function Metric({ label, value, mono = false }: MetricProps) {
  return (
    <div className="rounded-lg border border-border/70 bg-white/60 px-4 py-3">
      <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={mono ? 'font-mono text-lg font-semibold' : 'font-display text-2xl font-bold'}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
    </div>
  );
}
