-- otp_verification.sql — Verificación por código (OTP) por WhatsApp. (APLICADO 2026-06-24)
-- Cada mamá ve SOLO lo de su hijo: sin verificar no ve saldo ni montos. Sin login (recordame
-- hasta fin de año). El secreto y la URL NO se versionan (placeholders).
-- alumnos.telefono guarda el número por familia; en modo test el webhook reenvía a TEST_PHONE.

-- Tablas OTP (cerradas al público: solo las RPC security-definer las tocan)
create table if not exists public.otp_codigos (
  nombre text primary key,
  codigo text not null,
  expira timestamptz not null,
  intentos int not null default 0,
  creado timestamptz not null default now()
);
alter table public.otp_codigos enable row level security;
revoke all on public.otp_codigos from anon, authenticated;

create table if not exists public.otp_sesiones (
  token text primary key,
  nombre text not null,
  expira timestamptz not null,
  creado timestamptz not null default now()
);
alter table public.otp_sesiones enable row level security;
revoke all on public.otp_sesiones from anon, authenticated;

-- solicitar_codigo: genera código de 4 dígitos, lo guarda y dispara el envío por el webhook (Green API)
create or replace function public.solicitar_codigo(p_nombre text)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare v_tel text; v_codigo text; v_prev timestamptz;
  v_url text := '<WEBHOOK_URL>';
  v_secret text := '<ALUMNOS_SECRET>';
begin
  select telefono into v_tel from alumnos where nombre = btrim(p_nombre);
  if not found then return jsonb_build_object('ok', false, 'error', 'no_encontrado'); end if;
  if v_tel is null then return jsonb_build_object('ok', false, 'error', 'no_habilitado'); end if;
  select creado into v_prev from otp_codigos where nombre = btrim(p_nombre);
  if v_prev is not null and v_prev > now() - interval '45 seconds' then
    return jsonb_build_object('ok', false, 'error', 'espera');
  end if;
  v_codigo := lpad(((floor(random()*9000))::int + 1000)::text, 4, '0');
  insert into otp_codigos(nombre, codigo, expira, intentos, creado)
    values (btrim(p_nombre), v_codigo, now() + interval '10 minutes', 0, now())
    on conflict (nombre) do update set codigo=excluded.codigo, expira=excluded.expira, intentos=0, creado=now();
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('type','SENDOTP','telefono',v_tel,'codigo',v_codigo,'secret',v_secret),
    headers := '{"Content-Type":"application/json"}'::jsonb,
    timeout_milliseconds := 30000
  );
  return jsonb_build_object('ok', true);
end; $fn$;

-- verificar_codigo: valida el código; si OK crea sesión hasta fin de año y devuelve los meses pagados
create or replace function public.verificar_codigo(p_nombre text, p_codigo text)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare v_row otp_codigos; v_token text; v_exp timestamptz; v_meses text;
begin
  select * into v_row from otp_codigos where nombre = btrim(p_nombre);
  if not found or v_row.expira < now() or v_row.intentos >= 5 then
    return jsonb_build_object('ok', false, 'error', 'vencido');
  end if;
  if v_row.codigo <> btrim(p_codigo) then
    update otp_codigos set intentos = intentos + 1 where nombre = btrim(p_nombre);
    return jsonb_build_object('ok', false, 'error', 'incorrecto', 'restantes', greatest(0, 5 - (v_row.intentos+1)));
  end if;
  v_token := md5(random()::text || clock_timestamp()::text || p_nombre);
  v_exp := date_trunc('year', now()) + interval '1 year' - interval '1 second';
  insert into otp_sesiones(token, nombre, expira) values (v_token, btrim(p_nombre), v_exp);
  delete from otp_codigos where nombre = btrim(p_nombre);
  select meses_pagados into v_meses from alumnos where nombre = btrim(p_nombre);
  return jsonb_build_object('ok', true, 'token', v_token, 'nombre', btrim(p_nombre), 'meses', coalesce(v_meses,''), 'expira', v_exp);
end; $fn$;

-- ver_saldo_con_token: "recordame" — restaura la sesión sin OTP mientras el token no venza (fin de año)
create or replace function public.ver_saldo_con_token(p_token text)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare v_nombre text; v_exp timestamptz; v_meses text;
begin
  select nombre, expira into v_nombre, v_exp from otp_sesiones where token = p_token;
  if not found or v_exp < now() then return jsonb_build_object('ok', false); end if;
  select meses_pagados into v_meses from alumnos where nombre = v_nombre;
  return jsonb_build_object('ok', true, 'nombre', v_nombre, 'meses', coalesce(v_meses,''), 'expira', v_exp);
end; $fn$;

-- Cerrar la fuga: meses_pagados(nombre) ya no es llamable por el público (lo reemplazan las RPC OTP)
revoke execute on function public.meses_pagados(text) from anon;
