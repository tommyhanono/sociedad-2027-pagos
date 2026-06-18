import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'

const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
]

const CURRENT_YEAR = new Date().getFullYear()

export default function PaymentForm({ onSuccess }) {
  const [janij, setJanij]       = useState('')
  const [monto, setMonto]       = useState('')
  const [mes, setMes]           = useState('')
  const [file, setFile]         = useState(null)
  const [preview, setPreview]   = useState(null)
  const [errors, setErrors]     = useState({})
  const [loading, setLoading]   = useState(false)
  const fileRef = useRef()

  function validate() {
    const e = {}
    if (!janij.trim())  e.janij = 'Ingresa el nombre del janij/a'
    if (!monto || isNaN(Number(monto)) || Number(monto) <= 0) e.monto = 'Ingresa un monto válido'
    if (!mes)           e.mes   = 'Selecciona el mes que cubre'
    if (!file)          e.file  = 'Sube el comprobante de pago'
    return e
  }

  function handleFile(e) {
    const f = e.target.files[0]
    if (!f) return
    setFile(f)
    setErrors(prev => ({ ...prev, file: undefined }))
    const reader = new FileReader()
    reader.onload = ev => setPreview(ev.target.result)
    reader.readAsDataURL(f)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }

    setLoading(true)
    try {
      // 1. Upload image
      const ext = file.name.split('.').pop()
      const filename = `${Date.now()}-${janij.trim().replace(/\s+/g, '_')}.${ext}`
      const { error: uploadError } = await supabase.storage
        .from('comprobantes')
        .upload(filename, file, { contentType: file.type })
      if (uploadError) throw uploadError

      // 2. Get public URL
      const { data: urlData } = supabase.storage
        .from('comprobantes')
        .getPublicUrl(filename)
      const comprobante_url = urlData.publicUrl

      // 3. Insert row
      const { error: insertError } = await supabase.from('pagos').insert({
        janij: janij.trim(),
        monto: Number(monto),
        mes,
        comprobante_url,
      })
      if (insertError) throw insertError

      onSuccess({ janij: janij.trim(), monto: Number(monto), mes, comprobante_url })
    } catch (err) {
      console.error(err)
      setErrors({ submit: err.message || 'Ocurrió un error. Inténtalo de nuevo.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="fade-in flex flex-col gap-5">
      {/* Header */}
      <div className="text-center pt-8 pb-2">
        <h1 className="text-3xl font-bold tracking-tight" style={{ color: '#1A3A6B' }}>
          Sociedad <span style={{ color: '#F5A623' }}>2027</span>
        </h1>
        <p className="text-sm mt-1" style={{ color: '#6B7280' }}>Subir comprobante</p>
      </div>

      {/* Nombre janij */}
      <div>
        <label className="block text-sm font-semibold mb-1.5" style={{ color: '#1A3A6B' }}>
          Nombre del janij/a <span style={{ color: '#EF4444' }}>*</span>
        </label>
        <input
          type="text"
          value={janij}
          onChange={e => { setJanij(e.target.value); setErrors(p => ({ ...p, janij: undefined })) }}
          placeholder="Nombre completo"
          className="w-full px-4 py-3 rounded-xl border text-base outline-none transition-all"
          style={{
            borderColor: errors.janij ? '#EF4444' : '#D1D5DB',
            background: '#fff',
          }}
        />
        {errors.janij && <p className="text-xs mt-1" style={{ color: '#EF4444' }}>{errors.janij}</p>}
      </div>

      {/* Monto */}
      <div>
        <label className="block text-sm font-semibold mb-1.5" style={{ color: '#1A3A6B' }}>
          Monto pagado <span style={{ color: '#EF4444' }}>*</span>
        </label>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base font-semibold" style={{ color: '#6B7280' }}>B/.</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={monto}
            onChange={e => { setMonto(e.target.value); setErrors(p => ({ ...p, monto: undefined })) }}
            placeholder="0.00"
            className="w-full pl-12 pr-4 py-3 rounded-xl border text-base outline-none transition-all"
            style={{
              borderColor: errors.monto ? '#EF4444' : '#D1D5DB',
              background: '#fff',
            }}
          />
        </div>
        {errors.monto && <p className="text-xs mt-1" style={{ color: '#EF4444' }}>{errors.monto}</p>}
      </div>

      {/* Mes */}
      <div>
        <label className="block text-sm font-semibold mb-1.5" style={{ color: '#1A3A6B' }}>
          Mes que cubre <span style={{ color: '#EF4444' }}>*</span>
        </label>
        <select
          value={mes}
          onChange={e => { setMes(e.target.value); setErrors(p => ({ ...p, mes: undefined })) }}
          className="w-full px-4 py-3 rounded-xl border text-base outline-none appearance-none bg-white"
          style={{
            borderColor: errors.mes ? '#EF4444' : '#D1D5DB',
            color: mes ? '#111827' : '#9CA3AF',
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%236B7280'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right 12px center',
            backgroundSize: '20px',
          }}
        >
          <option value="">Selecciona un mes</option>
          {MONTHS.map(m => (
            <option key={m} value={`${m} ${CURRENT_YEAR}`}>{m} {CURRENT_YEAR}</option>
          ))}
        </select>
        {errors.mes && <p className="text-xs mt-1" style={{ color: '#EF4444' }}>{errors.mes}</p>}
      </div>

      {/* File upload */}
      <div>
        <label className="block text-sm font-semibold mb-1.5" style={{ color: '#1A3A6B' }}>
          Comprobante de pago <span style={{ color: '#EF4444' }}>*</span>
        </label>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/heic,image/heif"
          className="hidden"
          onChange={handleFile}
        />
        {!preview ? (
          <button
            type="button"
            onClick={() => fileRef.current.click()}
            className="w-full rounded-2xl border-2 border-dashed py-8 flex flex-col items-center gap-3 transition-colors active:opacity-80"
            style={{ borderColor: errors.file ? '#EF4444' : '#D1D5DB', background: '#F9FAFB' }}
          >
            {/* Camera icon */}
            <svg xmlns="http://www.w3.org/2000/svg" className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="#9CA3AF" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
            </svg>
            <div className="text-center">
              <p className="text-sm font-medium" style={{ color: '#374151' }}>Toca para subir foto</p>
              <p className="text-xs mt-0.5" style={{ color: '#9CA3AF' }}>JPG, PNG o HEIC</p>
            </div>
          </button>
        ) : (
          <div className="relative rounded-2xl overflow-hidden" style={{ background: '#F3F4F6' }}>
            <img src={preview} alt="Comprobante" className="w-full max-h-56 object-cover" />
            <button
              type="button"
              onClick={() => { setFile(null); setPreview(null); fileRef.current.value = '' }}
              className="absolute top-2 right-2 rounded-full w-7 h-7 flex items-center justify-center text-white text-xs font-bold"
              style={{ background: 'rgba(0,0,0,0.5)' }}
            >✕</button>
          </div>
        )}
        {errors.file && <p className="text-xs mt-1" style={{ color: '#EF4444' }}>{errors.file}</p>}
      </div>

      {/* Submit error */}
      {errors.submit && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: '#FEE2E2', color: '#991B1B' }}>
          {errors.submit}
        </div>
      )}

      {/* Submit button */}
      <button
        type="submit"
        disabled={loading}
        className="w-full py-4 rounded-2xl text-base font-bold text-white shadow-md flex items-center justify-center gap-2 transition-opacity disabled:opacity-70"
        style={{ background: '#1A3A6B' }}
      >
        {loading ? (
          <>
            <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            Enviando…
          </>
        ) : 'Enviar comprobante'}
      </button>
    </form>
  )
}
