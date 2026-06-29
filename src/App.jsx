import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import VerifyScreen from './components/VerifyScreen'
import MonthsScreen from './components/MonthsScreen'
import PaymentInfo from './components/PaymentInfo'
import ComprobanteScreen from './components/ComprobanteScreen'
import SuccessScreen from './components/SuccessScreen'
import PanelAdmin from './components/PanelAdmin'

const TOKEN_KEY = 'sociedad2027_sesion'

function parseMeses(s) {
  return (typeof s === 'string' && s) ? s.split(',').map(x => x.trim()).filter(Boolean) : []
}

export default function App() {
  // Ruta oculta del panel de la tesorera (#panel), protegida por contraseña server-side.
  const isPanel = typeof window !== 'undefined' && window.location.hash === '#panel'
  const [sesion, setSesion]   = useState(null)     // { nombre, nombreCompleto, meses: [], token }
  const [pago, setPago]       = useState(null)     // { meses: [codes], mesesFull: [names], monto, mesLabel }
  const [screen, setScreen]   = useState('verify') // verify → months → info → comprobante → success
  const [successData, setSuccessData] = useState(null)
  const [restoring, setRestoring]     = useState(true)

  // "Recordame": al abrir, si hay token guardado y sigue válido (hasta fin de año), restaura la
  // sesión sin pedir código. Si venció o no existe, va a la pantalla de verificación. (NO se toca.)
  useEffect(() => {
    if (isPanel) { setRestoring(false); return }
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) { setRestoring(false); return }
    let cancelled = false
    ;(async () => {
      try {
        const { data, error } = await supabase.rpc('ver_saldo_con_token', { p_token: token })
        if (!cancelled && data && data.ok) {
          setSesion({ nombre: data.nombre, nombreCompleto: data.nombre_completo, meses: parseMeses(data.meses), token })
          setScreen('months')
        } else if (!cancelled && !error && data && data.ok === false) {
          // Olvidamos el token SOLO si la sesión está genuinamente vencida/inválida (ok:false explícito).
          // Si fue un error transitorio (error != null, o data null) NO lo borramos → el "recordame" sobrevive.
          localStorage.removeItem(TOKEN_KEY)
        }
      } catch (e) { /* sin conexión: queda en verificación, token intacto */ }
      if (!cancelled) setRestoring(false)
    })()
    return () => { cancelled = true }
  }, [])

  function handleVerified({ nombre, nombre_completo, meses, token }) {
    localStorage.setItem(TOKEN_KEY, token)
    setSesion({ nombre, nombreCompleto: nombre_completo, meses: parseMeses(meses), token })
    setPago(null)
    setScreen('months')
  }
  function handleSalir() {
    localStorage.removeItem(TOKEN_KEY)
    setSesion(null); setPago(null); setSuccessData(null); setScreen('verify')
  }
  function handleMonthsContinue(p) { setPago(p); setScreen('info') }
  function handleSuccess(data) { setSuccessData(data); setScreen('success') }
  async function handleReset() {
    setSuccessData(null); setPago(null); setScreen('months')
    // Tras pagar, refrescar los meses pagados para que el mes recién pagado salga en verde/bloqueado
    // (evita que la mamá lo re-pague). Best-effort: si falla, se mantiene el estado actual.
    try {
      if (sesion?.token) {
        const { data } = await supabase.rpc('ver_saldo_con_token', { p_token: sesion.token })
        if (data && data.ok) setSesion(s => (s ? { ...s, meses: parseMeses(data.meses) } : s))
      }
    } catch (e) { /* fail-open: no romper el flujo si el refresh falla */ }
  }

  const shell = { width: '100%', maxWidth: 'var(--app-max-w)', margin: '0 auto', padding: '8px var(--app-pad-x) 40px', minHeight: '100vh' }
  const alumnoDisplay = sesion ? (sesion.nombreCompleto || sesion.nombre) : ''

  if (isPanel) return <PanelAdmin />

  if (restoring) {
    return (
      <div style={{ ...shell, display: 'grid', placeItems: 'center' }}>
        <span style={{ width: 30, height: 30, borderRadius: '50%', border: '3px solid var(--border-strong)', borderTopColor: 'var(--brand)', display: 'inline-block', animation: 'spin360 .8s linear infinite' }} />
      </div>
    )
  }

  return (
    <div style={shell}>
      {screen === 'verify' && <VerifyScreen onVerified={handleVerified} />}

      {screen === 'months' && sesion && (
        <MonthsScreen alumnoDisplay={alumnoDisplay} mesesPagados={sesion.meses}
          initialMeses={pago ? pago.meses : []} onContinue={handleMonthsContinue} onSalir={handleSalir} />
      )}

      {screen === 'info' && sesion && pago && (
        <PaymentInfo alumnoDisplay={alumnoDisplay} monto={pago.monto} mesesFull={pago.mesesFull}
          onNext={() => setScreen('comprobante')} onBack={() => setScreen('months')} onSalir={handleSalir} />
      )}

      {screen === 'comprobante' && sesion && pago && (
        <ComprobanteScreen alumno={sesion.nombre} alumnoDisplay={alumnoDisplay} monto={pago.monto}
          mesesFull={pago.mesesFull} mesLabel={pago.mesLabel} token={sesion.token}
          onSuccess={handleSuccess} onBack={() => setScreen('info')} />
      )}

      {screen === 'success' && <SuccessScreen data={successData} token={sesion?.token} onReset={handleReset} />}
    </div>
  )
}
