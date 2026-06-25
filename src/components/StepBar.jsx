// Barra de progreso 1-2-3 para que la mamá no se pierda en el flujo.
export default function StepBar({ step }) {
  const labels = ['Meses', 'Transferir', 'Comprobante']
  return (
    <div style={{ display: 'flex', gap: 8, paddingTop: 12 }}>
      {[1, 2, 3].map(n => (
        <div key={n} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'center' }}>
          <div style={{ width: '100%', height: 5, borderRadius: 3, background: n <= step ? 'var(--gold-400)' : 'var(--border-soft,#e8e3d8)', transition: 'background .2s' }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: n === step ? 'var(--brand)' : 'var(--text-muted)', fontFamily: 'var(--font-body)' }}>{n}. {labels[n - 1]}</span>
        </div>
      ))}
    </div>
  )
}
