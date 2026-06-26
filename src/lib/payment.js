// Constantes y helpers de pago compartidos por las pantallas del flujo (meses, transferir, comprobante).
export const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
export const MONTHS_FULL = { Ene:'Enero',Feb:'Febrero',Mar:'Marzo',Abr:'Abril',May:'Mayo',Jun:'Junio',Jul:'Julio',Ago:'Agosto',Sep:'Septiembre',Oct:'Octubre',Nov:'Noviembre',Dic:'Diciembre' }
export const MONTHS_DISABLED = new Set(['Ene'])
export const CUOTA = 30
export const CUOTA_YEAR = 2026          // año de las cuotas (la promo se gradúa en 2027)
export const MAX_FILE_MB = 12

// Convierte/compacta cualquier foto a JPEG con canvas. En iPhone esto además transforma el HEIC
// (que los navegadores no muestran) en un JPEG visible y liviano. Si no se puede decodificar, null.
export function compressToJpeg(file, maxDim = 1600, quality = 0.85) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
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
        canvas.toBlob((blob) => { blob ? finish({ blob, url: URL.createObjectURL(blob) }) : finish(null) }, 'image/jpeg', quality)
      } catch (e) { finish(null) }
    }
    img.onerror = () => finish(null)
    img.src = url
  })
}

// Huella SHA-256 del archivo ORIGINAL (para que el webhook detecte comprobantes repetidos). Best-effort.
export async function sha256Hex(file) {
  try {
    if (typeof crypto === 'undefined' || !crypto.subtle || !file.arrayBuffer) return null
    const buf = await file.arrayBuffer()
    const digest = await crypto.subtle.digest('SHA-256', buf)
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
  } catch (e) { return null }
}

export async function processFile(file) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
  if (isPdf) return { uploadFile: file, previewUrl: null, kind: 'pdf', ext: 'pdf' }
  const jpeg = await compressToJpeg(file)
  if (jpeg) return { uploadFile: jpeg.blob, previewUrl: jpeg.url, kind: 'image', ext: 'jpg' }
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  return { uploadFile: file, previewUrl: URL.createObjectURL(file), kind: 'image', ext }
}

export function friendlyError(err) {
  const msg = String(err?.message || err || '').toLowerCase()
  if (!navigator.onLine || msg.includes('failed to fetch') || msg.includes('network'))
    return 'Parece que no tiene conexión a internet. Conéctese e intente de nuevo.'
  if (msg.includes('payload') || msg.includes('large') || msg.includes('size') || msg.includes('exceeded'))
    return 'La foto es muy pesada. Pruebe con una más liviana o con una captura de pantalla.'
  if (msg.includes('duplicate') || msg.includes('already exists'))
    return 'Parece que este comprobante ya fue enviado. Revise el grupo o intente de nuevo.'
  return 'No pudimos enviar su comprobante. Revise su conexión e intente de nuevo. Si sigue, escríbale al tesorero por WhatsApp.'
}
