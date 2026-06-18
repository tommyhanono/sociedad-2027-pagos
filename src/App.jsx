import { useState } from 'react'
import PaymentInfo from './components/PaymentInfo'
import PaymentForm from './components/PaymentForm'
import SuccessScreen from './components/SuccessScreen'

export default function App() {
  const [screen, setScreen] = useState('info')   // 'info' | 'form' | 'success'
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
    <div className="min-h-svh flex items-start justify-center" style={{ background: '#f0f4f8' }}>
      <div className="w-full px-4 pb-10" style={{ maxWidth: 440 }}>
        {screen === 'info'    && <PaymentInfo onNext={() => setScreen('form')} />}
        {screen === 'form'    && <PaymentForm onSuccess={handleSuccess} />}
        {screen === 'success' && <SuccessScreen data={successData} onReset={handleReset} />}
      </div>
    </div>
  )
}
