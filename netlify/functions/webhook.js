const { askWanessa } = require('../../lib/claude');
const { markAsRead, notifyReceptionist } = require('../../lib/whatsapp');
const { agendarEnvios } = require('../../lib/qstash');
const { findPatient, upsertPatient } = require('../../lib/sheets');

exports.handler = async (event) => {
  // 1. Verificação do webhook (Meta chama com GET na hora de configurar)
  if (event.httpMethod === 'GET') {
    const params = event.queryStringParameters || {};
    const mode = params['hub.mode'];
    const token = params['hub.verify_token'];
    const challenge = params['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      return { statusCode: 200, body: challenge };
    }
    return { statusCode: 403, body: 'Token inválido' };
  }

  // 2. Mensagem nova chegando (Meta chama com POST)
  if (event.httpMethod === 'POST') {
    try {
      const body = JSON.parse(event.body);
      const entry = body.entry?.[0];
      const change = entry?.changes?.[0];
      const message = change?.value?.messages?.[0];

      // Meta também manda POSTs de status (entregue, lido), ignoramos esses
      if (!message) {
        return { statusCode: 200, body: 'ok' };
      }

      const from = message.from; // telefone do paciente
      const contactName = change?.value?.contacts?.[0]?.profile?.name || '';

      await markAsRead(message.id, { typing: true });

      // 3. Extrai o texto da mensagem (trata áudio como caso especial)
      let userText;
      if (message.type === 'text') {
        userText = message.text.body;
      } else if (message.type === 'audio') {
        userText = '[o paciente mandou um áudio]';
      } else {
        userText = `[o paciente mandou uma mensagem do tipo ${message.type}, não suportada ainda]`;
      }

      // 4. Busca o histórico do paciente na planilha
      const existing = await findPatient(from);
      const historico = existing?.historico || [];
      historico.push({ role: 'user', content: userText });

      // 5. Chama a Wanessa (Claude) com o histórico completo
      const resultado = await askWanessa(historico);

      historico.push({ role: 'assistant', content: resultado.mensagens.join(' ') });

      // 6. Agenda o envio de cada mensagem da lista, em sequência, com delay
      await agendarEnvios({ to: from, mensagens: resultado.mensagens });

      // 7. Atualiza a planilha
      const agora = new Date().toISOString();
      await upsertPatient(from, {
        nome: existing?.nome || contactName,
        status: resultado.status,
        historico,
        ultimaMensagemPaciente: agora,
        followupEnviado: '', // paciente respondeu, reseta o controle de follow-up
      });

      // 8. Se fechou agendamento, notifica a recepcionista
      if (resultado.status === 'agendado' && resultado.agendamento) {
        await notifyReceptionist({
          patientName: existing?.nome || contactName,
          patientPhone: from,
          agendamento: resultado.agendamento,
        });
      }

      return { statusCode: 200, body: 'ok' };
    } catch (err) {
      console.error('Erro no webhook da Wanessa:', err);
      // Retorna 200 mesmo em erro pra Meta não ficar reenviando o mesmo evento
      return { statusCode: 200, body: 'erro tratado' };
    }
  }

  return { statusCode: 405, body: 'Método não suportado' };
};
