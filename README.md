# Sociedad 2027 — Pagos

Mobile-first PWA para que los papás suban comprobantes de transferencia ACH. Cada pago se guarda en Supabase **y** aparece automáticamente en el Google Sheet "Informacion Sociedad 2027".

**Stack:** React + Vite + Tailwind CSS + Supabase (DB + Storage) + Google Apps Script (webhook → Sheets)

---

## Setup completo (7 pasos)

### 1. Crear proyecto en Supabase
Ve a [supabase.com](https://supabase.com) → New project. Anota tu **Project URL** y **anon public key** (Settings → API).

### 2. Copiar variables de entorno
```bash
cp .env.example .env
```
Llena `.env` con tus datos:
```env
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
VITE_ACH_BANCO=Banco Nacional de Panamá
VITE_ACH_CUENTA=123-456-7890
VITE_ACH_BENEFICIARIO=Sociedad 2027
```

### 3. Crear la tabla en Supabase
Dashboard → **SQL Editor** → New query → pega y ejecuta [`supabase/setup.sql`](supabase/setup.sql).

### 4. Crear el bucket de Storage
Dashboard → **Storage** → New bucket:
- Nombre: `comprobantes`
- **Public bucket: ON**

Luego añade política de upload:
- Storage → `comprobantes` → Policies → New policy → **"Allow anon upload"**
- Operation: `INSERT` | Role: `anon` | WITH CHECK: `true`

### 5. Conectar con Google Sheets (Sociedad 2027)

#### 5a. Crear el Google Apps Script
1. Abre [script.google.com](https://script.google.com) → **New project**
2. Borra el código existente y pega el contenido de [`supabase/google_apps_script.js`](supabase/google_apps_script.js)
3. Corre la función `testInsert()` para verificar que crea la tab **Pagos** en el sheet

#### 5b. Publicar como Web App
- **Deploy** → New deployment → **Web app**
- Execute as: **Me**
- Who has access: **Anyone**
- Copia la URL que termina en `/exec`

#### 5c. Crear el Webhook en Supabase
Dashboard → **Database** → **Webhooks** → Create new webhook:
- Name: `sync-to-sheets`
- Table: `pagos`
- Events: ✅ `INSERT`
- URL: pega la URL del Web App de Google
- HTTP method: `POST`

> A partir de aquí, cada vez que un papá envíe un comprobante, el pago aparece automáticamente en la tab **Pagos** del sheet [Informacion Sociedad 2027](https://docs.google.com/spreadsheets/d/1yx0Ciq-5TgacuoufSeIx4DrsB438LOiqJ9DpASChXp8).

### 6. Correr localmente
```bash
npm install
npm run dev
```

### 7. Deploy a GitHub Pages
```bash
npm run build
```
Sube el contenido de `dist/` a GitHub Pages (Settings → Pages → Deploy from branch `gh-pages`), o usa la acción de GitHub.

---

## Flujo de la app

| Pantalla | Qué hace |
|----------|----------|
| **1 — Instrucciones** | Muestra datos ACH del `.env` |
| **2 — Formulario** | Nombre janij, monto (B/.), mes, foto del comprobante |
| **3 — Confirmación** | Checkmark animado + resumen del pago |

Cada submit hace 3 cosas automáticamente:
1. Sube la foto a Supabase Storage (`comprobantes/`)
2. Inserta fila en tabla `pagos`
3. El webhook de Supabase llama al Apps Script → nueva fila en la tab **Pagos** del sheet

---

## Estructura de columnas en el Sheet (tab "Pagos")

| Fecha | Janij/a | Monto (B/.) | Mes | Estado | Comprobante |
|-------|---------|-------------|-----|--------|-------------|
| 18/06/2026 10:30 | David Cohen | 150 | Agosto 2026 | pendiente | https://... |

---

## 🔗 Links

- **Repo:** [github.com/tommyhanono/sociedad-2027-pagos](https://github.com/tommyhanono/sociedad-2027-pagos)
- **Sheet:** [Informacion Sociedad 2027](https://docs.google.com/spreadsheets/d/1yx0Ciq-5TgacuoufSeIx4DrsB438LOiqJ9DpASChXp8)
- **Deploy:** [tommyhanono.github.io/sociedad-2027-pagos](https://tommyhanono.github.io/sociedad-2027-pagos)
