import { createClient } from '@supabase/supabase-js'

// Fallback a los valores PÚBLICOS reales del proyecto: la anon key es pública por diseño (ya está
// en el bundle/repo y la protege el RLS), así la app funciona aunque el host (Vercel/GitHub Pages)
// no tenga seteadas las variables de entorno. Si están seteadas, mandan ellas.
const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL     || 'https://igsmhrwafhxlhmwcehiu.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlnc21ocndhZmh4bGhtd2NlaGl1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3MTYyMTgsImV4cCI6MjA5ODI5MjIxOH0.YgABbnpPjbyEk9Pe0kP6Mx6Q8eBn5McxzZiAS5MJpYg'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
