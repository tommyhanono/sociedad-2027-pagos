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
-- crear_pago GATEADO por token OTP (2026-06-28): exige p_token de una sesión OTP válida cuyo nombre
-- coincida con p_janij, + valida el rango del monto. Sin esto, cualquiera con la anon key (pública)
-- registraba pagos falsos a nombre de cualquier alumno. El overload de 4 args (sin token) FUE DROPEADO
-- una vez que el front (Vercel + GitHub Pages) pasó a llamar esta versión de 5 args con sesion.token.
create or replace function public.crear_pago(p_janij text, p_monto numeric, p_mes text, p_comprobante_url text, p_token text)
returns uuid language plpgsql security definer set search_path to 'public' as $fn$
declare v_id uuid; v_nom text; v_exp timestamptz;
begin
  select nombre, expira into v_nom, v_exp from otp_sesiones where token = p_token;
  if v_nom is null or v_exp < now() then raise exception 'sesion_invalida'; end if;
  if lower(btrim(v_nom)) <> lower(btrim(p_janij)) then raise exception 'sesion_no_coincide'; end if;
  if p_monto is null or p_monto < 0.01 or p_monto > 5000 then raise exception 'monto_invalido'; end if;
  -- Guarda el nombre CANÓNICO de la sesión (v_nom), no el p_janij crudo del caller, para que coincida
  -- exacto con el sheet (el webhook hace findPersonRow contra janij).
  insert into public.pagos(janij, monto, mes, comprobante_url)
  values (v_nom, p_monto, p_mes, p_comprobante_url)
  returning id into v_id;
  return v_id;
end; $fn$;
-- Cerrar la vía sin token (tras desplegar el front nuevo):
--   drop function if exists public.crear_pago(text, numeric, text, text);

-- pago_estado GATEADO por token (2026-06-28): el front (SuccessScreen) lo poll-ea con el id del pago
-- + el token de sesión. Sin el token correcto (cuyo nombre coincida con el alumno del pago) → excepción.
-- Cierra el IDOR donde, con solo el UUID, anon leía nombre/monto/saldo de un pago. (El overload viejo de
-- 1 arg se dropeó tras desplegar el front nuevo.)
create or replace function public.pago_estado(p_id uuid, p_token text)
returns text language plpgsql security definer set search_path to 'public' as $fn$
declare v_estado text; v_janij text; v_nom text; v_exp timestamptz;
begin
  -- Validar el token ANTES de leer pagos, y unificar TODA respuesta no-autorizada al mismo error,
  -- para no delatar la existencia de un UUID de pago (oráculo) por la diferencia 200/null vs 400.
  select nombre, expira into v_nom, v_exp from otp_sesiones where token = p_token;
  if v_nom is null or v_exp < now() then raise exception 'no_autorizado'; end if;
  select estado, janij into v_estado, v_janij from pagos where id = p_id;
  if not found then raise exception 'no_autorizado'; end if;
  if lower(btrim(v_nom)) <> lower(btrim(coalesce(v_janij,''))) then raise exception 'no_autorizado'; end if;
  return v_estado;
end; $fn$;
-- Cerrar el overload sin token (tras desplegar el front nuevo): drop function if exists public.pago_estado(uuid);

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

-- ── Hardening 2026-06-28: cerrar grants DML latentes en alumnos y pagos ──────
-- alumnos tenía RLS ON pero conservaba grants SELECT/INSERT/UPDATE/DELETE/TRUNCATE para anon y
-- authenticated (solo lo salvaba la ausencia de policy). pagos conservaba grants para authenticated +
-- una policy allow_authenticated_insert. Se revoca todo (acceso solo por RPCs security-definer) para
-- que la seguridad no dependa de la ausencia de policy. NO rompe: el front nunca hace .from('alumnos')
-- ni .from('pagos') (solo .rpc), y el webhook escribe vía set_meses_pagados (con ALUMNOS_SECRET).
revoke select, insert, update, delete, truncate, references, trigger on public.alumnos from anon, authenticated;
revoke select, insert, update, delete, truncate, references, trigger on public.pagos   from authenticated;
drop policy if exists allow_authenticated_insert on public.pagos;

-- ── Verificación ─────────────────────────────────────────────────────────────
-- Con la anon key, sobre /rest/v1/pagos: SELECT/INSERT/UPDATE/DELETE -> "permission denied".
-- crear_pago / pago_estado / set_pago_estado siguen funcionando (security definer).
-- Revertir candado (emergencia): alter table public.pagos disable row level security;
--   y re-grant lo necesario a anon.
