// ============================================================
// Google Apps Script — Sociedad 2027 Pagos → Google Sheets
// ============================================================
// Paste this into: script.google.com → New project
// Then: Deploy → New deployment → Web app
//   - Execute as: Me
//   - Who has access: Anyone
// Copy the Web App URL → paste into Supabase webhook (see README)
// ============================================================

const SHEET_ID  = '1yx0Ciq-5TgacuoufSeIx4DrsB438LOiqJ9DpASChXp8'
const TAB_NAME  = 'Pagos'   // Will be created automatically if it doesn't exist

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents)

    // Supabase sends { type: "INSERT", record: { ... } }
    if (payload.type !== 'INSERT') {
      return ContentService.createTextOutput('skipped').setMimeType(ContentService.MimeType.TEXT)
    }

    const row = payload.record
    const ss   = SpreadsheetApp.openById(SHEET_ID)
    let sheet  = ss.getSheetByName(TAB_NAME)

    // Auto-create tab + header if it doesn't exist
    if (!sheet) {
      sheet = ss.insertSheet(TAB_NAME)
      sheet.appendRow(['Fecha', 'Janij/a', 'Monto (B/.)', 'Mes', 'Estado', 'Comprobante'])
      sheet.getRange(1, 1, 1, 6).setFontWeight('bold')
    }

    const fecha = row.fecha
      ? new Date(row.fecha).toLocaleString('es-PA', { timeZone: 'America/Panama' })
      : new Date().toLocaleString('es-PA', { timeZone: 'America/Panama' })

    sheet.appendRow([
      fecha,
      row.janij        || '',
      row.monto        || 0,
      row.mes          || '',
      row.estado       || 'pendiente',
      row.comprobante_url || '',
    ])

    return ContentService.createTextOutput('ok').setMimeType(ContentService.MimeType.TEXT)
  } catch (err) {
    return ContentService.createTextOutput('error: ' + err.message).setMimeType(ContentService.MimeType.TEXT)
  }
}

// Test function — run manually from the editor to verify the sheet connection
function testInsert() {
  const fakeEvent = {
    postData: {
      contents: JSON.stringify({
        type: 'INSERT',
        record: {
          fecha: new Date().toISOString(),
          janij: 'Test Janij',
          monto: 99.50,
          mes: 'Agosto 2026',
          estado: 'pendiente',
          comprobante_url: 'https://example.com/test.jpg',
        }
      })
    }
  }
  doPost(fakeEvent)
  Logger.log('Test row inserted — check the Pagos tab in the sheet.')
}
