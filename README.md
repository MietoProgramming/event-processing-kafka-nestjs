# Real-Time Event Processing with Kafka, NestJS, Drizzle, and TanStack Start

This repository is a local learning lab for high-throughput event processing:

- Kafka in KRaft mode (Apache Kafka image, no ZooKeeper)
- PostgreSQL 16 primary + 2 read replicas with declarative daily partitions
- Kafka UI for topic and consumer-group inspection
- Node.js event generator publishing exactly 10,000 events/second across 3 topics
- Two NestJS backend instances in the same Kafka consumer group (`analytics-consumer`)
- TanStack Start + React dashboard with live stats and latest events table

## Architecture

1. The generator writes to three Kafka topics at fixed rates (7000/2900/100 events/sec).
2. Each topic uses its own partition key so ordering is preserved per entity key.
3. Two backend containers (`backend-1`, `backend-2`) share the same `groupId` and split partition ownership.
4. Backend services batch-insert events into the primary PostgreSQL node (`postgres`) `events` table (RANGE partitioned by `created_at`).
5. Two PostgreSQL read replicas (`postgres-replica-1`, `postgres-replica-2`) stream WAL from the primary for read-only workloads.
6. Backend read endpoints (`/stats`, `/events/latest`, `/dashboard/*`) use round-robin reads across both replicas.
7. Frontend reads live stats from SSE and fetches latest 100 rows via REST.
8. Dashboard analytics endpoint powers throughput graphs, partition distribution, event-type distribution, and per-instance ownership views.

## Kafka Topic Strategy

| Topic | Volume pattern | Partition key | Default partitions |
|---|---:|---|---:|
| `events.page_views` | 7000 events/sec | `session_id` | 12 |
| `events.clicks` | 2900 events/sec | `user_id` | 6 |
| `events.purchases` | 100 events/sec | `order_id` | 3 |

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
- PostgreSQL primary: localhost:5432
- PostgreSQL read replica 1: localhost:5433
- PostgreSQL read replica 2: localhost:5434

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

## 5) Verify PostgreSQL read replicas

Check replication status on the primary:

```bash
docker compose exec postgres psql -U postgres -d eventsdb -c "SELECT application_name, state, sync_state, client_addr FROM pg_stat_replication;"
```

Check both replicas are in recovery mode:

```bash
docker compose exec postgres-replica-1 psql -U postgres -d eventsdb -c "SELECT pg_is_in_recovery(), pg_last_wal_replay_lsn();"
docker compose exec postgres-replica-2 psql -U postgres -d eventsdb -c "SELECT pg_is_in_recovery(), pg_last_wal_replay_lsn();"
```

Run read-only checks from replicas:

```bash
docker compose exec postgres-replica-1 psql -U postgres -d eventsdb -c "SELECT COUNT(*) FROM events;"
docker compose exec postgres-replica-2 psql -U postgres -d eventsdb -c "SELECT COUNT(*) FROM events;"
```

If replicas are healthy but logs show `requested WAL segment ... has already been removed`,
re-seed only the replica volumes:

```bash
docker compose stop postgres-replica-1 postgres-replica-2
docker compose rm -f postgres-replica-1 postgres-replica-2
docker volume rm kafka-event-processing-lab_pg_replica_1_data kafka-event-processing-lab_pg_replica_2_data
docker compose up -d postgres-replica-1 postgres-replica-2
```

## Implementation Notes

- PostgreSQL trigger `create_daily_events_partition()` creates a day partition at insert time if missing.
- Backend persists `processed_by` and `kafka_partition` metadata per event for partition-aware analytics.
- Backend consumes `events.page_views`, `events.clicks`, and `events.purchases`, and normalizes `event_type` by topic to avoid bad producer payloads.
- Backend uses `DATABASE_URL` for writes and `DATABASE_READ_URLS` (comma-separated) for read-only queries; when `DATABASE_READ_URLS` is not set, reads fall back to `DATABASE_URL`.
- Backend runtime defaults for this lab target higher ingest (`KAFKA_PARTITIONS_CONSUMED_CONCURRENCY=6`, `BATCH_SIZE=2000`, `FLUSH_INTERVAL_MS=200`).
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
