import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'

const NUM_DISPLAY = '6681-8669'   // número desde el que llega el código (el del tesorero)

// Pantalla de VERIFICACIÓN — puerta de entrada. Sin esto, la mamá no ve saldos ni montos.
// 1) Escribe el nombre de su hijo/a → 2) le llega un código por WhatsApp → 3) lo escribe → entra.
export default function VerifyScreen({ onVerified }) {
  const [step, setStep]   = useState('nombre')   // 'nombre' | 'codigo'
  const [janij, setJanij] = useState('')
  const [sugerencias, setSugerencias] = useState([])
  const [nombre, setNombre] = useState('')        // alumno elegido (nombre exacto del sistema)
  const [codigo, setCodigo] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState('')
  const sugTimer = useRef(null)

  function onNombreChange(val) {
    setJanij(val); setNombre(''); setError('')
    if (sugTimer.current) clearTimeout(sugTimer.current)
    const q = val.trim()
    if (q.length < 2) { setSugerencias([]); return }
    sugTimer.current = setTimeout(async () => {
      try {
        const { data } = await supabase.rpc('buscar_alumnos', { q })
        setSugerencias(Array.isArray(data) ? data.map(d => d.nombre) : [])
      } catch (e) { setSugerencias([]) }
    }, 280)
  }

  function elegir(n) { setNombre(n); setJanij(n); setSugerencias([]); setError('') }

  async function enviarCodigo() {
    const n = (nombre || janij).trim()
    if (n.length < 2) { setError('Escribí el nombre de tu hijo/a y elegilo de la lista.'); return }
    setLoading(true); setError('')
    try {
      const { data, error: e } = await supabase.rpc('solicitar_codigo', { p_nombre: n })
      if (e) throw e
      if (data && data.ok) { setNombre(n); setCodigo(''); setStep('codigo') }
      else if (data && data.error === 'no_habilitado') setError('Este alumno todavía no está habilitado. Escribile al tesorero por WhatsApp.')
      else if (data && data.error === 'no_encontrado') setError('No encontramos ese alumno. Revisá el nombre y elegilo de la lista que aparece.')
      else if (data && data.error === 'espera') { setError('Ya te enviamos un código hace un momento. Revisá tu WhatsApp.'); setStep('codigo') }
      else setError('No pudimos enviar el código. Intentá de nuevo.')
    } catch (err) {
      setError('No pudimos enviar el código. Revisá tu conexión a internet e intentá de nuevo.')
    } finally { setLoading(false) }
  }

  async function verificar() {
    const c = codigo.trim()
    if (!/^\d{4}$/.test(c)) { setError('Escribí los 4 números del código.'); return }
    setLoading(true); setError('')
    try {
      const { data, error: e } = await supabase.rpc('verificar_codigo', { p_nombre: nombre, p_codigo: c })
      if (e) throw e
      if (data && data.ok) onVerified({ nombre: data.nombre, meses: data.meses, token: data.token })
      else if (data && data.error === 'incorrecto') setError(`Código incorrecto. Te ${data.restantes === 1 ? 'queda' : 'quedan'} ${data.restantes} ${data.restantes === 1 ? 'intento' : 'intentos'}.`)
      else if (data && data.error === 'vencido') setError('El código venció o se agotaron los intentos. Volvé a pedir uno nuevo.')
      else setError('No pudimos verificar el código. Intentá de nuevo.')
    } catch (err) {
      setError('No pudimos verificar el código. Revisá tu conexión a internet.')
    } finally { setLoading(false) }
  }

  const inputStyle = {
    width: '100%', padding: '15px 16px', borderRadius: 'var(--r-md)', border: '1.5px solid var(--border-strong)',
    fontSize: 'var(--text-md)', fontFamily: 'var(--font-body)', color: 'var(--text-strong)', background: '#fff', outline: 'none', boxShadow: 'var(--shadow-xs)',
  }
  const cta = (dis) => ({
    width: '100%', padding: '17px 24px', borderRadius: 'var(--r-lg)', border: 'none',
    background: dis ? 'var(--navy-300)' : 'var(--grad-gold)', color: dis ? 'var(--text-on-navy)' : 'var(--text-on-gold)',
    fontSize: 'var(--text-lg)', fontWeight: 800, fontFamily: 'var(--font-display)', cursor: dis ? 'not-allowed' : 'pointer',
    boxShadow: dis ? 'none' : 'var(--shadow-gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
  })
  const spinner = <span style={{ width: 18, height: 18, borderRadius: '50%', border: '2.5px solid rgba(255,255,255,0.45)', borderTopColor: '#fff', display: 'inline-block', animation: 'spin360 .8s linear infinite' }} />

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--section-gap)' }}>
      <header style={{ paddingTop: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent-strong)', fontFamily: 'var(--font-body)' }}>Promoción 2027 · Pagos</span>
          <span style={{ fontSize: 'var(--text-md)', fontWeight: 800, color: 'var(--navy-300)', fontFamily: 'var(--font-display)' }}>ב״ה</span>
        </div>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 'var(--text-3xl)', color: 'var(--brand)', lineHeight: 1.1 }}>
          Verificá tu identidad
        </h1>
      </header>

      {/* Explicación simple para las mamás */}
      <div style={{ borderRadius: 'var(--r-md)', padding: '16px 18px', background: 'var(--gold-050)', border: '1px solid var(--gold-100)' }}>
        <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: '#92400E', lineHeight: 1.6, fontFamily: 'var(--font-body)' }}>
          Para cuidar la información de cada familia, primero verificamos que seas tú. Es rápido:
        </p>
        <ol style={{ margin: '10px 0 0', paddingLeft: 20, fontSize: 'var(--text-sm)', color: '#92400E', lineHeight: 1.7, fontFamily: 'var(--font-body)' }}>
          <li>Escribí el nombre de tu hijo/a y elegilo de la lista.</li>
          <li>Te enviamos un código de 4 números por WhatsApp.</li>
          <li>Escribilo acá y listo: vas a ver tu saldo y vas a poder pagar.</li>
        </ol>
        <p style={{ margin: '12px 0 0', fontSize: 'var(--text-xs)', color: '#92400E', lineHeight: 1.6, fontFamily: 'var(--font-body)' }}>
          📲 El código llega del número <strong>{NUM_DISPLAY}</strong>. Es <strong>automático</strong> (lo envía el sistema). Solo lo recibe el WhatsApp registrado de la familia.
        </p>
      </div>

      {step === 'nombre' && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 'var(--text-sm)', color: 'var(--brand)' }}>Nombre del alumno o alumna</label>
            <div style={{ position: 'relative' }}>
              <input type="text" value={janij} inputMode="text" autoComplete="off" maxLength={60}
                onChange={e => onNombreChange(e.target.value)} placeholder="Escribí aquí el nombre"
                style={inputStyle}
                onFocus={e => { e.target.style.borderColor = 'var(--gold-400)'; e.target.style.boxShadow = 'var(--ring-gold)' }}
                onBlur={e => { e.target.style.borderColor = 'var(--border-strong)'; e.target.style.boxShadow = 'var(--shadow-xs)'; setTimeout(() => setSugerencias([]), 150) }} />
              {sugerencias.length > 0 && (
                <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 20, background: '#fff', border: '1.5px solid var(--border-strong)', borderRadius: 'var(--r-md)', boxShadow: 'var(--shadow-md)', overflow: 'hidden', maxHeight: 240, overflowY: 'auto' }}>
                  {sugerencias.map(n => (
                    <button key={n} type="button" onMouseDown={e => { e.preventDefault(); elegir(n) }}
                      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '12px 16px', border: 'none', borderBottom: '1px solid var(--border-soft)', background: '#fff', fontSize: 'var(--text-md)', fontFamily: 'var(--font-body)', color: 'var(--text-strong)', cursor: 'pointer' }}
                    >{n}</button>
                  ))}
                </div>
              )}
            </div>
          </div>
          {error && <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--error-500)', fontFamily: 'var(--font-body)', lineHeight: 1.5 }}>{error}</p>}
          <button type="button" onClick={enviarCodigo} disabled={loading} style={cta(loading)}>
            {loading && spinner}{loading ? 'Enviando…' : '📲 Enviarme el código por WhatsApp'}
          </button>
        </>
      )}

      {step === 'codigo' && (
        <>
          <div style={{ borderRadius: 'var(--r-md)', padding: '14px 16px', background: 'var(--success-100,#dcfce7)', border: '1px solid #bbf7d0' }}>
            <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--success-700,#15803d)', fontWeight: 700, fontFamily: 'var(--font-body)', lineHeight: 1.5 }}>
              ✅ Te enviamos un código por WhatsApp{nombre ? ' para ' + nombre : ''}. Llega del {NUM_DISPLAY}. Revisá tu WhatsApp.
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 'var(--text-sm)', color: 'var(--brand)' }}>Escribí el código de 4 números</label>
            <input type="text" value={codigo} inputMode="numeric" autoComplete="one-time-code" maxLength={4}
              onChange={e => { setCodigo(e.target.value.replace(/\D/g, '').slice(0, 4)); setError('') }}
              placeholder="0000"
              style={{ ...inputStyle, fontSize: 'var(--text-2xl)', fontWeight: 800, letterSpacing: '0.5em', textAlign: 'center', fontFamily: 'var(--font-display)' }}
              onFocus={e => { e.target.style.borderColor = 'var(--gold-400)'; e.target.style.boxShadow = 'var(--ring-gold)' }}
              onBlur={e => { e.target.style.borderColor = 'var(--border-strong)'; e.target.style.boxShadow = 'var(--shadow-xs)' }} />
          </div>
          {error && <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--error-500)', fontFamily: 'var(--font-body)', lineHeight: 1.5 }}>{error}</p>}
          <button type="button" onClick={verificar} disabled={loading || codigo.length < 4} style={cta(loading || codigo.length < 4)}>
            {loading && spinner}{loading ? 'Verificando…' : 'Verificar y continuar'}
          </button>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button type="button" onClick={() => { setStep('nombre'); setError(''); setCodigo('') }}
              style={{ background: 'none', border: 'none', padding: '6px 0', cursor: 'pointer', fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text-muted)', fontFamily: 'var(--font-body)' }}>
              ← Cambiar de alumno
            </button>
            <button type="button" onClick={enviarCodigo} disabled={loading}
              style={{ background: 'none', border: 'none', padding: '6px 0', cursor: 'pointer', fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--brand)', fontFamily: 'var(--font-body)', textDecoration: 'underline', textUnderlineOffset: 3 }}>
              Reenviar código
            </button>
          </div>
        </>
      )}
    </div>
  )
}
