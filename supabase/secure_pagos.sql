-- secure_pagos.sql — Cierra el acceso público a la tabla `pagos`. (APLICADO 2026-06-24)
--
-- Problema: la tabla `pagos` tenía RLS APAGADO y el rol `anon` (la llave pública, que va en el
-- bundle) tenía grants de SELECT/INSERT/UPDATE/DELETE/TRUNCATE. Es decir, cualquiera con la llave
-- pública podía LEER, ALTERAR y hasta BORRAR los pagos de las 52 familias.
--
-- Solución (mismo patrón que `alumnos`): `pagos` queda cerrada al rol anon; todo acceso pasa por
-- 3 RPC security-definer. NO destructivo. El trigger pagos->webhook sigue disparando igual.
--   • crear_pago        → el form registra el pago (en vez de insert directo + .select('id'))
--   • pago_estado       → el form lee SU saldo por id (en vez de select directo)
--   • set_pago_estado   → el webhook escribe el saldo (en vez de UPDATE directo con la anon key)
--
-- ORDEN SEGURO de aplicación (así NO se rompe el form en vivo):
--   1) crear las 3 RPC
--   2) desplegar el webhook que usa set_pago_estado (updatePagoEstado)
--   3) desplegar el frontend que usa crear_pago / pago_estado (ya con fallback)
--   4) recién entonces el candado (enable RLS + revoke)

-- ── 1) RPCs ─────────────────────────────────────────────────────────────────
create or replace function public.crear_pago(p_janij text, p_monto numeric, p_mes text, p_comprobante_url text)
returns uuid language plpgsql security definer set search_path to 'public' as $fn$
declare v_id uuid;
begin
  insert into public.pagos(janij, monto, mes, comprobante_url)
  values (btrim(p_janij), p_monto, p_mes, p_comprobante_url)
  returning id into v_id;
  return v_id;
end; $fn$;

create or replace function public.pago_estado(p_id uuid)
returns text language sql security definer set search_path to 'public' as $fn$
  select estado from public.pagos where id = p_id;
$fn$;

-- El secreto NO se versiona (placeholder). Valor real en el vault (~/.keys-vault) y en
-- Script Properties del webhook (ALUMNOS_SECRET) — el mismo que usa set_meses_pagados.
create or replace function public.set_pago_estado(p_id uuid, p_estado text, p_secret text)
returns void language plpgsql security definer set search_path to 'public' as $fn$
begin
  if p_secret is distinct from '<ALUMNOS_SECRET>' then
    raise exception 'no autorizado';
  end if;
  update public.pagos set estado = p_estado where id = p_id;
end; $fn$;

-- ── 2) y 3) desplegar webhook + frontend con las RPC ANTES de seguir ─────────

-- ── 4) Candado ───────────────────────────────────────────────────────────────
alter table public.pagos enable row level security;
revoke select, insert, update, delete, truncate, references, trigger on public.pagos from anon;
drop policy if exists allow_anon_insert on public.pagos;  -- queda moot al revocar el grant

-- ── Verificación ─────────────────────────────────────────────────────────────
-- Con la anon key, sobre /rest/v1/pagos: SELECT/INSERT/UPDATE/DELETE -> "permission denied".
-- crear_pago / pago_estado / set_pago_estado siguen funcionando (security definer).
-- Revertir candado (emergencia): alter table public.pagos disable row level security;
--   y re-grant lo necesario a anon.
