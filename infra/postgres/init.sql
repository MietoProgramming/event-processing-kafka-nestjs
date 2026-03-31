CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS events (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    user_id VARCHAR(128) NOT NULL,
    event_type VARCHAR(128) NOT NULL,
    processed_by VARCHAR(64) NOT NULL,
    kafka_partition INTEGER NOT NULL,
    kafka_topic VARCHAR(128) NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

ALTER TABLE events ADD COLUMN IF NOT EXISTS processed_by VARCHAR(64) NOT NULL DEFAULT 'unknown';
ALTER TABLE events ADD COLUMN IF NOT EXISTS kafka_partition INTEGER NOT NULL DEFAULT -1;
ALTER TABLE events ADD COLUMN IF NOT EXISTS kafka_topic VARCHAR(128) NOT NULL DEFAULT 'unknown_topic';
ALTER TABLE events ALTER COLUMN processed_by DROP DEFAULT;
ALTER TABLE events ALTER COLUMN kafka_partition DROP DEFAULT;
ALTER TABLE events ALTER COLUMN kafka_topic DROP DEFAULT;

CREATE INDEX IF NOT EXISTS idx_events_created_at ON events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_user_created_at ON events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_event_type_created_at ON events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_processed_by_created_at ON events (processed_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_partition_created_at ON events (kafka_partition, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_topic_created_at ON events (kafka_topic, created_at DESC);

CREATE OR REPLACE FUNCTION create_daily_events_partition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    partition_start TIMESTAMP;
    partition_end TIMESTAMP;
    partition_name TEXT;
BEGIN
    partition_start := date_trunc('day', NEW.created_at);
    partition_end := partition_start + INTERVAL '1 day';
    partition_name := format('events_%s', to_char(partition_start, 'YYYYMMDD'));

    PERFORM pg_advisory_xact_lock(hashtext('events_partition_lock'));

    BEGIN
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS %I PARTITION OF events FOR VALUES FROM (%L) TO (%L);',
            partition_name,
            partition_start,
            partition_end
        );
    EXCEPTION
        WHEN duplicate_table THEN
            NULL;
    END;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_daily_events_partition ON events;

CREATE TRIGGER trg_create_daily_events_partition
BEFORE INSERT ON events
FOR EACH ROW
EXECUTE FUNCTION create_daily_events_partition();

DO $$
DECLARE
    day_cursor TIMESTAMP := date_trunc('day', CURRENT_TIMESTAMP) - INTERVAL '1 day';
    end_day TIMESTAMP := date_trunc('day', CURRENT_TIMESTAMP) + INTERVAL '2 day';
    partition_name TEXT;
BEGIN
    WHILE day_cursor < end_day LOOP
        partition_name := format('events_%s', to_char(day_cursor, 'YYYYMMDD'));
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS %I PARTITION OF events FOR VALUES FROM (%L) TO (%L);',
            partition_name,
            day_cursor,
            day_cursor + INTERVAL '1 day'
        );

        day_cursor := day_cursor + INTERVAL '1 day';
    END LOOP;
END;
$$;
