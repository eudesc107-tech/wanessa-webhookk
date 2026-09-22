const { askWanessa } = require('../../lib/claude');
const { markAsRead, notifyReceptionist } = require('../../lib/whatsapp');
const { agendarEnvios } = require('../../lib/qstash');
const { findPatient, upsertPatient, getHorariosOcupados } = require('../../lib/sheets');

exports.handler = async (event) => {
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

      const tiposIgnorados = ['reaction', 'system', 'unsupported'];
      if (tiposIgnorados.includes(message.type)) {
        return { statusCode: 200, body: 'ignorado' };
      }

      let userText;
      if (message.type === 'text') {
        userText = message.text.body;
      } else if (message.type === 'audio') {
        try {
          const { transcreverAudio } = require('../../lib/transcribe');
          userText = await transcreverAudio(message.audio.id);
        } catch (err) {
          console.error('Erro ao transcrever áudio:', err);
          userText = '[o paciente mandou um áudio, mas não foi possível transcrever]';
        }
      } else {
        userText = `[o paciente mandou uma mensagem do tipo ${message.type}, não suportada ainda]`;
      }

      const existing = await findPatient(from);
      const historico = existing?.historico || [];
      historico.push({ role: 'user', content: userText });

      // Busca os horários já ocupados por outros pacientes, pra Wanessa
      // saber o que evitar antes de oferecer ou confirmar qualquer coisa.
      const ocupados = await getHorariosOcupados();

      const resultado = await askWanessa(historico, ocupados);

      const eraAgendadoAntes = existing?.status === 'agendado';
      let ehAgendamentoNovo = resultado.status === 'agendado' && resultado.agendamento && !eraAgendadoAntes;

      // TRAVA DE SEGURANÇA: mesmo que a Wanessa tenha sido avisada, confere
      // de novo aqui se o horário que ela fechou não colidiu com outro
      // paciente (cobre o caso raro de duas pessoas agendando quase juntas).
      if (ehAgendamentoNovo) {
        const conflito = ocupados.find(
          (o) => o.data === resultado.agendamento.data
            && o.horario === resultado.agendamento.horario
            && o.telefone !== from
        );

        if (conflito) {
          console.warn('Conflito de horário detectado, revertendo agendamento:', resultado.agendamento);
          resultado.mensagens = [
            'Peraí, parece que esse horário acabou de ser ocupado por outro paciente.',
            'Consegue me passar outro dia ou horário que eu já vejo a disponibilidade certinha pra você?',
          ];
          resultado.status = 'em_conversa';
          resultado.agendamento = null;
          ehAgendamentoNovo = false;
        }
      }

      historico.push({ role: 'assistant', content: resultado.mensagens.join(' ') });

      await agendarEnvios({ to: from, mensagens: resultado.mensagens });

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
