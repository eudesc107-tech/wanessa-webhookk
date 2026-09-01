# Wanessa Webhook

Webhook da Wanessa (Lens.AI): recebe mensagens do WhatsApp Business, conversa
usando a API do Claude, atualiza o CRM no Google Sheets, notifica a
recepcionista quando fecha agendamento, e roda follow-up automático de 24h/72h.

## Estrutura

```
netlify/functions/
  webhook.js          -> recebe e responde mensagens do WhatsApp
  followup-check.js   -> Scheduled Function, roda a cada hora, dispara follow-up
lib/
  claude.js            -> chama a API do Claude
  whatsapp.js           -> envia mensagens via WhatsApp Cloud API
  sheets.js              -> lê e escreve no Google Sheets
prompts/
  system-prompt.js       -> o "cérebro" da Wanessa (tom, regras, dados da clínica)
```

## Passo a passo pra colocar no ar

### 1. Planilha do Google Sheets

Crie uma planilha nova com uma aba chamada `Pacientes` e o cabeçalho nessa
ordem, na linha 1:

```
telefone | nome | status | historico | ultima_mensagem_paciente | followup_enviado
```

### 2. Conta de serviço do Google

No Google Cloud Console, crie uma conta de serviço com acesso à API do
Google Sheets, gere uma chave JSON, e compartilhe a planilha com o email
dessa conta de serviço (como se fosse compartilhar com uma pessoa).

### 3. Variáveis de ambiente no Netlify

No painel do site no Netlify, em Site settings > Environment variables,
adicione:

- `CLAUDE_API_KEY` — sua chave da API do Claude
- `WHATSAPP_TOKEN` — token de acesso da Cloud API da Meta
- `WHATSAPP_PHONE_NUMBER_ID` — ID do número de WhatsApp da clínica
- `WHATSAPP_VERIFY_TOKEN` — uma senha inventada por você, usada só na
  configuração do webhook na Meta
- `RECEPTIONIST_PHONE_NUMBER` — número da recepcionista no formato
  internacional, ex: 5583900000000
- `GOOGLE_SHEETS_ID` — o ID da planilha (fica na URL dela)
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` — email da conta de serviço
- `GOOGLE_PRIVATE_KEY` — a chave privada do JSON da conta de serviço
  (cole o valor inteiro, com as quebras de linha)

### 4. Configurar o webhook na Meta

No painel de desenvolvedores da Meta, aponte a URL do webhook para:

```
https://SEU-SITE.netlify.app/.netlify/functions/webhook
```

Use o mesmo valor de `WHATSAPP_VERIFY_TOKEN` no campo de verificação.

### 5. Deploy

Suba esse repositório pro GitHub e conecte no Netlify (ou arraste a pasta
direto no painel do Netlify pra um deploy manual). O `netlify.toml` já
aponta pra pasta certa das functions.

## O que ainda falta (próximos passos)

- Delay variável nas respostas + indicador de "digitando..."
- Transcrição de áudio (hoje a Wanessa só avisa que não escuta áudio)
- Testar tudo com a Clínica Sorriso Ideal (dados fictícios) antes de trocar
  pelos dados de um cliente real
