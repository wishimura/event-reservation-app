DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_log_stage') THEN
    CREATE TYPE payment_log_stage AS ENUM
      ('card_form', 'tokenize', 'verify', 'submit', 'charge', 'record');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_log_outcome') THEN
    CREATE TYPE payment_log_outcome AS ENUM ('ok', 'declined', 'error', 'abandoned');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS payment_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,
  stage payment_log_stage NOT NULL,
  outcome payment_log_outcome NOT NULL,
  order_number text,
  amount integer,
  customer_email text,
  message text NOT NULL DEFAULT '',
  detail jsonb,
  user_agent text
);

CREATE INDEX IF NOT EXISTS payment_logs_created_at_idx ON payment_logs (created_at);
