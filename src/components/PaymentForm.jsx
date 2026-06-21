import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'

const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const MONTHS_FULL = { Ene:'Enero',Feb:'Febrero',Mar:'Marzo',Abr:'Abril',May:'Mayo',Jun:'Junio',Jul:'Julio',Ago:'Agosto',Sep:'Septiembre',Oct:'Octubre',Nov:'Noviembre',Dic:'Diciembre' }
const CURRENT_YEAR = new Date().getFullYear()

function Field({ label, error, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 'var(--text-sm)', color: 'var(--brand)' }}>
        {label} <span style={{ color: 'var(--error-500)' }}>*</span>
      </label>
      {children}
      {error && <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--error-500)', fontFamily: 'var(--font-body)' }}>{error}</p>}
    </div>
  )
}

export default function PaymentForm({ onSuccess, onBack }) {
  const [janij, setJanij]     = useState('')
  const [monto, setMonto]     = useState('')
  const [meses, setMeses]     = useState([])
  const [file, setFile]       = useState(null)
  const [preview, setPreview] = useState(null)
  const [errors, setErrors]   = useState({})
  const [loading, setLoading] = useState(false)
  const fileRef = useRef()

  const toggle = (m) => {
    setMeses(s => s.includes(m) ? s.filter(x => x !== m) : [...s, m])
    setErrors(p => ({ ...p, mes: undefined }))
  }

  function validate() {
    const e = {}
    if (!janij.trim()) e.janij = 'Ingresa el nombre del alumno/a'
    if (!monto || isNaN(Number(monto)) || Number(monto) <= 0) e.monto = 'Ingresa un monto válido'
    if (!meses.length) e.mes = 'Selecciona al menos un mes'
    if (!file) e.file = 'Sube el comprobante de pago'
    return e
  }

  function handleFile(e) {
    const f = e.target.files[0]
    if (!f) return
    setFile(f)
    setErrors(p => ({ ...p, file: undefined }))
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
      const ext = file.name.split('.').pop()
      const filename = `${Date.now()}-${janij.trim().replace(/\s+/g, '_')}.${ext}`
      const { error: uploadError } = await supabase.storage
        .from('comprobantes').upload(filename, file, { contentType: file.type })
      if (uploadError) throw uploadError
      const { data: urlData } = supabase.storage.from('comprobantes').getPublicUrl(filename)
      const comprobante_url = urlData.publicUrl
      const mesLabel = meses.map(m => `${MONTHS_FULL[m]} ${CURRENT_YEAR}`).join(', ')
      const { error: insertError } = await supabase.from('pagos').insert({
        janij: janij.trim(), monto: Number(monto), mes: mesLabel, comprobante_url,
      })
      if (insertError) throw insertError
      onSuccess({ janij: janij.trim(), monto: Number(monto), mes: mesLabel, comprobante_url })
    } catch (err) {
      console.error(err)
      setErrors({ submit: err.message || 'Ocurrió un error. Inténtalo de nuevo.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--section-gap)' }}>
      <header style={{ paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button type="button" onClick={onBack} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
          ← Volver
        </button>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 'var(--text-3xl)', color: 'var(--brand)', lineHeight: 1.1 }}>
          Subí tu comprobante
        </h1>
        <p style={{ margin: 0, fontSize: 'var(--text-md)', color: 'var(--text-muted)', lineHeight: 1.5, fontFamily: 'var(--font-body)' }}>
          Completá los datos del pago y adjuntá la foto.
        </p>
      </header>

      <Field label="Nombre del alumno/a" error={errors.janij}>
        <input type="text" value={janij}
          onChange={e => { setJanij(e.target.value); setErrors(p => ({ ...p, janij: undefined })) }}
          placeholder="Ej. Sara Hanono"
          style={{ width: '100%', padding: '14px 16px', borderRadius: 'var(--r-md)', border: `1.5px solid ${errors.janij ? 'var(--error-500)' : 'var(--border-strong)'}`, fontSize: 'var(--text-md)', fontFamily: 'var(--font-body)', color: 'var(--text-strong)', background: '#fff', outline: 'none', boxShadow: 'var(--shadow-xs)' }}
          onFocus={e => { e.target.style.borderColor = 'var(--gold-400)'; e.target.style.boxShadow = 'var(--ring-gold)' }}
          onBlur={e => { e.target.style.borderColor = errors.janij ? 'var(--error-500)' : 'var(--border-strong)'; e.target.style.boxShadow = 'var(--shadow-xs)' }}
        />
      </Field>

      <Field label="Monto pagado" error={errors.monto}>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--text-muted)', pointerEvents: 'none' }}>B/.</span>
          <input type="number" min="0" step="0.01" value={monto}
            onChange={e => { setMonto(e.target.value); setErrors(p => ({ ...p, monto: undefined })) }}
            placeholder="0.00"
            style={{ width: '100%', padding: '14px 16px 14px 48px', borderRadius: 'var(--r-md)', border: `1.5px solid ${errors.monto ? 'var(--error-500)' : 'var(--border-strong)'}`, fontSize: 'var(--text-md)', fontFamily: 'var(--font-body)', color: 'var(--text-strong)', background: '#fff', outline: 'none', boxShadow: 'var(--shadow-xs)' }}
            onFocus={e => { e.target.style.borderColor = 'var(--gold-400)'; e.target.style.boxShadow = 'var(--ring-gold)' }}
            onBlur={e => { e.target.style.borderColor = errors.monto ? 'var(--error-500)' : 'var(--border-strong)'; e.target.style.boxShadow = 'var(--shadow-xs)' }}
          />
        </div>
      </Field>

      <Field label="Meses que estás pagando" error={errors.mes}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {MONTHS.map(m => {
            const sel = meses.includes(m)
            return (
              <button key={m} type="button" onClick={() => toggle(m)}
                style={{ padding: '10px 0', borderRadius: 'var(--r-pill)', border: `1.5px solid ${errors.mes && !meses.length ? 'var(--error-500)' : sel ? 'var(--navy-700)' : 'var(--border-strong)'}`, background: sel ? 'var(--navy-700)' : '#fff', color: sel ? '#fff' : 'var(--text-body)', fontSize: 'var(--text-sm)', fontWeight: sel ? 700 : 600, fontFamily: 'var(--font-body)', cursor: 'pointer', boxShadow: sel ? 'var(--shadow-md)' : 'none', transition: 'all .15s', transform: sel ? 'scale(1.03)' : 'scale(1)' }}
              >{m}</button>
            )
          })}
        </div>
        {meses.length > 0 && (
          <p style={{ margin: '6px 0 0', fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontFamily: 'var(--font-body)' }}>
            Seleccionados: <strong style={{ color: 'var(--brand)' }}>{meses.map(m => MONTHS_FULL[m]).join(', ')}</strong>
          </p>
        )}
      </Field>

      <Field label="Comprobante de pago" error={errors.file}>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/heic,image/heif" style={{ display: 'none' }} onChange={handleFile} />
        {!preview ? (
          <button type="button" onClick={() => fileRef.current.click()}
            style={{ width: '100%', borderRadius: 'var(--r-xl)', border: `2px dashed ${errors.file ? 'var(--error-500)' : 'var(--border-strong)'}`, background: 'var(--cream-050)', padding: '32px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, cursor: 'pointer', transition: 'border-color .15s, background .15s' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--gold-400)'; e.currentTarget.style.background = 'var(--gold-050)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = errors.file ? 'var(--error-500)' : 'var(--border-strong)'; e.currentTarget.style.background = 'var(--cream-050)' }}
          >
            <div style={{ width: 52, height: 52, borderRadius: 'var(--r-md)', background: '#fff', boxShadow: 'var(--shadow-sm)', display: 'grid', placeItems: 'center' }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--ink-300)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 8a2 2 0 0 1 2-2h1.5l1-1.6a1 1 0 0 1 .9-.5h5.2a1 1 0 0 1 .9.5l1 1.6H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/>
                <circle cx="12" cy="12.5" r="3.2"/>
              </svg>
            </div>
            <div style={{ textAlign: 'center' }}>
              <p style={{ margin: 0, fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--text-body)', fontFamily: 'var(--font-body)' }}>Toca para subir foto</p>
              <p style={{ margin: '4px 0 0', fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontFamily: 'var(--font-body)' }}>JPG, PNG o HEIC</p>
            </div>
          </button>
        ) : (
          <div style={{ position: 'relative', borderRadius: 'var(--r-xl)', overflow: 'hidden', boxShadow: 'var(--shadow-md)' }}>
            <img src={preview} alt="Comprobante" style={{ width: '100%', maxHeight: 220, objectFit: 'cover', display: 'block' }} />
            <button type="button" onClick={() => { setFile(null); setPreview(null); fileRef.current.value = '' }}
              style={{ position: 'absolute', top: 10, right: 10, width: 30, height: 30, borderRadius: '50%', background: 'rgba(0,0,0,0.55)', border: 'none', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'grid', placeItems: 'center' }}
            >✕</button>
          </div>
        )}
      </Field>

      {errors.submit && (
        <div style={{ borderRadius: 'var(--r-md)', padding: '14px 16px', background: 'var(--error-100)', color: '#991B1B', fontSize: 'var(--text-sm)', fontFamily: 'var(--font-body)' }}>
          {errors.submit}
        </div>
      )}

      <button type="submit" disabled={loading}
        style={{ width: '100%', padding: '17px 24px', borderRadius: 'var(--r-lg)', border: 'none', background: loading ? 'var(--navy-300)' : 'var(--grad-submit)', color: 'var(--text-on-navy)', fontSize: 'var(--text-lg)', fontWeight: 800, fontFamily: 'var(--font-display)', cursor: loading ? 'not-allowed' : 'pointer', boxShadow: loading ? 'none' : 'var(--shadow-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}
      >
        {loading ? 'Enviando…' : 'Enviar comprobante'}
      </button>
    </form>
  )
}
