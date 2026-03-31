# Real-Time Event Processing with Kafka, NestJS, Drizzle, and TanStack Start

This repository is a local learning lab for high-throughput event processing:

- Kafka in KRaft mode (Apache Kafka image, no ZooKeeper)
- PostgreSQL 16 with declarative daily partitions
- Kafka UI for topic and consumer-group inspection
- Node.js event generator publishing exactly 1,000 events/second
- Two NestJS backend instances in the same Kafka consumer group (`analytics-consumer`)
- TanStack Start + React dashboard with live stats and latest events table

## Architecture

1. The generator writes to Kafka topic `events.page_views` with message key=`user_id`.
2. Kafka partitions route all events for the same user to the same partition.
3. Two backend containers (`backend-1`, `backend-2`) share the same `groupId` and split partition ownership.
4. Backend services batch-insert events into PostgreSQL `events` table (RANGE partitioned by `created_at`).
5. Frontend reads live stats from SSE and fetches latest 100 rows via REST.

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
```

## 3) Observe Kafka partition load balancing

### In Kafka UI

1. Open `events.page_views` topic and confirm multiple partitions.
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
- Backend metrics endpoint uses database aggregates so stats stay accurate across both backend instances.
- SSE endpoint: `/api/stats/stream`.
- Latest events endpoint: `/api/events/latest?limit=100`.

## Stop everything

```bash
docker compose down
```

To also remove persisted Kafka/Postgres data:

```bash
docker compose down -v
```
