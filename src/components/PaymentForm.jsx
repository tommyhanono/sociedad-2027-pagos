import { useState, useRef, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const MONTHS_FULL = { Ene:'Enero',Feb:'Febrero',Mar:'Marzo',Abr:'Abril',May:'Mayo',Jun:'Junio',Jul:'Julio',Ago:'Agosto',Sep:'Septiembre',Oct:'Octubre',Nov:'Noviembre',Dic:'Diciembre' }
const MONTHS_DISABLED = new Set(['Ene'])
const CUOTA = 30
const CUOTA_YEAR = 2026          // año de las cuotas (la promo se gradúa en 2027)
const MAX_FILE_MB = 12

// Convierte/compacta cualquier foto a JPEG con canvas. En iPhone esto además
// transforma el HEIC (que los navegadores no muestran) en un JPEG visible y liviano.
// Si el navegador no puede decodificar el archivo, devuelve null y usamos el original.
function compressToJpeg(file, maxDim = 1600, quality = 0.85) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    // Guarda: si el navegador no dispara ni onload ni onerror (HEIC raro en WebView de iOS),
    // resolvemos null a los 15s para no dejar el form colgado en "Procesando su foto…".
    let done = false
    const finish = (val) => { if (done) return; done = true; clearTimeout(guard); try { URL.revokeObjectURL(url) } catch (e) {}; resolve(val) }
    const guard = setTimeout(() => finish(null), 15000)
    img.onload = () => {
      let { width, height } = img
      if (Math.max(width, height) > maxDim) {
        const s = maxDim / Math.max(width, height)
        width = Math.round(width * s); height = Math.round(height * s)
      }
      const canvas = document.createElement('canvas')
      canvas.width = width; canvas.height = height
      try {
        canvas.getContext('2d').drawImage(img, 0, 0, width, height)
        canvas.toBlob((blob) => {
          if (blob) finish({ blob, url: URL.createObjectURL(blob) })
          else finish(null)
        }, 'image/jpeg', quality)
      } catch (e) { finish(null) }
    }
    img.onerror = () => finish(null)
    img.src = url
  })
}

// Huella SHA-256 del archivo ORIGINAL (identidad estable de la foto). Si el navegador no
// soporta crypto.subtle o falla, devuelve null y el flujo sigue normal (sin dedup para ese pago).
async function sha256Hex(file) {
  try {
    if (typeof crypto === 'undefined' || !crypto.subtle || !file.arrayBuffer) return null
    const buf = await file.arrayBuffer()
    const digest = await crypto.subtle.digest('SHA-256', buf)
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
  } catch (e) { return null }
}

async function processFile(file) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
  if (isPdf) return { uploadFile: file, previewUrl: null, kind: 'pdf', ext: 'pdf' }
  const jpeg = await compressToJpeg(file)
  if (jpeg) return { uploadFile: jpeg.blob, previewUrl: jpeg.url, kind: 'image', ext: 'jpg' }
  // No se pudo convertir (ej. HEIC en un navegador de escritorio): subimos el original.
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  return { uploadFile: file, previewUrl: URL.createObjectURL(file), kind: 'image', ext }
}

// Traduce errores técnicos a un mensaje claro y formal para la usuaria.
function friendlyError(err) {
  const msg = String(err?.message || err || '').toLowerCase()
  if (!navigator.onLine || msg.includes('failed to fetch') || msg.includes('network'))
    return 'Parece que no tiene conexión a internet. Conéctese e intente de nuevo.'
  if (msg.includes('payload') || msg.includes('large') || msg.includes('size') || msg.includes('exceeded'))
    return 'La foto es muy pesada. Intente con una más liviana o con una captura de pantalla.'
  if (msg.includes('duplicate') || msg.includes('already exists'))
    return 'Parece que este comprobante ya fue enviado. Revise el grupo o intente de nuevo.'
  return 'No pudimos enviar su comprobante. Revise su conexión e intente de nuevo. Si el problema continúa, escríbale al tesorero por WhatsApp.'
}

function Field({ label, error, children, hint }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 'var(--text-sm)', color: 'var(--brand)' }}>
        {label} <span style={{ color: 'var(--error-500)' }}>*</span>
      </label>
      {children}
      {hint && !error && <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontFamily: 'var(--font-body)' }}>{hint}</p>}
      {error && <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--error-500)', fontFamily: 'var(--font-body)' }}>{error}</p>}
    </div>
  )
}

export default function PaymentForm({ onSuccess, onBack }) {
  const [janij, setJanij]       = useState('')
  const [monto, setMonto]       = useState('')
  const [montoTouched, setMontoTouched] = useState(false)
  const [meses, setMeses]       = useState([])
  const [file, setFile]         = useState(null)        // { uploadFile, previewUrl, kind, ext }
  const [fileProcessing, setFileProcessing] = useState(false)
  const [previewBroken, setPreviewBroken] = useState(false)
  const [errors, setErrors]     = useState({})
  const [loading, setLoading]   = useState(false)
  const [sugerencias, setSugerencias] = useState([])   // nombres del autocompletado
  const [mesesPagados, setMesesPagados] = useState([]) // meses ya pagados del alumno elegido (nombres completos)
  const fileRef = useRef()
  const submittingRef = useRef(false)   // evita doble envío en taps ultra-rápidos
  const attemptIdRef = useRef(null)     // id estable del intento de pago (anti-duplicado por reintento de red)
  const sugTimer = useRef(null)         // debounce del autocompletado

  // Un mes está "pagado" (grisado, no seleccionable) si el alumno elegido ya lo pagó completo.
  const esPagado = (m) => mesesPagados.includes(MONTHS_FULL[m])

  const toggle = (m) => {
    if (MONTHS_DISABLED.has(m) || esPagado(m)) return
    setMeses(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m])
    setErrors(p => ({ ...p, mes: undefined, monto: undefined }))
  }

  // Autocompletado: al escribir el nombre, buscamos coincidencias (debounce) y limpiamos el
  // estado de "meses pagados" (ya no corresponde a un alumno elegido). Best-effort: si falla, nada.
  function onNombreChange(val) {
    setJanij(val)
    setErrors(p => ({ ...p, janij: undefined }))
    setMesesPagados([])
    if (sugTimer.current) clearTimeout(sugTimer.current)
    const q = val.trim()
    if (q.length < 2) { setSugerencias([]); return }
    sugTimer.current = setTimeout(async () => {
      try {
        const { data } = await supabase.rpc('buscar_alumnos', { q })
        setSugerencias(Array.isArray(data) ? data.map(d => d.nombre) : [])
      } catch (e) { setSugerencias([]) }
    }, 280)
  }

  // Al elegir un alumno de la lista: fijamos el nombre exacto y grisamos sus meses ya pagados.
  async function elegirAlumno(nombre) {
    setJanij(nombre)
    setSugerencias([])
    setErrors(p => ({ ...p, janij: undefined }))
    try {
      const { data } = await supabase.rpc('meses_pagados', { p_nombre: nombre })
      const arr = (typeof data === 'string' && data) ? data.split(',').map(s => s.trim()).filter(Boolean) : []
      setMesesPagados(arr)
      setMeses(prev => prev.filter(m => !arr.includes(MONTHS_FULL[m])))  // quitar de la selección los ya pagados
    } catch (e) { setMesesPagados([]) }
  }

  // Si la mamá no escribió un monto a mano, lo sugerimos según los meses elegidos.
  useEffect(() => {
    if (!montoTouched) setMonto(meses.length ? String(meses.length * CUOTA) : '')
  }, [meses, montoTouched])

  const sugerido = meses.length * CUOTA
  const montoNum = Number(monto)
  const montoDifiere = meses.length > 0 && monto !== '' && !isNaN(montoNum) && Math.abs(montoNum - sugerido) > 0.001

  function validate() {
    const e = {}
    const nombre = janij.trim()
    if (!nombre) e.janij = 'Escriba el nombre del alumno o alumna'
    else if (nombre.length < 3) e.janij = 'Escriba el nombre completo del alumno o alumna'
    if (monto === '' || isNaN(montoNum) || montoNum <= 0) e.monto = 'Escriba el monto que transfirió'
    else if (montoNum > 5000) e.monto = 'Ese monto parece muy alto. Verifique el número.'
    if (!meses.length) e.mes = 'Seleccione al menos un mes'
    if (!file) e.file = 'Suba el comprobante de pago'
    return e
  }

  async function handleFile(e) {
    const f = e.target.files[0]
    if (!f) return
    if (f.size > MAX_FILE_MB * 1024 * 1024) {
      setErrors(p => ({ ...p, file: `La foto es muy pesada (máx. ${MAX_FILE_MB} MB). Intente con una captura de pantalla.` }))
      if (fileRef.current) fileRef.current.value = ''
      return
    }
    setErrors(p => ({ ...p, file: undefined }))
    setPreviewBroken(false)
    setFileProcessing(true)
    try {
      const processed = await processFile(f)
      // Paso extra (no bloqueante): huella del archivo original para detectar comprobantes repetidos
      let hash = null
      try { hash = await sha256Hex(f) } catch (e) {}
      setFile({ ...processed, hash })
    } catch (err) {
      setErrors(p => ({ ...p, file: 'No pudimos leer ese archivo. Intente con una foto o una captura de pantalla.' }))
    } finally {
      setFileProcessing(false)
    }
  }

  function clearFile() {
    if (file?.previewUrl) { try { URL.revokeObjectURL(file.previewUrl) } catch (e) {} }
    setFile(null)
    setPreviewBroken(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (loading || submittingRef.current) return
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }
    if (!navigator.onLine) { setErrors({ submit: 'Parece que no tiene conexión a internet. Conéctese e intente de nuevo.' }); return }
    submittingRef.current = true
    setLoading(true)
    setErrors(p => ({ ...p, submit: undefined }))
    try {
      // Id ESTABLE por intento de pago: si la red corta tras subir pero antes de ver la
      // respuesta y la mamá reintenta, el upload al MISMO path falla con "already exists"
      // (upsert:false) y cortamos ANTES del segundo INSERT → no se duplica el pago.
      if (!attemptIdRef.current) {
        attemptIdRef.current = (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : String(Date.now()) + '-' + Math.round(Math.random() * 1e9)
      }
      // Fallback de nombre: si al sanitizar queda vacío (nombre solo en hebreo/árabe/etc.)
      const safeName = (janij.trim().replace(/\s+/g, '_').replace(/[^\w.-]/g, '')) || 'comprobante'
      // El hash (si se pudo calcular) va al inicio del nombre, separado con "__", para que el
      // webhook lo lea desde la URL y detecte comprobantes repetidos. Si no hay hash, nombre normal.
      const hashPrefix = file.hash ? `${file.hash}__` : ''
      const filename = `${hashPrefix}${attemptIdRef.current}-${safeName}.${file.ext}`
      const contentType = file.kind === 'pdf' ? 'application/pdf' : 'image/jpeg'
      const { error: uploadError } = await supabase.storage
        .from('comprobantes').upload(filename, file.uploadFile, { contentType })
      if (uploadError) throw uploadError
      const { data: urlData } = supabase.storage.from('comprobantes').getPublicUrl(filename)
      const comprobante_url = urlData.publicUrl
      const mesLabel = meses.map(m => `${MONTHS_FULL[m]} ${CUOTA_YEAR}`).join(', ')
      const montoFinal = Math.round(montoNum * 100) / 100
      // Registra el pago vía RPC `crear_pago` (security definer) para que la tabla `pagos` quede
      // cerrada al público (la anon key no la lee ni inserta directo). Fallback al insert directo
      // por si la RPC aún no está desplegada (transición). El webhook dispara igual (AFTER INSERT).
      // Ver supabase/secure_pagos.sql.
      let nuevoPagoId = null
      const crearRpc = await supabase.rpc('crear_pago', {
        p_janij: janij.trim(), p_monto: montoFinal, p_mes: mesLabel, p_comprobante_url: comprobante_url,
      })
      if (!crearRpc.error && crearRpc.data) {
        nuevoPagoId = crearRpc.data
      } else {
        const { data: inserted, error: insertError } = await supabase.from('pagos').insert({
          janij: janij.trim(), monto: montoFinal, mes: mesLabel, comprobante_url,
        }).select('id').single()
        if (insertError) throw insertError
        nuevoPagoId = inserted?.id || null
      }

      attemptIdRef.current = null   // éxito → el próximo pago usa un id nuevo

      // Pasamos el id para que la pantalla de éxito consulte el saldo real (lo calcula el
      // webhook leyendo el sheet, incluidos los pagos históricos) por polling.
      onSuccess({
        janij: janij.trim(), monto: montoFinal, mes: mesLabel,
        comprobante_url, pagoId: nuevoPagoId,
      })
    } catch (err) {
      console.error(err)
      setErrors({ submit: friendlyError(err) })
    } finally {
      setLoading(false)
      submittingRef.current = false
    }
  }

  const inputBase = (hasError) => ({
    width: '100%', padding: '14px 16px', borderRadius: 'var(--r-md)',
    border: `1.5px solid ${hasError ? 'var(--error-500)' : 'var(--border-strong)'}`,
    fontSize: 'var(--text-md)', fontFamily: 'var(--font-body)', color: 'var(--text-strong)',
    background: '#fff', outline: 'none', boxShadow: 'var(--shadow-xs)',
  })

  return (
    <form onSubmit={handleSubmit} noValidate className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--section-gap)' }}>
      <header style={{ paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button type="button" onClick={onBack} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', padding: '4px 0', cursor: 'pointer', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
          ← Volver
        </button>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 'var(--text-3xl)', color: 'var(--brand)', lineHeight: 1.1 }}>
          Suba su comprobante
        </h1>
        <p style={{ margin: 0, fontSize: 'var(--text-md)', color: 'var(--text-muted)', lineHeight: 1.5, fontFamily: 'var(--font-body)' }}>
          Complete los datos del pago y adjunte la foto del comprobante.
        </p>
      </header>

      <Field label="Nombre del alumno o alumna" error={errors.janij} hint="Escriba el nombre y elíjalo de la lista">
        <div style={{ position: 'relative' }}>
          <input type="text" value={janij} inputMode="text" autoComplete="off" maxLength={60}
            onChange={e => onNombreChange(e.target.value)}
            placeholder="Escriba aquí el nombre"
            style={inputBase(errors.janij)}
            onFocus={e => { e.target.style.borderColor = 'var(--gold-400)'; e.target.style.boxShadow = 'var(--ring-gold)' }}
            onBlur={e => { e.target.style.borderColor = errors.janij ? 'var(--error-500)' : 'var(--border-strong)'; e.target.style.boxShadow = 'var(--shadow-xs)'; setTimeout(() => setSugerencias([]), 150) }}
          />
          {sugerencias.length > 0 && (
            <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 20, background: '#fff', border: '1.5px solid var(--border-strong)', borderRadius: 'var(--r-md)', boxShadow: 'var(--shadow-md)', overflow: 'hidden', maxHeight: 240, overflowY: 'auto' }}>
              {sugerencias.map(n => (
                <button key={n} type="button" onMouseDown={e => { e.preventDefault(); elegirAlumno(n) }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '12px 16px', border: 'none', borderBottom: '1px solid var(--border-soft)', background: '#fff', fontSize: 'var(--text-md)', fontFamily: 'var(--font-body)', color: 'var(--text-strong)', cursor: 'pointer' }}
                >{n}</button>
              ))}
            </div>
          )}
        </div>
      </Field>

      <Field label="Meses que está pagando" error={errors.mes}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {MONTHS.map(m => {
            const sel      = meses.includes(m)
            const pagado   = esPagado(m)
            const noDisp   = MONTHS_DISABLED.has(m)
            const disabled = noDisp || pagado
            return (
              <button key={m} type="button" onClick={() => toggle(m)} disabled={disabled}
                aria-pressed={sel}
                title={pagado ? 'Ya pagado' : noDisp ? 'Este mes no está disponible' : undefined}
                style={{
                  padding: '14px 0', borderRadius: 'var(--r-pill)', minHeight: 46,
                  border: `1.5px solid ${pagado ? 'var(--success-500,#22c55e)' : errors.mes && !meses.length && !disabled ? 'var(--error-500)' : sel ? 'var(--navy-700)' : 'var(--border-strong)'}`,
                  background: pagado ? 'var(--success-100,#dcfce7)' : noDisp ? 'var(--ink-050,#f3f4f6)' : sel ? 'var(--navy-700)' : '#fff',
                  color: pagado ? 'var(--success-700,#15803d)' : noDisp ? 'var(--text-muted)' : sel ? '#fff' : 'var(--text-body)',
                  fontSize: 'var(--text-sm)', fontWeight: (sel || pagado) ? 700 : 600, fontFamily: 'var(--font-body)',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  boxShadow: sel ? 'var(--shadow-md)' : 'none',
                  transition: 'all .15s', transform: sel ? 'scale(1.03)' : 'scale(1)',
                  opacity: noDisp ? 0.45 : 1,
                }}
              >{pagado ? '✓ ' + m : m}</button>
            )
          })}
        </div>
        {mesesPagados.length > 0 && (
          <p style={{ margin: '8px 0 0', fontSize: 'var(--text-xs)', color: 'var(--success-700,#15803d)', fontFamily: 'var(--font-body)' }}>
            ✓ Los meses en verde ya están pagados.
          </p>
        )}
        {meses.length > 0 && (
          <p style={{ margin: '6px 0 0', fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontFamily: 'var(--font-body)' }}>
            {meses.length} {meses.length === 1 ? 'mes' : 'meses'} · <strong style={{ color: 'var(--brand)' }}>{meses.map(m => MONTHS_FULL[m]).join(', ')}</strong> = B/. {sugerido}
          </p>
        )}
      </Field>

      <Field label="Monto pagado" error={errors.monto}
        hint={montoDifiere ? undefined : (!montoTouched && meses.length > 0 ? 'Lo calculamos según los meses que seleccionó. Modifíquelo si transfirió otro monto.' : 'El monto que transfirió por ACH')}>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--text-muted)', pointerEvents: 'none' }}>B/.</span>
          <input type="number" min="0" step="1" inputMode="decimal" value={monto}
            onChange={e => { setMonto(e.target.value); setMontoTouched(true); setErrors(p => ({ ...p, monto: undefined })) }}
            placeholder="0.00"
            style={{ ...inputBase(errors.monto), padding: '14px 16px 14px 48px' }}
            onFocus={e => { e.target.style.borderColor = 'var(--gold-400)'; e.target.style.boxShadow = 'var(--ring-gold)' }}
            onBlur={e => { e.target.style.borderColor = errors.monto ? 'var(--error-500)' : 'var(--border-strong)'; e.target.style.boxShadow = 'var(--shadow-xs)' }}
          />
        </div>
        {montoDifiere && !errors.monto && (
          <p style={{ margin: '2px 0 0', fontSize: 'var(--text-xs)', color: 'var(--pending-700,#a16207)', fontFamily: 'var(--font-body)' }}>
            Seleccionó {meses.length} {meses.length === 1 ? 'mes' : 'meses'} (B/. {sugerido}) pero ingresó B/. {montoNum}. Si es a propósito, está bien.
          </p>
        )}
      </Field>

      <Field label="Comprobante de pago" error={errors.file}>
        <input ref={fileRef} type="file" accept="image/*,application/pdf" style={{ display: 'none' }} onChange={handleFile} />
        {fileProcessing ? (
          <div style={{ width: '100%', borderRadius: 'var(--r-xl)', border: '2px dashed var(--border-strong)', background: 'var(--cream-050)', padding: '32px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 26, height: 26, borderRadius: '50%', border: '3px solid var(--border-strong)', borderTopColor: 'var(--brand)', display: 'inline-block', animation: 'spin360 .8s linear infinite' }} />
            <p style={{ margin: 0, fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text-body)', fontFamily: 'var(--font-body)' }}>Procesando su foto…</p>
          </div>
        ) : !file ? (
          <button type="button" onClick={() => fileRef.current?.click()}
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
              <p style={{ margin: 0, fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--text-body)', fontFamily: 'var(--font-body)' }}>Toque aquí para subir su comprobante</p>
              <p style={{ margin: '4px 0 0', fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontFamily: 'var(--font-body)' }}>Foto o captura de pantalla</p>
            </div>
          </button>
        ) : (
          <div style={{ position: 'relative', borderRadius: 'var(--r-xl)', overflow: 'hidden', boxShadow: 'var(--shadow-md)', border: '1px solid var(--border-soft)' }}>
            {file.kind === 'image' && file.previewUrl && !previewBroken ? (
              <img src={file.previewUrl} alt="Comprobante" onError={() => setPreviewBroken(true)}
                style={{ width: '100%', maxHeight: 220, objectFit: 'cover', display: 'block' }} />
            ) : (
              <div style={{ width: '100%', padding: '28px 20px', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--success-100,#dcfce7)' }}>
                <span style={{ fontSize: 26 }}>{file.kind === 'pdf' ? '📄' : '✅'}</span>
                <div>
                  <p style={{ margin: 0, fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--success-700,#15803d)', fontFamily: 'var(--font-body)' }}>Comprobante cargado</p>
                  <p style={{ margin: '2px 0 0', fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontFamily: 'var(--font-body)' }}>Listo para enviar</p>
                </div>
              </div>
            )}
            <button type="button" onClick={clearFile} aria-label="Quitar comprobante"
              style={{ position: 'absolute', top: 10, right: 10, width: 32, height: 32, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', border: 'none', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', display: 'grid', placeItems: 'center' }}
            >✕</button>
          </div>
        )}
      </Field>

      {errors.submit && (
        <div style={{ borderRadius: 'var(--r-md)', padding: '14px 16px', background: 'var(--error-100)', color: '#991B1B', fontSize: 'var(--text-sm)', fontFamily: 'var(--font-body)', lineHeight: 1.5 }}>
          {errors.submit}
        </div>
      )}

      <button type="submit" disabled={loading || fileProcessing}
        style={{ width: '100%', padding: '17px 24px', borderRadius: 'var(--r-lg)', border: 'none', background: (loading || fileProcessing) ? 'var(--navy-300)' : 'var(--grad-submit)', color: 'var(--text-on-navy)', fontSize: 'var(--text-lg)', fontWeight: 800, fontFamily: 'var(--font-display)', cursor: (loading || fileProcessing) ? 'not-allowed' : 'pointer', boxShadow: (loading || fileProcessing) ? 'none' : 'var(--shadow-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}
      >
        {loading && <span style={{ width: 18, height: 18, borderRadius: '50%', border: '2.5px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', display: 'inline-block', animation: 'spin360 .8s linear infinite' }} />}
        {loading ? 'Enviando…' : 'Enviar comprobante'}
      </button>
    </form>
  )
}
