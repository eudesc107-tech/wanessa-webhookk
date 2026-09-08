const { getAllPatients, updateConfirmacaoEnviada } = require('../../lib/sheets');
const { requestConfirmation } = require('../../lib/whatsapp');

const HORA_EM_MS = 60 * 60 * 1000;

function formatarDataRelativa(dataISO) {
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Recife' });
  const amanha = new Date(Date.now() + 24 * HORA_EM_MS).toLocaleDateString('en-CA', { timeZone: 'America/Recife' });

  if (dataISO === hoje) return 'hoje';
  if (dataISO === amanha) return 'amanhã';

  const [ano, mes, dia] = dataISO.split('-');
  return `dia ${dia}/${mes}`;
}

function horasAteAgendamento(dataISO, horario) {
  if (!dataISO || !horario) return null;
  // Monta o horário do agendamento como se fosse no fuso de Recife (UTC-3)
  const dataHoraAgendamento = new Date(`${dataISO}T${horario}:00-03:00`);
  return (dataHoraAgendamento.getTime() - Date.now()) / HORA_EM_MS;
}

exports.config = {
  schedule: '@hourly',
};

exports.handler = async () => {
  const pacientes = await getAllPatients();

  const elegiveis = pacientes.filter(
    (p) => p.status === 'agendado' && p.agendamentoData && !p.confirmacaoEnviada
  );

  let enviados = 0;

  for (const paciente of elegiveis) {
    const horas = horasAteAgendamento(paciente.agendamentoData, paciente.agendamentoHorario);

    // Manda a confirmação quando faltar entre 12h e 24h pro agendamento.
    // Como a função roda de hora em hora, essa janela garante que ela
    // pegue o paciente uma vez só, sem mandar múltiplas vezes.
    if (horas !== null && horas > 0 && horas <= 24) {
      await requestConfirmation({
        patientPhone: paciente.telefone,
        nome: paciente.nome,
        agendamento: {
          procedimento: paciente.agendamentoProcedimento,
          motivo: paciente.agendamentoMotivo,
          horario: paciente.agendamentoHorario,
          dataFormatada: formatarDataRelativa(paciente.agendamentoData),
        },
      });
      await updateConfirmacaoEnviada(paciente.rowNumber, 'enviada');
      enviados += 1;
    }
  }

  return { statusCode: 200, body: `Confirmações enviadas: ${enviados}` };
};
