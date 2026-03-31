# Real-Time Event Processing with Kafka, NestJS, Drizzle, and TanStack Start

This repository is a local learning lab for high-throughput event processing:

- Kafka in KRaft mode (Apache Kafka image, no ZooKeeper)
- PostgreSQL 16 with declarative daily partitions
- Kafka UI for topic and consumer-group inspection
- Node.js event generator publishing exactly 1,000 events/second across 3 topics
- Two NestJS backend instances in the same Kafka consumer group (`analytics-consumer`)
- TanStack Start + React dashboard with live stats and latest events table

## Architecture

1. The generator writes to three Kafka topics at fixed rates (700/290/10 events/sec).
2. Each topic uses its own partition key so ordering is preserved per entity key.
3. Two backend containers (`backend-1`, `backend-2`) share the same `groupId` and split partition ownership.
4. Backend services batch-insert events into PostgreSQL `events` table (RANGE partitioned by `created_at`).
5. Frontend reads live stats from SSE and fetches latest 100 rows via REST.
6. Dashboard analytics endpoint powers throughput graphs, partition distribution, event-type distribution, and per-instance ownership views.

## Kafka Topic Strategy

| Topic | Volume pattern | Partition key | Default partitions |
|---|---:|---|---:|
| `events.page_views` | 700 events/sec | `session_id` | 12 |
| `events.clicks` | 290 events/sec | `user_id` | 6 |
| `events.purchases` | 10 events/sec | `order_id` | 3 |

## Project Structure

- `docker-compose.yml`: full local orchestration
- `infra/postgres/init.sql`: partitioned schema + trigger-based partition creation
- `generator/`: high-rate Kafka producer
- `backend/`: NestJS Kafka consumer + REST/SSE API + Drizzle
- `frontend/`: TanStack Start dashboard with shadcn-style UI and TanStack Table

## 1) Start the stack

```bash
docker compose up -d --build
```

Then verify container status:

```bash
docker compose ps
```

## 2) Access services

- Frontend dashboard: http://localhost:5173
- Kafka UI: http://localhost:8080
- Backend 1 API: http://localhost:3001/api
- Backend 2 API: http://localhost:3002/api

Useful API checks:

```bash
curl http://localhost:3001/api/health
curl http://localhost:3001/api/stats
curl http://localhost:3001/api/events/latest?limit=5
curl "http://localhost:3001/api/dashboard/analytics?windowMinutes=15&bucketSeconds=10"
```

You can scope analytics to one backend instance:

```bash
curl "http://localhost:3001/api/dashboard/analytics?windowMinutes=15&bucketSeconds=10&processedBy=backend-1"
```

## 3) Observe Kafka partition load balancing

### In Kafka UI

1. Open `events.page_views`, `events.clicks`, and `events.purchases` and confirm partitions exist for each.
2. Open Consumer Groups and select `analytics-consumer`.
3. Confirm there are two members and partition assignments are split across them.

### In logs

```bash
docker compose logs -f backend-1 backend-2
```

Each backend logs consumed counts periodically. You should see both instances consuming as partitions are assigned.

## 4) Verify PostgreSQL partitioning

Connect to Postgres:

```bash
docker compose exec postgres psql -U postgres -d eventsdb
```

Inspect partitions:

```sql
SELECT
  parent.relname AS parent_table,
  child.relname AS partition_table
FROM pg_inherits
JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
JOIN pg_class child ON pg_inherits.inhrelid = child.oid
WHERE parent.relname = 'events'
ORDER BY partition_table;
```

Check row count:

```sql
SELECT COUNT(*) FROM events;
```

## Implementation Notes

- PostgreSQL trigger `create_daily_events_partition()` creates a day partition at insert time if missing.
- Backend persists `processed_by` and `kafka_partition` metadata per event for partition-aware analytics.
- Backend consumes `events.page_views`, `events.clicks`, and `events.purchases`, and normalizes `event_type` by topic to avoid bad producer payloads.
- Backend metrics endpoint uses database aggregates so stats stay accurate across both backend instances.
- SSE endpoint: `/api/stats/stream`.
- Latest events endpoint: `/api/events/latest?limit=100&processedBy=backend-1`.
- Dashboard analytics endpoint: `/api/dashboard/analytics?windowMinutes=15&bucketSeconds=10&processedBy=backend-1`.

## Frontend Dashboard Features

- Backend scope switcher: choose `all-instances`, `backend-1`, or `backend-2`.
- Throughput graph: rolling bucketed event-rate trend over a selectable time window.
- Partition load panel: event counts per Kafka partition in the selected window.
- Partition ownership matrix: which backend instance processed each partition.
- Event type bars: top event types in the selected time window.
- Latest events table now includes processing instance and Kafka partition columns.

Optional frontend env for custom instance list:

```bash
VITE_API_INSTANCES=backend-1=http://localhost:3001/api,backend-2=http://localhost:3002/api
```

`id` values in `VITE_API_INSTANCES` should match backend `INSTANCE_ID` values for instance-specific filtering.

## Stop everything

```bash
docker compose down
```

To also remove persisted Kafka/Postgres data:

```bash
docker compose down -v
```
