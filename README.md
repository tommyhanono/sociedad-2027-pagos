# Sociedad 2027 — Pagos

Mobile-first React PWA for parents to submit ACH payment receipts. Built with React + Vite + Tailwind CSS + Supabase.

## Setup (5 steps)

### 1. Create a Supabase project
Go to [supabase.com](https://supabase.com), create a new project, and note your **Project URL** and **anon public key** (Settings → API).

### 2. Copy env keys
```bash
cp .env.example .env
```
Fill in `.env` with your Supabase credentials and ACH bank details.

### 3. Run the SQL schema
In your Supabase dashboard → **SQL Editor** → New query, paste and run the contents of [`supabase/setup.sql`](supabase/setup.sql).

### 4. Create the storage bucket
In Supabase dashboard → **Storage** → New bucket:
- Name: `comprobantes`
- Toggle **Public bucket** ON

Then add an upload policy:
- Storage → `comprobantes` → Policies → New policy → **"Allow anon upload"**
- Operation: `INSERT`, Role: `anon`, `WITH CHECK`: `true`

### 5. Run locally
```bash
npm install
npm run dev
```

## Deploy to GitHub Pages
```bash
npm run build
# push the dist/ folder or use gh-pages
```
The `vite.config.js` sets `base: '/sociedad-2027-pagos/'` for production automatically.

## App flow
| Screen | Description |
|--------|-------------|
| **1 — Instrucciones** | Shows ACH bank details from `.env` |
| **2 — Formulario** | Name, amount, month, receipt photo upload |
| **3 — Confirmación** | Animated checkmark + summary |

## 🔗 Links
- **Repo:** [github.com/tommyhanono/sociedad-2027-pagos](https://github.com/tommyhanono/sociedad-2027-pagos)
- **Deploy:** [tommyhanono.github.io/sociedad-2027-pagos](https://tommyhanono.github.io/sociedad-2027-pagos)
