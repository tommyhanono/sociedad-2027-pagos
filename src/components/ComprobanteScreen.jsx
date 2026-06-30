import { useState, useRef, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { MAX_FILE_MB, processFile, sha256Hex, friendlyError } from '../lib/payment'
import StepBar from './StepBar'

// PASO 3 — Subir comprobante. El alumno, el monto y los meses YA vienen elegidos (no se escribe nada).
// OJO: la lógica de subida + hash (dedup) + crear_pago es IDÉNTICA a la de antes — solo cambió de lugar.
export default function ComprobanteScreen({ alumno = '', alumnoDisplay = '', monto = 0, mesesFull = [], mesLabel = '', token = '', onSuccess, onBack, onSalir }) {
  const [file, setFile] = useState(null)
  const [fileProcessing, setFileProcessing] = useState(false)
  const [previewBroken, setPreviewBroken] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const fileRef = useRef()
  const submittingRef = useRef(false)
  const attemptIdRef = useRef(null)

  // Revoca el blob URL del preview al re-elegir archivo o al desmontar (evita fuga de object URLs).
  useEffect(() => () => { if (file?.previewUrl) { try { URL.revokeObjectURL(file.previewUrl) } catch (e) {} } }, [file])

  async function handleFile(e) {
    const f = e.target.files[0]
    if (!f) return
    if (f.size > MAX_FILE_MB * 1024 * 1024) {
      setError(`La foto es muy pesada (máx. ${MAX_FILE_MB} MB). Pruebe con una captura de pantalla.`)
      if (fileRef.current) fileRef.current.value = ''
      return
    }
    // Solo imagen o PDF (el bucket también lo limita server-side, pero avisamos amable acá).
    const okType = f.type.startsWith('image/') || f.type === 'application/pdf' || /\.(pdf|jpe?g|png|heic|heif|webp|gif)$/i.test(f.name)
    if (!okType) {
      setError('Suba una foto o un PDF del comprobante (no otro tipo de archivo).')
      if (fileRef.current) fileRef.current.value = ''
      return
    }
    setError(''); setPreviewBroken(false); setFileProcessing(true)
    try {
      const processed = await processFile(f)
      let hash = null
      try { hash = await sha256Hex(f) } catch (e) {}
      setFile({ ...processed, hash })
    } catch (err) {
      setError('No pudimos leer ese archivo. Pruebe con una foto o una captura de pantalla.')
    } finally { setFileProcessing(false) }
  }

  function clearFile() {
    if (file?.previewUrl) { try { URL.revokeObjectURL(file.previewUrl) } catch (e) {} }
    setFile(null); setPreviewBroken(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleSubmit() {
    if (loading || submittingRef.current) return
    if (!file) { setError('Suba la foto del comprobante.'); return }
    submittingRef.current = true; setLoading(true); setError('')
    try {
      if (!attemptIdRef.current) {
        attemptIdRef.current = (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID() : String(Date.now()) + '-' + Math.round(Math.random() * 1e9)
      }
      const safeName    = (alumno.trim().replace(/\s+/g, '_').replace(/[^\w.-]/g, '')) || 'comprobante'
      const hashPrefix  = file.hash ? `${file.hash}__` : ''
      const filename    = `${hashPrefix}${attemptIdRef.current}-${safeName}.${file.ext}`
      const contentType = file.kind === 'pdf' ? 'application/pdf' : 'image/jpeg'
      // INSERT plano (sin upsert): el bucket solo permite INSERT anónimo, NO SELECT, así que upsert:true
      // daría 403 ("row-level security"). En un reintento se resetea attemptIdRef en el catch, de modo que
      // el reintento genera un filename nuevo y no choca con un 409.
      const { error: uploadError } = await supabase.storage.from('comprobantes').upload(filename, file.uploadFile, { contentType })
      if (uploadError) throw uploadError
      const { data: urlData } = supabase.storage.from('comprobantes').getPublicUrl(filename)
      const comprobante_url = urlData.publicUrl
      const montoFinal = Math.round(monto * 100) / 100

      let nuevoPagoId = null
      // p_token: liga el pago a la sesión OTP verificada de ESTE alumno (la RPC valida que el token
      // exista, no esté vencido y el nombre coincida). Sin esto cualquiera con la anon key crearía
      // pagos falsos. El front siempre tiene un token válido (recién verificó o lo restauró recordarme).
      const crearRpc = await supabase.rpc('crear_pago', {
        p_janij: alumno.trim(), p_monto: montoFinal, p_mes: mesLabel, p_comprobante_url: comprobante_url, p_token: token,
      })
      // `pagos` está cerrada al rol anon (RLS), así que un insert directo SIEMPRE daría 401 y solo
      // enmascararía la causa real de crear_pago (ej. sesion_invalida). Propagamos el error real para
      // que friendlyError dé el mensaje correcto (no el genérico "Revise su conexión").
      if (crearRpc.error) throw crearRpc.error
      nuevoPagoId = crearRpc.data
      attemptIdRef.current = null
      onSuccess({ janij: alumnoDisplay || alumno, monto: montoFinal, mes: mesLabel, comprobante_url, pagoId: nuevoPagoId })
    } catch (err) {
      console.error(err)
      // Sin upsert, un reintento del MISMO attemptId chocaría con 409 si el upload ya había pasado.
      // Reseteando attemptIdRef el reintento usa un filename nuevo y sube limpio.
      attemptIdRef.current = null
      setError(friendlyError(err))
    } finally {
      setLoading(false); submittingRef.current = false
    }
  }

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--section-gap)' }}>
      <StepBar step={3} />
      <button type="button" onClick={() => { if (!loading) onBack() }} disabled={loading} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', padding: '4px 0', cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 'var(--text-sm)', color: 'var(--text-muted)', opacity: loading ? 0.5 : 1 }}>← Volver</button>

      <header style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 'var(--text-3xl)', color: 'var(--brand)', lineHeight: 1.1 }}>Suba su comprobante</h1>
        <p style={{ margin: 0, fontSize: 'var(--text-md)', color: 'var(--text-muted)', lineHeight: 1.5, fontFamily: 'var(--font-body)' }}>Una foto o captura del comprobante de su transferencia.</p>
      </header>

      {/* Resumen del pago */}
      <div style={{ borderRadius: 'var(--r-md)', padding: '14px 18px', background: 'var(--cream-050,#faf8f3)', border: '1px solid var(--border-soft,#e8e3d8)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div>
          <p style={{ margin: 0, fontSize: 'var(--text-sm)', fontWeight: 800, color: 'var(--brand)', fontFamily: 'var(--font-display)' }}>{alumnoDisplay || alumno}</p>
          <p style={{ margin: '2px 0 0', fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontFamily: 'var(--font-body)' }}>{mesesFull.join(', ')}</p>
        </div>
        <span style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: 'var(--brand)', fontFamily: 'var(--font-display)', whiteSpace: 'nowrap' }}>B/. {monto}</span>
      </div>

      <input ref={fileRef} type="file" accept="image/*,application/pdf" style={{ display: 'none' }} onChange={handleFile} />
      {fileProcessing ? (
        <div style={{ width: '100%', borderRadius: 'var(--r-xl)', border: '2px dashed var(--border-strong)', background: 'var(--cream-050)', padding: '32px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 26, height: 26, borderRadius: '50%', border: '3px solid var(--border-strong)', borderTopColor: 'var(--brand)', display: 'inline-block', animation: 'spin360 .8s linear infinite' }} />
          <p style={{ margin: 0, fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text-body)', fontFamily: 'var(--font-body)' }}>Procesando su foto…</p>
        </div>
      ) : !file ? (
        <button type="button" onClick={() => fileRef.current?.click()}
          style={{ width: '100%', borderRadius: 'var(--r-xl)', border: `2px dashed ${error ? 'var(--error-500)' : 'var(--border-strong)'}`, background: 'var(--cream-050)', padding: '36px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
          <div style={{ width: 56, height: 56, borderRadius: 'var(--r-md)', background: '#fff', boxShadow: 'var(--shadow-sm)', display: 'grid', placeItems: 'center' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--ink-300)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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
            <img src={file.previewUrl} alt="Comprobante" onError={() => setPreviewBroken(true)} style={{ width: '100%', maxHeight: 220, objectFit: 'cover', display: 'block' }} />
          ) : (
            <div style={{ width: '100%', padding: '28px 20px', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--success-100,#dcfce7)' }}>
              <span style={{ fontSize: 26 }}>{file.kind === 'pdf' ? '📄' : '✅'}</span>
              <div>
                <p style={{ margin: 0, fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--success-700,#15803d)', fontFamily: 'var(--font-body)' }}>Comprobante cargado</p>
                <p style={{ margin: '2px 0 0', fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontFamily: 'var(--font-body)' }}>Listo para enviar</p>
              </div>
            </div>
          )}
          <button type="button" onClick={clearFile} aria-label="Quitar comprobante" style={{ position: 'absolute', top: 10, right: 10, width: 32, height: 32, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', border: 'none', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', display: 'grid', placeItems: 'center' }}>✕</button>
        </div>
      )}

      {error && <div style={{ borderRadius: 'var(--r-md)', padding: '14px 16px', background: 'var(--error-100)', color: '#991B1B', fontSize: 'var(--text-sm)', fontFamily: 'var(--font-body)', lineHeight: 1.5 }}>{error}</div>}
      {error && error.includes('sesión venció') && onSalir && (
        <button type="button" onClick={onSalir}
          style={{ width: '100%', padding: '15px', borderRadius: 'var(--r-lg)', border: 'none', background: 'var(--grad-gold)', color: 'var(--text-on-gold)', fontSize: 'var(--text-md)', fontWeight: 800, fontFamily: 'var(--font-display)', cursor: 'pointer' }}>
          Volver a verificarme
        </button>
      )}

      <button type="button" onClick={handleSubmit} disabled={loading || fileProcessing || !file}
        style={{ width: '100%', padding: '17px 24px', borderRadius: 'var(--r-lg)', border: 'none', background: (loading || fileProcessing || !file) ? 'var(--navy-300)' : 'var(--grad-submit)', color: 'var(--text-on-navy)', fontSize: 'var(--text-lg)', fontWeight: 800, fontFamily: 'var(--font-display)', cursor: (loading || fileProcessing || !file) ? 'not-allowed' : 'pointer', boxShadow: (loading || fileProcessing || !file) ? 'none' : 'var(--shadow-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
        {loading && <span style={{ width: 18, height: 18, borderRadius: '50%', border: '2.5px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', display: 'inline-block', animation: 'spin360 .8s linear infinite' }} />}
        {loading ? 'Enviando…' : 'Enviar comprobante'}
      </button>
    </div>
  )
}
