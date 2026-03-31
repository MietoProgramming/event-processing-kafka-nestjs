import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { EventsTable } from '~/components/events-table';
import { MetricsCard } from '~/components/metrics-card';
import { ProcessingAnalytics } from '~/components/processing-analytics';
import {
    fetchLatestEvents,
    getBackendSources,
    selectionToProcessedBy,
    selectionToSourceId,
    type BackendSelection,
    type LatestEvent,
} from '~/lib/api';

const WINDOW_MINUTE_OPTIONS = [5, 15, 30, 60];
const BUCKET_SECOND_OPTIONS = [5, 10, 15, 30, 60];

export const Route = createFileRoute('/')({
  component: DashboardPage,
});

export function DashboardPage() {
  const backendSources = useMemo(() => getBackendSources(), []);
  const [selection, setSelection] = useState<BackendSelection>('all');
  const [windowMinutes, setWindowMinutes] = useState<number>(15);
  const [bucketSeconds, setBucketSeconds] = useState<number>(10);
  const [events, setEvents] = useState<LatestEvent[]>([]);

  useEffect(() => {
    let mounted = true;
    const sourceId = selectionToSourceId(selection);
    const processedBy = selectionToProcessedBy(selection);

    const load = async () => {
      try {
        const rows = await fetchLatestEvents({
          limit: 100,
          sourceId,
          processedBy,
        });
        if (mounted) {
          setEvents(rows);
        }
      } catch (_error) {
        // Keep last successful snapshot if one backend instance is restarting.
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
  }, [selection]);

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-8">
      <header className="animate-floatIn">
        <p className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Kafka + NestJS + Drizzle
        </p>
        <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">
          Real-Time Event Processing Dashboard
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-muted-foreground sm:text-base">
          Inspect all processed events with live throughput graphs, partition ownership, event
          distribution, and explicit backend-instance switching for cluster-level debugging.
        </p>
      </header>

      <section className="animate-floatIn rounded-xl border border-border/70 bg-card/80 p-4 shadow-glass [animation-delay:70ms] sm:p-5">
        <div className="grid gap-4 sm:grid-cols-3">
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
            Graph Window
            <select
              className="w-full rounded-lg border border-border/80 bg-white/75 px-3 py-2 text-sm font-medium text-foreground"
              value={windowMinutes}
              onChange={(event) => setWindowMinutes(Number(event.target.value))}
            >
              {WINDOW_MINUTE_OPTIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes} minutes
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2 text-xs uppercase tracking-wide text-muted-foreground">
            Throughput Bucket
            <select
              className="w-full rounded-lg border border-border/80 bg-white/75 px-3 py-2 text-sm font-medium text-foreground"
              value={bucketSeconds}
              onChange={(event) => setBucketSeconds(Number(event.target.value))}
            >
              {BUCKET_SECOND_OPTIONS.map((seconds) => (
                <option key={seconds} value={seconds}>
                  {seconds} seconds
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <MetricsCard selection={selection} />
      <ProcessingAnalytics
        selection={selection}
        windowMinutes={windowMinutes}
        bucketSeconds={bucketSeconds}
      />
      <EventsTable events={events} />
    </main>
  );
}
