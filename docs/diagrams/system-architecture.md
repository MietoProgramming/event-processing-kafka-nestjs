# System Architecture

```mermaid
flowchart LR
  subgraph Client[User Side]
    U[Browser User]
    FE[Frontend Dashboard<br/>React + TanStack + Vite]
  end

  subgraph Infra[Docker Network]
    KAFKA[Kafka Broker<br/>Topics: page_views(12), clicks(6), purchases(3)]
    KUI[Kafka UI]
    GEN[Event Generator<br/>10000 events/sec]
    subgraph BEG[Consumer Group: analytics-consumer]
      B1[Backend-1 NestJS]
      B2[Backend-2 NestJS]
    end
    PG[(PostgreSQL eventsdb<br/>Partitioned events table)]
  end

  U --> FE
  FE -->|REST: stats, latest events, analytics| B1
  FE -. failover .-> B2
  FE -->|SSE stats stream single-instance mode| B1
  FE -->|Polling stats all-instances mode| B1
  FE -->|Polling stats all-instances mode| B2

  GEN -->|produce keyed events by user_id| KAFKA
  KAFKA -->|partition assignments| B1
  KAFKA -->|partition assignments| B2
  B1 -->|batch inserts| PG
  B2 -->|batch inserts| PG
  KUI -->|inspect topics and consumer group| KAFKA
```