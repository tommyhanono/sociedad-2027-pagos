// ============================================================
// Google Apps Script — Sociedad 2027 Pagos → Google Sheets
// ============================================================

function testUrlFetch() {
  sendWhatsApp('✅ TEST autorización WhatsApp desde editor')
}

function authorizeDrive() {
  // Función temporal para forzar autorización de drive.readonly
  const file = DriveApp.getFileById('1dlqXAlbqQzYGuok4AfJ_9BcT-YltS3T4')
  Logger.log('Drive OK: ' + file.getName())
}

// ── Modo de pruebas global ────────────────────────────────────
// true  = todo va a TEST_TAB (seguro para pruebas del form real)
// false = producción real → MATRIX_TAB
const GLOBAL_TEST_MODE = true

const SHEET_ID        = '1yx0Ciq-5TgacuoufSeIx4DrsB438LOiqJ9DpASChXp8'
const MATRIX_TAB      = 'Mensualidades 2026'
const TEST_TAB        = 'test mensualidad'
const LOG_HEADER      = 'PAGOS RECIBIDOS (App)'
const LOG_COLS        = ['Fecha', 'Janij/a', 'Monto (B/.)', 'Mes(es)', 'Estado', 'Comprobante']
const MONTHLY_FEE     = 30
const DISABLED_MONTHS = new Set(['Enero'])

const MONTH_COL = {
  'Enero': 6, 'Febrero': 8, 'Marzo': 10, 'Abril': 12,
  'Mayo': 14, 'Junio': 16, 'Julio': 18, 'Agosto': 20,
  'Septiembre': 22, 'Octubre': 24, 'Noviembre': 26, 'Diciembre': 28
}

const MONTH_ORDER = [
  'Febrero','Marzo','Abril','Mayo','Junio','Julio',
  'Agosto','Septiembre','Octubre','Noviembre','Diciembre'
]

// Filas de estructura/encabezado/total que NUNCA deben matchearse como alumno.
// Protege la fila "Total" (que tiene fórmulas SUM) de ser sobrescrita por un pago.
const STRUCTURAL_NAMES = new Set([
  'total', 'totales', 'persona', 'pago', 'janija', 'janij', 'nombre', 'alumno', 'alumnoa', 'suma'
])

// Alumnos EXCLUIDOS del grado: NO se cuentan (no se sincronizan, no salen en el autocompletado ni
// la verificación, no se les puede aplicar un pago). Su NOMBRE en el sheet NO se borra: solo se ignora.
const EXCLUDED_STUDENTS = new Set(['joyce e'])

// ── WhatsApp (Green API) ──────────────────────────────────────
const WA_INSTANCE  = '7107661922'
const WA_TOKEN     = '7fe84dc2b26d4bc598f4967ddf97e3ec9518892fe5984bd3ba'
const WA_CHAT_ID   = '50766797887@c.us'
// En modo test, los códigos OTP van SIEMPRE a este número (el del dueño), no al de la familia.
const TEST_PHONE   = '50766818669'

// ── Supabase (para devolver el saldo real al form) ────────────
// El webhook escribe el resultado en la columna `estado` de la fila recién insertada.
// El form hace polling de esa columna para mostrarle a la mamá su saldo real del sheet.
const SUPABASE_URL = 'https://obshrrzvfprsjeykqsen.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ic2hycnp2ZnByc2pleWtxc2VuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4MDMyMjIsImV4cCI6MjA5NzM3OTIyMn0.Lhlh3Sb9EQ8axxPsDBiEVVERdo8sDIZaGDhYQkxdNdo'

/** Escribe el resultado del pago (incluido el saldo real) en la fila de Supabase.
 *  El form lo lee por polling. Silencioso si falla — nunca debe romper el flujo. */
function updatePagoEstado(pagoId, obj) {
  if (!pagoId) return
  try {
    // Escribe el saldo vía RPC security-definer: la tabla `pagos` queda cerrada al rol anon
    // (UPDATE directo ya no permitido). Reusa el secreto ALUMNOS_SECRET de Script Properties.
    const secret = PropertiesService.getScriptProperties().getProperty('ALUMNOS_SECRET') || ''
    const resp = UrlFetchApp.fetch(
      SUPABASE_URL + '/rest/v1/rpc/set_pago_estado',
      { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY },
        payload: JSON.stringify({ p_id: pagoId, p_estado: JSON.stringify(obj), p_secret: secret }) }
    )
    // Si Supabase rechaza, avisamos: el pago SÍ entró al sheet pero la mamá puede
    // quedar sin saldo en el form (polling eterno). Best-effort, no hace throw.
    if (resp.getResponseCode() >= 300) {
      sendWhatsApp('⚠️ No se pudo escribir el saldo en Supabase (HTTP ' + resp.getResponseCode() +
        ') para id=' + pagoId + '. El pago SÍ se aplicó al sheet; la mamá puede no ver su saldo en el form.')
    }
  } catch (e) {
    sendWhatsApp('⚠️ Error al escribir el saldo en Supabase para id=' + pagoId + ': ' + e.message +
      '. El pago SÍ se aplicó al sheet.')
  }
}

// Lista de meses COMPLETAMENTE pagados (valor >= cuota) de un alumno, como "Febrero,Marzo,..."
// Se usa para grisar esos meses en el form (paso extra, no afecta el flujo de pago).
function paidMonthsOf(sheet, row) {
  const out = []
  for (const mo of MONTH_ORDER) {
    const v = Math.round((Number(sheet.getRange(row, MONTH_COL[mo]).getValue()) || 0) * 100) / 100
    if (v >= MONTHLY_FEE) out.push(mo)
  }
  return out.join(',')
}

// Escribe los meses pagados de un alumno en Supabase (tabla `alumnos`) vía RPC protegida por
// secreto. Best-effort: si no hay secreto o falla, no rompe nada. El form lo lee para el grisado.
function syncAlumno(nombre, mesesPagadosStr) {
  try {
    if (!nombre) return
    const secret = PropertiesService.getScriptProperties().getProperty('ALUMNOS_SECRET')
    if (!secret) return
    UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/set_meses_pagados', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY },
      payload: JSON.stringify({ p_nombre: nombre, p_meses: mesesPagadosStr || '', p_secret: secret })
    })
  } catch (e) {}
}

// Re-sincroniza a Supabase los meses pagados de la fila r (si es un alumno válido).
// Lo usan onSheetEdit (edición manual) y el payload SYNCROW (prueba).
function syncRowToSupabase(sheet, r) {
  const nombre = String(sheet.getRange(r, 2).getValue() || '').trim()
  if (!nombre || STRUCTURAL_NAMES.has(normalize(nombre)) || EXCLUDED_STUDENTS.has(normalize(nombre))) return false
  // No tocar filas con fórmulas en el bloque de meses (ej. fila Total)
  const hasFormula = sheet.getRange(r, 6, 1, 23).getFormulas()[0].some(function (f) { return f })
  if (hasFormula) return false
  syncAlumno(nombre, paidMonthsOf(sheet, r))
  return true
}

// Barre TODOS los alumnos del tab activo y los sincroniza a Supabase en UNA sola llamada bulk.
// Sirve para que ediciones MANUALES en el sheet (que no pasaron por el form) entren al grisado
// en el próximo pago, sin depender del trigger onEdit. Es 1 solo fetch (~500ms), nada al lado del
// OCR que ya corre en el flujo. Best-effort y try/catch total: jamás rompe el pago. NO destructivo:
// la RPC bulk solo hace UPSERT, nunca borra filas. Devuelve cuántos alumnos barrió (0 si falló).
function syncAllAlumnos(sheet) {
  try {
    const secret = PropertiesService.getScriptProperties().getProperty('ALUMNOS_SECRET')
    if (!secret) return 0
    const last = sheet.getLastRow()
    if (last < 1) return 0
    const vals = sheet.getRange(1, 1, last, 28).getValues()
    let logRow = vals.length
    for (let i = 0; i < vals.length; i++) { if (String(vals[i][0]).trim() === LOG_HEADER) { logRow = i; break } }
    const rows = []
    for (let i = 0; i < logRow; i++) {
      const nm = String(vals[i][1] || '').trim()
      if (!nm || STRUCTURAL_NAMES.has(normalize(nm)) || EXCLUDED_STUDENTS.has(normalize(nm))) continue
      const meses = []
      for (const mo of MONTH_ORDER) {
        const v = Math.round((Number(vals[i][MONTH_COL[mo] - 1]) || 0) * 100) / 100
        if (v >= MONTHLY_FEE) meses.push(mo)
      }
      rows.push({ nombre: nm, meses: meses.join(',') })
    }
    if (!rows.length) return 0
    UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/set_meses_pagados_bulk', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY },
      payload: JSON.stringify({ p_rows: rows, p_secret: secret })
    })
    return rows.length
  } catch (e) { return 0 }
}

// Trigger INSTALABLE onEdit: cuando se edita MANUALMENTE una celda de meses en el tab activo,
// re-sincroniza a Supabase los meses pagados de ese alumno (para que el grisado del form quede
// al día sin pasar por el form). Funciona con los scopes actuales (spreadsheets + external_request).
// INSTALACIÓN (una vez, en el editor de Apps Script): Activadores (reloj) → Añadir activador →
//   función: onSheetEdit · origen del evento: "Desde una hoja de cálculo" · tipo: "Al editar".
function onSheetEdit(e) {
  try {
    if (!e || !e.range) return
    const sheet = e.range.getSheet()
    const activeTab = GLOBAL_TEST_MODE ? TEST_TAB : MATRIX_TAB
    if (sheet.getName() !== activeTab) return
    const c1 = e.range.getColumn()
    const c2 = c1 + e.range.getNumColumns() - 1
    if (c2 < 6 || c1 > 28) return   // la edición no toca columnas de meses → ignorar
    const r1 = e.range.getRow()
    const rN = e.range.getNumRows()
    for (let r = r1; r < r1 + rN; r++) syncRowToSupabase(sheet, r)
  } catch (err) {}
}

function extractDriveId(url) {
  const m = url.match(/[?&]id=([^&]+)/) || url.match(/\/d\/([^/\?]+)/)
  return m ? m[1] : null
}

// Extrae la huella SHA-256 del comprobante desde la URL (el form la pone como "<hash>__..." en
// el nombre). Devuelve null si no está → en ese caso NO se hace dedup (cero interferencia).
function extractCompHash(url) {
  if (!url) return null
  const m = String(url).match(/\/([a-f0-9]{64})__/)
  return m ? m[1] : null
}

function sendWhatsApp(message) {
  try {
    UrlFetchApp.fetch(
      'https://api.green-api.com/waInstance' + WA_INSTANCE + '/sendMessage/' + WA_TOKEN,
      { method: 'post', contentType: 'application/json',
        payload: JSON.stringify({ chatId: WA_CHAT_ID, message: message }),
        muteHttpExceptions: true }
    )
  } catch (e) {}
}

function sendWhatsAppWithImage(caption, imageUrl) {
  try {
    const fileId = extractDriveId(imageUrl)

    let blob, ext
    if (fileId) {
      // URL de Google Drive → fetch via DriveApp
      blob = DriveApp.getFileById(fileId).getBlob()
      const mime = blob.getContentType() || 'image/jpeg'
      ext = mime.includes('png') ? 'png' : mime.includes('pdf') ? 'pdf' : 'jpg'
    } else {
      // URL pública (Supabase Storage, etc.) → fetch directo
      const resp = UrlFetchApp.fetch(imageUrl, { muteHttpExceptions: true })
      if (resp.getResponseCode() !== 200) { sendWhatsApp(caption + '\n🧾 ' + imageUrl); return }
      blob = resp.getBlob()
      ext  = imageUrl.toLowerCase().includes('.png') ? 'png'
           : imageUrl.toLowerCase().includes('.pdf') ? 'pdf' : 'jpg'
    }

    // Green API sendFileByUpload — multipart con blob
    UrlFetchApp.fetch(
      'https://api.green-api.com/waInstance' + WA_INSTANCE + '/sendFileByUpload/' + WA_TOKEN,
      { method: 'post', muteHttpExceptions: true,
        payload: { chatId: WA_CHAT_ID, caption: caption,
                   fileName: 'comprobante.' + ext, file: blob } }
    )
  } catch (e) {
    // Si falla por cualquier razón, manda el texto solo
    sendWhatsApp(caption + '\n🧾 ' + imageUrl)
  }
}

// ── OCR del comprobante (advisory) ────────────────────────────
// Lee con Claude (vision) el nº de referencia + monto + fecha del comprobante y devuelve
// una línea corta para incluir en el WhatsApp a Marce (así detecta recibos repetidos de un
// vistazo). NO bloquea nada. 100% best-effort: cualquier fallo → devuelve '' y el flujo sigue.
// La API key se lee de Script Properties (ANTHROPIC_KEY) — NUNCA va en el código (git la revoca).
function readComprobanteInfo(imageUrl) {
  try {
    if (!imageUrl) return ''
    const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_KEY')
    if (!key) return ''   // sin key configurada → no hay OCR, cero efecto
    const resp = UrlFetchApp.fetch(imageUrl, { muteHttpExceptions: true })
    if (resp.getResponseCode() !== 200) return ''
    const blob = resp.getBlob()
    const mime = blob.getContentType() || ''
    if (mime.indexOf('image/') !== 0) return ''   // PDFs u otros → no vision
    const b64 = Utilities.base64Encode(blob.getBytes())
    const body = {
      model: 'claude-sonnet-4-6',   // más preciso leyendo dígitos que Haiku; corre fuera del lock
      max_tokens: 150,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } },
          { type: 'text', text: 'Es un comprobante de transferencia bancaria. Devuelve SOLO JSON: {"referencia":"<nro de referencia/confirmacion/transaccion o vacio>","monto":"<monto o vacio>","fecha":"<fecha o vacio>"}. Solo el JSON.' }
        ]
      }]
    }
    const r = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify(body)
    })
    if (r.getResponseCode() !== 200) return ''
    const out = JSON.parse(r.getContentText())
    const txt = (out.content && out.content[0] && out.content[0].text) || ''
    const j = JSON.parse(txt.match(/\{[\s\S]*\}/)[0])
    const parts = []
    if (j.referencia) parts.push('Ref ' + String(j.referencia).trim())
    if (j.monto)      parts.push(String(j.monto).trim())
    if (j.fecha)      parts.push(String(j.fecha).trim())
    return parts.length ? '\n🔎 Comprobante → ' + parts.join(' · ') : ''
  } catch (e) { return '' }
}

// ── Utilidades ────────────────────────────────────────────────

function normalize(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z\s]/g, '').trim()
}

function levenshtein(a, b) {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const v0 = Array.from({length: b.length + 1}, (_, i) => i)
  const v1 = new Array(b.length + 1)
  for (let i = 0; i < a.length; i++) {
    v1[0] = i + 1
    for (let j = 0; j < b.length; j++) {
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + (a[i] === b[j] ? 0 : 1))
    }
    for (let j = 0; j <= b.length; j++) v0[j] = v1[j]
  }
  return v1[b.length]
}

// ── Búsqueda de persona ───────────────────────────────────────

function findPersonRow(sheet, personName) {
  const data    = sheet.getDataRange().getValues()
  const normIn  = normalize(personName)
  const allParts = normIn.split(/\s+/)

  // Solo buscar en filas ENCIMA del log header — evita confundir filas del log con la matrix
  let matrixLimit = data.length
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === LOG_HEADER) { matrixLimit = i; break }
  }

  // Prueba: nombre completo → sin última palabra → sin 2 últimas
  const variants = [allParts]
  if (allParts.length > 2) variants.push(allParts.slice(0, -1))
  if (allParts.length > 3) variants.push(allParts.slice(0, -2))

  for (const parts of variants) {
    const first    = parts[0]
    const lastInit = parts.length > 1 ? parts[parts.length - 1][0] : ''
    const joined   = parts.join(' ')
    const exact = [], fuzzy = []

    for (let i = 0; i < matrixLimit; i++) {
      const cellRaw  = String(data[i][1]).trim()
      if (!cellRaw) continue
      const cellNorm = normalize(cellRaw)
      // Saltar filas de estructura (Total, Persona, Pago, headers) — nunca son alumnos
      if (STRUCTURAL_NAMES.has(cellNorm) || EXCLUDED_STUDENTS.has(cellNorm)) continue

      if (cellNorm === joined) return { row: i + 1, confidence: 'exact', matched: cellRaw }

      const cp  = cellNorm.split(/\s+/)
      const cf  = cp[0]
      // liOk: la inicial ingresada coincide con CUALQUIER palabra del nombre (no solo la última)
      // Ej: "Keren B" matchea "Keren Benchimol Arnstein" aunque la última inicial sea "A"
      const liOk = !lastInit || cp.slice(1).some(function(w) { return w[0] === lastInit })

      if (cf === first && liOk)                      exact.push({ row: i + 1, name: cellRaw })
      else if (levenshtein(cf, first) <= 2 && liOk) fuzzy.push({ row: i + 1, name: cellRaw })
    }

    // Si la mamá mandó solo un nombre (sin apellido), un único homónimo NO se aplica
    // automático: podría ser otra familia con el mismo primer nombre. Se confirma.
    const hasApellido = parts.length > 1
    if (exact.length === 1) {
      return hasApellido
        ? { row: exact[0].row, confidence: 'partial', matched: exact[0].name }
        : { row: -1, confidence: 'ambiguous', candidates: [exact[0].name] }
    }
    if (exact.length > 1)  return { row: -1, confidence: 'ambiguous', candidates: exact.map(m => m.name) }
    if (fuzzy.length === 1) return { row: fuzzy[0].row, confidence: 'fuzzy', matched: fuzzy[0].name }
    if (fuzzy.length > 1)  return { row: -1, confidence: 'ambiguous', candidates: fuzzy.map(m => m.name) }
  }

  return { row: -1, confidence: 'not_found' }
}

// ── Parseo de meses ───────────────────────────────────────────

function parseMonths(mesStr) {
  if (!mesStr) return []
  const re = new RegExp('(' + Object.keys(MONTH_COL).join('|') + ')(?:\\s+(\\d{4}))?', 'gi')
  const found = []
  let m
  while ((m = re.exec(mesStr)) !== null) {
    const month = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase()
    const year  = m[2] ? parseInt(m[2]) : 2026
    if (year >= 2026 && MONTH_COL[month] && !DISABLED_MONTHS.has(month) && !found.includes(month))
      found.push(month)
  }
  return found
}

// Todos los meses necesarios para absorber el monto dado (para modo auto)
function findAllUnpaidMonths(sheet, matchedRow, monto) {
  const months = []
  let remaining = Math.round(monto * 100) / 100
  for (const month of MONTH_ORDER) {
    if (remaining < 0.01) break
    const current = Math.round((Number(sheet.getRange(matchedRow, MONTH_COL[month]).getValue()) || 0) * 100) / 100
    const needed  = Math.round((MONTHLY_FEE - current) * 100) / 100
    if (needed > 0) {
      months.push(month)
      remaining = Math.round((remaining - Math.min(remaining, needed)) * 100) / 100
    }
  }
  return months
}

// ── Saldo pendiente ───────────────────────────────────────────

function calculateBalance(sheet, matchedRow) {
  let total = 0
  for (const m of MONTH_ORDER) {
    total = Math.round((total + (Number(sheet.getRange(matchedRow, MONTH_COL[m]).getValue()) || 0)) * 100) / 100
  }
  return Math.max(0, Math.round((330 - total) * 100) / 100)
}

// ── Distribución inteligente ──────────────────────────────────

function distributePayment(sheet, matchedRow, months, monto) {
  let remaining = monto
  const log     = []

  for (const month of months) {
    if (remaining < 0.01) break
    const cell    = sheet.getRange(matchedRow, MONTH_COL[month])
    const current = Math.round((Number(cell.getValue()) || 0) * 100) / 100
    const needed  = Math.round((MONTHLY_FEE - current) * 100) / 100

    if (needed <= 0) {
      log.push(month + ': ya completo')
      continue
    }

    const toAdd = Math.round(Math.min(remaining, needed) * 100) / 100
    cell.setValue(Math.round((current + toAdd) * 100) / 100)
    log.push(month + ': +B/.' + toAdd)
    remaining = Math.round((remaining - toAdd) * 100) / 100
  }

  return { log, extra: remaining > 0.01 ? Math.round(remaining * 100) / 100 : 0 }
}

// ── Saldo a favor (sobrepagos) ────────────────────────────────
// Sección APARTE (columnas K-L = 11-12, al lado del log, sin tocar la matriz de meses) que
// ACUMULA por alumno la "plata de más" cuando un pago supera lo que llena meses completos.
// Así no se pierde y Marce la ve. Queda como crédito (no se aplica solo); Marce decide.
const SF_HEADER   = '💰 SALDO A FAVOR'
const SF_NAME_COL = 11   // columna K
const SF_AMT_COL  = 12   // columna L

// Devuelve la fila de la 1ra ENTRADA de la sección (creándola si no existe).
function ensureSaldoFavorSection(sheet) {
  const last = Math.max(sheet.getLastRow(), 1)
  const colK = sheet.getRange(1, SF_NAME_COL, last, 1).getValues()
  for (let i = 0; i < colK.length; i++) {
    if (String(colK[i][0]).trim() === SF_HEADER) return i + 3   // header + subheader + 1ra entrada
  }
  // No existe: la ubicamos a la altura del header del log (misma zona, columnas aparte).
  let hdrRow = sheet.getLastRow() + 2
  const colA = sheet.getRange(1, 1, last, 1).getValues()
  for (let i = 0; i < colA.length; i++) { if (String(colA[i][0]).trim() === LOG_HEADER) { hdrRow = i + 1; break } }
  sheet.getRange(hdrRow, SF_NAME_COL).setValue(SF_HEADER)
  sheet.getRange(hdrRow, SF_NAME_COL, 1, 2).setFontWeight('bold').setBackground('#15803d').setFontColor('#ffffff')
  sheet.getRange(hdrRow + 1, SF_NAME_COL, 1, 2).setValues([['Alumno', 'Saldo a favor B/.']])
  sheet.getRange(hdrRow + 1, SF_NAME_COL, 1, 2).setFontWeight('bold').setBackground('#22c55e').setFontColor('#ffffff')
  return hdrRow + 2
}

// Suma `extra` al saldo a favor del alumno (acumula; crea la fila si es la 1ra vez). NO destructivo.
function addSaldoFavor(sheet, nombre, extra) {
  if (!nombre || !(extra > 0)) return
  const firstRow = ensureSaldoFavorSection(sheet)
  const last = Math.max(sheet.getLastRow(), firstRow)
  const names = sheet.getRange(firstRow, SF_NAME_COL, last - firstRow + 1, 1).getValues()
  let target = -1
  for (let i = 0; i < names.length; i++) {
    const v = String(names[i][0]).trim()
    if (v === String(nombre).trim()) {
      const row = firstRow + i
      const cur = Math.round((Number(sheet.getRange(row, SF_AMT_COL).getValue()) || 0) * 100) / 100
      sheet.getRange(row, SF_AMT_COL).setValue(Math.round((cur + extra) * 100) / 100)
      return
    }
    if (v === '' && target < 0) target = firstRow + i
  }
  if (target < 0) target = firstRow + names.length
  sheet.getRange(target, SF_NAME_COL).setValue(String(nombre).trim())
  sheet.getRange(target, SF_AMT_COL).setValue(Math.round(extra * 100) / 100)
}

// ── Log section ───────────────────────────────────────────────

function ensureLogHeader(sheet) {
  const data = sheet.getDataRange().getValues()
  for (let i = 0; i < data.length; i++) {
    const v = String(data[i][0]).trim()
    // Reconoce el header correcto O un #ERROR! (de versiones viejas con === al inicio)
    if (v === LOG_HEADER || v.startsWith('#')) return
  }
  const insertAt = sheet.getLastRow() + 2
  sheet.getRange(insertAt, 1).setValue(LOG_HEADER)
  sheet.getRange(insertAt, 1, 1, 6)
    .setFontWeight('bold').setBackground('#1A3A6B').setFontColor('#ffffff')
  sheet.getRange(insertAt + 1, 1, 1, 6).setValues([LOG_COLS])
  sheet.getRange(insertAt + 1, 1, 1, 6)
    .setFontWeight('bold').setBackground('#2A5298').setFontColor('#ffffff')
  SpreadsheetApp.flush()
}

/** Limpia las cabeceras duplicadas del log — llama con payload.type = 'FIXLOG' */
function fixLogSection(sheet) {
  const lastRow = sheet.getLastRow()
  if (lastRow < 1) return '0 filas'

  const allVals = sheet.getRange(1, 1, lastRow, 6).getValues()
  const allFmls = sheet.getRange(1, 1, lastRow, 6).getFormulas()

  // Encontrar dónde empieza la sección de log — SOLO ancla al LOG_HEADER exacto.
  // (Antes aceptaba '#...' o 'Fecha', lo que podía apuntar dentro de la matriz si una
  //  celda de col A tenía #REF!/#ERROR! y borrar filas de alumnos. Ya no.)
  let logStart = -1
  for (let i = 0; i < allVals.length; i++) {
    if (String(allVals[i][0]).trim() === LOG_HEADER) { logStart = i; break }
  }
  if (logStart === -1) return 'no log encontrado'

  // SALVAGUARDA: si en el rango a borrar hay un nombre de alumno (col B no vacía y no
  // estructural), abortar sin borrar. Jamás borrar nombres.
  for (let i = logStart; i < allVals.length; i++) {
    const nm = normalize(String(allVals[i][1] || '').trim())
    if (nm && !STRUCTURAL_NAMES.has(nm)) {
      return 'ABORTADO: el rango a limpiar contiene nombres de alumnos (fila ' + (i + 1) + ') — no se borró nada'
    }
  }

  // Recolectar solo filas de datos reales (col A tiene timestamp con /)
  const dataRows = []
  for (let i = logStart; i < allVals.length; i++) {
    const v = String(allVals[i][0])
    if (/^\d{2}\/\d{2}\/\d{4}/.test(v)) dataRows.push({ v: allVals[i], f: allFmls[i] })
  }

  // Borrar todo desde logStart en adelante
  const toDel = lastRow - logStart
  if (toDel > 0) sheet.deleteRows(logStart + 1, toDel)
  SpreadsheetApp.flush()

  // Escribir UNA sola cabecera
  const base = sheet.getLastRow() + 2
  sheet.getRange(base, 1).setValue(LOG_HEADER)
  sheet.getRange(base, 1, 1, 6).setFontWeight('bold').setBackground('#1A3A6B').setFontColor('#ffffff')
  sheet.getRange(base + 1, 1, 1, 6).setValues([LOG_COLS])
  sheet.getRange(base + 1, 1, 1, 6).setFontWeight('bold').setBackground('#2A5298').setFontColor('#ffffff')
  SpreadsheetApp.flush()

  // Reescribir filas de datos conservando fórmulas (hyperlinks)
  for (let i = 0; i < dataRows.length; i++) {
    const row = base + 2 + i
    sheet.getRange(row, 1, 1, 5).setValues([dataRows[i].v.slice(0, 5)])
    const fml6 = dataRows[i].f[5]
    if (fml6) sheet.getRange(row, 6).setFormula(fml6)
    else sheet.getRange(row, 6).setValue(dataRows[i].v[5] || '—')
  }
  SpreadsheetApp.flush()

  // Limpiar columnas 7-30 de TODAS las filas del log (por si quedaron $30 sueltos de bug anterior)
  const newLast = sheet.getLastRow()
  const newBase = newLast - dataRows.length - 1  // fila donde empieza el primer log entry
  if (dataRows.length > 0 && newBase >= base + 2) {
    sheet.getRange(base + 2, 7, dataRows.length, 24).clearContent()
  }
  SpreadsheetApp.flush()

  return dataRows.length + ' filas restauradas, 1 cabecera'
}

function appendLogRow(sheet, fecha, janij, monto, mes, estado, comprobanteUrl) {
  const lastRow = sheet.getLastRow() + 1
  sheet.getRange(lastRow, 1, 1, 5).setValues([[fecha, janij, monto, mes, estado]])
  if (comprobanteUrl) {
    // Hyperlink clickeable — muestra "ver foto", link al comprobante original
    const safe = comprobanteUrl.replace(/"/g, '%22')
    sheet.getRange(lastRow, 6).setFormula('=HYPERLINK("' + safe + '","ver foto")')
  } else {
    sheet.getRange(lastRow, 6).setValue('—')
  }
}

// ── doPost principal ──────────────────────────────────────────

function doPost(e) {
  try {
    // Guard: POST sin cuerpo o no-JSON (bots/scanners/monitores) → no es un error real,
    // no disparar la alerta de WhatsApp del catch global.
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput('no payload').setMimeType(ContentService.MimeType.TEXT)
    }
    let payload
    try {
      payload = JSON.parse(e.postData.contents)
    } catch (parseErr) {
      return ContentService.createTextOutput('bad json').setMimeType(ContentService.MimeType.TEXT)
    }

    // ── SEGURIDAD ──────────────────────────────────────────────────────────────
    // El webhook es un endpoint PÚBLICO. Las operaciones de ADMIN/DEBUG (leer la hoja, setear
    // secretos, WhatsApp, OCR, reset, fixlog) Y los SYNC* van detrás de ADMIN_SECRET — `test:true`
    // NO alcanza (cualquiera lo manda). El cron manda el admin secret en su payload de SYNCALL.
    // NO se gatea el pago real (INSERT, vía el trigger) — ese es el camino público legítimo del
    // form, así nada de lo que funciona se rompe.
    const adminSecret = PropertiesService.getScriptProperties().getProperty('ADMIN_SECRET')
    const isAdmin = !!adminSecret && payload.admin === adminSecret
    // Bootstrap de una sola vez: setea ADMIN_SECRET solo si todavía no existe (luego queda bloqueado).
    if (payload.type === 'SETADMIN' && payload.secret) {
      if (adminSecret) return ContentService.createTextOutput('ADMIN_SECRET ya configurado').setMimeType(ContentService.MimeType.TEXT)
      PropertiesService.getScriptProperties().setProperty('ADMIN_SECRET', String(payload.secret))
      return ContentService.createTextOutput('[SETADMIN] ok').setMimeType(ContentService.MimeType.TEXT)
    }
    if (['READ','INSPECT','SETKEY','SETSECRET','WATEST','OCRTEST','RESETMONTHS','FIXLOG','SYNCALUMNOS','SYNCALL','SYNCROW'].indexOf(payload.type) >= 0 && !isAdmin) {
      return ContentService.createTextOutput('no autorizado').setMimeType(ContentService.MimeType.TEXT)
    }

    // SENDOTP — manda el código de verificación por WhatsApp (Green API). Lo llama la RPC
    // `solicitar_codigo` (server-side, vía pg_net) con el secreto ALUMNOS_SECRET. En modo test
    // SIEMPRE va a TEST_PHONE (el número del dueño), nunca al de la familia.
    if (payload.type === 'SENDOTP') {
      const sec = PropertiesService.getScriptProperties().getProperty('ALUMNOS_SECRET')
      if (!sec || payload.secret !== sec) return ContentService.createTextOutput('no autorizado').setMimeType(ContentService.MimeType.TEXT)
      const destino = GLOBAL_TEST_MODE ? TEST_PHONE : String(payload.telefono || '').replace(/\D/g, '')
      if (!destino) return ContentService.createTextOutput('sin destino').setMimeType(ContentService.MimeType.TEXT)
      const msg = '🔐 *Sociedad 2027 — Pagos*\n\n' +
                  'Tu código de verificación es:  *' + payload.codigo + '*\n\n' +
                  'Sirve para ver el saldo de tu hijo/a y poder pagar. Vence en 10 minutos.\n\n' +
                  '⚙️ Mensaje automático, enviado por inteligencia artificial. No respondas a este chat.'
      try {
        UrlFetchApp.fetch('https://api.green-api.com/waInstance' + WA_INSTANCE + '/sendMessage/' + WA_TOKEN,
          { method: 'post', contentType: 'application/json',
            payload: JSON.stringify({ chatId: destino + '@c.us', message: msg }), muteHttpExceptions: true })
      } catch (e) {}
      return ContentService.createTextOutput('[SENDOTP] enviado').setMimeType(ContentService.MimeType.TEXT)
    }

    // Reparar cabeceras duplicadas del log
    if (payload.type === 'FIXLOG' && payload.test === true) {
      const ss2 = SpreadsheetApp.openById(SHEET_ID)
      const sh2 = ss2.getSheetByName(TEST_TAB)
      if (!sh2) return ContentService.createTextOutput('no test tab').setMimeType(ContentService.MimeType.TEXT)
      const result = fixLogSection(sh2)
      return ContentService.createTextOutput('[FIXLOG] ' + result).setMimeType(ContentService.MimeType.TEXT)
    }

    // Debug WhatsApp — prueba envío y devuelve resultado completo
    if (payload.type === 'WATEST') {
      const driveUrl = payload.driveUrl || ''
      let result = ''
      try {
        if (driveUrl) {
          const fileId = extractDriveId(driveUrl)
          result += 'fileId=' + fileId + ' | '
          const blob = DriveApp.getFileById(fileId).getBlob()
          result += 'blob OK mime=' + blob.getContentType() + ' size=' + blob.getBytes().length + ' | '
          const r = UrlFetchApp.fetch(
            'https://api.green-api.com/waInstance' + WA_INSTANCE + '/sendFileByUpload/' + WA_TOKEN,
            { method: 'post', muteHttpExceptions: true,
              payload: { chatId: WA_CHAT_ID, caption: 'TEST imagen', fileName: 'comprobante.jpg', file: blob } }
          )
          result += 'upload=' + r.getResponseCode() + ' ' + r.getContentText()
        } else {
          const r = UrlFetchApp.fetch(
            'https://api.green-api.com/waInstance' + WA_INSTANCE + '/sendMessage/' + WA_TOKEN,
            { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
              payload: JSON.stringify({ chatId: WA_CHAT_ID, message: 'TEST texto directo desde Apps Script' }) }
          )
          result += 'text=' + r.getResponseCode() + ' ' + r.getContentText()
        }
      } catch(e) { result += 'ERROR: ' + e.message }
      return ContentService.createTextOutput('[WATEST] ' + result).setMimeType(ContentService.MimeType.TEXT)
    }

    // SETKEY — guarda la API key de Anthropic en Script Properties (server-side, fuera de git).
    // { type:'SETKEY', test:true, key:'sk-ant-...' }  → no devuelve la key, solo confirma.
    if (payload.type === 'SETKEY' && payload.test === true && payload.key) {
      PropertiesService.getScriptProperties().setProperty('ANTHROPIC_KEY', String(payload.key))
      return ContentService.createTextOutput('[SETKEY] guardada (len=' + String(payload.key).length + ')').setMimeType(ContentService.MimeType.TEXT)
    }

    // SETSECRET — guarda el secreto compartido para escribir en la tabla `alumnos` (RPC).
    // { type:'SETSECRET', test:true, secret:'...' }
    if (payload.type === 'SETSECRET' && payload.test === true && payload.secret) {
      PropertiesService.getScriptProperties().setProperty('ALUMNOS_SECRET', String(payload.secret))
      return ContentService.createTextOutput('[SETSECRET] guardado (len=' + String(payload.secret).length + ')').setMimeType(ContentService.MimeType.TEXT)
    }

    // SYNCALUMNOS — sincroniza a Supabase los nombres + meses pagados de TODOS los alumnos del
    // tab activo (para el autocompletado y el grisado). Solo lee el sheet. { type:'SYNCALUMNOS', test:true }
    if (payload.type === 'SYNCALUMNOS' && payload.test === true) {
      const ssS  = SpreadsheetApp.openById(SHEET_ID)
      const tabS = (GLOBAL_TEST_MODE) ? TEST_TAB : MATRIX_TAB
      const shS  = ssS.getSheetByName(tabS)
      if (!shS) return ContentService.createTextOutput('no tab ' + tabS).setMimeType(ContentService.MimeType.TEXT)
      const lastS = shS.getLastRow()
      const valsS = shS.getRange(1, 1, lastS, 28).getValues()
      let logS = valsS.length
      for (let i = 0; i < valsS.length; i++) { if (String(valsS[i][0]).trim() === LOG_HEADER) { logS = i; break } }
      let n = 0
      for (let i = 0; i < logS; i++) {
        const nm = String(valsS[i][1] || '').trim()
        if (!nm || STRUCTURAL_NAMES.has(normalize(nm)) || EXCLUDED_STUDENTS.has(normalize(nm))) continue
        const meses = []
        for (const mo of MONTH_ORDER) {
          const v = Math.round((Number(valsS[i][MONTH_COL[mo] - 1]) || 0) * 100) / 100
          if (v >= MONTHLY_FEE) meses.push(mo)
        }
        syncAlumno(nm, meses.join(','))
        n++
      }
      return ContentService.createTextOutput('[SYNCALUMNOS] ' + n + ' alumnos sincronizados desde ' + tabS).setMimeType(ContentService.MimeType.TEXT)
    }

    // SYNCALL — prueba aislada del barrido bulk (mismo efecto que corre tras cada pago aplicado).
    // Solo lee el sheet y hace 1 upsert bulk. { type:'SYNCALL', test:true }
    if (payload.type === 'SYNCALL' && payload.test === true) {
      const ssAll = SpreadsheetApp.openById(SHEET_ID)
      const shAll = ssAll.getSheetByName(GLOBAL_TEST_MODE ? TEST_TAB : MATRIX_TAB)
      if (!shAll) return ContentService.createTextOutput('no tab').setMimeType(ContentService.MimeType.TEXT)
      const nAll = syncAllAlumnos(shAll)
      return ContentService.createTextOutput('[SYNCALL] barrido bulk de ' + nAll + ' alumnos').setMimeType(ContentService.MimeType.TEXT)
    }

    // SYNCROW — prueba: re-sincroniza una fila (lo mismo que hace onSheetEdit en una edición manual).
    // { type:'SYNCROW', test:true, row: N }
    if (payload.type === 'SYNCROW' && payload.test === true && payload.row) {
      const ssR = SpreadsheetApp.openById(SHEET_ID)
      const shR = ssR.getSheetByName(GLOBAL_TEST_MODE ? TEST_TAB : MATRIX_TAB)
      if (!shR) return ContentService.createTextOutput('no tab').setMimeType(ContentService.MimeType.TEXT)
      const ok = syncRowToSupabase(shR, Number(payload.row))
      const nm = String(shR.getRange(Number(payload.row), 2).getValue() || '').trim()
      return ContentService.createTextOutput('[SYNCROW] fila ' + payload.row + ' (' + nm + ') ' + (ok ? 'sincronizada: ' + paidMonthsOf(shR, Number(payload.row)) : 'omitida (no es alumno/fórmula)')).setMimeType(ContentService.MimeType.TEXT)
    }

    // OCRTEST — probar el OCR del comprobante sin tocar el sheet ni el WhatsApp.
    // { type:'OCRTEST', imageUrl:'https://...' }  → devuelve lo que leyó del comprobante.
    if (payload.type === 'OCRTEST') {
      const info = readComprobanteInfo(payload.imageUrl || '')
      return ContentService.createTextOutput('[OCRTEST]' + (info || ' (sin datos / sin key / no-imagen)')).setMimeType(ContentService.MimeType.TEXT)
    }

    // INSPECT — volcado CRUDO de columnas 1-28 para un rango de filas (SOLO LECTURA).
    // Para entender la estructura real (qué hay en cada columna par/impar de meses).
    // { type:'INSPECT', tab:'test'|'real', from: 1, to: 16 }
    if (payload.type === 'INSPECT') {
      const ss2 = SpreadsheetApp.openById(SHEET_ID)
      const tn  = payload.tab === 'real' ? MATRIX_TAB : TEST_TAB
      const sh2 = ss2.getSheetByName(tn)
      if (!sh2) return ContentService.createTextOutput(JSON.stringify({ error: 'no existe ' + tn })).setMimeType(ContentService.MimeType.JSON)
      const from = payload.from || 1
      const to   = Math.min(payload.to || 16, sh2.getLastRow())
      const n    = Math.max(0, to - from + 1)
      const vals = n > 0 ? sh2.getRange(from, 1, n, 28).getValues() : []
      const rows = vals.map(function(r, i) {
        const cells = {}
        for (let c = 0; c < 28; c++) {
          const v = r[c]
          if (v !== '' && v !== null && v !== undefined) cells['col' + (c + 1)] = v
        }
        return { row: from + i, cells: cells }
      })
      return ContentService.createTextOutput(JSON.stringify({ tab: tn, from: from, to: to, rows: rows })).setMimeType(ContentService.MimeType.JSON)
    }

    // READ — inspeccionar estructura de un tab (solo lectura). Para debugging/observabilidad.
    // { type:'READ', tab:'test'|'real', max: 200 }
    if (payload.type === 'READ') {
      const ss2 = SpreadsheetApp.openById(SHEET_ID)
      const tn  = payload.tab === 'real' ? MATRIX_TAB : TEST_TAB
      const sh2 = ss2.getSheetByName(tn)
      if (!sh2) return ContentService.createTextOutput(JSON.stringify({ error: 'no existe tab ' + tn })).setMimeType(ContentService.MimeType.JSON)
      const last = Math.min(sh2.getLastRow(), payload.max || 200)
      if (last < 1) return ContentService.createTextOutput(JSON.stringify({ tab: tn, rows: 0, students: [] })).setMimeType(ContentService.MimeType.JSON)
      const vals = sh2.getRange(1, 1, last, 28).getValues()
      let logRow = -1
      for (let i = 0; i < vals.length; i++) {
        if (String(vals[i][0]).trim() === LOG_HEADER) { logRow = i + 1; break }
      }
      const limit = logRow > 0 ? logRow - 1 : vals.length
      const students = []
      for (let i = 0; i < limit; i++) {
        const name = String(vals[i][1] || '').trim()
        if (!name) continue
        const paid = []
        for (const mo of MONTH_ORDER) {
          const v = Number(vals[i][MONTH_COL[mo] - 1]) || 0
          if (v > 0) paid.push(mo + '=' + v)
        }
        students.push({ row: i + 1, name: name, paid: paid })
      }
      return ContentService.createTextOutput(JSON.stringify({
        tab: tn, totalRows: sh2.getLastRow(), logHeaderRow: logRow, studentCount: students.length, students: students
      })).setMimeType(ContentService.MimeType.JSON)
    }

    // RESETMONTHS — deja el test tab fresh: pone en 0 SOLO las celdas de MONTO de cada mes
    // (columnas pares = MONTH_COL) y GARANTIZA que el nombre del alumno esté repetido en la
    // columna de cada mes (columnas impares "Persona:"). NUNCA borra nombres. (Solo TEST.)
    //
    // Estructura: por mes hay 2 columnas → impar = nombre "Persona:", par = monto "Pago?".
    //   Enero: col5=nombre, col6=monto · Febrero: col7/col8 · ... · Diciembre: col27/col28.
    // { type:'RESETMONTHS', test:true }
    if (payload.type === 'RESETMONTHS' && payload.test === true) {
      const ss2 = SpreadsheetApp.openById(SHEET_ID)
      const sh2 = ss2.getSheetByName(TEST_TAB)
      if (!sh2) return ContentService.createTextOutput('no test tab').setMimeType(ContentService.MimeType.TEXT)
      const last = sh2.getLastRow()
      const vals = sh2.getRange(1, 1, last, 28).getValues()
      const fmls = sh2.getRange(1, 1, last, 28).getFormulas()   // leídas una sola vez
      let logRow = vals.length
      for (let i = 0; i < vals.length; i++) {
        if (String(vals[i][0]).trim() === LOG_HEADER) { logRow = i; break }
      }
      let cleared = 0
      for (let i = 0; i < logRow; i++) {
        const name = String(vals[i][1] || '').trim()
        const nm   = normalize(name)
        if (!nm || STRUCTURAL_NAMES.has(nm)) continue
        // No tocar filas con fórmulas en el bloque de meses (ej. fila Total con SUM)
        const hasFormula = fmls[i].slice(5, 28).some(function(f) { return f })
        if (hasFormula) continue
        // Cols 5..28: impar = nombre del alumno (restaurado/garantizado), par = monto a 0 (vacío).
        const block = []
        for (let c = 5; c <= 28; c++) block.push(c % 2 === 1 ? name : '')
        sh2.getRange(i + 1, 5, 1, 24).setValues([block])
        cleared++
      }
      // Limpiar también la sección "Saldo a favor" (cols K-L), dejando el encabezado.
      try {
        const lastK = sh2.getLastRow()
        const colK  = sh2.getRange(1, SF_NAME_COL, lastK, 1).getValues()
        let sfHdr = -1
        for (let i = 0; i < colK.length; i++) { if (String(colK[i][0]).trim() === SF_HEADER) { sfHdr = i + 1; break } }
        if (sfHdr > 0 && lastK > sfHdr + 1) {
          sh2.getRange(sfHdr + 2, SF_NAME_COL, lastK - (sfHdr + 1), 2).clearContent()
        }
      } catch (e) {}
      SpreadsheetApp.flush()
      return ContentService.createTextOutput('[RESETMONTHS] ' + cleared + ' alumnos: montos en 0, nombres por mes intactos, saldo a favor limpio').setMimeType(ContentService.MimeType.TEXT)
    }

    if (payload.type !== 'INSERT') {
      return ContentService.createTextOutput('skipped').setMimeType(ContentService.MimeType.TEXT)
    }

    const isTest  = GLOBAL_TEST_MODE || payload.test === true
    const tabName = isTest ? TEST_TAB : MATRIX_TAB
    const row     = payload.record

    // Guard: record ausente / no-objeto (payload malformado) — no es un pago procesable
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      return ContentService.createTextOutput('error: record ausente o inválido').setMimeType(ContentService.MimeType.TEXT)
    }

    // Idempotencia: dedup por id de Supabase (NO por nombre+monto: una mamá puede pagar igual 2 veces)
    const props     = PropertiesService.getScriptProperties()
    const dedupeKey  = row.id ? 'pago_' + row.id : null

    const ss = SpreadsheetApp.openById(SHEET_ID)
    let sheet = ss.getSheetByName(tabName)
    if (!sheet) {
      // Solo crear hoja para el TEST. Para el tab REAL, fallar ruidoso: un rename/typo NO debe
      // crear una hoja vacía y marcar todo como "no encontrado".
      if (isTest) {
        sheet = ss.insertSheet(tabName)
      } else {
        sendWhatsApp('🚨 ERROR DE CONFIGURACIÓN: no existe el tab "' + tabName + '". Pago de "' +
          ((row && row.janij) || 'sin nombre') + '" (id ' + (row && row.id) + ') NO procesado. Revisar el nombre de la hoja.')
        if (row.id) updatePagoEstado(row.id, { ok: false, motivo: 'tab_inexistente', tab: tabName })
        return ContentService.createTextOutput('error: tab "' + tabName + '" no existe').setMimeType(ContentService.MimeType.TEXT)
      }
    }

    // Fecha: si row.fecha no es parseable, usar la del servidor (si no, FIXLOG la descarta luego)
    const _fechaRaw = row.fecha ? new Date(row.fecha) : new Date()
    const _fechaObj = isNaN(_fechaRaw.getTime()) ? new Date() : _fechaRaw
    const fecha = _fechaObj.toLocaleString('es-PA', { timeZone: 'America/Panama' })
    const monto = Math.round((Number(row.monto) || 0) * 100) / 100

    // Monto inválido — alertar por WA y no procesar (antes del lock: no escribe nada)
    if (monto <= 0) {
      const tag2  = isTest ? '[TEST] ' : ''
      const pfx2  = isTest ? '🧪 [TEST]\n' : ''
      const sub2  = (row.janij || 'sin nombre').trim()
      sendWhatsApp(
        pfx2 + '⚠️ Pago recibido con monto inválido\n' +
        '👤 Enviado como: "' + sub2 + '"\n' +
        '💰 B/.' + monto + '\n' +
        'Revisar el formulario — no se procesó'
      )
      updatePagoEstado(row.id, { ok: false, motivo: 'monto_invalido', monto: monto })
      return ContentService.createTextOutput(tag2 + '⚠️ MONTO INVÁLIDO — B/.' + monto).setMimeType(ContentService.MimeType.TEXT)
    }

    // OCR advisory del comprobante — se calcula ANTES del lock (es solo lectura de la imagen,
    // no necesita el lock) para NO alargar el bloqueo. Best-effort: '' si falla o no hay key.
    const ocrInfo = readComprobanteInfo(row.comprobante_url || '')

    // ── SECCIÓN CRÍTICA — serializada con LockService ──────────────────────────
    // Evita que dos pagos simultáneos al mismo alumno se pisen (read-modify-write atómico).
    const lock = LockService.getScriptLock()
    try {
      lock.waitLock(20000)
    } catch (lockErr) {
      return ContentService.createTextOutput('ocupado, reintentar en un momento').setMimeType(ContentService.MimeType.TEXT)
    }
    try {
      // Idempotencia (dentro del lock = atómico): si este id ya se procesó, no re-aplicar.
      if (dedupeKey && props.getProperty(dedupeKey)) {
        return ContentService.createTextOutput('[DUP] ya procesado id=' + row.id).setMimeType(ContentService.MimeType.TEXT)
      }

      // ── PASO EXTRA: comprobante duplicado ──────────────────────────────────────
      // Si este MISMO comprobante (misma huella) ya se usó para ACREDITAR un pago,
      // NO se acredita de nuevo: se avisa a Marce. Si no viene huella (form viejo o
      // falló el hash), compHash es null y todo este paso se saltea → cero interferencia.
      const compHash  = extractCompHash(row.comprobante_url)
      const compScope = isTest ? 'cmp_t_' : 'cmp_p_'
      if (compHash) {
        const prior = props.getProperty(compScope + compHash)
        if (prior) {
          let priorWho = prior
          try { priorWho = (JSON.parse(prior).janij) || prior } catch (e) {}
          const pfx = isTest ? '🧪 [TEST]\n' : ''
          sendWhatsApp(pfx + '🚫 Comprobante DUPLICADO\n' +
            '👤 Enviado como: "' + (row.janij || '') + '"\n' +
            '💰 B/.' + monto + '\n' +
            'Este MISMO comprobante ya se usó para acreditar a "' + priorWho + '". NO se aplicó. Revisar.' + ocrInfo)
          updatePagoEstado(row.id, { ok: false, found: false, motivo: 'comprobante_duplicado', monto: monto, usadoPor: priorWho })
          return ContentService.createTextOutput((isTest ? '[TEST] ' : '') +
            '🚫 COMPROBANTE DUPLICADO — ya usado para acreditar a "' + priorWho + '"').setMimeType(ContentService.MimeType.TEXT)
        }
      }

      // Buscar persona
      const matchResult = row.janij ? findPersonRow(sheet, row.janij) : { row: -1, confidence: 'not_found' }

      // Meses que indicó la mamá (solo para mostrar; NO definen el orden de aplicación)
      const requestedMonths = parseMonths(row.mes)

      // SIEMPRE aplicar en orden cronológico desde el primer mes pendiente (Feb→Dic).
      // Un match SOLO fuzzy NO se aplica automático (podría ser otra familia).
      let months = []
      if (matchResult.row > 0 && matchResult.confidence !== 'fuzzy') {
        months = findAllUnpaidMonths(sheet, matchResult.row, monto)
      }

      // Aplicar distribución
      let estado    = ''
      let distLog   = [], distExtra = 0
      let saldo     = null
      let aplicado  = false              // true SOLO si realmente se escribió el pago
      let montoSospechoso = false

      if (matchResult.row > 0 && matchResult.confidence !== 'fuzzy') {
        const tag = matchResult.confidence === 'partial' ? ' (nombre aprox.)' : ''
        const saldoActual = calculateBalance(sheet, matchResult.row)

        if (monto > saldoActual + MONTHLY_FEE) {
          // Monto sospechosamente alto (típico typo 300 en vez de 30): NO aplicar, confirmar.
          montoSospechoso = true
          saldo  = saldoActual
          estado = '⚠️ PENDIENTE — monto B/.' + monto + ' supera el saldo pendiente B/.' + saldoActual +
                   ' — posible error de tipeo, NO se aplicó. Confirmar.'
        } else if (months.length > 0) {
          const r = distributePayment(sheet, matchResult.row, months, monto)
          distLog = r.log; distExtra = r.extra
          aplicado = true
          // Sobrepago: lo que sobró (no llenó un mes completo) se guarda como SALDO A FAVOR
          // (sección aparte, columnas K-L). Así no se pierde; Marce decide qué hacer.
          if (r.extra > 0) { try { addSaldoFavor(sheet, matchResult.matched, r.extra) } catch (e) {} }
          saldo   = calculateBalance(sheet, matchResult.row)
          estado  = '✓ aplicado' + tag + ' | ' + r.log.join(' · ') + ' | Saldo: B/.' + saldo
          if (r.extra > 0) estado += ' | 💰 B/.' + r.extra + ' → saldo a favor'
        } else {
          // Ya completó el año: toda la plata es de más → saldo a favor (no se aplica a meses).
          try { addSaldoFavor(sheet, matchResult.matched, monto) } catch (e) {}
          saldo  = saldoActual
          estado = '⚠️ año completo' + tag + ' | 💰 B/.' + monto + ' → saldo a favor (revisar adelanto/duplicado)'
        }
      } else if (matchResult.confidence === 'fuzzy') {
        estado = '⚠️ PENDIENTE — nombre similar a "' + matchResult.matched + '" (enviado: "' +
                 (row.janij || '') + '") — confirmar antes de aplicar'
      } else if (matchResult.confidence === 'ambiguous') {
        estado = '⚠️ PENDIENTE — ambiguo: ¿' + matchResult.candidates.join(' o ') + '?'
      } else {
        estado = '⚠️ PENDIENTE — "' + (row.janij || '') + '" no encontrado'
      }

      // Flush de la matriz antes de tocar el log
      SpreadsheetApp.flush()

      // Log — en su propio try/catch: si el dinero YA se aplicó pero falla el log, avisar
      // específicamente (no dejar el pago sin rastro de auditoría) y continuar el flujo.
      try {
        ensureLogHeader(sheet)
        appendLogRow(sheet, fecha, row.janij || '', monto, row.mes || '', estado, row.comprobante_url || '')
        SpreadsheetApp.flush()
      } catch (logErr) {
        sendWhatsApp((isTest ? '🧪 [TEST]\n' : '') +
          '⚠️ Pago ' + (aplicado ? 'YA APLICADO en la matriz' : 'recibido') + ' pero FALLÓ escribir el log\n' +
          '👤 ' + (matchResult.matched || (row.janij || 'sin nombre')) + '\n' +
          '💰 B/.' + monto + (aplicado && distLog.length ? '\n📅 ' + distLog.join(' · ') : '') + '\n' +
          'Anotar manualmente. (' + logErr.message + ')')
      }

      // WhatsApp — SIEMPRE mandar, según el resultado real
      const mesesStr  = months.join(', ') || (row.mes ? row.mes.trim() : '—')
      const prefix    = isTest ? '🧪 [TEST]\n' : ''
      const submitted = (row.janij || '').trim()
      let waCaption

      if (aplicado) {
        const sheetName = matchResult.matched || submitted
        const nameLine  = normalize(sheetName) !== normalize(submitted)
          ? '👤 ' + sheetName + '\n   ← enviado como: "' + submitted + '"'
          : '👤 ' + sheetName
        const logStr    = distLog.join(' · ') || mesesStr
        const extraWarn = distExtra > 0 ? '\n💰 B/.' + distExtra + ' de más → guardado como saldo a favor' : ''
        const reqStr  = requestedMonths.join(', ')
        const appStr  = months.join(', ')
        const reqNote = reqStr && reqStr !== appStr
          ? '\n   ℹ️ La mamá indicó: ' + reqStr + ' — se aplicó en orden'
          : ''
        const saldoLine = '\n💳 Saldo pendiente: B/.' + (saldo != null ? saldo : '?')
        waCaption = prefix + '✅ Pago registrado\n' + nameLine + '\n' +
          '💰 B/.' + monto + '\n' + '📅 ' + logStr + reqNote + extraWarn + saldoLine

      } else if (matchResult.row > 0 && matchResult.confidence !== 'fuzzy' && !montoSospechoso && months.length === 0) {
        const sheetName = matchResult.matched || submitted
        const nameLine  = normalize(sheetName) !== normalize(submitted)
          ? '👤 ' + sheetName + '\n   ← enviado como: "' + submitted + '"'
          : '👤 ' + sheetName
        waCaption = prefix + '⚠️ Pago recibido — año ya completo\n' + nameLine + '\n' +
          '💰 B/.' + monto + ' → guardado como saldo a favor\n' +
          'Este alumno ya pagó los 11 meses. Revisar si es adelanto o duplicado.'

      } else if (montoSospechoso) {
        waCaption = prefix + '❓ Pago pendiente — monto sospechoso\n' +
          '👤 ' + (matchResult.matched || submitted) + '\n' +
          '💰 B/.' + monto + ' (debe B/.' + (saldo != null ? saldo : '?') + ')\n' +
          'Supera lo que debe — posible error de tipeo. NO se aplicó, confirmar.'

      } else if (matchResult.confidence === 'fuzzy') {
        waCaption = prefix + '❓ Pago pendiente — nombre similar\n' +
          '👤 Enviado como: "' + submitted + '"  ¿es "' + matchResult.matched + '"?\n' +
          '💰 B/.' + monto + '\n' +
          (row.mes ? '📅 Mes(es): ' + row.mes + '\n' : '') +
          'Confirmar antes de aplicar (NO se aplicó automático)'

      } else if (matchResult.confidence === 'ambiguous') {
        waCaption = prefix + '❓ Pago pendiente — nombre ambiguo\n' +
          '👤 Enviado como: "' + submitted + '"\n' +
          '💰 B/.' + monto + '\n' +
          (row.mes ? '📅 Mes(es): ' + row.mes + '\n' : '') +
          '⚠️ Puede ser:\n' +
          matchResult.candidates.map(function(c) { return '   • ' + c }).join('\n') + '\n' +
          'Confirmar quién es y asignar'

      } else {
        waCaption = prefix + '❓ Pago pendiente — nombre no encontrado\n' +
          '👤 Enviado como: "' + submitted + '"\n' +
          '💰 B/.' + monto + '\n' +
          (row.mes ? '📅 Mes(es): ' + row.mes + '\n' : '') +
          'Buscar en el directorio y asignar manualmente'
      }

      // Agregar lo que Claude leyó del comprobante (ref/monto/fecha) para que Marce
      // detecte recibos repetidos de un vistazo. ocrInfo es '' si no hay key/falla.
      waCaption += ocrInfo

      if (row.comprobante_url) {
        sendWhatsAppWithImage(waCaption, row.comprobante_url)
      } else {
        sendWhatsApp(waCaption)
      }

      // Resultado a Supabase (para el saldo del form)
      let resultObj
      if (aplicado) {
        resultObj = { ok: true, found: true, saldo: saldo, monto: monto,
          detalle: distLog.join(' · '), extra: distExtra, completo: saldo === 0,
          alumno: matchResult.matched || submitted }
      } else if (matchResult.row > 0 && matchResult.confidence !== 'fuzzy' && !montoSospechoso && months.length === 0) {
        resultObj = { ok: true, found: true, saldo: (saldo != null ? saldo : 0), monto: monto,
          completo: true, alumno: matchResult.matched || submitted }
      } else if (montoSospechoso) {
        resultObj = { ok: false, found: true, motivo: 'monto_sospechoso', monto: monto, saldo: saldo,
          alumno: matchResult.matched || submitted }
      } else if (matchResult.confidence === 'fuzzy') {
        resultObj = { ok: false, found: false, motivo: 'nombre_similar', monto: monto, similar: matchResult.matched }
      } else if (matchResult.confidence === 'ambiguous') {
        resultObj = { ok: false, found: false, motivo: 'ambiguo', monto: monto, candidatos: matchResult.candidates }
      } else {
        resultObj = { ok: false, found: false, motivo: 'no_encontrado', monto: monto }
      }
      updatePagoEstado(row.id, resultObj)

      // Idempotencia: marcar como procesado DESPUÉS del éxito (no antes, por si murió a medias)
      if (dedupeKey) props.setProperty(dedupeKey, String(new Date().getTime()))

      // Registrar la huella del comprobante SOLO si se ACREDITÓ el pago. Así, reusar el mismo
      // comprobante en otro pago se detecta arriba. (Si no se aplicó, no se registra: permite
      // reenviar el mismo comprobante con el nombre corregido sin falso "duplicado".)
      if (aplicado && compHash) {
        props.setProperty(compScope + compHash, JSON.stringify({
          janij: matchResult.matched || submitted, id: row.id || '', fecha: fecha
        }))
      }

      // Sincronizar a Supabase los meses pagados del alumno (para grisarlos en el form la
      // próxima vez). Solo si se aplicó. Best-effort, fuera del flujo crítico de escritura.
      if (aplicado && matchResult.matched) {
        syncAlumno(matchResult.matched, paidMonthsOf(sheet, matchResult.row))
        // Además barre a TODOS en 1 sola llamada bulk: así una edición MANUAL en el sheet (que no
        // pasó por el form) queda reflejada en el grisado en el próximo pago, sin trigger onEdit.
        // Best-effort: si fallara, el pago y el sync individual de arriba ya quedaron firmes.
        syncAllAlumnos(sheet)
      }

      const tag = isTest ? '[TEST] ' : ''
      return ContentService.createTextOutput(tag + estado).setMimeType(ContentService.MimeType.TEXT)
    } finally {
      lock.releaseLock()
    }

  } catch (err) {
    try {
      const isTestMode = typeof GLOBAL_TEST_MODE !== 'undefined' && GLOBAL_TEST_MODE
      sendWhatsApp(
        (isTestMode ? '🧪 [TEST]\n' : '') +
        '🔴 Error interno en el webhook\n' +
        err.message + '\n' +
        'Revisar pago manualmente'
      )
    } catch (e2) {}
    return ContentService.createTextOutput('error: ' + err.message).setMimeType(ContentService.MimeType.TEXT)
  }
}

// Instala (idempotente) el trigger onEdit. Se ejecuta una vez con `clasp run installEditTrigger`.
function installEditTrigger() {
  const ts = ScriptApp.getProjectTriggers()
  for (var i = 0; i < ts.length; i++) {
    if (ts[i].getHandlerFunction() === 'onSheetEdit') ScriptApp.deleteTrigger(ts[i])
  }
  ScriptApp.newTrigger('onSheetEdit').forSpreadsheet(SHEET_ID).onEdit().create()
  return 'OK: trigger onSheetEdit instalado'
}

function testInsert() {
  const fakeEvent = { postData: { contents: JSON.stringify({
    type: 'INSERT', test: true,
    record: { fecha: new Date().toISOString(), janij: 'Tommy Hanono', monto: 30,
      mes: '', comprobante_url: 'https://drive.google.com/open?id=1dlqXAlbqQzYGuok4AfJ_9BcT-YltS3T4'
    }
  })}}
  Logger.log(doPost(fakeEvent).getContent())
}
