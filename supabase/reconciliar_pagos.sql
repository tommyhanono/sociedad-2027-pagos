-- reconciliar_pagos.sql — red de seguridad server-side (2026-06-29).
-- El trigger pg_net es single-shot: si la llamada al webhook falla (cold start, 5xx, hipo de pg_net),
-- el pago queda 'pendiente' y NADA lo vuelve a mirar. Esta función re-dispara el webhook para los pagos
-- 'pendiente' de >2 min (idempotente: el webhook descarta duplicados por id). pg_cron la corre cada 5 min.
-- URL/secreto reales NO versionados (placeholders). Valores reales en el vault / scratchpad.
create or replace function public.reconciliar_pagos()
returns int language plpgsql security definer set search_path to 'public' as $fn$
declare r record; n int := 0;
  v_url text := '<WEBHOOK_URL>';
  v_secret text := '<ALUMNOS_SECRET>';
begin
  for r in
    select * from pagos
    where (estado is null or estado = 'pendiente')
      and fecha < now() - interval '2 minutes' and fecha > now() - interval '7 days'
    order by fecha limit 30
  loop
    perform net.http_post(url := v_url,
      body := jsonb_build_object('type','INSERT','record', row_to_json(r)::jsonb, 'secret', v_secret),
      headers := '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds := 30000);
    n := n + 1;
  end loop;
  return n;
end; $fn$;
revoke execute on function public.reconciliar_pagos() from public, anon, authenticated;
select cron.schedule('reconciliar-pagos', '*/5 * * * *', 'select public.reconciliar_pagos();');
