const { google } = require('googleapis');

// Colunas esperadas na planilha, nessa ordem, a partir da linha 2 (linha 1 é cabeçalho):
// A: telefone | B: nome | C: status | D: historico (JSON) |
// E: ultima_mensagem_paciente (ISO) | F: followup_enviado |
// G: agendamento_data (AAAA-MM-DD) | H: agendamento_horario (HH:MM) |
// I: agendamento_procedimento | J: agendamento_motivo | K: confirmacao_enviada

const SHEET_NAME = 'Pacientes';
const RANGE = `${SHEET_NAME}!A2:K`;

function getAuth() {
  const rawKey = process.env.GOOGLE_PRIVATE_KEY || '';
  const privateKey = Buffer.from(rawKey, 'base64').toString('utf8');

  return new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    privateKey,
    ['https://www.googleapis.com/auth/spreadsheets']
  );
}

async function getSheetsClient() {
  const auth = getAuth();
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}

function linhaParaObjeto(row, rowNumber) {
  return {
    rowNumber,
    telefone: row[0],
    nome: row[1] || '',
    status: row[2] || 'em_conversa',
    historico: row[3] ? JSON.parse(row[3]) : [],
    ultimaMensagemPaciente: row[4] || '',
    followupEnviado: row[5] || '',
    agendamentoData: row[6] || '',
    agendamentoHorario: row[7] || '',
    agendamentoProcedimento: row[8] || '',
    agendamentoMotivo: row[9] || '',
    confirmacaoEnviada: row[10] || '',
  };
}

async function findPatient(phone) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEETS_ID,
    range: RANGE,
  });

  const rows = res.data.values || [];
  const rowIndex = rows.findIndex((row) => row[0] === phone);

  if (rowIndex === -1) return null;

  return linhaParaObjeto(rows[rowIndex], rowIndex + 2);
}

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
    agendamentoData: fields.agendamentoData ?? existing?.agendamentoData ?? '',
    agendamentoHorario: fields.agendamentoHorario ?? existing?.agendamentoHorario ?? '',
    agendamentoProcedimento: fields.agendamentoProcedimento ?? existing?.agendamentoProcedimento ?? '',
    agendamentoMotivo: fields.agendamentoMotivo ?? existing?.agendamentoMotivo ?? '',
    confirmacaoEnviada: fields.confirmacaoEnviada ?? existing?.confirmacaoEnviada ?? '',
  };

  const values = [[
    merged.telefone,
    merged.nome,
    merged.status,
    JSON.stringify(merged.historico),
    merged.ultimaMensagemPaciente,
    merged.followupEnviado,
    merged.agendamentoData,
    merged.agendamentoHorario,
    merged.agendamentoProcedimento,
    merged.agendamentoMotivo,
    merged.confirmacaoEnviada,
  ]];

  if (existing) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEETS_ID,
      range: `${SHEET_NAME}!A${existing.rowNumber}:K${existing.rowNumber}`,
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

async function getAllPatients() {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEETS_ID,
    range: RANGE,
  });

  const rows = res.data.values || [];
  return rows.map((row, i) => linhaParaObjeto(row, i + 2));
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

async function updateConfirmacaoEnviada(rowNumber, valor) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.GOOGLE_SHEETS_ID,
    range: `${SHEET_NAME}!K${rowNumber}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[valor]] },
  });
}

module.exports = {
  findPatient,
  upsertPatient,
  getAllPatients,
  updateFollowupEnviado,
  updateConfirmacaoEnviada,
};
