import { createClient } from '@supabase/supabase-js'

// Fallback a los valores PÚBLICOS reales del proyecto: la anon key es pública por diseño (ya está
// en el bundle/repo y la protege el RLS), así la app funciona aunque el host (Vercel/GitHub Pages)
// no tenga seteadas las variables de entorno. Si están seteadas, mandan ellas.
const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL     || 'https://obshrrzvfprsjeykqsen.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ic2hycnp2ZnByc2pleWtxc2VuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4MDMyMjIsImV4cCI6MjA5NzM3OTIyMn0.Lhlh3Sb9EQ8axxPsDBiEVVERdo8sDIZaGDhYQkxdNdo'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
