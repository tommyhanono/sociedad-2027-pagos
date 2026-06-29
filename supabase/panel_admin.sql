-- panel_admin.sql — RPC para el DASHBOARD de la tesorería (2026-06-28).
-- Ruta oculta del front en #panel (src/components/PanelAdmin.jsx): pide contraseña → llama esta RPC →
-- muestra el estado de pago de las 51 familias (quién está al día, quién debe, total recaudado).
-- Gateada server-side por contraseña: sin la contraseña correcta devuelve {ok:false} (no expone nada).
-- La contraseña real NO se versiona (placeholder). Se setea al crear la función con el PAT.
-- Excluye 'joyce e' (no es de la promo). Solo lectura.
-- Rate-limit global anti brute-force (2026-06-29): tras 10 intentos fallidos en una ventana de 15 min
-- devuelve {ok:false,error:'bloqueado'}; la ventana se resetea sola. (Lock global; un ataque puede
-- bloquear a la tesorera 15 min, pero ella tiene el Sheet como respaldo y el atacante no entra.)
create table if not exists public.panel_lock (id int primary key default 1, fails int not null default 0, ventana timestamptz not null default now());
insert into public.panel_lock(id) values (1) on conflict do nothing;
revoke all on public.panel_lock from anon, authenticated;

create or replace function public.panel_admin(p_secret text)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare v_pass text := '<DASHBOARD_PASS>'; v_fails int; v_ventana timestamptz;
begin
  select fails, ventana into v_fails, v_ventana from panel_lock where id=1 for update;
  if v_ventana < now() - interval '15 minutes' then v_fails := 0; update panel_lock set fails=0, ventana=now() where id=1; end if;
  if v_fails >= 10 then return jsonb_build_object('ok', false, 'error', 'bloqueado'); end if;
  if p_secret is distinct from v_pass then
    update panel_lock set fails = fails + 1 where id=1;
    return jsonb_build_object('ok', false);
  end if;
  update panel_lock set fails=0, ventana=now() where id=1;
  return jsonb_build_object('ok', true, 'alumnos', (
    select coalesce(jsonb_agg(x order by x->>'nombre'), '[]'::jsonb) from (
      select jsonb_build_object(
        'id',     nombre,
        'nombre', coalesce(nombre_completo, nombre),
        'meses',  coalesce(meses_pagados, ''),
        'tel',    coalesce(telefono, '')
      ) x
      from alumnos
      where nombre is not null and lower(btrim(nombre)) <> 'joyce e'
    ) s
  ));
end; $fn$;

grant execute on function public.panel_admin(text) to anon;
-- Para cambiar la contraseña: re-crear la función con otro valor de v_pass.
