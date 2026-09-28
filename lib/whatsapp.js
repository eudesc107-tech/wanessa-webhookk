const WHATSAPP_API_VERSION = 'v21.0';

const DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function apiUrl(phoneNumberId, path) {
  return `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${phoneNumberId}/${path}`;
}

// Transforma 2026-09-25 em "sexta, 25/09/2026", mais fácil de ler pra recepção.
function dataLegivel(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || '';
  const [ano, mes, dia] = iso.split('-');
  const diaSemana = DIAS_SEMANA[new Date(`${iso}T12:00:00-03:00`).getDay()];
  return `${diaSemana}, ${dia}/${mes}/${ano}`;
}

async function sendText(to, text) {
  const res = await fetch(apiUrl(process.env.WHATSAPP_PHONE_NUMBER_ID, 'messages'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    }),
  });

  if (!res.ok) {
    console.error('Erro ao enviar WhatsApp:', await res.text());
  }
}

async function markAsRead(messageId, { typing = false } = {}) {
  const body = {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId,
  };

  if (typing) {
    body.typing_indicator = { type: 'text' };
  }

  await fetch(apiUrl(process.env.WHATSAPP_PHONE_NUMBER_ID, 'messages'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
}

async function notifyReceptionist({ patientName, patientPhone, agendamento, remarcado = false }) {
  const numero = process.env.RECEPTIONIST_PHONE_NUMBER;
  if (!numero) {
    console.error('RECEPTIONIST_PHONE_NUMBER não configurado, notificação não enviada.');
    return;
  }

  const titulo = remarcado
    ? 'Agendamento remarcado pela Wanessa'
    : 'Novo agendamento pela Wanessa';

  const texto =
    `${titulo}\n\n` +
    `Paciente: ${patientName || patientPhone}\n` +
    `Telefone: ${patientPhone}\n` +
    `Data: ${dataLegivel(agendamento.data)}\n` +
    `Horário: ${agendamento.horario}\n` +
    `Procedimento: ${agendamento.procedimento}`;

  await sendText(numero, texto);
}

/**
 * Manda a mensagem de confirmação ativa de presença, perto da data do
 * agendamento. Pede uma resposta (não é só um aviso), o que aumenta muito
 * mais a chance de comparecimento do que um lembrete passivo.
 */
async function requestConfirmation({ patientPhone, nome, agendamento }) {
  const primeiroNome = (nome || '').split(' ')[0];
  const saudacao = primeiroNome ? `Oi, ${primeiroNome}` : 'Oi';

  const motivoTexto = agendamento.motivo
    ? `, pra resolver aquilo que você comentou (${agendamento.motivo})`
    : '';

  const texto =
    `${saudacao}, passando pra confirmar sua ${agendamento.procedimento || 'consulta'} ` +
    `${agendamento.dataFormatada} às ${agendamento.horario}${motivoTexto}. ` +
    `Posso contar com você?`;

  await sendText(patientPhone, texto);
}

module.exports = { sendText, markAsRead, notifyReceptionist, requestConfirmation };
