const WHATSAPP_API_VERSION = 'v21.0';

function apiUrl(phoneNumberId, path) {
  return `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${phoneNumberId}/${path}`;
}

/**
 * Envia uma mensagem de texto simples pro número informado.
 */
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

/**
 * Marca uma mensagem recebida como lida (mostra o "check azul").
 */
async function markAsRead(messageId) {
  await fetch(apiUrl(process.env.WHATSAPP_PHONE_NUMBER_ID, 'messages'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    }),
  });
}

/**
 * Envia a notificação de agendamento pro WhatsApp da recepcionista/dentista.
 */
async function notifyReceptionist({ patientName, patientPhone, agendamento }) {
  const numero = process.env.RECEPTIONIST_PHONE_NUMBER;
  if (!numero) {
    console.error('RECEPTIONIST_PHONE_NUMBER não configurado, notificação não enviada.');
    return;
  }

  const texto =
    `Novo agendamento pela Wanessa\n\n` +
    `Paciente: ${patientName || patientPhone}\n` +
    `Telefone: ${patientPhone}\n` +
    `Data: ${agendamento.data}\n` +
    `Horário: ${agendamento.horario}\n` +
    `Procedimento: ${agendamento.procedimento}`;

  await sendText(numero, texto);
}

module.exports = { sendText, markAsRead, notifyReceptionist };
