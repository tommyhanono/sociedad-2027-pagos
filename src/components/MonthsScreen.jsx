import { useState } from 'react'
import { MONTHS, MONTHS_FULL, MONTHS_DISABLED, CUOTA, CUOTA_YEAR } from '../lib/payment'
import StepBar from './StepBar'

// PASO 1 — ¿Qué vas a pagar? La mamá ve su saldo y toca los meses (solo taps, sin escribir nada).
export default function MonthsScreen({ alumnoDisplay = '', mesesPagados = [], initialMeses = [], onContinue, onSalir }) {
  const [meses, setMeses] = useState(initialMeses)
  const [error, setError] = useState('')

  const mesesPendientes = Math.max(0, 11 - mesesPagados.length)
  const saldoPendiente  = mesesPendientes * CUOTA
  const esPagado = (m) => mesesPagados.includes(MONTHS_FULL[m])

  const toggle = (m) => {
    if (MONTHS_DISABLED.has(m) || esPagado(m)) return
    setMeses(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m])
    setError('')
  }

  const total = meses.length * CUOTA

  function continuar() {
    if (!meses.length) { setError('Toque al menos un mes que va a pagar.'); return }
    const ordered   = MONTHS.filter(m => meses.includes(m))          // orden cronológico
    const mesesFull = ordered.map(m => MONTHS_FULL[m])
    const mesLabel  = mesesFull.map(n => `${n} ${CUOTA_YEAR}`).join(', ')
    onContinue({ meses: ordered, mesesFull, monto: total, mesLabel })
  }

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--section-gap)' }}>
      <StepBar step={1} />

      {/* Alumno verificado + cuánto debe */}
      <div style={{ borderRadius: 'var(--r-md)', padding: '14px 18px', background: 'var(--success-100,#dcfce7)', border: '1px solid #bbf7d0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <p style={{ margin: 0, fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--success-700,#15803d)', fontFamily: 'var(--font-body)' }}>✓ Verificado · {alumnoDisplay}</p>
          <p style={{ margin: '2px 0 0', fontSize: 'var(--text-sm)', fontWeight: 700, color: saldoPendiente === 0 ? 'var(--success-700,#15803d)' : 'var(--pending-700,#a16207)', fontFamily: 'var(--font-body)' }}>
            {saldoPendiente === 0 ? '¡Está al día! 🎉' : `Debe B/. ${saldoPendiente} (${mesesPendientes} ${mesesPendientes === 1 ? 'mes' : 'meses'})`}
          </p>
        </div>
        {onSalir && <button type="button" onClick={onSalir} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text-muted)', fontFamily: 'var(--font-body)', textDecoration: 'underline' }}>Salir</button>}
      </div>

      <header style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 'var(--text-3xl)', color: 'var(--brand)', lineHeight: 1.1 }}>¿Qué va a pagar?</h1>
        <p style={{ margin: 0, fontSize: 'var(--text-md)', color: 'var(--text-muted)', lineHeight: 1.5, fontFamily: 'var(--font-body)' }}>Toque los meses que va a pagar. <strong style={{ color: 'var(--success-700,#15803d)' }}>Verde</strong> = ya pagado.</p>
        <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--text-muted)', lineHeight: 1.5, fontFamily: 'var(--font-body)' }}>Enero aparece en gris porque no se cobra (la cuota va de febrero a diciembre).</p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {MONTHS.map(m => {
          const sel    = meses.includes(m)
          const pagado = esPagado(m)
          const noDisp = MONTHS_DISABLED.has(m)
          const disabled = noDisp || pagado
          return (
            <button key={m} type="button" onClick={() => toggle(m)} disabled={disabled} aria-pressed={sel}
              title={pagado ? 'Ya pagado' : noDisp ? 'No disponible' : undefined}
              style={{
                padding: '16px 0', borderRadius: 'var(--r-pill)', minHeight: 52,
                border: `1.5px solid ${pagado ? 'var(--success-500,#22c55e)' : sel ? 'var(--navy-700)' : 'var(--border-strong)'}`,
                background: pagado ? 'var(--success-100,#dcfce7)' : noDisp ? 'var(--ink-050,#f3f4f6)' : sel ? 'var(--navy-700)' : '#fff',
                color: pagado ? 'var(--success-700,#15803d)' : noDisp ? 'var(--text-muted)' : sel ? '#fff' : 'var(--text-body)',
                fontSize: 'var(--text-md)', fontWeight: (sel || pagado) ? 800 : 600, fontFamily: 'var(--font-body)',
                cursor: disabled ? 'not-allowed' : 'pointer', boxShadow: sel ? 'var(--shadow-md)' : 'none',
                transition: 'all .15s', transform: sel ? 'scale(1.03)' : 'scale(1)', opacity: noDisp ? 0.45 : 1,
              }}
            >{pagado ? '✓ ' + m : m}</button>
          )
        })}
      </div>

      {error && <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--error-500)', fontFamily: 'var(--font-body)' }}>{error}</p>}

      {/* Total en vivo */}
      <div style={{ borderRadius: 'var(--r-md)', padding: '16px 18px', background: meses.length ? 'var(--grad-navy-card)' : 'var(--cream-050,#faf8f3)', border: meses.length ? 'none' : '1px solid var(--border-soft,#e8e3d8)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: meses.length ? 'var(--text-on-navy)' : 'var(--text-muted)', fontFamily: 'var(--font-body)' }}>
          {meses.length
            ? `${meses.length} ${meses.length === 1 ? 'mes' : 'meses'}: ${MONTHS.filter(m => meses.includes(m)).map(m => MONTHS_FULL[m]).join(', ')}`
            : (mesesPendientes === 0 ? '🎉 Ya pagó todos los meses del año' : 'Toque los meses arriba')}
        </span>
        <span style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: meses.length ? 'var(--gold-400)' : 'var(--text-muted)', fontFamily: 'var(--font-display)' }}>B/. {total}</span>
      </div>

      <button type="button" onClick={continuar} disabled={!meses.length}
        style={{ width: '100%', padding: '17px 24px', borderRadius: 'var(--r-lg)', border: 'none', background: meses.length ? 'var(--grad-gold)' : 'var(--navy-300)', color: meses.length ? 'var(--text-on-gold)' : 'var(--text-on-navy)', fontSize: 'var(--text-lg)', fontWeight: 800, fontFamily: 'var(--font-display)', cursor: meses.length ? 'pointer' : 'not-allowed', boxShadow: meses.length ? 'var(--shadow-gold)' : 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
      >Continuar <span>→</span></button>
    </div>
  )
}
