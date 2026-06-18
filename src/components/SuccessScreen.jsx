export default function SuccessScreen({ data, onReset }) {
  return (
    <div className="fade-in flex flex-col items-center gap-6 pt-12 pb-8">
      {/* Animated checkmark */}
      <div className="circle-pop w-24 h-24 rounded-full flex items-center justify-center" style={{ background: '#DCFCE7' }}>
        <svg className="w-12 h-12" viewBox="0 0 52 52" fill="none">
          <circle cx="26" cy="26" r="24" stroke="#22C55E" strokeWidth="3" fill="none" />
          <polyline
            className="check-path"
            points="14,26 22,34 38,18"
            fill="none"
            stroke="#22C55E"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      {/* Title */}
      <div className="text-center">
        <h2 className="text-2xl font-bold" style={{ color: '#1A3A6B' }}>
          ¡Comprobante recibido!
        </h2>
        <p className="text-lg mt-1 font-medium" style={{ color: '#F5A623' }}>
          {data.janij}
        </p>
      </div>

      {/* Summary card */}
      <div className="w-full rounded-2xl overflow-hidden shadow" style={{ background: '#fff' }}>
        <div className="px-5 py-3 border-b" style={{ borderColor: '#F3F4F6' }}>
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#6B7280' }}>
            Resumen del pago
          </p>
        </div>
        {[
          { label: 'Janij/a',  value: data.janij },
          { label: 'Monto',    value: `B/. ${Number(data.monto).toFixed(2)}` },
          { label: 'Mes',      value: data.mes },
          { label: 'Estado',   value: 'Pendiente de revisión' },
        ].map(({ label, value }) => (
          <div key={label} className="flex justify-between items-center px-5 py-3 border-b last:border-0" style={{ borderColor: '#F3F4F6' }}>
            <span className="text-sm" style={{ color: '#6B7280' }}>{label}</span>
            <span className="text-sm font-semibold" style={{ color: '#111827' }}>{value}</span>
          </div>
        ))}
      </div>

      {/* Receipt thumbnail */}
      {data.comprobante_url && (
        <div className="w-full rounded-2xl overflow-hidden shadow max-h-40">
          <img src={data.comprobante_url} alt="Comprobante" className="w-full h-40 object-cover" />
        </div>
      )}

      <p className="text-sm text-center" style={{ color: '#6B7280' }}>
        El equipo revisará tu pago y te confirmará a la brevedad.
      </p>

      {/* Reset link */}
      <button
        onClick={onReset}
        className="text-sm font-semibold underline underline-offset-2"
        style={{ color: '#1A3A6B' }}
      >
        Enviar otro comprobante
      </button>
    </div>
  )
}
