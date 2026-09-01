const { WANESSA_SYSTEM_PROMPT } = require('../prompts/system-prompt');

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001'; // troque para um Sonnet se quiser respostas mais refinadas

/**
 * Chama a API do Claude com o histórico da conversa e retorna o objeto já
 * parseado: { mensagens, status, agendamento }
 *
 * @param {Array<{role: 'user'|'assistant', content: string}>} history
 */
async function askWanessa(history) {
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
      system: WANESSA_SYSTEM_PROMPT,
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
    // Remove eventuais crases de markdown, caso o modelo escape do formato
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    // Fallback: se o JSON vier malformado, manda o texto cru mesmo assim
    // pra conversa não travar, e loga o erro pra você investigar depois.
    console.error('Falha ao parsear JSON da Wanessa:', rawText);
    return {
      mensagens: [rawText || 'Desculpa, deu um erro aqui. Pode repetir?'],
      status: 'em_conversa',
      agendamento: null,
    };
  }
}

module.exports = { askWanessa };
