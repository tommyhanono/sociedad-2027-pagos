-- otp_verification.sql — Verificación por código (OTP) por WhatsApp. (APLICADO 2026-06-24)
-- Cada mamá ve SOLO lo de su hijo: sin verificar no ve saldo ni montos. Sin login (recordame
-- hasta fin de año). El secreto y la URL NO se versionan (placeholders).
-- alumnos.telefono = número por familia; alumnos.nombre_completo = nombre real (ej. 'Raquel Abbo')
-- para que el buscador encuentre por apellido. En modo test el webhook reenvía a TEST_PHONE.

alter table public.alumnos add column if not exists telefono text;
alter table public.alumnos add column if not exists nombre_completo text;

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


-- buscar_alumnos: busca por nombre del sistema O nombre completo. Hardening 2026-06-28: mínimo 3 chars
-- (reduce enumeración del padrón) + escapa los metacaracteres LIKE (% _ \) del input del usuario para
-- que no se usen como comodín (q='%' ya no trae a todos).
create or replace function public.buscar_alumnos(q text)
returns table(nombre text, nombre_completo text)
language sql security definer set search_path to 'public' as $fn$
  select a.nombre, coalesce(a.nombre_completo, a.nombre)
  from alumnos a
  where length(btrim(coalesce(q,''))) >= 3
    and (a.nombre ilike '%'||replace(replace(replace(btrim(q),'\','\\'),'%','\%'),'_','\_')||'%' escape '\'
      or a.nombre_completo ilike '%'||replace(replace(replace(btrim(q),'\','\\'),'%','\%'),'_','\_')||'%' escape '\')
  order by coalesce(a.nombre_completo, a.nombre) limit 10;
$fn$;

-- solicitar_codigo: resuelve el input por nombre del sistema O nombre completo.
-- Tope diario anti-spam (2026-06-28): además del throttle de 45s, máx 15 códigos/día por alumno
-- (corta el spam de WhatsApp a las familias reales y el gasto de cuota de Green en producción).
alter table public.otp_codigos add column if not exists envios_dia int not null default 0;
alter table public.otp_codigos add column if not exists dia date;
create or replace function public.solicitar_codigo(p_nombre text)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare v_nom text; v_tel text; v_codigo text; v_prev timestamptz; v_envios int; v_dia date;
  v_hoy date := (now() at time zone 'America/Panama')::date;   -- el tope diario usa hora de Panamá
  v_url text := '<WEBHOOK_URL>';
  v_secret text := '<ALUMNOS_SECRET>';
begin
  select nombre, telefono into v_nom, v_tel from alumnos
    where lower(nombre) = lower(btrim(p_nombre)) or lower(nombre_completo) = lower(btrim(p_nombre)) limit 1;
  if v_nom is null then return jsonb_build_object('ok', false, 'error', 'no_encontrado'); end if;
  if v_tel is null then return jsonb_build_object('ok', false, 'error', 'no_habilitado'); end if;
  select creado, envios_dia, dia into v_prev, v_envios, v_dia from otp_codigos where nombre = v_nom;
  if v_prev is not null and v_prev > now() - interval '45 seconds' then return jsonb_build_object('ok', false, 'error', 'espera'); end if;
  if v_dia is distinct from v_hoy then v_envios := 0; end if;
  if coalesce(v_envios,0) >= 15 then return jsonb_build_object('ok', false, 'error', 'limite_diario'); end if;
  v_codigo := lpad(((floor(random()*9000))::int + 1000)::text, 4, '0');
  insert into otp_codigos(nombre, codigo, expira, intentos, creado, envios_dia, dia)
    values (v_nom, v_codigo, now() + interval '10 minutes', 0, now(), coalesce(v_envios,0)+1, v_hoy)
    on conflict (nombre) do update set codigo=excluded.codigo, expira=excluded.expira, intentos=0, creado=now(),
      envios_dia=excluded.envios_dia, dia=excluded.dia;
  perform net.http_post(url := v_url,
    body := jsonb_build_object('type','SENDOTP','telefono',v_tel,'codigo',v_codigo,'secret',v_secret),
    headers := '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds := 30000);
  return jsonb_build_object('ok', true);
end; $fn$;

-- verificar_codigo: resuelve el input y devuelve también el nombre completo (para mostrarlo)
create or replace function public.verificar_codigo(p_nombre text, p_codigo text)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare v_nom text; v_nc text; v_row otp_codigos; v_token text; v_exp timestamptz; v_meses text;
begin
  select nombre, coalesce(nombre_completo, nombre) into v_nom, v_nc from alumnos
    where lower(nombre) = lower(btrim(p_nombre)) or lower(nombre_completo) = lower(btrim(p_nombre)) limit 1;
  if v_nom is null then return jsonb_build_object('ok', false, 'error', 'vencido'); end if;
  select * into v_row from otp_codigos where nombre = v_nom;
  if not found or v_row.expira < now() or v_row.intentos >= 5 then return jsonb_build_object('ok', false, 'error', 'vencido'); end if;
  if v_row.codigo <> btrim(p_codigo) then
    update otp_codigos set intentos = intentos + 1 where nombre = v_nom;
    return jsonb_build_object('ok', false, 'error', 'incorrecto', 'restantes', greatest(0, 5 - (v_row.intentos+1)));
  end if;
  v_token := md5(random()::text || clock_timestamp()::text || v_nom);
  v_exp := date_trunc('year', now()) + interval '1 year' - interval '1 second';
  insert into otp_sesiones(token, nombre, expira) values (v_token, v_nom, v_exp);
  delete from otp_codigos where nombre = v_nom;
  select meses_pagados into v_meses from alumnos where nombre = v_nom;
  return jsonb_build_object('ok', true, 'token', v_token, 'nombre', v_nom, 'nombre_completo', v_nc, 'meses', coalesce(v_meses,''), 'expira', v_exp);
end; $fn$;

-- ver_saldo_con_token: devuelve también el nombre completo
create or replace function public.ver_saldo_con_token(p_token text)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare v_nom text; v_nc text; v_exp timestamptz; v_meses text;
begin
  select nombre, expira into v_nom, v_exp from otp_sesiones where token = p_token;
  if not found or v_exp < now() then return jsonb_build_object('ok', false); end if;
  select meses_pagados, coalesce(nombre_completo, nombre) into v_meses, v_nc from alumnos where nombre = v_nom;
  return jsonb_build_object('ok', true, 'nombre', v_nom, 'nombre_completo', v_nc, 'meses', coalesce(v_meses,''), 'expira', v_exp);
end; $fn$;

-- Cerrar la fuga: meses_pagados(nombre) ya no es llamable por el público
revoke execute on function public.meses_pagados(text) from public, anon;
