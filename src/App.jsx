import { useState } from 'react'
import PaymentInfo from './components/PaymentInfo'
import PaymentForm from './components/PaymentForm'
import SuccessScreen from './components/SuccessScreen'

export default function App() {
  const [screen, setScreen] = useState('info')
  const [successData, setSuccessData] = useState(null)

  function handleSuccess(data) {
    setSuccessData(data)
    setScreen('success')
  }

  function handleReset() {
    setSuccessData(null)
    setScreen('info')
  }

  return (
    <div style={{ width: '100%', maxWidth: 'var(--app-max-w)', margin: '0 auto', padding: '8px var(--app-pad-x) 40px', minHeight: '100vh' }}>
      {screen === 'info'    && <PaymentInfo onNext={() => setScreen('form')} />}
      {screen === 'form'    && <PaymentForm onSuccess={handleSuccess} onBack={() => setScreen('info')} />}
      {screen === 'success' && <SuccessScreen data={successData} onReset={handleReset} />}
    </div>
  )
}
