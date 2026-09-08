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

      if (!message) {
        return { statusCode: 200, body: 'ok' };
      }

      const from = message.from;
      const contactName = change?.value?.contacts?.[0]?.profile?.name || '';

      await markAsRead(message.id, { typing: true });

      let userText;
      if (message.type === 'text') {
        userText = message.text.body;
      } else if (message.type === 'audio') {
        userText = '[o paciente mandou um áudio]';
      } else {
        userText = `[o paciente mandou uma mensagem do tipo ${message.type}, não suportada ainda]`;
      }

      const existing = await findPatient(from);
      const historico = existing?.historico || [];
      historico.push({ role: 'user', content: userText });

      const resultado = await askWanessa(historico);

      historico.push({ role: 'assistant', content: resultado.mensagens.join(' ') });

      await agendarEnvios({ to: from, mensagens: resultado.mensagens });

      // Se o paciente já estava "agendado" e essa mensagem nova é só uma
      // conversa de rotina, mantém o status de agendado em vez de sobrescrever.
      const eraAgendadoAntes = existing?.status === 'agendado';
      let statusFinal = resultado.status;
      if (eraAgendadoAntes && resultado.status === 'em_conversa') {
        statusFinal = 'agendado';
      }

      const agora = new Date().toISOString();
      const camposParaSalvar = {
        nome: existing?.nome || contactName,
        status: statusFinal,
        historico,
        ultimaMensagemPaciente: agora,
        followupEnviado: '',
      };

      // Se fechou um agendamento NOVO agora, salva os detalhes dele e
      // reseta o controle de confirmação (pra função de confirmação de
      // presença saber que precisa avisar mais perto da data).
      const ehAgendamentoNovo = resultado.status === 'agendado' && resultado.agendamento && !eraAgendadoAntes;
      if (ehAgendamentoNovo) {
        camposParaSalvar.agendamentoData = resultado.agendamento.data || '';
        camposParaSalvar.agendamentoHorario = resultado.agendamento.horario || '';
        camposParaSalvar.agendamentoProcedimento = resultado.agendamento.procedimento || '';
        camposParaSalvar.agendamentoMotivo = resultado.agendamento.motivo || '';
        camposParaSalvar.confirmacaoEnviada = '';
      }

      await upsertPatient(from, camposParaSalvar);

      if (ehAgendamentoNovo) {
        await notifyReceptionist({
          patientName: existing?.nome || contactName,
          patientPhone: from,
          agendamento: resultado.agendamento,
        });
      }

      return { statusCode: 200, body: 'ok' };
    } catch (err) {
      console.error('Erro no webhook da Wanessa:', err);
      return { statusCode: 200, body: 'erro tratado' };
    }
  }

  return { statusCode: 405, body: 'Método não suportado' };
};
