const { Client } = require('@upstash/qstash');

const qstashClient = new Client({
  token: process.env.QSTASH_TOKEN,
  baseUrl: process.env.QSTASH_URL,
});

// Calcula um delay variável: respostas curtas ficam entre 3 e 8 segundos,
// respostas mais longas entre 10 e 20 segundos, pra parecer alguém digitando.
function calcularDelaySegundos(texto) {
  const ehLonga = texto.length > 140;
  const base = ehLonga ? 10 : 3;
  const variacao = ehLonga ? 10 : 5;
  return base + Math.floor(Math.random() * variacao);
}

/**
 * Agenda o envio da mensagem pro paciente depois de um delay variável,
 * usando o QStash como fila (porque a function do Netlify não pode
 * simplesmente "esperar" vários segundos antes de responder).
 */
async function agendarEnvio({ to, text }) {
  const delaySegundos = calcularDelaySegundos(text);
  const destino = `${process.env.SITE_URL}/.netlify/functions/send-message`;

  await qstashClient.publishJSON({
    url: destino,
    body: { to, text },
    delay: delaySegundos,
  });
}

module.exports = { agendarEnvio };
