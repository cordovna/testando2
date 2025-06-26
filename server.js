const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");

const app = express();
const PORT = 3000;

app.use(express.static("public"));
app.use(express.json());

let botProcess = null;

// Configuração do Multer para upload de arquivos
const upload = multer({ dest: "uploads/" });

app.post("/start-bot", (req, res) => {
  const { channel, accounts, proxies } = req.body;

  if (!channel || !accounts || accounts.length === 0) {
    return res.json({ message: "Dados inválidos" });
  }

  // Salvar dados em arquivos
  const accountsData = accounts.map((acc) => ({
    usuario: acc.username,
    token: acc.token,
    mensagens: acc.messages,
  }));

  fs.writeFileSync("./uploads/contas.json", JSON.stringify(accountsData, null, 2));

  if (proxies && proxies.length > 0) {
    fs.writeFileSync("./uploads/proxies.json", JSON.stringify(proxies, null, 2));
  }

  // Parar bot anterior se existir
  if (botProcess) {
    botProcess.kill("SIGTERM"); // Enviar SIGTERM para permitir que o bot se encerre graciosamente
  }

  // Iniciar novo bot
  const cmd = `node bot.js --channel=${channel} --useProxies=${
    proxies && proxies.length > 0 ? "yes" : "no"
  }`;
  console.log("Executando:", cmd);

  botProcess = exec(cmd, (error, stdout, stderr) => {
    if (error) {
      console.error(`Erro ao executar bot: ${error}`);
    }
    console.log(stdout);
    if (stderr) console.error(stderr);
  });

  res.json({ message: "Bot iniciado com sucesso!" });
});

app.post("/stop-bot", (req, res) => {
  if (botProcess) {
    botProcess.kill("SIGTERM"); // Enviar SIGTERM para permitir que o bot se encerre graciosamente
    botProcess = null;
    res.json({ message: "Bot parado" });
  } else {
    res.json({ message: "Nenhum bot rodando" });
  }
});

app.post("/upload-good-night-messages", upload.single("goodNightFile"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "Nenhum arquivo de boa noite enviado." });
  }

  const goodNightFilePath = path.join(__dirname, "uploads", "good_night_messages.json");
  fs.rename(req.file.path, goodNightFilePath, (err) => {
    if (err) {
      console.error("Erro ao mover arquivo de boa noite:", err);
      return res.status(500).json({ message: "Erro ao salvar arquivo de boa noite." });
    }
    res.json({ message: "Arquivo de mensagens de boa noite carregado com sucesso!" });
  });
});

app.post("/send-good-night", (req, res) => {
  const { channel, accounts, proxies } = req.body;

  if (!channel || !accounts || accounts.length === 0) {
    return res.json({ message: "Dados inválidos" });
  }

  // Salvar dados em arquivos (contas e proxies) para o bot usar
  const accountsData = accounts.map((acc) => ({
    usuario: acc.username,
    token: acc.token,
    mensagens: acc.messages, // Mensagens normais, não as de boa noite
  }));
  fs.writeFileSync("./uploads/contas.json", JSON.stringify(accountsData, null, 2));
  if (proxies && proxies.length > 0) {
    fs.writeFileSync("./uploads/proxies.json", JSON.stringify(proxies, null, 2));
  }

  if (botProcess) {
    botProcess.kill("SIGTERM"); // Parar o bot atual para iniciar o de boa noite
  }

  // Iniciar o bot no modo 'boa noite'
  const cmd = `node bot.js --channel=${channel} --goodNight=yes --useProxies=${
    proxies && proxies.length > 0 ? "yes" : "no"
  }`;
  console.log("Executando (Boa Noite):");

  botProcess = exec(cmd, (error, stdout, stderr) => {
    if (error) {
      console.error(`Erro ao executar bot de boa noite: ${error}`);
    }
    console.log(stdout);
    if (stderr) console.error(stderr);
  });

  res.json({ message: "Bot iniciado para enviar mensagens de boa noite!" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});


