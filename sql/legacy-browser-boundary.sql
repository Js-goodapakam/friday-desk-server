-- Prepared for reviewed release. Run only after confirming the backend role
-- and inventorying any supported clients that use the public Data API.
BEGIN;
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['property','guest','reservation','user','payment',
    'room','roomType','serviceRequest','teleCMIUserMapping','callLog']
  LOOP
    -- Missing tables fail the transaction instead of silently skipping protection.
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated', name);
  END LOOP;
END $$;
COMMIT;
