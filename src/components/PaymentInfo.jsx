import { useState } from 'react'

const banco        = import.meta.env.VITE_ACH_BANCO        || 'Credicorp Bank'
const cuenta       = import.meta.env.VITE_ACH_CUENTA       || '4021-973-201'
const tipo         = import.meta.env.VITE_ACH_TIPO         || 'Cuenta de Ahorros'
const beneficiario = import.meta.env.VITE_ACH_BENEFICIARIO || 'Margie Hanono o Esther Davarro'

const Piggy = ({ size = 110 }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <path d="M52 30c0-9-8-15-19-15-3 0-6 .5-8 1.4C23 13 19 12 19 12s1 4 2 6c-3 3-5 7-5 11 0 2 .6 4 1.6 5.6L16 40v6h6l1.6-3.2c1.4.5 3 .8 4.4.9V47h6v-3.3c2-.3 4-1 5.6-2L48 44h4v-7l-1.5-1.2C51.4 34 52 32 52 30Z" fill="#F5A623"/>
    <circle cx="41" cy="27" r="2.2" fill="#1A3A6B"/>
    <path d="M50 24c1.6 0 3-1 3.5-2.4.2-.6-.5-1-.9-.5-.6.7-1.5 1.1-2.6 1.1Z" fill="#F8B948"/>
    <rect x="28" y="9" width="9" height="2.4" rx="1.2" fill="#FBDDA0"/>
  </svg>
)

// Copia robusta: navigator.clipboard falla en el navegador interno de WhatsApp/Instagram
// (contexto no seguro), así que caemos a un textarea + execCommand como respaldo.
function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text)
  }
  return new Promise((resolve, reject) => {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.focus()
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      ok ? resolve() : reject(new Error('copy failed'))
    } catch (e) { reject(e) }
  })
}

function CopyRow({ label, value, large }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    copyText(value)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
      .catch(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
      <div>
        <p style={{ margin: 0, fontSize: 'var(--text-xs)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-on-navy-mut)', fontFamily: 'var(--font-body)' }}>{label}</p>
        <p style={{ margin: '3px 0 0', fontSize: large ? 'var(--text-xl)' : 'var(--text-md)', fontWeight: large ? 800 : 600, color: 'var(--text-on-navy)', fontFamily: large ? 'var(--font-display)' : 'var(--font-body)', letterSpacing: large ? '0.04em' : 0 }}>{value}</p>
      </div>
      <button
        onClick={copy}
        style={{ flexShrink: 0, marginLeft: 12, padding: '6px 12px', borderRadius: 'var(--r-pill)', border: '1.5px solid rgba(255,255,255,0.2)', background: copied ? 'rgba(34,197,94,0.18)' : 'rgba(255,255,255,0.08)', color: copied ? '#86efac' : 'var(--text-on-navy-mut)', fontSize: 'var(--text-xs)', fontWeight: 700, fontFamily: 'var(--font-body)', cursor: 'pointer', transition: 'all .2s' }}
      >
        {copied ? '✓ Copiado' : 'Copiar'}
      </button>
    </div>
  )
}

export default function PaymentInfo({ onNext }) {
  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--section-gap)' }}>

      {/* Header */}
      <header style={{ paddingTop: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent-strong)', fontFamily: 'var(--font-body)' }}>
            Promoción 2027 · Cuotas
          </span>
          <span style={{ fontSize: 'var(--text-md)', fontWeight: 800, color: 'var(--navy-300)', fontFamily: 'var(--font-display)' }}>ב״ה</span>
        </div>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 'var(--text-3xl)', color: 'var(--brand)', lineHeight: 1.1 }}>
          Datos para su transferencia
        </h1>
        <p style={{ margin: 0, fontSize: 'var(--text-md)', color: 'var(--text-muted)', lineHeight: 1.5, fontFamily: 'var(--font-body)' }}>
          Realice la transferencia ACH y luego presione <strong style={{ color: 'var(--text-body)' }}>Ya pagué</strong>.
        </p>
      </header>

      {/* Navy hero card */}
      <div style={{ borderRadius: 'var(--r-2xl)', background: 'var(--grad-navy-card)', boxShadow: 'var(--shadow-navy)', overflow: 'hidden', position: 'relative' }}>
        <div style={{ position: 'absolute', bottom: -14, left: -10, opacity: 0.13, transform: 'rotate(-8deg)', pointerEvents: 'none' }}>
          <Piggy />
        </div>
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
          <p style={{ margin: 0, fontSize: 'var(--text-xs)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gold-400)', fontFamily: 'var(--font-body)' }}>
            Datos para transferencia ACH
          </p>
        </div>
        <CopyRow label="Beneficiario" value={beneficiario} />
        <CopyRow label="Banco"        value={banco} />
        <CopyRow label="Tipo"         value={tipo} />
        <CopyRow label="Cuenta"       value={cuenta} large />
      </div>

      {/* Cuota mensual — para que sepan cuánto pagar */}
      <div style={{ borderRadius: 'var(--r-md)', padding: '14px 18px', background: 'var(--cream-050, #faf8f3)', border: '1px solid var(--border-soft, #e8e3d8)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <p style={{ margin: 0, fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--brand)', fontFamily: 'var(--font-body)' }}>Cuota mensual</p>
          <p style={{ margin: '2px 0 0', fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontFamily: 'var(--font-body)' }}>De Febrero a Diciembre (11 meses)</p>
        </div>
        <span style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: 'var(--brand)', fontFamily: 'var(--font-display)' }}>B/. 30</span>
      </div>

      {/* Info note */}
      <div style={{ borderRadius: 'var(--r-md)', padding: '14px 16px', background: 'var(--gold-050)', border: '1px solid var(--gold-100)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <span style={{ fontSize: 18, lineHeight: 1 }}>💡</span>
        <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: '#92400E', lineHeight: 1.5, fontFamily: 'var(--font-body)' }}>
          Realice la transferencia ACH y luego suba el comprobante. Lo revisaremos y le confirmaremos por el grupo.
        </p>
      </div>

      {/* CTA */}
      <button
        onClick={onNext}
        style={{ width: '100%', padding: '17px 24px', borderRadius: 'var(--r-lg)', border: 'none', background: 'var(--grad-gold)', color: 'var(--text-on-gold)', fontSize: 'var(--text-lg)', fontWeight: 800, fontFamily: 'var(--font-display)', cursor: 'pointer', boxShadow: 'var(--shadow-gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, letterSpacing: '-0.01em' }}
        onMouseDown={e => e.currentTarget.style.transform = 'scale(0.98)'}
        onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
        onTouchStart={e => e.currentTarget.style.transform = 'scale(0.97)'}
        onTouchEnd={e => e.currentTarget.style.transform = 'scale(1)'}
      >
        <span>💸</span> Ya pagué — subir comprobante
      </button>
    </div>
  )
}
