const tmi = require("tmi.js");
const fs = require("fs");
const { HttpsProxyAgent } = require("https-proxy-agent");
const args = require("minimist")(process.argv.slice(2));

const canal = args.channel || "ccordova";
const usarProxies = args.useProxies === "yes";
const goodNightMode = args.goodNight === "yes";

let contas = [];
let proxies = [];
let clientesAtivos = [];
let statusContas = new Map();
let goodNightMessages = [];
let usedGoodNightMessages = new Set();

// Carrega dados
function carregarDados() {
  try {
    contas = JSON.parse(fs.readFileSync("./uploads/contas.json", "utf-8"));
    console.log(`📋 ${contas.length} contas carregadas`);

    if (usarProxies && fs.existsSync("./uploads/proxies.json")) {
      const proxiesRaw = JSON.parse(fs.readFileSync("./uploads/proxies.json", "utf-8"));
      proxies = proxiesRaw.map((proxy) => {
        if (typeof proxy === "string") {
          const [ip, porta, usuario, senha] = proxy.split(":");
          return `http://${usuario}:${senha}@${ip}:${porta}`;
        }
        return proxy;
      });
      console.log(`🌐 ${proxies.length} proxies carregados`);
    }

    if (goodNightMode) {
      if (fs.existsSync("./uploads/good_night_messages.json")) {
        goodNightMessages = JSON.parse(fs.readFileSync("./uploads/good_night_messages.json", "utf-8"));
        console.log(`🌙 ${goodNightMessages.length} mensagens de boa noite carregadas`);
      } else {
        console.error("❌ Arquivo good_night_messages.json não encontrado.");
        process.exit(1);
      }
    }
  } catch (error) {
    console.error("❌ Erro ao carregar dados:", error.message);
    process.exit(1);
  }
}

function criarCliente(conta, proxyUrl) {
  const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;

  const clientConfig = {
    identity: {
      username: conta.usuario,
      password: conta.token,
    },
    channels: [canal],
    connection: {
      secure: true,
      reconnect: true,
    },
  };

  const client = new tmi.Client(clientConfig);

  if (agent) {
    const originalConnect = client.connect;
    client.connect = function () {
      if (client.ws) client.ws.agent = agent;
      return originalConnect.call(this);
    };
  }

  return client;
}

async function conectarConta(conta, proxyIndex = 0) {
  const proxyUrl = usarProxies && proxies.length > 0 ? proxies[proxyIndex % proxies.length] : null;

  try {
    console.log(`🔧 Conectando ${conta.usuario}${proxyUrl ? " com proxy" : ""}`);

    const client = criarCliente(conta, proxyUrl);
    await client.connect();

    console.log(`✅ ${conta.usuario} conectado!`);

    statusContas.set(conta.usuario, {
      status: "conectado",
      mensagensEnviadas: 0,
      totalMensagens: conta.mensagens ? conta.mensagens.length : 0,
      concluido: false,
    });

    return { client, conta };
  } catch (error) {
    console.error(`❌ ${conta.usuario} falhou:`, error.message);
    statusContas.set(conta.usuario, {
      status: "erro",
      erro: error.message,
    });
    throw error;
  }
}

function iniciarMensagens(client, conta) {
  let indiceAtual = 0;
  const mensagens = conta.mensagens.sort((a, b) => a.timestamp_min - b.timestamp_min);

  function enviarProximaMensagem() {
    if (indiceAtual >= mensagens.length) {
      console.log(`🏁 ${conta.usuario} concluiu todas as mensagens`);
      statusContas.get(conta.usuario).concluido = true;
      statusContas.get(conta.usuario).status = "concluído";
      return;
    }

    const mensagemAtual = mensagens[indiceAtual];
    const proximaMensagem = mensagens[indiceAtual + 1];

    client
      .say(canal, mensagemAtual.mensagem)
      .then(() => {
        console.log(`🗣️ ${conta.usuario} (${indiceAtual + 1}/${mensagens.length}): "${mensagemAtual.mensagem}"`);

        const status = statusContas.get(conta.usuario);
        status.mensagensEnviadas = indiceAtual + 1;

        indiceAtual++;

        if (proximaMensagem) {
          const delay = (proximaMensagem.timestamp_min - mensagemAtual.timestamp_min) * 60 * 1000;
          setTimeout(enviarProximaMensagem, delay);
        } else {
          enviarProximaMensagem();
        }
      })
      .catch((err) => {
        console.error(`❌ ${conta.usuario} erro ao enviar:`, err.message);
      });
  }

  // Iniciar primeira mensagem
  const primeiroDelay = mensagens[0].timestamp_min * 60 * 1000;
  setTimeout(enviarProximaMensagem, primeiroDelay);
}

function getRandomGoodNightMessage() {
  const availableMessages = goodNightMessages.filter(msg => !usedGoodNightMessages.has(msg));
  if (availableMessages.length === 0) {
    console.warn("⚠️ Não há mais mensagens de boa noite únicas disponíveis.");
    return null;
  }
  const randomIndex = Math.floor(Math.random() * availableMessages.length);
  const message = availableMessages[randomIndex];
  usedGoodNightMessages.add(message);
  return message;
}

async function enviarBoaNoite(client, conta) {
  const message = getRandomGoodNightMessage();
  if (!message) {
    console.error(`❌ ${conta.usuario} não conseguiu uma mensagem de boa noite única.`);
    statusContas.get(conta.usuario).status = "falha_boa_noite";
    return;
  }

  try {
    await client.say(canal, message);
    console.log(`🌙 ${conta.usuario} enviou: "${message}"`);
    statusContas.get(conta.usuario).status = "boa_noite_enviado";
  } catch (error) {
    console.error(`❌ ${conta.usuario} falhou ao enviar boa noite:`, error.message);
    statusContas.get(conta.usuario).status = "falha_boa_noite";
  }
}

function mostrarStatus() {
  console.log("\n📊 STATUS DAS CONTAS:\n========================");
  statusContas.forEach((info, username) => {
    let status = "🔄";
    if (info.status === "conectado") status = "✅";
    else if (info.status === "erro") status = "❌";
    else if (info.status === "concluido") status = "🏁";
    else if (info.status === "boa_noite_enviado") status = "🌙";
    else if (info.status === "falha_boa_noite") status = "⚠️";

    const progresso = info.mensagensEnviadas && info.totalMensagens ?
      ` (${info.mensagensEnviadas}/${info.totalMensagens})` : "";

    console.log(`${status} ${username}: ${info.status}${progresso}`);
  });
  console.log("========================\n");
}

async function iniciarBot() {
  carregarDados();

  console.log(`🚀 Iniciando bot para canal: ${canal}`);
  console.log(`📋 ${contas.length} contas para processar`);

  for (let i = 0; i < contas.length; i++) {
    const conta = contas[i];
    try {
      const { client } = await conectarConta(conta, i);
      clientesAtivos.push({ client, conta });

      if (goodNightMode) {
        // Adiciona um pequeno delay entre o envio de mensagens de boa noite por conta
        await new Promise(resolve => setTimeout(resolve, i * 1000)); // 1 segundo de delay por conta
        await enviarBoaNoite(client, conta);
      } else {
        iniciarMensagens(client, conta);
      }

      // Delay entre conexões (mantido para o modo normal)
      if (!goodNightMode) {
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (error) {
      console.error(`🚨 Falha ao conectar ${conta.usuario}`);
    }
  }

  console.log(`\n🎉 Bot iniciado com ${clientesAtivos.length}/${contas.length} contas!`);

  // Mostrar status periodicamente
  setTimeout(mostrarStatus, 10000);
  setInterval(mostrarStatus, 120000);

  if (goodNightMode) {
    // Desconectar após enviar todas as mensagens de boa noite
    console.log("Desconectando clientes após enviar mensagens de boa noite...");
    // Esperar um pouco para garantir que as mensagens foram enviadas
    // Adicionado Promise.all para garantir que todas as desconexões sejam concluídas
    await Promise.all(clientesAtivos.map(async ({ client }) => {
      try {
        await client.disconnect();
        console.log(`Cliente ${client.identity.username} desconectado.`);
      } catch (err) {
        console.error(`Erro ao desconectar cliente ${client.identity.username}:`, err);
      }
    }));
    process.exit(0);
  }
}

// Tratamento de erros
process.on("unhandledRejection", (reason) => {
  console.error("🚨 Erro não tratado:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("🚨 Exceção não capturada:", error);
});

process.on("SIGINT", async () => {
  console.log("\n🛑 Parando bot...");
  await Promise.all(clientesAtivos.map(async ({ client }) => {
    try {
      await client.disconnect();
      console.log(`Cliente ${client.identity.username} desconectado.`);
    } catch (err) {
      console.error(`Erro ao desconectar cliente ${client.identity.username}:`, err);
    }
  }));
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n🛑 Recebido sinal SIGTERM. Parando bot...");
  await Promise.all(clientesAtivos.map(async ({ client }) => {
    try {
      await client.disconnect();
      console.log(`Cliente ${client.identity.username} desconectado.`);
    } catch (err) {
      console.error(`Erro ao desconectar cliente ${client.identity.username}:`, err);
    }
  }));
  process.exit(0);
});

iniciarBot().catch(console.error);


