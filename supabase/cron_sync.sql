-- cron_sync.sql — MANERA 2 de mantener el grisado al día: barrido periódico automático.
--
-- Complementa la MANERA 1 (barrido tras cada pago del form: syncAllAlumnos en el webhook).
-- Un job pg_cron llama al webhook con {type:'SYNCALL', test:true} cada 10 minutos. El webhook
-- lee el tab activo del sheet y hace UPSERT masivo (RPC set_meses_pagados_bulk) en la tabla
-- `alumnos`. Así las ediciones MANUALES del sheet entran al grisado aunque NO haya pagos por el
-- form durante horas. No depende del navegador, ni de la Mac, ni del trigger onEdit.
--
-- NO destructivo: la RPC bulk solo hace UPSERT, nunca borra filas.
-- Requiere: pg_cron + pg_net (ambos activos en el proyecto).
-- El payload usa test:true como simple "gate" para entrar al handler SYNCALL; el tab que lee lo
-- decide GLOBAL_TEST_MODE en el webhook (test → 'test mensualidad', prod → 'Mensualidades 2026'),
-- así que este job sirve igual en test y en producción sin cambios.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Crear/actualizar el job (idempotente por nombre). Cambiá '*/10 * * * *' para otro intervalo.
select cron.schedule(
  'sync-alumnos-grisado',
  '*/10 * * * *',
  $cmd$select net.http_post(
    url := '<PEGAR_URL_DEL_WEBHOOK>',  -- misma URL del webhook (no se versiona por seguridad)
    body := '{"type":"SYNCALL","test":true}'::jsonb,
    headers := '{"Content-Type":"application/json"}'::jsonb,
    timeout_milliseconds := 30000
  )$cmd$
);

-- Estado del job:
--   select jobid, jobname, schedule, active from cron.job;
-- Historial de corridas:
--   select runid, status, return_message, start_time from cron.job_run_details order by start_time desc limit 10;
-- Quitar el job:
--   select cron.unschedule('sync-alumnos-grisado');
