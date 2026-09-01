const { google } = require('googleapis');

// Colunas esperadas na planilha, nessa ordem, a partir da linha 2 (linha 1 é cabeçalho):
// A: telefone | B: nome | C: status | D: historico (JSON) |
// E: ultima_mensagem_paciente (ISO) | F: followup_enviado

const SHEET_NAME = 'Pacientes';
const RANGE = `${SHEET_NAME}!A2:F`;

function getAuth() {
  return new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  );
}

async function getSheetsClient() {
  const auth = getAuth();
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}

/**
 * Busca a linha do paciente pelo telefone. Retorna null se não existir ainda.
 */
async function findPatient(phone) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEETS_ID,
    range: RANGE,
  });

  const rows = res.data.values || [];
  const rowIndex = rows.findIndex((row) => row[0] === phone);

  if (rowIndex === -1) return null;

  const row = rows[rowIndex];
  return {
    rowNumber: rowIndex + 2, // +2 porque a planilha começa na linha 2
    telefone: row[0],
    nome: row[1] || '',
    status: row[2] || 'em_conversa',
    historico: row[3] ? JSON.parse(row[3]) : [],
    ultimaMensagemPaciente: row[4] || '',
    followupEnviado: row[5] || '',
  };
}

/**
 * Cria ou atualiza a linha do paciente com os campos passados.
 */
async function upsertPatient(phone, fields) {
  const sheets = await getSheetsClient();
  const existing = await findPatient(phone);

  const merged = {
    telefone: phone,
    nome: fields.nome ?? existing?.nome ?? '',
    status: fields.status ?? existing?.status ?? 'em_conversa',
    historico: fields.historico ?? existing?.historico ?? [],
    ultimaMensagemPaciente: fields.ultimaMensagemPaciente ?? existing?.ultimaMensagemPaciente ?? '',
    followupEnviado: fields.followupEnviado ?? existing?.followupEnviado ?? '',
  };

  const values = [[
    merged.telefone,
    merged.nome,
    merged.status,
    JSON.stringify(merged.historico),
    merged.ultimaMensagemPaciente,
    merged.followupEnviado,
  ]];

  if (existing) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEETS_ID,
      range: `${SHEET_NAME}!A${existing.rowNumber}:F${existing.rowNumber}`,
      valueInputOption: 'RAW',
      requestBody: { values },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEETS_ID,
      range: RANGE,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values },
    });
  }

  return merged;
}

/**
 * Retorna todos os pacientes da planilha (usado pela checagem de follow-up).
 */
async function getAllPatients() {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEETS_ID,
    range: RANGE,
  });

  const rows = res.data.values || [];
  return rows.map((row, i) => ({
    rowNumber: i + 2,
    telefone: row[0],
    nome: row[1] || '',
    status: row[2] || 'em_conversa',
    historico: row[3] ? JSON.parse(row[3]) : [],
    ultimaMensagemPaciente: row[4] || '',
    followupEnviado: row[5] || '',
  }));
}

async function updateFollowupEnviado(rowNumber, valor) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.GOOGLE_SHEETS_ID,
    range: `${SHEET_NAME}!F${rowNumber}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[valor]] },
  });
}

module.exports = { findPatient, upsertPatient, getAllPatients, updateFollowupEnviado };
