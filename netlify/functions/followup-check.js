const { getAllPatients, updateFollowupEnviado } = require('../../lib/sheets');
const { sendText } = require('../../lib/whatsapp');

const HORA_EM_MS = 60 * 60 * 1000;

const MENSAGENS_24H = [
  'Oi, tudo bem? Fico por aqui se quiser continuar aquela conversa. Qualquer coisa é só chamar',
  'Oi! Separei um tempinho pra te ajudar a resolver isso ainda essa semana, se quiser só me chamar que eu vejo os horários com você',
];

const MENSAGENS_72H = [
  'Oi, tudo bem? Imagino que a correria deve ter tomado conta. Separei um horário essa semana caso ainda queira resolver isso, quer que eu reserve pra você?',
  'Oi! Ainda temos horário disponível essa semana se você quiser aproveitar. Topa eu já ver um dia pra você?',
];

function escolherMensagem(lista) {
  return lista[Math.floor(Math.random() * lista.length)];
}

function horasDesde(isoString) {
  if (!isoString) return 0;
  return (Date.now() - new Date(isoString).getTime()) / HORA_EM_MS;
}

// Configuração do agendamento: roda a cada hora.
// https://docs.netlify.com/functions/scheduled-functions/
exports.config = {
  schedule: '@hourly',
};

exports.handler = async () => {
  const pacientes = await getAllPatients();

  const elegiveis = pacientes.filter((p) => p.status === 'em_conversa');

  for (const paciente of elegiveis) {
    const horas = horasDesde(paciente.ultimaMensagemPaciente);

    if (horas >= 72 && paciente.followupEnviado !== '72h' && paciente.followupEnviado !== 'concluido') {
      await sendText(paciente.telefone, escolherMensagem(MENSAGENS_72H));
      await updateFollowupEnviado(paciente.rowNumber, 'concluido');
      continue;
    }

    if (horas >= 24 && !paciente.followupEnviado) {
      await sendText(paciente.telefone, escolherMensagem(MENSAGENS_24H));
      await updateFollowupEnviado(paciente.rowNumber, '24h');
    }
  }

  return { statusCode: 200, body: `Checagem concluída, ${elegiveis.length} pacientes avaliados` };
};
