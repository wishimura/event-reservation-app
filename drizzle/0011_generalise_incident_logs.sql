DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'payment_logs')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'incident_logs')
  THEN
    ALTER TABLE payment_logs RENAME TO incident_logs;
    ALTER INDEX IF EXISTS payment_logs_created_at_idx RENAME TO incident_logs_created_at_idx;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS incident_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,
  stage text NOT NULL,
  outcome text NOT NULL,
  order_number text,
  amount integer,
  customer_email text,
  message text NOT NULL DEFAULT '',
  detail jsonb,
  user_agent text
);

ALTER TABLE incident_logs ALTER COLUMN stage TYPE text USING stage::text;
ALTER TABLE incident_logs ALTER COLUMN outcome TYPE text USING outcome::text;
ALTER TABLE incident_logs ADD COLUMN IF NOT EXISTS area text NOT NULL DEFAULT 'payment';
ALTER TABLE incident_logs ADD COLUMN IF NOT EXISTS path text;

CREATE INDEX IF NOT EXISTS incident_logs_created_at_idx ON incident_logs (created_at);
CREATE INDEX IF NOT EXISTS incident_logs_area_idx ON incident_logs (area);
