const { Client } = require('@upstash/qstash');

const qstashClient = new Client({
  token: process.env.QSTASH_TOKEN,
  baseUrl: process.env.QSTASH_URL,
});

// Calcula um delay variável: mensagens curtas ficam entre 3 e 8 segundos,
// mais longas entre 6 e 14 segundos, pra parecer alguém digitando.
function calcularDelaySegundos(texto) {
  const ehLonga = texto.length > 100;
  const base = ehLonga ? 6 : 3;
  const variacao = ehLonga ? 8 : 5;
  return base + Math.floor(Math.random() * variacao);
}

/**
 * Agenda o envio de uma lista de mensagens, uma depois da outra, cada
 * uma com seu próprio delay (que vai se acumulando), pra simular alguém
 * digitando várias mensagens em sequência.
 */
async function agendarEnvios({ to, mensagens }) {
  const destino = `${process.env.SITE_URL}/.netlify/functions/send-message`;

  let delayAcumulado = 0;

  for (const texto of mensagens) {
    delayAcumulado += calcularDelaySegundos(texto);

    await qstashClient.publishJSON({
      url: destino,
      body: { to, text: texto },
      delay: delayAcumulado,
    });
  }
}

module.exports = { agendarEnvios };
