#!/usr/bin/env python3
"""mudanza_supabase.py — muda Sociedad 2027 del proyecto Supabase viejo al compartido (11-oct-2026).

Plan completo: ~/taller-3d/noche-11oct/tienda/MUDANZA-SOCIEDAD.md. Por qué así:
  · Las TABLAS van a un schema propio `sociedad` (aisladas del resto del compartido).
  · Las FUNCIONES (las RPC que llaman el form y el Apps Script) se quedan en `public` con
    `search_path = sociedad, public`. Así la API las ve sin tocar "Exposed schemas" (tocar esa lista puede tumbar
    ProfeAula, KioskoPay, Reparto y SAT) y el form y el Apps Script no cambian ni una llamada: solo URL y clave.
  · `comprobantes_eventos` (del verificador ~/comprobantes) va a `public`, con solo SELECT e INSERT.
  · Los secretos (cuerpos de funciones, comando del cron, claves) NUNCA se imprimen: el script los lee de la
    Management API y los escribe directo en el destino. Solo se imprimen conteos.

Necesita un token personal de Supabase en ~/.config/supabase-mudanza.token (chmod 600); se revoca al final.

    python3 mudanza_supabase.py respaldo     → ~/backups/sociedad-mudanza-<fecha>/ (todo: datos, funciones, cron, archivos)
    python3 mudanza_supabase.py preparar     → crea todo en el compartido con los cron APAGADOS (el viejo sigue vivo)
    python3 mudanza_supabase.py verificar    → compara filas (hash), funciones, permisos y archivos
    python3 mudanza_supabase.py cortar       → apaga los cron del viejo y prende los del nuevo
    python3 mudanza_supabase.py volver       → al revés (vuelta atrás)
"""
import json, os, re, sys, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path

VIEJO, NUEVO = "obshrrzvfprsjeykqsen", "igsmhrwafhxlhmwcehiu"
TOKEN = (Path.home() / ".config" / "supabase-mudanza.token").read_text().strip() if \
    (Path.home() / ".config" / "supabase-mudanza.token").exists() else None
RESPALDO = Path.home() / "backups" / f"sociedad-mudanza-{time.strftime('%Y-%m-%d')}"
TABLAS = ["pagos", "alumnos", "otp_codigos", "otp_sesiones", "panel_lock"]          # → schema sociedad
FUNCIONES = ["buscar_alumnos", "crear_pago", "meses_pagados", "notify_webhook", "pago_estado", "panel_admin",
             "reconciliar_pagos", "set_meses_pagados", "set_meses_pagados_bulk", "set_pago_estado", "solicitar_codigo",
             "telefonos_para_broadcast", "ver_saldo_con_token", "verificar_codigo"]
CRON = {"sync-alumnos-grisado": "sociedad-sync-alumnos", "reconciliar-pagos": "sociedad-reconciliar-pagos"}
BUCKETS = {"comprobantes": "sociedad-comprobantes", "comprobantes-demo": "comprobantes-demo"}

DDL = """
create schema if not exists sociedad;
revoke all on schema sociedad from anon, authenticated;
create table if not exists sociedad.pagos (id uuid primary key default gen_random_uuid(), fecha timestamptz default now(),
  janij text not null, monto numeric not null, mes text not null, comprobante_url text, estado text default 'pendiente');
create table if not exists sociedad.alumnos (nombre text primary key, meses_pagados text default '', updated_at timestamptz default now(),
  telefono text, nombre_completo text);
create table if not exists sociedad.otp_codigos (nombre text primary key, codigo text not null, expira timestamptz not null,
  intentos integer not null default 0, creado timestamptz not null default now(), envios_dia integer not null default 0, dia date);
create table if not exists sociedad.otp_sesiones (token text primary key, nombre text not null, expira timestamptz not null,
  creado timestamptz not null default now());
create table if not exists sociedad.panel_lock (id integer primary key default 1, fails integer not null default 0,
  ventana timestamptz not null default now());
alter table sociedad.pagos enable row level security; alter table sociedad.alumnos enable row level security;
alter table sociedad.otp_codigos enable row level security; alter table sociedad.otp_sesiones enable row level security;
alter table sociedad.panel_lock enable row level security;
create index if not exists pagos_mes_idx on sociedad.pagos (mes);
create index if not exists pagos_janij_idx on sociedad.pagos (janij);
revoke all on all tables in schema sociedad from anon, authenticated;
create table if not exists public.comprobantes_eventos (id_evento uuid primary key, ts timestamptz not null, tipo text not null,
  payload jsonb not null, insertado_en timestamptz not null default now());
alter table public.comprobantes_eventos enable row level security;
create index if not exists comprobantes_eventos_tipo_idx on public.comprobantes_eventos (tipo);
create index if not exists comprobantes_eventos_ts_idx on public.comprobantes_eventos (ts desc);
revoke all on public.comprobantes_eventos from anon, authenticated;
grant select, insert on public.comprobantes_eventos to anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='comprobantes_eventos' and policyname='ce_select') then
    create policy ce_select on public.comprobantes_eventos for select to anon, authenticated using (true); end if;
  if not exists (select 1 from pg_policies where tablename='comprobantes_eventos' and policyname='ce_insert') then
    create policy ce_insert on public.comprobantes_eventos for insert to anon, authenticated with check (true); end if;
end $$;
"""


def api(metodo, ruta, cuerpo=None, base="https://api.supabase.com", clave=None, crudo=False, tipo="application/json"):
    datos = cuerpo if (cuerpo is None or isinstance(cuerpo, bytes)) else json.dumps(cuerpo).encode()
    h = {"Authorization": f"Bearer {clave or TOKEN}", "User-Agent": "mudanza-sociedad"}
    if clave:
        h["apikey"] = clave
    if datos is not None:
        h["Content-Type"] = tipo
    r = urllib.request.Request(base + ruta, data=datos, method=metodo, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=120) as f:
            b = f.read()
    except urllib.error.HTTPError as e:            # el error se muestra SIN el cuerpo de la consulta (puede traer secretos)
        raise SystemExit(f"✗ {metodo} {ruta.split('?')[0]} → HTTP {e.code}: {e.read()[:300].decode(errors='replace')}")
    return b if crudo else (json.loads(b) if b else None)


def sql(ref, q):
    return api("POST", f"/v1/projects/{ref}/database/query", {"query": q})


def clave_servicio(ref):
    for k in api("GET", f"/v1/projects/{ref}/api-keys?reveal=true"):
        if k.get("name") == "service_role":
            return k["api_key"]
    raise SystemExit("✗ sin clave service_role")


def respaldo():
    RESPALDO.mkdir(parents=True, exist_ok=True)
    os.chmod(RESPALDO, 0o700)
    out = {}
    for t in TABLAS + ["comprobantes_eventos"]:
        out[t] = sql(VIEJO, f"select coalesce(json_agg(x), '[]') j from public.{t} x")[0]["j"]
    out["funciones"] = {r["proname"]: {"def": r["d"], "acl": r["acl"]} for r in sql(VIEJO,
        "select p.proname, pg_get_functiondef(p.oid) d, p.proacl::text acl from pg_proc p "
        "where p.pronamespace='public'::regnamespace and p.proname = any(array[%s])" % ",".join(f"'{f}'" for f in FUNCIONES))}
    out["cron"] = sql(VIEJO, "select jobname, schedule, command, active from cron.job")
    out["objetos"] = {b: sql(VIEJO, f"select name, metadata from storage.objects where bucket_id='{b}' order by name") for b in BUCKETS}
    (RESPALDO / "respaldo.json").write_text(json.dumps(out, ensure_ascii=False))
    os.chmod(RESPALDO / "respaldo.json", 0o600)
    n = 0
    for b, objs in out["objetos"].items():
        for o in objs:
            f = RESPALDO / "storage" / b / o["name"]
            f.parent.mkdir(parents=True, exist_ok=True)
            if not f.exists():
                f.write_bytes(urllib.request.urlopen(f"https://{VIEJO}.supabase.co/storage/v1/object/public/{b}/"
                                                     f"{urllib.parse.quote(o['name'])}", timeout=60).read())
            n += 1
    print("respaldo:", {t: len(out[t]) for t in TABLAS + ["comprobantes_eventos"]}, "·", len(out["funciones"]), "funciones ·",
          len(out["cron"]), "cron ·", n, "archivos →", RESPALDO)


def cargar():
    return json.loads((RESPALDO / "respaldo.json").read_text())


def preparar():
    R = cargar()
    assert len(R["funciones"]) == len(FUNCIONES), f"faltan funciones en el respaldo: {set(FUNCIONES) - set(R['funciones'])}"
    sql(NUEVO, DDL)
    # datos (sin otp_codigos: vencen a los 10 min; sin otp_sesiones: el plan pide que vuelvan a verificar)
    for t, esquema in [("pagos", "sociedad"), ("alumnos", "sociedad"), ("panel_lock", "sociedad"), ("comprobantes_eventos", "public")]:
        filas = R[t]
        if filas:
            j = json.dumps(filas).replace("'", "''")
            sql(NUEVO, f"insert into {esquema}.{t} select * from json_populate_recordset(null::{esquema}.{t}, '{j}') on conflict do nothing")
    # funciones: mismo cuerpo, con search_path = sociedad, public y public.pagos → sociedad.pagos (conteos verificados)
    for nombre, f in R["funciones"].items():
        d = f["def"]
        d2, n1 = re.subn(r"SET search_path TO 'public'", "SET search_path TO 'sociedad', 'public'", d)
        d2, n2 = re.subn(r"\bpublic\.pagos\b", "sociedad.pagos", d2)
        if nombre != "notify_webhook" and n1 != 1:
            raise SystemExit(f"✗ {nombre}: esperaba 1 search_path y hay {n1}; no sigo")
        if nombre == "notify_webhook" and n1 == 0:
            d2 = d2.replace("RETURNS trigger", "RETURNS trigger\n SET search_path TO 'sociedad', 'public'", 1)
        sql(NUEVO, d2.replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION", 1))
        # permisos: los mismos que en el viejo
        firma = sql(NUEVO, f"select oid::regprocedure::text s from pg_proc where proname='{nombre}' and pronamespace='public'::regnamespace")[0]["s"]
        sql(NUEVO, f"revoke all on function {firma} from public, anon, authenticated")
        for rol in ("anon", "authenticated", "service_role"):
            if f"{rol}=X" in (f["acl"] or ""):
                sql(NUEVO, f"grant execute on function {firma} to {rol}")
        print(f"  función {nombre}: search_path {n1}, public.pagos {n2}")
    # trigger (después de cargar los datos: los 12 pagos viejos no se reenvían)
    sql(NUEVO, "drop trigger if exists pagos_webhook_trigger on sociedad.pagos; create trigger pagos_webhook_trigger after insert "
               "on sociedad.pagos for each row execute function public.notify_webhook()")
    # cron: mismos comandos, nombres con prefijo, APAGADOS hasta el corte
    for c in R["cron"]:
        nuevo = CRON.get(c["jobname"])
        if not nuevo:
            continue
        cmd = c["command"]
        if "$cmd$" in cmd:
            raise SystemExit(f"✗ el comando del cron {c['jobname']} trae $cmd$; no sigo")
        if not sql(NUEVO, f"select 1 from cron.job where jobname='{nuevo}'"):
            sql(NUEVO, f"select cron.alter_job(cron.schedule('{nuevo}', '{c['schedule']}', $cmd${cmd}$cmd$), active := false)")
        cron_activo(NUEVO, [nuevo], False)
    # storage
    sk = clave_servicio(NUEVO)
    base = f"https://{NUEVO}.supabase.co"
    for viejo, nuevo in BUCKETS.items():
        if not sql(NUEVO, f"select 1 from storage.buckets where id='{nuevo}'"):
            api("POST", "/storage/v1/bucket", {"id": nuevo, "name": nuevo, "public": True}, base=base, clave=sk)
        hechos = {r["name"] for r in sql(NUEVO, f"select name from storage.objects where bucket_id='{nuevo}'")}
        for o in R["objetos"][viejo]:
            if o["name"] in hechos:
                continue
            f = RESPALDO / "storage" / viejo / o["name"]
            api("POST", f"/storage/v1/object/{nuevo}/{urllib.parse.quote(o['name'])}", f.read_bytes(), base=base, clave=sk,
                tipo=(o.get("metadata") or {}).get("mimetype") or "application/octet-stream")
        print(f"  bucket {nuevo}: {len(R['objetos'][viejo])} archivos")
    sql(NUEVO, """
      update storage.buckets set file_size_limit = 15728640, allowed_mime_types = array['image/jpeg','application/pdf']
        where id = 'sociedad-comprobantes';
      do $$ begin
        if not exists (select 1 from pg_policies where schemaname='storage' and policyname='sociedad_comprobantes_insert') then
          create policy sociedad_comprobantes_insert on storage.objects for insert to anon with check (bucket_id = 'sociedad-comprobantes'); end if;
        if not exists (select 1 from pg_policies where schemaname='storage' and policyname='comprobantes_demo_select2') then
          create policy comprobantes_demo_select2 on storage.objects for select to anon, authenticated using (bucket_id = 'comprobantes-demo'); end if;
        if not exists (select 1 from pg_policies where schemaname='storage' and policyname='comprobantes_demo_insert2') then
          create policy comprobantes_demo_insert2 on storage.objects for insert to anon, authenticated with check (bucket_id = 'comprobantes-demo'); end if;
      end $$;""")
    # los links de los pagos copiados apuntan al Storage nuevo
    sql(NUEVO, f"update sociedad.pagos set comprobante_url = replace(replace(comprobante_url, '{VIEJO}.supabase.co', '{NUEVO}.supabase.co'), "
               f"'/public/comprobantes/', '/public/sociedad-comprobantes/') where comprobante_url like '%{VIEJO}%'")
    print("preparado (cron del nuevo APAGADOS; el viejo sigue igual)")


def huella(ref, esquema, t, cols):
    return sql(ref, f"select count(*) n, md5(coalesce(string_agg(t::text, '|' order by t::text), '')) h from "
                    f"(select {cols} from {esquema}.{t}) t")[0]


def verificar():
    ok = True
    for t, e, cols in [("pagos", "sociedad", "id, fecha, janij, monto, mes, estado"), ("alumnos", "sociedad", "nombre, meses_pagados, telefono, nombre_completo"),
                       ("panel_lock", "sociedad", "id"), ("comprobantes_eventos", "public", "*")]:
        a, b = huella(VIEJO, "public", t, cols), huella(NUEVO, e, t, cols)
        igual = a == b
        ok &= igual
        print(f"  {t}: viejo {a['n']} · nuevo {b['n']} · {'IGUAL' if igual else 'DISTINTO'}")
    fn = sql(NUEVO, "select count(*) n from pg_proc where pronamespace='public'::regnamespace and proname = any(array[%s])"
             % ",".join(f"'{f}'" for f in FUNCIONES))[0]["n"]
    print(f"  funciones en el nuevo: {fn}/{len(FUNCIONES)}")
    ok &= fn == len(FUNCIONES)
    for viejo, nuevo in BUCKETS.items():
        a = sql(VIEJO, f"select count(*) n from storage.objects where bucket_id='{viejo}'")[0]["n"]
        b = sql(NUEVO, f"select count(*) n from storage.objects where bucket_id='{nuevo}'")[0]["n"]
        print(f"  {viejo} → {nuevo}: {a} · {b}")
        ok &= a == b
    cols = "select table_name||'.'||column_name||':'||data_type||':'||coalesce(column_default,'')||':'||is_nullable c from information_schema.columns where table_schema='%s' and table_name='%s' order by 1"
    for t, e in [("pagos", "sociedad"), ("alumnos", "sociedad"), ("otp_codigos", "sociedad"), ("otp_sesiones", "sociedad"),
                 ("panel_lock", "sociedad"), ("comprobantes_eventos", "public")]:
        a, b = [r["c"] for r in sql(VIEJO, cols % ("public", t))], [r["c"] for r in sql(NUEVO, cols % (e, t))]
        if a != b:
            ok = False
            print(f"  columnas {t}: DISTINTAS")
    idx = "select count(*) n from pg_indexes where schemaname='%s' and tablename = any(array['pagos','alumnos','otp_codigos','otp_sesiones','panel_lock','comprobantes_eventos'])"
    ia, ib = sql(VIEJO, idx % "public")[0]["n"], sql(NUEVO, idx % "sociedad")[0]["n"] + sql(NUEVO, idx % "public")[0]["n"]
    print(f"  índices: viejo {ia} · nuevo {ib}")
    ok &= ia == ib
    tg = sql(NUEVO, "select count(*) n from pg_trigger where tgname='pagos_webhook_trigger' and tgrelid='sociedad.pagos'::regclass")[0]["n"]
    print(f"  trigger pagos_webhook_trigger: {tg}")
    ok &= tg == 1
    acls = "select proname, proacl::text a from pg_proc where pronamespace='public'::regnamespace and proname = any(array[%s])" % ",".join(f"'{f}'" for f in FUNCIONES)
    rol = lambda a: tuple(r for r in ("anon", "authenticated", "service_role") if f"{r}=X" in (a or ""))
    pa = {r["proname"]: rol(r["a"]) for r in sql(VIEJO, acls)}
    pb = {r["proname"]: rol(r["a"]) for r in sql(NUEVO, acls)}
    distintas = [f for f in FUNCIONES if pa.get(f) != pb.get(f)]
    print("  permisos EXECUTE distintos:", distintas or "ninguno")
    ok &= not distintas
    rls = sql(NUEVO, "select count(*) n from pg_class where relnamespace='sociedad'::regnamespace and relkind='r' and not relrowsecurity")[0]["n"]
    print(f"  tablas de sociedad sin RLS: {rls}")
    ok &= rls == 0
    for viejo, nuevo in BUCKETS.items():
        q = "select coalesce(sum((metadata->>'size')::bigint),0) s from storage.objects where bucket_id='%s'"
        a, b = sql(VIEJO, q % viejo)[0]["s"], sql(NUEVO, q % nuevo)[0]["s"]
        print(f"  bytes {viejo} → {nuevo}: {a} · {b}")
        ok &= a == b
    acl = sql(NUEVO, "select proname, proacl::text a from pg_proc where pronamespace='public'::regnamespace and proname in "
                     "('meses_pagados','reconciliar_pagos')")
    abiertas = [r["proname"] for r in acl if "anon=X" in (r["a"] or "")]
    print("  funciones solo-servicio expuestas a anon:", abiertas or "ninguna")
    ok &= not abiertas
    print("✓ todo igual" if ok else "✗ HAY DIFERENCIAS: no cortar")
    return ok


def cron_activo(ref, nombres, valor):
    for n in nombres:
        r = sql(ref, f"select cron.alter_job(jobid, active := {str(valor).lower()}) from cron.job where jobname='{n}'")
        if len(r) != 1:
            raise SystemExit(f"✗ cron {n} no existe en {ref}")
    estado = sql(ref, "select jobname, active from cron.job where jobname = any(array[%s])" % ",".join(f"'{n}'" for n in nombres))
    print(f"  cron {ref[:6]}…:", {e["jobname"]: e["active"] for e in estado})


def cortar():
    if not verificar():
        raise SystemExit("✗ no corto: la verificación falló")
    cron_activo(VIEJO, CRON.keys(), False)
    cron_activo(NUEVO, CRON.values(), True)
    print("corte hecho: cron del viejo apagados, del nuevo prendidos")


def volver():
    cron_activo(NUEVO, CRON.values(), False)
    cron_activo(VIEJO, CRON.keys(), True)
    print("vuelta atrás: cron del viejo prendidos, del nuevo apagados (las apps vuelven con el commit anterior)")


if __name__ == "__main__":
    if not TOKEN:
        raise SystemExit("✗ falta el token en ~/.config/supabase-mudanza.token")
    {"respaldo": respaldo, "preparar": preparar, "verificar": verificar, "cortar": cortar, "volver": volver}[sys.argv[1]]()
