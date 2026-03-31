import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { EventsTable } from '~/components/events-table';
import { MetricsCard } from '~/components/metrics-card';
import { fetchLatestEvents, type LatestEvent } from '~/lib/api';

export const Route = createFileRoute('/')({
  component: DashboardPage,
});

export function DashboardPage() {
  const [events, setEvents] = useState<LatestEvent[]>([]);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const rows = await fetchLatestEvents(100);
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
  }, []);

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
          Two backend consumers share the same Kafka consumer group to demonstrate native partition
          balancing while this UI streams live ingestion metrics and the latest persisted events.
        </p>
      </header>

      <MetricsCard />
      <EventsTable events={events} />
    </main>
  );
}
