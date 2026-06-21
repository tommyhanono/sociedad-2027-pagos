export default function PaymentInfo({ onNext }) {
  const banco        = import.meta.env.VITE_ACH_BANCO        || 'Credicorp Bank'
  const cuenta       = import.meta.env.VITE_ACH_CUENTA       || '4021-973-201'
  const tipo         = import.meta.env.VITE_ACH_TIPO         || 'Cuenta de Ahorros'
  const beneficiario = import.meta.env.VITE_ACH_BENEFICIARIO || 'Margie Hanono ó Esther Davarro'

  const rows = [
    { label: 'Beneficiario', value: beneficiario },
    { label: 'Banco',        value: banco },
    { label: 'Tipo',         value: tipo },
    { label: 'Cuenta',       value: cuenta },
  ]

  return (
    <div className="fade-in flex flex-col gap-6">
      {/* Header */}
      <div className="text-center pt-8 pb-4">
        <h1 className="text-3xl font-bold tracking-tight" style={{ color: '#1A3A6B' }}>
          Sociedad <span style={{ color: '#F5A623' }}>2027</span>
        </h1>
        <p className="text-sm mt-1" style={{ color: '#6B7280' }}>Pagos — Año escolar 2027</p>
      </div>

      {/* ACH Card */}
      <div className="rounded-2xl shadow-lg overflow-hidden" style={{ background: '#1A3A6B' }}>
        <div className="px-5 py-4 border-b border-white/10">
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#F5A623' }}>
            Datos para transferencia ACH
          </p>
        </div>
        <div className="divide-y divide-white/10">
          {rows.map(({ label, value }) => (
            <div key={label} className="flex justify-between items-center px-5 py-3.5">
              <span className="text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>{label}</span>
              <span className="text-sm font-semibold text-white text-right ml-4">{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Info note */}
      <div className="rounded-xl px-4 py-3 text-sm" style={{ background: '#FEF3C7', color: '#92400E' }}>
        Realiza tu transferencia ACH y luego sube el comprobante. El equipo lo revisará y confirmará tu pago.
      </div>

      {/* CTA */}
      <button
        onClick={onNext}
        className="w-full py-4 rounded-2xl text-base font-bold text-white shadow-md active:opacity-90 transition-opacity"
        style={{ background: '#F5A623' }}
      >
        Ya pagué →
      </button>
    </div>
  )
}
