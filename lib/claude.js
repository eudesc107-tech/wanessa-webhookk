const { WANESSA_SYSTEM_PROMPT } = require('../prompts/system-prompt');

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

function dataDeHoje() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Recife' });
}

function contextoDeData() {
  const diasSemana = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  const hoje = new Date();

  // Monta uma tabela pronta dos próximos 7 dias, pra Wanessa NUNCA precisar
  // calcular "que dia é amanhã" de cabeça, ela só consulta a tabela.
  const linhas = [];
  for (let i = 0; i < 7; i++) {
    const data = new Date(hoje.getTime() + i * 24 * 60 * 60 * 1000);
    const iso = data.toLocaleDateString('en-CA', { timeZone: 'America/Recife' });
    const diaSemanaIndex = new Date(iso + 'T12:00:00-03:00').getDay();
    const nomeDia = diasSemana[diaSemanaIndex];
    const rotulo = i === 0 ? 'HOJE' : i === 1 ? 'AMANHÃ' : nomeDia;
    linhas.push(`${rotulo} = ${iso} (${nomeDia})`);
  }

  return `\n\nTABELA DE DATAS, use exatamente esses valores, nunca calcule uma data por conta própria:\n${linhas.join('\n')}\n\nO campo "data" do agendamento no JSON de resposta deve SEMPRE ser preenchido com um desses valores ISO (AAAA-MM-DD) da tabela acima, nunca uma palavra relativa nem uma data inventada.`;
}

function contextoDeAgenda(ocupados) {
  if (!ocupados || ocupados.length === 0) {
    return '\n\nNenhum horário está ocupado nos próximos dias. Você pode oferecer livremente dentro do horário de funcionamento da clínica.';
  }

  const linhas = ocupados
    .map((o) => `${o.data} às ${o.horario}`)
    .join(', ');

  return `\n\nHORÁRIOS JÁ OCUPADOS por outros pacientes, NUNCA ofereça nem confirme agendamento nesses horários: ${linhas}. Se o paciente pedir um desses horários, avise educadamente que já está ocupado e ofereça uma alternativa próxima, sem revelar detalhes de quem ocupou.`;
}

/**
 * Passa pra Wanessa o que o sistema sabe de verdade sobre quem está falando:
 * se já é paciente da clínica, se tem consulta marcada, se faltou. Isso vale
 * mais do que o histórico da conversa, porque vem da planilha da clínica.
 */
function contextoDoPaciente(paciente) {
  const hoje = dataDeHoje();
  const linhas = [];

  if (!paciente) {
    linhas.push('Este contato ainda não tem cadastro na clínica. Trate como primeiro contato.');
  } else {
    if (paciente.ultimoAtendimento) {
      linhas.push(
        `Este contato JÁ É PACIENTE da clínica. A última consulta dele foi em ${paciente.ultimoAtendimento}. ` +
        'Trate como alguém que já conhece a clínica: não se apresente como se fosse a primeira vez, ' +
        'não explique o básico da clínica, e conduza pro próximo passo (retorno, novo procedimento ou avaliação de acompanhamento).'
      );
    }

    if (paciente.status === 'agendado' && paciente.agendamentoData) {
      const procedimento = paciente.agendamentoProcedimento ? ` (${paciente.agendamentoProcedimento})` : '';

      if (paciente.agendamentoData >= hoje) {
        linhas.push(
          `Ele tem uma consulta marcada para ${paciente.agendamentoData} às ${paciente.agendamentoHorario}${procedimento}. ` +
          'Use exatamente esses dados se ele perguntar sobre a consulta.'
        );
      } else {
        linhas.push(
          `A consulta que ele tinha marcada (${paciente.agendamentoData} às ${paciente.agendamentoHorario}) já passou ` +
          'e a clínica ainda não registrou se ele compareceu. Não afirme que ele veio nem que faltou. ' +
          'Se ele quiser marcar de novo, ajude normalmente.'
        );
      }
    }

    if (paciente.status === 'faltou') {
      linhas.push(
        `Ele não compareceu à última consulta (${paciente.agendamentoData}). ` +
        'Seja acolhedora, sem cobrança e sem culpa, e ajude a remarcar se ele quiser.'
      );
    }

    if (linhas.length === 0) {
      linhas.push('Este contato já conversou com a clínica antes, mas ainda não tem consulta marcada nem atendimento registrado.');
    }
  }

  return `\n\nSITUAÇÃO DESTE CONTATO NA CLÍNICA (dado oficial do sistema, mais confiável que o histórico da conversa):\n- ${linhas.join('\n- ')}`;
}

async function askWanessa(history, ocupados, paciente) {
  const systemCompleto =
    WANESSA_SYSTEM_PROMPT +
    contextoDeData() +
    contextoDeAgenda(ocupados) +
    contextoDoPaciente(paciente);

  const response = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 500,
      system: systemCompleto,
      messages: history,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const rawText = data.content?.[0]?.text || '';

  try {
    let cleaned = rawText.replace(/```json|```/g, '').trim();

    const inicio = cleaned.indexOf('{');
    const fim = cleaned.lastIndexOf('}');
    if (inicio !== -1 && fim !== -1 && fim > inicio) {
      cleaned = cleaned.slice(inicio, fim + 1);
    }

    return JSON.parse(cleaned);
  } catch (err) {
    console.error('Falha ao parsear JSON da Wanessa:', rawText);
    return {
      mensagens: [rawText || 'Desculpa, deu um erro aqui. Pode repetir?'],
      status: 'em_conversa',
      agendamento: null,
    };
  }
}

module.exports = { askWanessa };
