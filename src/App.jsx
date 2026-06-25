import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import VerifyScreen from './components/VerifyScreen'
import PaymentInfo from './components/PaymentInfo'
import PaymentForm from './components/PaymentForm'
import SuccessScreen from './components/SuccessScreen'

const TOKEN_KEY = 'sociedad2027_sesion'

function parseMeses(s) {
  return (typeof s === 'string' && s) ? s.split(',').map(x => x.trim()).filter(Boolean) : []
}

export default function App() {
  const [sesion, setSesion]   = useState(null)     // { nombre, meses: [], token }
  const [screen, setScreen]   = useState('verify')
  const [successData, setSuccessData] = useState(null)
  const [restoring, setRestoring]     = useState(true)

  // "Recordame": al abrir, si hay token guardado y sigue válido (hasta fin de año), restaura la
  // sesión sin pedir código de nuevo. Si venció o no existe, va a la pantalla de verificación.
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) { setRestoring(false); return }
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await supabase.rpc('ver_saldo_con_token', { p_token: token })
        if (!cancelled && data && data.ok) {
          setSesion({ nombre: data.nombre, nombreCompleto: data.nombre_completo, meses: parseMeses(data.meses), token })
          setScreen('info')
        } else if (!cancelled) {
          localStorage.removeItem(TOKEN_KEY)
        }
      } catch (e) { /* sin conexión: queda en verificación */ }
      if (!cancelled) setRestoring(false)
    })()
    return () => { cancelled = true }
  }, [])

  function handleVerified({ nombre, nombre_completo, meses, token }) {
    localStorage.setItem(TOKEN_KEY, token)
    setSesion({ nombre, nombreCompleto: nombre_completo, meses: parseMeses(meses), token })
    setScreen('info')
  }
  function handleSalir() {
    localStorage.removeItem(TOKEN_KEY)
    setSesion(null); setSuccessData(null); setScreen('verify')
  }
  function handleSuccess(data) { setSuccessData(data); setScreen('success') }
  function handleReset() { setSuccessData(null); setScreen('info') }

  const shell = { width: '100%', maxWidth: 'var(--app-max-w)', margin: '0 auto', padding: '8px var(--app-pad-x) 40px', minHeight: '100vh' }

  if (restoring) {
    return (
      <div style={{ ...shell, display: 'grid', placeItems: 'center' }}>
        <span style={{ width: 30, height: 30, borderRadius: '50%', border: '3px solid var(--border-strong)', borderTopColor: 'var(--brand)', display: 'inline-block', animation: 'spin360 .8s linear infinite' }} />
      </div>
    )
  }

  return (
    <div style={shell}>
      {screen === 'verify'  && <VerifyScreen onVerified={handleVerified} />}
      {screen === 'info'    && sesion && <PaymentInfo onNext={() => setScreen('form')} alumno={sesion.nombreCompleto || sesion.nombre} onSalir={handleSalir} />}
      {screen === 'form'    && sesion && <PaymentForm alumno={sesion.nombre} alumnoDisplay={sesion.nombreCompleto || sesion.nombre} mesesPagados={sesion.meses} onSuccess={handleSuccess} onBack={() => setScreen('info')} />}
      {screen === 'success' && <SuccessScreen data={successData} onReset={handleReset} />}
    </div>
  )
}
