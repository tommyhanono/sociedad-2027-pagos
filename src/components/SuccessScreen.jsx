import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const confettiPieces = [
  { l: '8%',  c: '#F5A623', d: '0s',    s: 8 },
  { l: '20%', c: '#1A3A6B', d: '.15s',  s: 6 },
  { l: '34%', c: '#F8B948', d: '.3s',   s: 10 },
  { l: '52%', c: '#22C55E', d: '.1s',   s: 7 },
  { l: '68%', c: '#E0951C', d: '.22s',  s: 9 },
  { l: '82%', c: '#7C9AC4', d: '.05s',  s: 6 },
  { l: '92%', c: '#F5A623', d: '.34s',  s: 8 },
]

// Número de la TESORERA (Marcela) al que la mamá puede avisar (opcional). Configurable por env.
const WA_NUMBER = import.meta.env.VITE_WA_TESORERA || '50766797887'

function buildWaUrl(janij, monto, mes, comprobante_url) {
  const msg = [
    `Buenas, les envío el comprobante de mi pago 🧾`,
    ``,
    `*Alumno/a:* ${janij}`,
    `*Monto:* B/. ${Number(monto).toFixed(2)}`,
    `*Mes(es):* ${mes}`,
    comprobante_url ? `*Comprobante:* ${comprobante_url}` : '',
  ].filter(Boolean).join('\n')
  return `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(msg)}`
}

// Polling del saldo real: el webhook escribe el resultado (con saldo del sheet) en
// la columna `estado` de Supabase. Acá lo leemos hasta que aparezca (máx ~24s, cubre cold start).
function useSaldo(pagoId, token) {
  const [state, setState] = useState({ status: pagoId ? 'loading' : 'timeout' })
  useEffect(() => {
    if (!pagoId) return
    let cancelled = false, tries = 0
    const poll = async () => {
      if (cancelled) return
      tries++
      try {
        // Lee SOLO el estado del pago propio por id, vía RPC `pago_estado` GATEADA por el token de
        // sesión (solo el alumno del pago puede leerlo; la tabla `pagos` queda cerrada al público).
        let estado = null
        const viaRpc = await supabase.rpc('pago_estado', { p_id: pagoId, p_token: token })
        if (!viaRpc.error && viaRpc.data != null) estado = viaRpc.data
        if (estado && estado !== 'pendiente') {
          let parsed = null
          try { parsed = JSON.parse(estado) } catch (e) {}
          if (parsed && !cancelled) { setState({ status: 'done', result: parsed }); return }
        }
      } catch (e) {}
      // Hasta ~38s: cubre cold start del webhook de Apps Script (10-15s) + OCR del comprobante + escrituras
      if (tries >= 26) { if (!cancelled) setState({ status: 'timeout' }); return }
      setTimeout(poll, 1500)
    }
    const t = setTimeout(poll, 800)
    return () => { cancelled = true; clearTimeout(t) }
  }, [pagoId, token])
  return state
}

function SaldoRow({ state }) {
  const baseRow = {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '16px 20px', borderBottom: '1px solid var(--border-soft)',
  }
  // Cargando — el webhook todavía está calculando el saldo real
  if (state.status === 'loading') {
    return (
      <div style={{ ...baseRow, background: 'var(--cream-050,#faf8f3)' }}>
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', fontFamily: 'var(--font-body)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--border-strong)', borderTopColor: 'var(--brand)', display: 'inline-block', animation: 'spin360 .8s linear infinite' }} />
          Calculando su saldo…
        </span>
      </div>
    )
  }
  // Timeout o sin id — no pudimos confirmar el saldo en el momento
  if (state.status === 'timeout' || !state.result) {
    return (
      <div style={{ ...baseRow, background: 'var(--cream-050,#faf8f3)' }}>
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', fontFamily: 'var(--font-body)' }}>Saldo</span>
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text-body)', fontFamily: 'var(--font-body)', textAlign: 'right', maxWidth: '62%' }}>
          Registrando su pago — se lo confirmaremos en breve
        </span>
      </div>
    )
  }
  const r = state.result
  // No encontrado / ambiguo — el pago necesita asignación manual
  if (!r.found) {
    return (
      <div style={{ ...baseRow, background: 'var(--pending-100,#fef9c3)' }}>
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--pending-700,#a16207)', fontFamily: 'var(--font-body)' }}>Saldo</span>
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--pending-700,#a16207)', fontFamily: 'var(--font-body)', textAlign: 'right', maxWidth: '62%' }}>
          Revisaremos y asignaremos su pago
        </span>
      </div>
    )
  }
  // Encontrado — mostramos el saldo real del sheet
  const alDia = r.saldo === 0
  return (
    <div style={{ ...baseRow, background: alDia ? 'var(--success-100,#dcfce7)' : 'var(--pending-100,#fef9c3)' }}>
      <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: alDia ? 'var(--success-700,#15803d)' : 'var(--pending-700,#a16207)', fontFamily: 'var(--font-body)' }}>
        {alDia ? '✓ Está al día' : 'Saldo pendiente'}
      </span>
      <span style={{ fontSize: 'var(--text-lg)', fontWeight: 800, color: alDia ? 'var(--success-700,#15803d)' : 'var(--pending-700,#a16207)', fontFamily: 'var(--font-display)' }}>
        {alDia ? '¡Al día! 🎉' : `B/. ${Number(r.saldo).toFixed(2)}`}
      </span>
    </div>
  )
}

export default function SuccessScreen({ data, token = '', onReset }) {
  const { janij = '', monto = 0, mes = '', comprobante_url, pagoId } = data || {}
  const waUrl = buildWaUrl(janij, monto, mes, comprobante_url)
  const saldoState = useSaldo(pagoId, token)
  const [imgBroken, setImgBroken] = useState(false)

  return (
    <div className="fade-in" style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, paddingTop: 20, paddingBottom: 32 }}>

      {/* Confetti */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }} aria-hidden="true">
        {confettiPieces.map((p, i) => (
          <span key={i} style={{ position: 'absolute', top: '-12px', left: p.l, width: p.s, height: p.s, background: p.c, borderRadius: i % 2 ? '2px' : '50%', animation: `confettiFall 1.5s ease-in ${p.d} 1 both` }} />
        ))}
      </div>

      {/* Animated check */}
      <div className="circle-pop" style={{ width: 104, height: 104, borderRadius: '50%', background: 'var(--success-100)', display: 'grid', placeItems: 'center', boxShadow: '0 12px 28px rgba(34,197,94,.28)' }}>
        <div style={{ width: 78, height: 78, borderRadius: '50%', background: 'var(--success-500)', display: 'grid', placeItems: 'center' }}>
          <svg width="42" height="42" viewBox="0 0 48 48" fill="none">
            <path d="M14 25l7 7 14-15" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"
              className="check-path" style={{ strokeDasharray: 48, strokeDashoffset: 48 }} />
          </svg>
        </div>
      </div>

      <div style={{ textAlign: 'center' }}>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 'var(--text-3xl)', color: 'var(--brand)', lineHeight: 1.1 }}>
          ¡Comprobante recibido!
        </h1>
        <p style={{ margin: '8px 0 0', fontSize: 'var(--text-md)', color: 'var(--text-muted)', lineHeight: 1.5, fontFamily: 'var(--font-body)' }}>
          ¡Gracias! 🙏 Lo revisaremos y se lo confirmaremos en breve.
        </p>
      </div>

      {/* Pending badge */}
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 14px', borderRadius: 'var(--r-pill)', background: 'var(--pending-100)', border: '1px solid #FDE68A' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--pending-500)', display: 'inline-block', animation: 'softPulse 1.8s ease-in-out infinite' }} />
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--pending-700)', fontFamily: 'var(--font-body)' }}>Pendiente de revisión</span>
      </div>

      {/* Summary card */}
      <div style={{ width: '100%', borderRadius: 'var(--r-xl)', background: '#fff', boxShadow: 'var(--shadow-md)', overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-soft)' }}>
          <p style={{ margin: 0, fontSize: 'var(--text-xs)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', fontFamily: 'var(--font-body)' }}>
            Resumen del pago
          </p>
        </div>
        {[
          { label: 'Alumno/a', value: janij },
          { label: 'Monto pagado', value: `B/. ${Number(monto).toFixed(2)}` },
          { label: 'Meses indicados', value: mes || '—' },
        ].map(({ label, value }) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderBottom: '1px solid var(--border-soft)' }}>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', fontFamily: 'var(--font-body)' }}>{label}</span>
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text-strong)', fontFamily: 'var(--font-body)', textAlign: 'right', maxWidth: '60%' }}>{value}</span>
          </div>
        ))}
        <SaldoRow state={saldoState} />
        {comprobante_url && !imgBroken && (
          <div style={{ padding: '14px 20px' }}>
            <img src={comprobante_url} alt="Comprobante" onError={() => setImgBroken(true)}
              style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 'var(--r-md)', boxShadow: 'var(--shadow-sm)', display: 'block' }} />
          </div>
        )}
        {comprobante_url && imgBroken && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px' }}>
            <span style={{ fontSize: 20 }}>✅</span>
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--success-700,#15803d)', fontFamily: 'var(--font-body)' }}>Comprobante recibido correctamente</span>
          </div>
        )}
      </div>

      {/* WhatsApp CTA */}
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
        <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--text-muted)', textAlign: 'center', fontFamily: 'var(--font-body)' }}>
          Ya lo recibimos. Si lo desea, puede avisar también por WhatsApp (opcional).
        </p>
        <a href={waUrl} target="_blank" rel="noopener noreferrer"
          style={{ width: '100%', padding: '17px 24px', borderRadius: 'var(--r-lg)', border: 'none', background: '#25D366', color: '#fff', fontSize: 'var(--text-lg)', fontWeight: 800, fontFamily: 'var(--font-display)', cursor: 'pointer', boxShadow: '0 10px 22px rgba(37,211,102,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, textDecoration: 'none', letterSpacing: '-0.01em' }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
          </svg>
          Avisar al tesorero por WhatsApp
        </a>
      </div>

      <button onClick={onReset}
        style={{ background: 'none', border: 'none', padding: '8px 0', cursor: 'pointer', fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--brand)', fontFamily: 'var(--font-body)', textDecoration: 'underline', textUnderlineOffset: 3 }}
      >
        Enviar otro comprobante
      </button>
    </div>
  )
}
