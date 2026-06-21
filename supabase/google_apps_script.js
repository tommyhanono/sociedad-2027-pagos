// ============================================================
// Google Apps Script — Sociedad 2027 Pagos → Google Sheets
// ============================================================

const SHEET_ID   = '1yx0Ciq-5TgacuoufSeIx4DrsB438LOiqJ9DpASChXp8'
const MATRIX_TAB = 'Mensualidades 2026'
const LOG_HEADER = '=== PAGOS RECIBIDOS (App) ==='
const LOG_COLS   = ['Fecha', 'Janij/a', 'Monto (B/.)', 'Mes(es)', 'Estado', 'Comprobante']

// Pago? column (1-based) for each month in the matrix
const MONTH_COL = {
  'Enero': 6, 'Febrero': 8, 'Marzo': 10, 'Abril': 12,
  'Mayo': 14, 'Junio': 16, 'Julio': 18, 'Agosto': 20,
  'Septiembre': 22, 'Octubre': 24, 'Noviembre': 26, 'Diciembre': 28
}

/** Match "Tommy Hanono" → "Tommy H" using first name + last initial */
function findPersonRow(sheet, personName) {
  const parts = String(personName || '').trim().split(/\s+/)
  const first = parts[0].toLowerCase()
  const lastI = parts.length > 1 ? parts[parts.length - 1][0].toLowerCase() : ''
  const data  = sheet.getDataRange().getValues()
  for (let i = 0; i < data.length; i++) {
    const cp  = String(data[i][1]).trim().split(/\s+/)
    const cf  = cp[0].toLowerCase()
    const cli = cp.length > 1 ? cp[cp.length - 1][0].toLowerCase() : ''
    if (cf === first && (!lastI || cli === lastI)) return i + 1
  }
  return -1
}

/** Parse "Enero 2026, Febrero 2026" → ["Enero", "Febrero"] */
function parseMonths(mesStr) {
  return String(mesStr || '').split(',')
    .map(s => s.trim().replace(/\s+\d{4}$/, '').trim())
    .filter(s => s && MONTH_COL[s])
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents)
    if (payload.type !== 'INSERT') {
      return ContentService.createTextOutput('skipped').setMimeType(ContentService.MimeType.TEXT)
    }
    const row   = payload.record
    const ss    = SpreadsheetApp.openById(SHEET_ID)
    let sheet   = ss.getSheetByName(MATRIX_TAB)
    if (!sheet) sheet = ss.insertSheet(MATRIX_TAB)

    const fecha    = row.fecha
      ? new Date(row.fecha).toLocaleString('es-PA', { timeZone: 'America/Panama' })
      : new Date().toLocaleString('es-PA', { timeZone: 'America/Panama' })
    const months   = parseMonths(row.mes)
    const monto    = Number(row.monto) || 0
    const perMonth = months.length > 0 ? Math.round((monto / months.length) * 100) / 100 : monto

    // 1. Update matrix cells
    let matrixUpdated = false
    let matchedRow    = -1
    if (row.janij && months.length > 0) {
      matchedRow = findPersonRow(sheet, row.janij)
      if (matchedRow > 0) {
        for (const month of months) {
          const cell    = sheet.getRange(matchedRow, MONTH_COL[month])
          const current = Number(cell.getValue()) || 0
          cell.setValue(current + perMonth)
        }
        matrixUpdated = true
      }
    }

    // 2. Append to log section
    const data = sheet.getDataRange().getValues()
    let logRow = -1
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][0]).trim() === LOG_HEADER) { logRow = i; break }
    }
    if (logRow === -1) {
      const insertAt = sheet.getLastRow() + 3
      sheet.getRange(insertAt, 1).setValue(LOG_HEADER)
      sheet.getRange(insertAt, 1, 1, 6).setFontWeight('bold').setBackground('#1A3A6B').setFontColor('#ffffff')
      sheet.getRange(insertAt + 1, 1, 1, 6).setValues([LOG_COLS])
      sheet.getRange(insertAt + 1, 1, 1, 6).setFontWeight('bold').setBackground('#F5A623')
    }
    const estado = matrixUpdated
      ? 'actualizado en matrix ✓'
      : matchedRow === -1 ? 'PENDIENTE — nombre no encontrado' : 'pendiente'
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, 6).setValues([[
      fecha, row.janij || '', monto, row.mes || '', estado, row.comprobante_url || ''
    ]])

    return ContentService.createTextOutput('ok').setMimeType(ContentService.MimeType.TEXT)
  } catch (err) {
    return ContentService.createTextOutput('error: ' + err.message).setMimeType(ContentService.MimeType.TEXT)
  }
}

function testInsert() {
  const fakeEvent = { postData: { contents: JSON.stringify({ type: 'INSERT', record: {
    fecha: new Date().toISOString(), janij: 'Tommy Hanono', monto: 60,
    mes: 'Octubre 2026, Noviembre 2026', estado: 'pendiente',
    comprobante_url: 'https://example.com/test.jpg'
  }})}}
  Logger.log(doPost(fakeEvent).getContent())
}
