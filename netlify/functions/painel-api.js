const crypto = require('crypto');
const { getAllPatients, findPatient, marcarResultadoConsulta } = require('../../lib/sheets');

const DIAS_VALIDADE_DO_LOGIN = 7;
const DIAS_DE_HISTORICO_RECENTE = 7;

// ---------- Segurança (senha do painel + token assinado) ----------

function chaveSecreta() {
  return crypto
    .createHash('sha256')
    .update('painel:' + (process.env.PAINEL_SENHA || ''))
    .digest();
}

function assinar(texto) {
  return crypto.createHmac('sha256', chaveSecreta()).update(texto).digest('hex');
}

function criarToken() {
  const expira = String(Date.now() + DIAS_VALIDADE_DO_LOGIN * 24 * 60 * 60 * 1000);
  return `${expira}.${assinar(expira)}`;
}

function tokenValido(token) {
  if (!process.env.PAINEL_SENHA) return false;
  if (!token || typeof token !== 'string') return false;

  const [expira, assinatura] = token.split('.');
  if (!expira || !assinatura) return false;

  const esperada = Buffer.from(assinar(expira));
  const recebida = Buffer.from(assinatura);
  if (esperada.length !== recebida.length) return false;
  if (!crypto.timingSafeEqual(esperada, recebida)) return false;

  return Number(expira) > Date.now();
}

function senhaCorreta(tentativa) {
  const senha = process.env.PAINEL_SENHA || '';
  if (!senha || typeof tentativa !== 'string') return false;

  const a = crypto.createHash('sha256').update(tentativa).digest();
  const b = crypto.createHash('sha256').update(senha).digest();
  return crypto.timingSafeEqual(a, b);
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- Datas ----------

function hojeEmRecife() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Recife' });
}

function diasAtras(iso, dias) {
  const base = new Date(`${iso}T12:00:00-03:00`);
  const antes = new Date(base.getTime() - dias * 24 * 60 * 60 * 1000);
  return antes.toLocaleDateString('en-CA', { timeZone: 'America/Recife' });
}

// ---------- Respostas ----------

function resposta(statusCode, corpo) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(corpo),
  };
}

// Só manda pro painel o que a recepção precisa. O histórico das conversas
// dos pacientes nunca sai daqui.
function paraPainel(p) {
  return {
    telefone: p.telefone,
    nome: p.nome,
    data: p.agendamentoData,
    horario: p.agendamentoHorario,
    procedimento: p.agendamentoProcedimento,
    motivo: p.agendamentoMotivo,
    status: p.status,
    jaEPaciente: p.status === 'agendado' && !!p.ultimoAtendimento,
  };
}

function ordenarPorHorario(lista, decrescente = false) {
  const fator = decrescente ? -1 : 1;
  return lista.sort((a, b) => {
    const chaveA = `${a.data} ${a.horario}`;
    const chaveB = `${b.data} ${b.horario}`;
    return chaveA < chaveB ? -1 * fator : chaveA > chaveB ? 1 * fator : 0;
  });
}

async function listar() {
  const hoje = hojeEmRecife();
  const limiteRecentes = diasAtras(hoje, DIAS_DE_HISTORICO_RECENTE);

  const pacientes = (await getAllPatients()).filter((p) => p.telefone && p.agendamentoData);

  const pendentes = [];
  const deHoje = [];
  const proximos = [];
  const recentes = [];

  for (const p of pacientes) {
    if (p.status === 'agendado') {
      if (p.agendamentoData < hoje) pendentes.push(paraPainel(p));
      else if (p.agendamentoData === hoje) deHoje.push(paraPainel(p));
      else proximos.push(paraPainel(p));
    } else if (
      (p.status === 'atendido' || p.status === 'faltou') &&
      p.agendamentoData >= limiteRecentes
    ) {
      recentes.push(paraPainel(p));
    }
  }

  return {
    hoje,
    pendentes: ordenarPorHorario(pendentes),
    deHoje: ordenarPorHorario(deHoje),
    proximos: ordenarPorHorario(proximos),
    recentes: ordenarPorHorario(recentes, true),
  };
}

async function marcar(telefone, resultado) {
  const permitidos = ['atendido', 'faltou', 'agendado'];
  if (!telefone || !permitidos.includes(resultado)) {
    return { codigo: 400, corpo: { erro: 'Pedido inválido' } };
  }

  const paciente = await findPatient(String(telefone));
  if (!paciente || !paciente.agendamentoData) {
    return { codigo: 404, corpo: { erro: 'Agendamento não encontrado' } };
  }

  // Evita marcar duas vezes (toque duplo) ou mexer no que não está na lista.
  if ((resultado === 'atendido' || resultado === 'faltou') && paciente.status !== 'agendado') {
    return { codigo: 409, corpo: { erro: 'Esse agendamento já foi marcado' } };
  }
  if (resultado === 'agendado' && paciente.status !== 'atendido' && paciente.status !== 'faltou') {
    return { codigo: 409, corpo: { erro: 'Nada pra desfazer aqui' } };
  }

  let ultimoAtendimento = null; // null = não mexe nessa coluna

  if (resultado === 'atendido') {
    // Guarda a data mais recente entre a consulta de agora e o que já existia.
    ultimoAtendimento = paciente.agendamentoData > (paciente.ultimoAtendimento || '')
      ? paciente.agendamentoData
      : paciente.ultimoAtendimento;
  }

  if (resultado === 'agendado' && paciente.ultimoAtendimento === paciente.agendamentoData) {
    // Desfazendo um "compareceu": tira a data que essa marcação tinha colocado.
    ultimoAtendimento = '';
  }

  await marcarResultadoConsulta(paciente.rowNumber, resultado, ultimoAtendimento);

  return { codigo: 200, corpo: { ok: true } };
}

// ---------- Handler ----------

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return resposta(405, { erro: 'Método não suportado' });
  }

  let pedido;
  try {
    pedido = JSON.parse(event.body || '{}');
  } catch (err) {
    return resposta(400, { erro: 'Pedido inválido' });
  }

  try {
    if (pedido.action === 'login') {
      if (!senhaCorreta(pedido.senha)) {
        await esperar(800); // deixa tentativa de adivinhar senha bem mais lenta
        return resposta(401, { erro: 'Senha incorreta' });
      }
      return resposta(200, { token: criarToken() });
    }

    const cabecalho = event.headers?.authorization || event.headers?.Authorization || '';
    const token = cabecalho.replace(/^Bearer\s+/i, '');

    if (!tokenValido(token)) {
      return resposta(401, { erro: 'Sessão expirada' });
    }

    if (pedido.action === 'listar') {
      return resposta(200, await listar());
    }

    if (pedido.action === 'marcar') {
      const { codigo, corpo } = await marcar(pedido.telefone, pedido.resultado);
      return resposta(codigo, corpo);
    }

    return resposta(400, { erro: 'Ação desconhecida' });
  } catch (err) {
    console.error('Erro no painel:', err);
    return resposta(500, { erro: 'Erro interno' });
  }
};
