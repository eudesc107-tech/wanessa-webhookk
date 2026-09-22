const { WANESSA_SYSTEM_PROMPT } = require('../prompts/system-prompt');

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

function contextoDeData() {
  const agora = new Date();
  const formatado = agora.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'America/Recife',
  });
  const isoHoje = agora.toLocaleDateString('en-CA', { timeZone: 'America/Recife' });

  return `\n\nHoje é ${formatado} (${isoHoje}). Use essa data como referência pra calcular qualquer data relativa que o paciente mencionar (amanhã, segunda, sábado, etc). O campo "data" do agendamento no JSON de resposta deve SEMPRE ser preenchido no formato absoluto AAAA-MM-DD, nunca com uma palavra relativa.`;
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

async function askWanessa(history, ocupados) {
  const systemCompleto = WANESSA_SYSTEM_PROMPT + contextoDeData() + contextoDeAgenda(ocupados);

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
