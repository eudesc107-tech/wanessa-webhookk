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

      // A Wanessa também recebe a situação real do contato (já é paciente,
      // tem consulta marcada, faltou) direto da planilha da clínica.
      const resultado = await askWanessa(historico, ocupados, existing);

      const hojeISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Recife' });

      // Existe uma consulta marcada que a recepção ainda não resolveu
      // (nem "compareceu", nem "faltou")?
      const agendamentoPendente = existing?.status === 'agendado' && !!existing?.agendamentoData;

      // Essa consulta ainda vai acontecer (hoje ou depois)?
      const agendamentoAindaVale = agendamentoPendente && existing.agendamentoData >= hojeISO;

      const quisAgendar = resultado.status === 'agendado' && !!resultado.agendamento;

      // Agendamento novo: quem não tinha nenhuma consulta futura marcada.
      let ehAgendamentoNovo = quisAgendar && !agendamentoAindaVale;

      // Remarcação: quem já tinha consulta futura e fechou outro dia ou horário.
      let ehRemarcacao = quisAgendar && agendamentoAindaVale && (
        resultado.agendamento.data !== existing.agendamentoData ||
        resultado.agendamento.horario !== existing.agendamentoHorario
      );

      // TRAVA DE SEGURANÇA: mesmo que a Wanessa tenha sido avisada, confere
      // de novo aqui se o horário que ela fechou não colidiu com outro
      // paciente (cobre o caso raro de duas pessoas agendando quase juntas).
      if (ehAgendamentoNovo || ehRemarcacao) {
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
          ehRemarcacao = false;
        }
      }

      historico.push({ role: 'assistant', content: resultado.mensagens.join(' ') });

      await agendarEnvios({ to: from, mensagens: resultado.mensagens });

      // Conversa de rotina não pode apagar o que a clínica já sabe do paciente:
      // consulta ainda não resolvida continua "agendado", e quem já foi
      // atendido continua "atendido" (e não vira lead de novo).
      let statusFinal = resultado.status;
      if (resultado.status === 'em_conversa') {
        if (agendamentoPendente) {
          statusFinal = 'agendado';
        } else if (existing?.status === 'atendido') {
          statusFinal = 'atendido';
        }
      }

      const agora = new Date().toISOString();
      const camposParaSalvar = {
        nome: existing?.nome || contactName,
        status: statusFinal,
        historico,
        ultimaMensagemPaciente: agora,
        followupEnviado: '',
      };

      const salvarAgendamento = ehAgendamentoNovo || ehRemarcacao;

      if (salvarAgendamento) {
        camposParaSalvar.agendamentoData = resultado.agendamento.data || '';
        camposParaSalvar.agendamentoHorario = resultado.agendamento.horario || '';
        camposParaSalvar.agendamentoProcedimento = resultado.agendamento.procedimento || '';
        camposParaSalvar.agendamentoMotivo = resultado.agendamento.motivo || '';
        camposParaSalvar.confirmacaoEnviada = '';
      }

      await upsertPatient(from, camposParaSalvar);

      if (salvarAgendamento) {
        await notifyReceptionist({
          patientName: existing?.nome || contactName,
          patientPhone: from,
          agendamento: resultado.agendamento,
          remarcado: ehRemarcacao,
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
