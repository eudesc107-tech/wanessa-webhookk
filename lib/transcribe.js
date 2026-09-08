/**
 * Baixa o arquivo de áudio do WhatsApp usando o ID da mídia. A Cloud API
 * funciona em duas etapas: primeiro pega a URL temporária do arquivo,
 * depois baixa o arquivo em si dessa URL.
 */
async function baixarAudioWhatsapp(mediaId) {
  const metaRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
  });

  if (!metaRes.ok) {
    throw new Error(`Erro ao buscar metadados do áudio: ${metaRes.status}`);
  }

  const meta = await metaRes.json();

  const fileRes = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
  });

  if (!fileRes.ok) {
    throw new Error(`Erro ao baixar arquivo de áudio: ${fileRes.status}`);
  }

  const buffer = await fileRes.arrayBuffer();
  return { buffer, mimeType: meta.mime_type || 'audio/ogg' };
}

/**
 * Transcreve o áudio usando a API da OpenAI (gpt-4o-mini-transcribe).
 * Retorna o texto transcrito, pra ser tratado como se o paciente tivesse
 * digitado a mensagem.
 */
async function transcreverAudio(mediaId) {
  const { buffer, mimeType } = await baixarAudioWhatsapp(mediaId);

  const formData = new FormData();
  const blob = new Blob([buffer], { type: mimeType });
  formData.append('file', blob, 'audio.ogg');
  formData.append('model', 'gpt-4o-mini-transcribe');
  formData.append('language', 'pt');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: formData,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Erro na transcrição: ${res.status} ${errText}`);
  }

  const data = await res.json();
  return data.text;
}

module.exports = { transcreverAudio };
