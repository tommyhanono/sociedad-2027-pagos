import { useState } from 'react'
import StepBar from './StepBar'

const banco        = import.meta.env.VITE_ACH_BANCO        || 'Credicorp Bank'
const cuenta       = import.meta.env.VITE_ACH_CUENTA       || '4021-973-201'
const tipo         = import.meta.env.VITE_ACH_TIPO         || 'Cuenta de Ahorros'
const beneficiario = import.meta.env.VITE_ACH_BENEFICIARIO || 'Margie Hanono o Esther Davarro'

// Copia robusta: navigator.clipboard falla en el navegador interno de WhatsApp (contexto no seguro),
// así que caemos a un textarea + execCommand como respaldo.
function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text)
  return new Promise((resolve, reject) => {
    try {
      const ta = document.createElement('textarea')
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.focus(); ta.select()
      const ok = document.execCommand('copy'); document.body.removeChild(ta)
      ok ? resolve() : reject(new Error('copy failed'))
    } catch (e) { reject(e) }
  })
}

function CopyRow({ label, value, large }) {
  const [copied, setCopied] = useState(false)
  function copy() { copyText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) }).catch(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) }) }
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
      <div>
        <p style={{ margin: 0, fontSize: 'var(--text-xs)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-on-navy-mut)', fontFamily: 'var(--font-body)' }}>{label}</p>
        <p style={{ margin: '3px 0 0', fontSize: large ? 'var(--text-xl)' : 'var(--text-md)', fontWeight: large ? 800 : 600, color: 'var(--text-on-navy)', fontFamily: large ? 'var(--font-display)' : 'var(--font-body)', letterSpacing: large ? '0.04em' : 0 }}>{value}</p>
      </div>
      <button onClick={copy} style={{ flexShrink: 0, marginLeft: 12, padding: '6px 12px', borderRadius: 'var(--r-pill)', border: '1.5px solid rgba(255,255,255,0.2)', background: copied ? 'rgba(34,197,94,0.18)' : 'rgba(255,255,255,0.08)', color: copied ? '#86efac' : 'var(--text-on-navy-mut)', fontSize: 'var(--text-xs)', fontWeight: 700, fontFamily: 'var(--font-body)', cursor: 'pointer', transition: 'all .2s' }}>
        {copied ? '✓ Copiado' : 'Copiar'}
      </button>
    </div>
  )
}

// PASO 2 — Datos para transferir. Le decimos CUÁNTO (sale de los meses) y A DÓNDE.
export default function PaymentInfo({ onNext, onBack, alumnoDisplay = '', monto = 0, mesesFull = [], onSalir }) {
  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--section-gap)' }}>
      <StepBar step={2} />
      <button type="button" onClick={onBack} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', padding: '4px 0', cursor: 'pointer', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>← Volver a los meses</button>

      <header style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 'var(--text-3xl)', color: 'var(--brand)', lineHeight: 1.1 }}>Hacé tu transferencia</h1>
        <p style={{ margin: 0, fontSize: 'var(--text-md)', color: 'var(--text-muted)', lineHeight: 1.5, fontFamily: 'var(--font-body)' }}>Transferí por ACH a esta cuenta y después subí el comprobante.</p>
      </header>

      {/* Cuánto transferir (sale de los meses elegidos) */}
      <div style={{ borderRadius: 'var(--r-xl)', padding: '20px 22px', background: 'var(--grad-gold)', boxShadow: 'var(--shadow-gold)', textAlign: 'center' }}>
        <p style={{ margin: 0, fontSize: 'var(--text-sm)', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-on-gold)', opacity: 0.85, fontFamily: 'var(--font-body)' }}>Tenés que transferir</p>
        <p style={{ margin: '4px 0 0', fontSize: 'var(--text-4xl, 40px)', fontWeight: 800, color: 'var(--text-on-gold)', fontFamily: 'var(--font-display)', lineHeight: 1 }}>B/. {monto}</p>
        {mesesFull.length > 0 && (
          <p style={{ margin: '8px 0 0', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-on-gold)', opacity: 0.9, fontFamily: 'var(--font-body)' }}>
            Por: {mesesFull.join(', ')} ({mesesFull.length} × B/. 30)
          </p>
        )}
      </div>

      {/* Datos de la cuenta */}
      <div style={{ borderRadius: 'var(--r-2xl)', background: 'var(--grad-navy-card)', boxShadow: 'var(--shadow-navy)', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
          <p style={{ margin: 0, fontSize: 'var(--text-xs)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gold-400)', fontFamily: 'var(--font-body)' }}>Datos para transferencia ACH</p>
        </div>
        <CopyRow label="Beneficiario" value={beneficiario} />
        <CopyRow label="Banco"        value={banco} />
        <CopyRow label="Tipo"         value={tipo} />
        <CopyRow label="Cuenta"       value={cuenta} large />
      </div>

      <button onClick={onNext}
        style={{ width: '100%', padding: '17px 24px', borderRadius: 'var(--r-lg)', border: 'none', background: 'var(--grad-gold)', color: 'var(--text-on-gold)', fontSize: 'var(--text-lg)', fontWeight: 800, fontFamily: 'var(--font-display)', cursor: 'pointer', boxShadow: 'var(--shadow-gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
        <span>📎</span> Ya transferí — subir comprobante
      </button>
      {onSalir && <button type="button" onClick={onSalir} style={{ alignSelf: 'center', background: 'none', border: 'none', padding: '4px 0', cursor: 'pointer', fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text-muted)', fontFamily: 'var(--font-body)', textDecoration: 'underline' }}>Salir</button>}
    </div>
  )
}
