const { Receiver } = require('@upstash/qstash');
const { sendText } = require('../../lib/whatsapp');

const receiver = new Receiver({
  currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
  nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
});

exports.handler = async (event) => {
  const signature = event.headers['upstash-signature'];
  const bodyText = event.body;

  try {
    const isValid = await receiver.verify({
      signature,
      body: bodyText,
    });

    if (!isValid) {
      return { statusCode: 401, body: 'Assinatura inválida' };
    }

    const { to, text } = JSON.parse(bodyText);
    await sendText(to, text);

    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    console.error('Erro ao processar envio agendado:', err);
    return { statusCode: 500, body: 'erro' };
  }
};
