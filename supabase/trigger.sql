-- Run this in the Supabase SQL Editor AFTER setup.sql
-- Requires pg_net extension (enabled by default in Supabase)

-- Enable pg_net if not already enabled
create extension if not exists pg_net;

-- Function called on each INSERT into pagos
create or replace function notify_webhook()
returns trigger language plpgsql as $$
declare
  -- URL ESTABLE de producción (el deployment fijo que el trigger usa desde siempre).
  -- La URL / deploymentId reales NO se versionan acá por seguridad — ponelos al correr este
  -- script (están en el vault / Script Properties). Se publica con: clasp deploy --deploymentId <ID>
  webhook_url text := '<PEGAR_URL_DEL_WEBHOOK>';  -- https://script.google.com/macros/s/<ID>/exec
  payload jsonb;
begin
  payload := jsonb_build_object(
    'type',   TG_OP,
    'record', row_to_json(NEW)::jsonb
  );

  -- timeout_milliseconds:30000 because Apps Script cold starts can take 10-15s
  perform net.http_post(
    url                  := webhook_url,
    body                 := payload,
    headers              := '{"Content-Type":"application/json"}'::jsonb,
    timeout_milliseconds := 30000
  );

  return NEW;
end;
$$;

-- Attach trigger to pagos table
drop trigger if exists pagos_webhook_trigger on pagos;
create trigger pagos_webhook_trigger
  after insert on pagos
  for each row execute function notify_webhook();
