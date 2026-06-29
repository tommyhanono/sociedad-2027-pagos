import { useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'

// Panel para la tesorera/admin — ruta oculta (#panel), protegida por contraseña server-side
// (RPC panel_admin). Muestra el estado de pago de las 51 familias: quién está al día, quién debe,
// cuánto se lleva recaudado. Solo lectura. No expone nada sin la contraseña correcta.
const CUOTA = 30
const TOTAL_ANUAL = 330 // 11 meses (Feb–Dic) × 30

export default function PanelAdmin() {
  const [pass, setPass] = useState('')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [orden, setOrden] = useState('debe') // 'debe' | 'nombre'

  async function entrar(e) {
    e?.preventDefault?.()
    if (!pass.trim()) return
    setLoading(true); setError('')
    try {
      const { data: d, error: err } = await supabase.rpc('panel_admin', { p_secret: pass.trim() })
      if (err) throw err
      if (d && d.ok) setData(d.alumnos || [])
      else setError('Contraseña incorrecta.')
    } catch (e) {
      console.error(e)
      setError('No se pudo cargar el panel. Intente de nuevo.')
    } finally { setLoading(false) }
  }

  const filas = useMemo(() => {
    if (!data) return []
    const rows = data.map(a => {
      const meses = (a.meses || '').split(',').map(s => s.trim()).filter(Boolean)
      const pagado = Math.min(meses.length, 11) * CUOTA
      const saldo = Math.max(0, TOTAL_ANUAL - pagado)
      return { id: a.id || a.nombre, nombre: a.nombre, tel: a.tel || '', nMeses: meses.length, pagado, saldo, alDia: saldo === 0 }
    })
    const filtered = q.trim()
      ? rows.filter(r => r.nombre.toLowerCase().includes(q.trim().toLowerCase()))
      : rows
    return filtered.sort((a, b) => orden === 'nombre'
      ? a.nombre.localeCompare(b.nombre)
      : (b.saldo - a.saldo) || a.nombre.localeCompare(b.nombre))
  }, [data, q, orden])

  const totales = useMemo(() => {
    if (!data) return null
    let recaudado = 0, alDia = 0
    data.forEach(a => {
      const n = Math.min((a.meses || '').split(',').filter(x => x.trim()).length, 11)
      recaudado += n * CUOTA
      if (n >= 11) alDia++
    })
    return { recaudado, alDia, deben: data.length - alDia, total: data.length, esperado: data.length * TOTAL_ANUAL }
  }, [data])

  const card = { background: '#fff', borderRadius: 'var(--r-md, 14px)', border: '1.5px solid var(--border-strong, #e3e6ee)', padding: '14px 16px', boxShadow: 'var(--shadow-xs, 0 1px 3px rgba(0,0,0,.06))' }
  const shell = { width: '100%', maxWidth: 760, margin: '0 auto', padding: '20px 16px 56px', minHeight: '100vh' }

  // ── Gate de contraseña ──────────────────────────────────────────────
  if (!data) {
    return (
      <div style={{ ...shell, maxWidth: 420, display: 'grid', placeItems: 'center', minHeight: '80vh' }}>
        <form onSubmit={entrar} style={{ ...card, width: '100%', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 30 }}>🔒</div>
            <h1 style={{ fontFamily: 'var(--font-display, sans-serif)', fontSize: 22, color: 'var(--text-strong, #0E254A)', margin: '6px 0 2px' }}>Panel · Sociedad 2027</h1>
            <p style={{ fontSize: 14, color: '#667', margin: 0 }}>Solo para la tesorería. Ingrese la contraseña.</p>
          </div>
          <input type="password" value={pass} onChange={e => setPass(e.target.value)} placeholder="Contraseña"
            autoFocus style={{ width: '100%', padding: '14px 16px', borderRadius: 12, border: '1.5px solid var(--border-strong, #e3e6ee)', fontSize: 16, outline: 'none' }} />
          {error && <div style={{ color: '#c0392b', fontSize: 14, textAlign: 'center' }}>{error}</div>}
          <button type="submit" disabled={loading || !pass.trim()}
            style={{ padding: '15px', borderRadius: 14, border: 'none', background: loading || !pass.trim() ? '#b9c0d4' : 'var(--grad-gold, linear-gradient(135deg,#d4af37,#f1d27a))', color: 'var(--text-on-gold, #3a2e07)', fontSize: 17, fontWeight: 800, fontFamily: 'var(--font-display, sans-serif)', cursor: loading ? 'wait' : 'pointer' }}>
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    )
  }

  // ── Dashboard ───────────────────────────────────────────────────────
  const pct = totales.esperado ? Math.round((totales.recaudado / totales.esperado) * 100) : 0
  return (
    <div style={shell}>
      <h1 style={{ fontFamily: 'var(--font-display, sans-serif)', fontSize: 24, color: 'var(--text-strong, #0E254A)', margin: '0 0 4px' }}>Panel · Sociedad 2027</h1>
      <p style={{ fontSize: 13, color: '#889', margin: '0 0 18px' }}>Cuota B/.{CUOTA}/mes · 11 meses (Feb–Dic) · total B/.{TOTAL_ANUAL} por familia</p>

      {/* Resumen */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 18 }}>
        <div style={card}>
          <div style={{ fontSize: 12, color: '#889', fontWeight: 600 }}>RECAUDADO</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-strong, #0E254A)' }}>B/.{totales.recaudado.toLocaleString()}</div>
          <div style={{ fontSize: 12, color: '#889' }}>de B/.{totales.esperado.toLocaleString()} · {pct}%</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 12, color: '#889', fontWeight: 600 }}>AL DÍA</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#1e8e4e' }}>{totales.alDia}<span style={{ fontSize: 15, color: '#889' }}> / {totales.total}</span></div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 12, color: '#889', fontWeight: 600 }}>DEBEN</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#c0392b' }}>{totales.deben}</div>
        </div>
      </div>

      {/* Controles */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar familia…"
          style={{ flex: 1, minWidth: 160, padding: '11px 14px', borderRadius: 11, border: '1.5px solid var(--border-strong, #e3e6ee)', fontSize: 15, outline: 'none' }} />
        <button onClick={() => setOrden(orden === 'debe' ? 'nombre' : 'debe')}
          style={{ padding: '11px 14px', borderRadius: 11, border: '1.5px solid var(--border-strong, #e3e6ee)', background: '#fff', fontSize: 14, cursor: 'pointer', fontWeight: 600, color: '#445' }}>
          Orden: {orden === 'debe' ? 'deuda ↓' : 'A–Z'}
        </button>
      </div>

      {/* Tabla */}
      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        {filas.map((r, i) => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderTop: i ? '1px solid #eef0f5' : 'none', background: r.alDia ? '#fff' : '#fff8f6' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, color: 'var(--text-strong, #0E254A)', fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.nombre}</div>
              <div style={{ fontSize: 12.5, color: '#889' }}>{r.nMeses} de 11 meses · pagó B/.{r.pagado}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              {r.alDia
                ? <span style={{ fontSize: 13, fontWeight: 800, color: '#1e8e4e' }}>✓ Al día</span>
                : <span style={{ fontSize: 14, fontWeight: 800, color: '#c0392b' }}>Debe B/.{r.saldo}</span>}
            </div>
            {r.tel && (
              <a href={`https://wa.me/${r.tel}`} target="_blank" rel="noreferrer"
                style={{ fontSize: 18, textDecoration: 'none', flexShrink: 0 }} title="WhatsApp">💬</a>
            )}
          </div>
        ))}
        {filas.length === 0 && <div style={{ padding: 18, textAlign: 'center', color: '#889' }}>Sin resultados.</div>}
      </div>
      <p style={{ fontSize: 11.5, color: '#aab', textAlign: 'center', marginTop: 16 }}>
        Datos del cuadro de mensualidades. Solo lectura.
      </p>
    </div>
  )
}
