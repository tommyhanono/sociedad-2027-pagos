import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // base del sitio:
  //  - Vercel  → '/'  (la app vive en la raíz del dominio; Vercel setea VERCEL=1 al buildear)
  //  - GitHub Pages (npm run deploy) → '/sociedad-2027-pagos/' (subcarpeta del repo)
  //  - dev local → '/'
  base: process.env.VERCEL ? '/' : (process.env.NODE_ENV === 'production' ? '/sociedad-2027-pagos/' : '/'),
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    strictPort: false,
  },
})
