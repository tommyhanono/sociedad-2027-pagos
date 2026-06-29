-- panel_admin.sql — RPC para el DASHBOARD de la tesorería (2026-06-28).
-- Ruta oculta del front en #panel (src/components/PanelAdmin.jsx): pide contraseña → llama esta RPC →
-- muestra el estado de pago de las 51 familias (quién está al día, quién debe, total recaudado).
-- Gateada server-side por contraseña: sin la contraseña correcta devuelve {ok:false} (no expone nada).
-- La contraseña real NO se versiona (placeholder). Se setea al crear la función con el PAT.
-- Excluye 'joyce e' (no es de la promo). Solo lectura.

create or replace function public.panel_admin(p_secret text)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare v_pass text := '<DASHBOARD_PASS>';
begin
  if p_secret is distinct from v_pass then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true, 'alumnos', (
    select coalesce(jsonb_agg(x order by x->>'nombre'), '[]'::jsonb) from (
      select jsonb_build_object(
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
