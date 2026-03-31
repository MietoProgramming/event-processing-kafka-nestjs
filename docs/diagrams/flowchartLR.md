
```mermaid
flowchart LR
  G[Generator] -->|keyed messages| K[Kafka topics]
  K --> P1[Partition lanes]
  P1 --> C1[backend-1 in analytics-consumer]
  P1 --> C2[backend-2 in analytics-consumer]
  C1 --> B[In-memory batch buffer]
  C2 --> B2[In-memory batch buffer]
  B --> DB[(Postgres events partitions)]
  B2 --> DB
  DB --> A[Stats and analytics API]
  A --> UI[Dashboard: throughput, partition load, ownership]
  ```