#!/usr/bin/env python3
"""guardian.py — prueba de humo REPETIBLE de todas las apps que usan los dos proyectos Supabase de la mudanza.

    viejo      = obshrrzvfprsjeykqsen  (Sociedad 2027 + el verificador ~/comprobantes)
    compartido = igsmhrwafhxlhmwcehiu  (tres-leches: ProfeAula, KioskoPay, Reparto, SAT, Casa, Metzada, ...)

Se corre ANTES de tocar nada, DESPUÉS de cada paso de MUDANZA-SOCIEDAD.md y al FINAL:

    python3 guardian.py                         # corre todo, imprime la tabla, guarda guardian-runs/<timestamp>.json
    python3 guardian.py --comparar guardian-runs/<otra>.json   # además dice qué cambió contra esa corrida
    python3 guardian.py --fase despues          # cuando Sociedad ya vive en el compartido (ver FASES abajo)
    python3 guardian.py --solo sociedad,comprobantes          # filtra apps por id

Sale con código 1 si cualquier chequeo da distinto a lo esperado. Los esperados están FIJOS en APPS (abajo).

Reglas que este script cumple (no se cambian):
  · Solo lectura. GET/HEAD a webs y a la API REST con la clave anon, RPCs que se verificaron de solo lectura
    (STABLE o sin INSERT/UPDATE/DELETE/pg_net en el cuerpo), y el "list" de Storage (un SELECT sobre storage.objects).
    Nada de crear pagos, pedir OTP, mandar WhatsApp, insertar filas ni subir archivos. Al webhook: solo GET.
  · Las claves NO viven aquí: se leen en cada corrida de los archivos versionados de los repos donde ya están
    (claves anon/publishable, públicas por diseño). Nunca se abren .env ni el baúl de credenciales.
    En pantalla y en el JSON solo sale "primeros 6 caracteres…" + una huella sha256 de 8 (para notar una rotación).
  · Sin dependencias: Python 3 del sistema.
"""
import argparse, base64, concurrent.futures as cf, hashlib, json, os, re, sys, time
import urllib.error, urllib.parse, urllib.request
from pathlib import Path

HOME = Path.home()
AQUI = Path(__file__).resolve().parent
RUNS = AQUI / "guardian-runs"
VIEJO, COMP = "obshrrzvfprsjeykqsen", "igsmhrwafhxlhmwcehiu"
NOMBRE = {VIEJO: "viejo", COMP: "compartido"}
UA = "guardian-mudanza/1 (solo lectura)"
TIMEOUT = 25

# ───────────────────────────── claves (de los repos, en cada corrida) ─────────────────────────────
# Cada JWT trae su `ref` dentro: así se sabe de qué proyecto es aunque la mudanza cambie el archivo.
FUENTES_CLAVE = [
    HOME / "sat-studio/index.html",                        # anon JWT del compartido
    HOME / "sociedad-2027-pagos/src/lib/supabase.js",      # anon JWT del viejo (respaldo hardcodeado del form)
    HOME / "sociedad-clasp/code.js",                       # anon JWT del viejo (webhook)
    HOME / "sociedad-2027-pagos/supabase/google_apps_script.js",
]
FUENTES_PUBLISHABLE = [  # sb_publishable_ no trae ref: se asume del compartido (es lo que dicen los dos archivos)
    HOME / "cuarto-madrijim/parte_json.py",
    HOME / "kineret/src/sync.ts",
]
RE_JWT = re.compile(r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}")
RE_PUB = re.compile(r"sb_publishable_[A-Za-z0-9_-]{10,}")


def _claims(jwt):
    p = jwt.split(".")[1]
    try:
        return json.loads(base64.urlsafe_b64decode(p + "=" * (-len(p) % 4)))
    except Exception:
        return {}


def cargar_claves():
    claves, origen = {}, {}
    for f in FUENTES_CLAVE:
        try:
            texto = f.read_text(errors="replace")
        except OSError:
            continue
        for k in RE_JWT.findall(texto):
            c = _claims(k)
            if c.get("role") == "anon" and c.get("ref") in (VIEJO, COMP) and (c["ref"], "anon") not in claves:
                claves[(c["ref"], "anon")] = k
                origen[(c["ref"], "anon")] = str(f).replace(str(HOME), "~")
    # después de la mudanza el form ya no trae la clave del viejo: se toma del último commit antes del corte
    if (VIEJO, "anon") not in claves:
        import subprocess
        texto = subprocess.run(["git", "-C", str(HOME / "sociedad-2027-pagos"), "show", "effc065:src/lib/supabase.js"],
                               capture_output=True, text=True).stdout
        for k in RE_JWT.findall(texto):
            if _claims(k).get("ref") == VIEJO and _claims(k).get("role") == "anon":
                claves[(VIEJO, "anon")] = k
                origen[(VIEJO, "anon")] = "git effc065:src/lib/supabase.js"
    for f in FUENTES_PUBLISHABLE:
        try:
            m = RE_PUB.search(f.read_text(errors="replace"))
        except OSError:
            continue
        if m and (COMP, "pub") not in claves:
            claves[(COMP, "pub")] = m.group(0)
            origen[(COMP, "pub")] = str(f).replace(str(HOME), "~")
    return claves, origen


def mascara(k):
    return f"{k[:6]}… sha{hashlib.sha256(k.encode()).hexdigest()[:8]}"


def mascara_url(u):
    u = re.sub(r"(/macros/s/[A-Za-z0-9_-]{8})[A-Za-z0-9_-]+", r"\1…", u)
    return re.sub(r"(user_content_key=)[^&]+", r"\1…", u)


def url_webhook():
    """La URL /exec del webhook no está en ningún repo (se sacó a propósito). Se toma de la variable
    GUARDIAN_WEBHOOK_URL o de la memoria de Sociedad. Nunca se imprime entera."""
    if os.environ.get("GUARDIAN_WEBHOOK_URL"):
        return os.environ["GUARDIAN_WEBHOOK_URL"]
    mem = HOME / ".claude/projects/-Users-tommyhanono/memory/project_sociedad2027.md"
    try:
        m = re.search(r"https://script\.google\.com/macros/s/AKfycbwg[A-Za-z0-9_-]+/exec", mem.read_text())
        return m.group(0) if m else None
    except OSError:
        return None


# ───────────────────────────── HTTP ─────────────────────────────
def http(url, metodo="GET", headers=None, cuerpo=None, leer=True, max_bytes=3_000_000):
    h = {"User-Agent": UA}
    h.update(headers or {})
    data = None
    if cuerpo is not None:
        data = json.dumps(cuerpo).encode()
        h["Content-Type"] = "application/json"
    ultimo = None
    for intento in range(2):
        req = urllib.request.Request(url, data=data, headers=h, method=metodo)
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return r.status, {k.lower(): v for k, v in r.headers.items()}, (r.read(max_bytes) if leer else b""), r.geturl()
        except urllib.error.HTTPError as e:
            return e.code, {k.lower(): v for k, v in e.headers.items()}, (e.read(max_bytes) if leer else b""), url
        except Exception as e:  # red, DNS, timeout: un reintento
            ultimo = e
            time.sleep(1.5)
    return 0, {}, f"{type(ultimo).__name__}: {ultimo}".encode(), url


def sb_headers(claves, proyecto, clave="anon", schema=None):
    k = claves.get((proyecto, clave))
    if not k:
        return None
    h = {"apikey": k}
    if clave == "anon":  # los JWT van también como Bearer; las publishable solo como apikey
        h["Authorization"] = "Bearer " + k
    if schema:
        h["Accept-Profile"] = schema
    return h


def contar(rango):
    # Content-Range: "0-0/59" o "*/0"
    m = re.search(r"/(\d+)$", rango or "")
    return int(m.group(1)) if m else None


# ───────────────────────────── tipos de chequeo ─────────────────────────────
# Cada chequeo devuelve {"obtenido": {...}, "resumen": "texto corto"}; la comparación con "esperado" es aparte.

def ck_web(c, claves):
    s, h, b, final = http(c["url"])
    t = b.decode("utf8", "replace")
    titulo = re.search(r"<title[^>]*>(.*?)</title>", t, re.S | re.I)
    titulo = re.sub(r"\s+", " ", titulo.group(1)).strip() if titulo else None
    refs = set(re.findall(r"([a-z]{20})\.supabase\.co", t))
    scripts = [urllib.parse.urljoin(final, x) for x in re.findall(r"<script[^>]+src=[\"']([^\"']+)[\"']", t, re.I)]
    propios = [x for x in scripts if urllib.parse.urlparse(x).netloc == urllib.parse.urlparse(final).netloc]
    bundle = None
    for i, su in enumerate(propios[:15]):
        s2, _, b2, _ = http(su)
        if i == 0 or (bundle and bundle["status"] != 200):
            bundle = {"status": s2, "bytes": len(b2)}
        refs |= set(re.findall(r"([a-z]{20})\.supabase\.co", b2.decode("utf8", "replace")))
    contiene = None
    if c.get("contiene"):
        contiene = bool(re.search(c["contiene"], t))
    obt = {"status": s, "bytes": len(b), "titulo": titulo, "bundle": bundle,
           "apunta_a": sorted(NOMBRE.get(r, r) for r in refs), "contiene": contiene}
    if s == 0:
        obt["error"] = t[:120]
    tam = lambda n: f"{n}B" if n < 2048 else f"{n//1024}kB"
    res = f"{s} {tam(len(b))}"
    if bundle:
        res += f" · js {bundle['status']} {tam(bundle['bytes'])}"
    if refs:
        res += " · →" + "+".join(obt["apunta_a"])
    if s == 404 and "DEPLOYMENT_NOT_FOUND" in t:
        res += " · DEPLOYMENT_NOT_FOUND"
        obt["deployment_not_found"] = True
    return obt, res


def ck_rest(c, claves):
    """HEAD con Prefer: count=exact → cuántas filas ve anon (no baja datos)."""
    h = sb_headers(claves, c["proyecto"], c.get("clave", "anon"), c.get("schema"))
    if h is None:
        return {"status": None, "sin_clave": True}, "sin clave pública en el repo"
    h.update({"Prefer": "count=exact", "Range": "0-0"})
    url = f"https://{c['proyecto']}.supabase.co/rest/v1/{c['tabla']}?select=*"
    s, hh, b, _ = http(url, "HEAD", h, leer=False)
    n = contar(hh.get("content-range"))
    sch = f"{c['schema']}." if c.get("schema") else ""
    return {"status": s, "filas": n}, f"{sch}{c['tabla']} {s}" + (f" · {n} filas" if n is not None else "")


def ck_rpc(c, claves):
    """Solo RPCs verificadas de lectura (ver la lista RPC_DE_LECTURA)."""
    assert c["fn"] in RPC_DE_LECTURA, f"{c['fn']} no está en la lista blanca de RPC de lectura"
    h = sb_headers(claves, c["proyecto"], c.get("clave", "anon"), c.get("schema"))
    if h is None:
        return {"status": None, "sin_clave": True}, "sin clave pública en el repo"
    url = f"https://{c['proyecto']}.supabase.co/rest/v1/rpc/{c['fn']}"
    s, _, b, _ = http(url, "POST", h, c.get("args", {}))
    obt = {"status": s}
    try:
        d = json.loads(b)
    except Exception:
        d = None
    if isinstance(d, list):
        obt["filas"] = len(d)
    elif isinstance(d, dict):
        obt["code"] = d.get("code")
        obt["claves"] = sorted(d.keys())[:12]
        if isinstance(d.get(c.get("numero", "")), (int, float)):
            obt["numero"] = d[c["numero"]]
    res = f"rpc {c['fn']}{c.get('etiqueta', '')} {s}"
    if "filas" in obt:
        res += f" · {obt['filas']} resultados"
    if obt.get("code"):
        res += f" · {obt['code']}"
    if "numero" in obt:
        res += f" · {c['numero']}={obt['numero']}"
    return obt, res


def ck_storage_list(c, claves):
    """POST /storage/v1/object/list/<bucket> es una LECTURA (SELECT en storage.objects con las policies de anon)."""
    h = sb_headers(claves, c["proyecto"], c.get("clave", "anon"))
    if h is None:
        return {"status": None, "sin_clave": True}, "sin clave pública en el repo"
    url = f"https://{c['proyecto']}.supabase.co/storage/v1/object/list/{c['bucket']}"
    s, _, b, _ = http(url, "POST", h, {"prefix": c.get("prefijo", ""), "limit": 1000, "offset": 0})
    try:
        d = json.loads(b)
    except Exception:
        d = None
    n = len(d) if isinstance(d, list) else None
    return {"status": s, "filas": n}, f"bucket {c['bucket']} {s}" + (f" · {n} objetos" if n is not None else "")


def ck_objeto(c, claves):
    """GET de 1 byte de un objeto público (Range: bytes=0-0)."""
    url = f"https://{c['proyecto']}.supabase.co/storage/v1/object/public/{c['bucket']}/{c['ruta']}"
    s, hh, _, _ = http(url, headers={"Range": "bytes=0-0"})
    total = contar(hh.get("content-range"))
    return {"status": s, "bytes_total": total}, f"objeto {c['bucket']}/{c['ruta'].split('/')[-1]} {s}"


def ck_json(c, claves):
    """GET a un endpoint JSON de la app (solo lectura en su código)."""
    s, _, b, _ = http(c["url"])
    try:
        d = json.loads(b)
    except Exception:
        d = None
    obt = {"status": s, "claves": sorted(d.keys())[:15] if isinstance(d, dict) else None}
    for campo in c.get("registrar", []):
        v = d
        for parte in campo.split("."):
            v = v.get(parte) if isinstance(v, dict) else None
        if isinstance(v, dict):
            v = sum(x for x in v.values() if isinstance(x, (int, float)))
        obt[campo] = v
    extra = " · ".join(f"{k}={obt[k]}" for k in c.get("registrar", []))
    return obt, f"{urllib.parse.urlparse(c['url']).path} {s}" + (f" · {extra}" if extra else "")


def ck_webhook(c, claves):
    u = url_webhook()
    if not u:
        return {"status": None, "sin_url": True}, "sin URL (pon GUARDIAN_WEBHOOK_URL)"
    s, _, b, final = http(u)  # SOLO GET. El script no tiene doGet: no corre nada, Apps Script responde su página de error
    t = b.decode("utf8", "replace")
    return ({"status": s, "contiene": bool(re.search(c["contiene"], t)), "url": mascara_url(u)},
            f"GET /exec {s} · " + ("sin doGet (vivo, sin efectos)" if re.search(c["contiene"], t) else "respuesta distinta"))


def ck_schemas(c, claves):
    """Pide un schema que no existe: PostgREST responde PGRST106 con la lista de 'Exposed schemas'."""
    h = sb_headers(claves, c["proyecto"], "anon", "zz_guardian_no_existe")
    if h is None:
        return {"status": None, "sin_clave": True}, "sin clave pública en el repo"
    s, _, b, _ = http(f"https://{c['proyecto']}.supabase.co/rest/v1/zz", headers=h)
    try:
        hint = json.loads(b).get("hint", "")
    except Exception:
        hint = ""
    m = re.search(r"exposed:\s*(.+)$", hint)
    lista = sorted(x.strip() for x in m.group(1).split(",")) if m else None
    return {"status": s, "expuestos": lista}, "expuestos: " + (", ".join(lista) if lista else f"? ({s})")


def ck_auth(c, claves):
    h = sb_headers(claves, c["proyecto"], "anon")
    if h is None:
        return {"status": None, "sin_clave": True}, "sin clave pública en el repo"
    s, _, _, _ = http(f"https://{c['proyecto']}.supabase.co/auth/v1/health", headers=h)
    return {"status": s}, f"auth/v1/health {s}"


TIPOS = {"web": ck_web, "rest": ck_rest, "rpc": ck_rpc, "storage_list": ck_storage_list, "objeto": ck_objeto,
         "json": ck_json, "webhook": ck_webhook, "schemas": ck_schemas, "auth": ck_auth}

# RPCs que se pueden llamar: verificadas el 11-oct-2026 en pg_proc (solo SELECT del catálogo):
#   buscar_alumnos(q)      viejo · SQL, sin INSERT/UPDATE/DELETE/pg_net; SELECT ... LIMIT 10 sobre el caché alumnos
#   encuesta_resultados()  compartido · STABLE, sin escrituras; agregados de la encuesta
#   sat_list_sessions()    compartido · SELECT de las sesiones de auth.uid(); anon NO tiene EXECUTE → 401 esperado
# Fuera de la lista a propósito: crear_pago, solicitar_codigo, verificar_codigo, set_*, panel_admin, tl_*, cc_*, casa_*,
# metzada_*, despeje_* (escriben, mandan algo o exigen un secreto).
RPC_DE_LECTURA = {"buscar_alumnos", "encuesta_resultados", "sat_list_sessions"}


# ───────────────────────────── las apps y lo esperado ─────────────────────────────
# esperado: status = lista de códigos válidos; filas = (op, n) con op en >=, ==, <=; contiene/bundle/apunta_a/claves.
# FASES: "antes" = Sociedad y ~/comprobantes viven en el viejo. "despues" = ya viven en el compartido
# (con las funciones en `public`, como hace mudanza_supabase.py). Cambia SOLO lo que depende de eso.
def apps(fase):
    soc = VIEJO if fase == "antes" else COMP
    soc_ref = NOMBRE[soc]
    W = lambda url, contiene=None, bundle=True, apunta=None, status=(200,): {
        "tipo": "web", "url": url, "contiene": contiene,
        "esperado": {"status": list(status), "bundle": bundle, "contiene": bool(contiene) if contiene else None,
                     "apunta_a": apunta}}
    no_probado = "no probado: sin vía segura"
    return [
        {"id": "profeaula", "app": "ProfeAula (prod)", "escritura": no_probado + " (todo pide login de profe)",
         "checks": [
             W("https://profeaula.vercel.app", r"ProfeAula", apunta=["compartido"]),
             {"tipo": "rest", "proyecto": COMP, "schema": "profeaula", "tabla": "classes",
              "esperado": {"status": [200], "filas": ("==", 0)}, "nota": "RLS cerrado: 0 esperado"},
             {"tipo": "storage_list", "proyecto": COMP, "bucket": "profeaula", "esperado": {"status": [200], "filas": (">=", 1)}},
             {"tipo": "objeto", "proyecto": COMP, "bucket": "profeaula", "ruta": "tutorial/Tutorial-ProfeAula-v2.mp4",
              "esperado": {"status": [206, 200]}},
         ]},
        {"id": "kioskopay", "app": "KioskoPay (demo)", "escritura": no_probado + " (recargas/aprobaciones = plata)",
         "checks": [
             W("https://tommyhanono.github.io/kioskopay-demo/", r"KioskoPay", apunta=["compartido"]),
             {"tipo": "rest", "proyecto": COMP, "schema": "kioskopay", "tabla": "schools",
              "esperado": {"status": [200], "filas": ("==", 0)}, "nota": "RLS cerrado: 0 esperado"},
             {"tipo": "storage_list", "proyecto": COMP, "bucket": "kioskopay-comprobantes",
              "esperado": {"status": [200], "filas": ("==", 0)}, "nota": "privado: [] esperado"},
         ]},
        {"id": "reparto", "app": "Reparto", "escritura": no_probado + " (solo servidor, Postgres directo)",
         "checks": [
             W("https://reparto-rutas.vercel.app", r"Reparto"),
             {"tipo": "json", "url": "https://reparto-rutas.vercel.app/api/chofer/guardian-no-existe",
              "registrar": ["error"], "esperado": {"status": [404], "claves": ["error"]},
              "nota": "token falso: el server hace un SELECT en reparto.* y responde 404 → la base contesta"},
         ]},
        {"id": "sat", "app": "SAT Studio", "escritura": no_probado + " (sat_upsert_session exige login)",
         "checks": [
             W("https://sat-studio.vercel.app/", r"SAT Studio", bundle=None, apunta=["compartido"]),
             {"tipo": "rpc", "proyecto": COMP, "fn": "sat_list_sessions",
              "esperado": {"status": [401], "code": "42501"}, "nota": "anon sin EXECUTE: 401/42501 esperado"},
         ]},
        {"id": "tresleches", "app": "tres-leches", "escritura": no_probado + " (pedidos reales)",
         "checks": [
             W("https://tres-leches-pedidos.vercel.app", r"Tres Leches", apunta=["compartido"]),
             {"tipo": "rest", "proyecto": COMP, "tabla": "pedidos", "esperado": {"status": [200, 206], "filas": (">=", 1)},
              "nota": "hoy ABIERTA a anon (002_cerrar_rls sin aplicar)"},
             {"tipo": "storage_list", "proyecto": COMP, "bucket": "comprobantes", "esperado": {"status": [200], "filas": (">=", 1)}},
         ]},
        {"id": "casa", "app": "Casa Santa Clara", "escritura": no_probado + " (casa_register y admin exigen PIN)",
         "checks": [
             W("https://casa-santa-clara.vercel.app/", r"Casa Santa Clara", apunta=["compartido"]),
             {"tipo": "rest", "proyecto": COMP, "tabla": "casa_config", "esperado": {"status": [200, 206], "filas": ("==", 1)}},
             {"tipo": "rest", "proyecto": COMP, "tabla": "casa_year", "esperado": {"status": [200, 206], "filas": (">=", 1)}},
         ]},
        {"id": "metzada", "app": "Metzada", "escritura": no_probado + " (pedidos de mamás reales)",
         "checks": [
             W("https://metzada-maletas.vercel.app/", r"Metzada", apunta=["compartido"]),
             {"tipo": "rest", "proyecto": COMP, "tabla": "metzada_pedidos", "esperado": {"status": [200, 206], "filas": (">=", 1)},
              "nota": "hoy ABIERTA a anon (runbook 002_cerrar_rls sin aplicar)"},
             {"tipo": "storage_list", "proyecto": COMP, "bucket": "metzada-comprobantes", "esperado": {"status": [200], "filas": (">=", 1)}},
         ]},
        {"id": "cuentas", "app": "Cuentas Claras", "escritura": no_probado + " (gastos de grupos reales)",
         "checks": [
             W("https://cuentas-claras-pty.vercel.app/", r"Cuentas Claras", apunta=["compartido"]),
             {"tipo": "rest", "proyecto": COMP, "tabla": "cc_miembros", "esperado": {"status": [200, 206], "filas": (">=", 1)},
              "nota": "SELECT abierto por diseño (Realtime); cc_grupos cerrada"},
         ]},
        {"id": "encuesta", "app": "Encuesta SAT", "escritura": no_probado + " (encuesta_responder inserta)",
         "checks": [
             W("https://encuesta-sat-studio.vercel.app/", bundle=None, status=(404,)),
             {"tipo": "rpc", "proyecto": COMP, "fn": "encuesta_resultados", "numero": "total",
              "esperado": {"status": [200], "claves_incluye": ["total"]}},
         ],
         "nota": "la web ya daba 404 DEPLOYMENT_NOT_FOUND el 11-oct, antes de la mudanza (esperado fijado así)"},
        {"id": "cuarto", "app": "Cuarto madrijim", "escritura": no_probado,
         "checks": [
             W("https://cuarto-madrijim.vercel.app/", r"madrijim", apunta=["compartido"]),
             {"tipo": "rest", "proyecto": COMP, "clave": "pub", "tabla": "cuarto_disenos",
              "esperado": {"status": [200, 206], "filas": (">=", 1)}, "nota": "con la publishable versionada"},
         ]},
        {"id": "kineret", "app": "Kineret", "escritura": no_probado,
         "checks": [W("https://kineret-3d.vercel.app/", r"Kinneret")],
         "lectura_nota": "solo Realtime broadcast, sin tabla: lectura no probada"},
        {"id": "despeje", "app": "Despeje", "escritura": no_probado + " (todo con login)",
         "checks": [
             W("https://despeje.vercel.app", r"Despeje"),
             {"tipo": "json", "url": "https://despeje.vercel.app/api/health", "registrar": ["ok", "ultimo_ciclo"],
              "esperado": {"status": [200], "claves": ["ok", "ultimo_ciclo"]},
              "nota": "lee despeje_estado server-side; ok=false ya el 11-oct (el poller no registra éxito)"},
             {"tipo": "rest", "proyecto": COMP, "tabla": "despeje_usuarios", "esperado": {"status": [401]},
              "nota": "anon sin grant: 401 esperado"},
         ]},
        {"id": "tablero", "app": "Tablero", "escritura": no_probado + " (Face ID)",
         "checks": [
             W("https://tablero-1zvtcr.vercel.app"),
             {"tipo": "rest", "proyecto": COMP, "tabla": "hub_audit", "esperado": {"status": [401]}, "nota": "anon sin grant: 401 esperado"},
         ]},
        {"id": "capturador", "app": "Capturador (ideas_)", "escritura": no_probado,
         "checks": [
             {"tipo": "rest", "proyecto": COMP, "tabla": "ideas_items", "esperado": {"status": [200], "filas": ("==", 0)},
              "nota": "RLS cerrado: 0 esperado (corre local, sin web)"},
         ]},
        {"id": "sociedad", "app": "Sociedad 2027 (form)",
         "escritura": no_probado + " (crear_pago/solicitar_codigo disparan webhook y WhatsApp)",
         "checks": [
             W("https://pagosmensualidadsociedad2027.vercel.app", r"Sociedad 2027", apunta=[soc_ref]),
             W("https://tommyhanono.github.io/sociedad-2027-pagos/", r"Sociedad 2027", apunta=[soc_ref]),
             {"tipo": "rpc", "proyecto": soc, "fn": "buscar_alumnos", "args": {"q": "abc"}, "etiqueta": "('abc')",
              "esperado": {"status": [200], "filas": (">=", 0)}},
             {"tipo": "rpc", "proyecto": soc, "fn": "buscar_alumnos", "args": {"q": "man"}, "etiqueta": "('man')",
              "esperado": {"status": [200], "filas": (">=", 1)}, "nota": "prueba que el caché alumnos tiene datos"},
             {"tipo": "rest", "proyecto": soc, "schema": None if fase == "antes" else "public",
              "tabla": "pagos" if fase == "antes" else "pagos_no_debe_existir_en_public",
              "esperado": {"status": [401] if fase == "antes" else [404]},
              "nota": "pagos cerrada a anon" if fase == "antes" else "pagos vive en schema sociedad (no expuesto)"},
         ]},
        {"id": "webhook", "app": "Webhook Apps Script", "escritura": "no probado: sin vía segura (un POST dispara el flujo real)",
         "checks": [{"tipo": "webhook", "contiene": r"doGet", "esperado": {"status": [200], "contiene": True}}]},
        {"id": "comprobantes", "app": "Comprobantes (verif.)", "escritura": no_probado + " (POST /api/decision escribe eventos)",
         "checks": [
             W("https://comprobantes-nu.vercel.app", r"Comprobantes", bundle=True),
             {"tipo": "json", "url": "https://comprobantes-nu.vercel.app/api/estado", "registrar": ["familias", "totales"],
              "esperado": {"status": [200], "claves": ["adaptador", "familias", "totales"]},
              "nota": "el server lee comprobantes_eventos con SUS variables: prueba la ruta real"},
             {"tipo": "rest", "proyecto": soc, "tabla": "comprobantes_eventos",
              "esperado": {"status": [200, 206], "filas": (">=", 1)}},
             {"tipo": "storage_list", "proyecto": soc, "bucket": "comprobantes-demo",
              "esperado": {"status": [200], "filas": (">=", 1)}},
         ]},
    ]


def config_compartido(fase):
    """'Configuración del compartido': si alguien toca 'Exposed schemas' o Auth, se nota aquí."""
    return [
        {"id": "cfg-comp-schemas", "app": "compartido: Exposed schemas", "tipo": "schemas", "proyecto": COMP,
         "esperado": {"status": [406], "incluye": ["public", "graphql_public", "kioskopay", "profeaula"]}},
        {"id": "cfg-comp-public", "app": "compartido: public", "tipo": "rest", "proyecto": COMP, "schema": "public",
         "tabla": "casa_config", "esperado": {"status": [200, 206], "filas": (">=", 1)}},
        {"id": "cfg-comp-profeaula", "app": "compartido: profeaula", "tipo": "rest", "proyecto": COMP, "schema": "profeaula",
         "tabla": "students", "esperado": {"status": [200], "filas": ("==", 0)}},
        {"id": "cfg-comp-kioskopay", "app": "compartido: kioskopay", "tipo": "rest", "proyecto": COMP, "schema": "kioskopay",
         "tabla": "students", "esperado": {"status": [200], "filas": ("==", 0)}},
        {"id": "cfg-comp-auth", "app": "compartido: Auth", "tipo": "auth", "proyecto": COMP, "esperado": {"status": [200]}},
        {"id": "cfg-viejo-schemas", "app": "viejo: Exposed schemas", "tipo": "schemas", "proyecto": VIEJO,
         "esperado": {"status": [406], "incluye": ["public", "graphql_public"]}},
        {"id": "cfg-viejo-auth", "app": "viejo: Auth", "tipo": "auth", "proyecto": VIEJO, "esperado": {"status": [200]}},
    ]


# ───────────────────────────── evaluar ─────────────────────────────
def evaluar(obt, esp):
    """Devuelve lista de motivos de FALLA (vacía = OK)."""
    if not esp:
        return []
    m = []
    if obt.get("sin_clave"):
        return ["sin clave pública en el repo"]
    if obt.get("sin_url"):
        return ["sin URL del webhook"]
    if "status" in esp and obt.get("status") not in esp["status"]:
        m.append(f"status {obt.get('status')} (esperado {'/'.join(map(str, esp['status']))})")
    if esp.get("filas") and obt.get("status") in esp.get("status", [obt.get("status")]):
        op, n = esp["filas"]
        v = obt.get("filas")
        okf = v is not None and {"==": v == n, ">=": v >= n, "<=": v <= n}[op]
        if not okf:
            m.append(f"filas {v} (esperado {op} {n})")
    if esp.get("bundle") and (not obt.get("bundle") or obt["bundle"]["status"] != 200 or obt["bundle"]["bytes"] < 1000):
        m.append(f"bundle JS {obt.get('bundle')}")
    if esp.get("contiene") is not None and obt.get("contiene") != esp["contiene"]:
        m.append("contenido esperado no aparece (¿página en blanco?)")
    if esp.get("apunta_a") is not None and obt.get("apunta_a") != esp["apunta_a"]:
        m.append(f"apunta a {obt.get('apunta_a')} (esperado {esp['apunta_a']})")
    if esp.get("code") and obt.get("code") != esp["code"]:
        m.append(f"code {obt.get('code')} (esperado {esp['code']})")
    if esp.get("claves") and not set(esp["claves"]) <= set(obt.get("claves") or []):
        m.append(f"JSON sin {sorted(set(esp['claves']) - set(obt.get('claves') or []))}")
    if esp.get("claves_incluye") and not set(esp["claves_incluye"]) <= set(obt.get("claves") or []):
        m.append("JSON sin los campos esperados")
    if esp.get("incluye"):
        falta = sorted(set(esp["incluye"]) - set(obt.get("expuestos") or []))
        if falta:
            m.append(f"FALTAN schemas expuestos: {', '.join(falta)}")
    return m


def correr_check(c, claves):
    try:
        obt, res = TIPOS[c["tipo"]](c, claves)
    except Exception as e:
        obt, res = {"status": None, "excepcion": f"{type(e).__name__}: {e}"}, f"excepción {type(e).__name__}"
    return obt, res, evaluar(obt, c.get("esperado"))


def clase(c):
    return "web" if c["tipo"] == "web" else "lectura"


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--comparar", metavar="JSON", help="compara contra una corrida anterior y dice qué cambió")
    ap.add_argument("--fase", choices=["antes", "despues"], default="antes")
    ap.add_argument("--solo", help="ids de app separados por coma")
    ap.add_argument("--no-guardar", action="store_true")
    a = ap.parse_args()

    claves, origen = cargar_claves()
    lista = apps(a.fase)
    cfg = config_compartido(a.fase)
    if a.solo:
        ids = set(a.solo.split(","))
        lista = [x for x in lista if x["id"] in ids]
        cfg = [x for x in cfg if x["id"] in ids]

    trabajos = []
    for ap_ in lista:
        for i, c in enumerate(ap_["checks"]):
            c["id"] = f"{ap_['id']}.{i}.{c['tipo']}"
            trabajos.append(c)
    trabajos += cfg
    with cf.ThreadPoolExecutor(max_workers=10) as ex:
        resultados = dict(zip([c["id"] for c in trabajos], ex.map(lambda c: correr_check(c, claves), trabajos)))

    salida = {"fecha": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "fase": a.fase, "solo": a.solo,
              "claves": {f"{NOMBRE[p]}:{t}": {"clave": mascara(k), "de": origen[(p, t)]} for (p, t), k in claves.items()},
              "apps": [], "config": []}
    filas, total_fallas = [], 0
    for ap_ in lista:
        partes = {"web": [], "lectura": []}
        checks_out, fallas = [], []
        for c in ap_["checks"]:
            obt, res, mot = resultados[c["id"]]
            marca = "" if not mot else " ✗"
            partes[clase(c)].append(res + marca)
            fallas += [f"{res}: {x}" for x in mot]
            checks_out.append({"id": c["id"], "tipo": c["tipo"], "clase": clase(c), "resumen": res, "obtenido": obt,
                               "esperado": c.get("esperado"), "nota": c.get("nota"), "ok": not mot, "motivos": mot})
        if ap_.get("lectura_nota"):
            partes["lectura"].append(ap_["lectura_nota"])
        total_fallas += len(fallas)
        salida["apps"].append({"id": ap_["id"], "app": ap_["app"], "ok": not fallas, "fallas": fallas,
                               "escritura": ap_["escritura"], "nota": ap_.get("nota"), "checks": checks_out})
        filas.append((ap_["app"], partes["web"], partes["lectura"], ap_["escritura"].split(" (")[0], not fallas))
    cfg_filas = []
    for c in cfg:
        obt, res, mot = resultados[c["id"]]
        total_fallas += len(mot)
        extra = []
        if c["tipo"] == "schemas" and obt.get("expuestos"):
            nuevos = sorted(set(obt["expuestos"]) - set(c["esperado"]["incluye"]))
            if nuevos:
                extra.append(f"aviso: expuestos además {', '.join(nuevos)}")
        salida["config"].append({"id": c["id"], "app": c["app"], "resumen": res, "obtenido": obt,
                                 "esperado": c.get("esperado"), "ok": not mot, "motivos": mot, "avisos": extra})
        cfg_filas.append((c["app"], res, mot, extra))

    # ── tabla ──
    print(f"\nGuardián de la mudanza · {salida['fecha']} · fase {a.fase}")
    for k, v in salida["claves"].items():
        print(f"  clave {k}: {v['clave']} (de {v['de']})")
    w = [24, 46, 58, 26]
    linea = "─" * (sum(w) + 12)
    print(linea)
    print(f"{'app':<{w[0]}} │ {'web':<{w[1]}} │ {'lectura':<{w[2]}} │ {'escritura':<{w[3]}} │ resultado")
    print(linea)
    for app, web, lec, esc, ok in filas:
        n = max(len(web), len(lec), 1)
        for i in range(n):
            print(f"{(app if i == 0 else ''):<{w[0]}} │ {(web[i] if i < len(web) else ''):<{w[1]}} │ "
                  f"{(lec[i] if i < len(lec) else ''):<{w[2]}} │ {(esc if i == 0 else ''):<{w[3]}} │ "
                  f"{(('OK' if ok else 'FALLA') if i == 0 else '')}")
        print("·" * (sum(w) + 12))
    print("\nConfiguración del compartido (y del viejo)")
    for app, res, mot, extra in cfg_filas:
        print(f"  {'OK   ' if not mot else 'FALLA'} {app:<30} {res}" + ("".join(f"\n        ✗ {x}" for x in mot))
              + ("".join(f"\n        · {x}" for x in extra)))
    if total_fallas:
        print("\nFALLAS:")
        for x in salida["apps"]:
            for f in x["fallas"]:
                print(f"  ✗ {x['app']}: {f}")
        for x in salida["config"]:
            for f in x["motivos"]:
                print(f"  ✗ {x['app']}: {f}")
    print(f"\n{'TODO COMO SE ESPERABA' if not total_fallas else f'{total_fallas} cosa(s) distinta(s) a lo esperado'}")

    if not a.no_guardar:
        RUNS.mkdir(parents=True, exist_ok=True)
        f = RUNS / f"{time.strftime('%Y%m%d-%H%M%S')}.json"
        f.write_text(json.dumps(salida, ensure_ascii=False, indent=1))
        print(f"guardado: {f}")

    if a.comparar:
        comparar(json.loads(Path(a.comparar).read_text()), salida)
    sys.exit(1 if total_fallas else 0)


def comparar(antes, ahora):
    def idx(s):
        d = {}
        for x in s.get("apps", []):
            for c in x["checks"]:
                d[c["id"]] = (x["app"], c)
        for c in s.get("config", []):
            d[c["id"]] = (c["app"], c)
        return d
    A, B = idx(antes), idx(ahora)
    print(f"\nCambios desde {antes.get('fecha')} (fase {antes.get('fase')}) → {ahora['fecha']} (fase {ahora['fase']})")
    n = 0
    for k in sorted(set(A) | set(B)):
        if k not in A:
            print(f"  + nuevo   {B[k][0]}: {B[k][1]['resumen']}"); n += 1; continue
        if k not in B:
            if ahora.get("solo"):
                continue  # corrida parcial: lo que no se corrió no "desapareció"
            print(f"  - ya no   {A[k][0]}: {A[k][1]['resumen']}"); n += 1; continue
        a, b = A[k][1], B[k][1]
        if a["ok"] != b["ok"]:
            print(f"  {'✓ ARREGLADO' if b['ok'] else '✗ SE ROMPIÓ'} {B[k][0]}: {a['resumen']}  →  {b['resumen']}"); n += 1
        elif a["resumen"] != b["resumen"] or a.get("obtenido", {}).get("expuestos") != b.get("obtenido", {}).get("expuestos"):
            print(f"  ~ cambió  {B[k][0]}: {a['resumen']}  →  {b['resumen']}"); n += 1
    ka, kb = antes.get("claves", {}), ahora.get("claves", {})
    for k in sorted(set(ka) | set(kb)):
        if ka.get(k, {}).get("clave") != kb.get(k, {}).get("clave"):
            print(f"  ~ clave {k}: {ka.get(k, {}).get('clave')} → {kb.get(k, {}).get('clave')}"); n += 1
    print("  (sin cambios)" if not n else f"  {n} cambio(s)")


if __name__ == "__main__":
    main()
