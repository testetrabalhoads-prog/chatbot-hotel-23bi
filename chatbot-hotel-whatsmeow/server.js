const express = require("express");
const { Pool } = require("pg");
const crypto = require("crypto");

const app = express();
app.use(express.json({ limit: "2mb" }));

const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.DATABASE_URL;
const WA_API_URL = String(process.env.WA_API_URL || "").replace(/\/+$/, "");
const WA_INSTANCE_NAME = process.env.WA_INSTANCE_NAME || "hotel23bi";
const WA_INSTANCE_TOKEN = process.env.WA_INSTANCE_TOKEN || "";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";
const ADMIN_KEY = process.env.ADMIN_KEY || "";
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
const HUMAN_PAUSE_MINUTES = Number(process.env.HUMAN_PAUSE_MINUTES || 60);
const SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000;

if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL não configurada.");
  process.exit(1);
}
if (!WA_API_URL) {
  console.error("❌ WA_API_URL não configurada.");
  process.exit(1);
}
if (!WA_INSTANCE_TOKEN) {
  console.error("❌ WA_INSTANCE_TOKEN não configurada.");
  process.exit(1);
}
if (!WEBHOOK_SECRET) {
  console.error("❌ WEBHOOK_SECRET não configurada.");
  process.exit(1);
}
if (!ADMIN_KEY) {
  console.error("❌ ADMIN_KEY não configurada.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
});

const MENU = `Olá, a equipe do Hotel de Trânsito - 23º BI agradece o seu contato. Como podemos ajudar?

Para que possamos dar prosseguimento ao atendimento, digite o número de uma das opções abaixo:

1. Solicitação/Disponibilidade
2. Valores
3. Horários de funcionamento
4. Informações e contatos
5. Cancelar reserva
6. Finalizar chat`;

const SOLICITACAO = `Por favor, diga seu nome, posto/graduação, qual o período pretendido e a quantidade de hóspedes.

Nossas reservas são realizadas com no máximo 1 mês de antecedência e no mínimo 48 horas.

Exemplo:
Reservas para outubro podem ser realizadas a partir do dia 01 de setembro.

Assim que possível, um militar da nossa equipe irá verificar a disponibilidade.`;

const VALORES = `Diária individual / duplo com vínculo / duplo sem vínculo

OF. General - R$75 / R$94 / R$113
OF. Superior - R$65 / R$81 / R$98
Of. Inter/Subalterno/Asp - R$60 / R$75 / R$90
Cad/Sten/Sgt - R$55 / R$69 / R$83
Civil (Forças auxiliares) - R$85 / R$107 / R$128`;

const HORARIOS = `Horários de check-in: a partir das 15:00
Horários de check-out: até 12:00
Horário de atendimento: 07:30 - 22:00

Café da manhã em dias de semana:
07:00 - 09:00

Café da manhã em finais de semana:
07:30 - 09:30

*CHECK-IN APÓS AS 22:00: ACIONAMENTO DO DISPOSITIVO DE CAMPAINHA ELETRÔNICA NA PORTA DA RECEPÇÃO*`;

const CONTATOS = `Email: ht23bi.bnu@gmail.com
Telefone: (47) 3336-2731
Endereço:
https://maps.app.goo.gl/pGycoCchdpy39FnB9

*NÃO ATENDEMOS LIGAÇÕES VIA WHATSAPP*
*NÃO ACEITAMOS PETS*`;

const CANCELAMENTO = `Sua reserva será cancelada.

A equipe do Hotel de Trânsito - 23º BI agradece pelo aviso.

Digite "Olá" para iniciar um novo chat!`;

const FINALIZAR = `Agradecemos o contato.

Para iniciar um novo chat, digite "Olá".`;

const INVALIDA = `Opção inválida.

Por favor, digite um número de 1 a 6.`;

const PALAVRAS_INICIO = [
  "oi",
  "ola",
  "opa",
  "bom dia",
  "boa tarde",
  "boa noite",
  "tudo bem",
  "reserva",
  "solicito",
  "disponibilidade",
  "menu",
];

function normalizarTexto(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function deveIniciar(texto) {
  const msg = normalizarTexto(texto);
  return PALAVRAS_INICIO.some((p) => msg.includes(normalizarTexto(p)));
}

function phoneFromJid(jid) {
  const s = String(jid || "");
  if (!s) return "";
  const local = s.split("@")[0];
  return local.replace(/\D/g, "");
}

function adminOk(req) {
  return req.query.key === ADMIN_KEY || req.get("x-admin-key") === ADMIN_KEY;
}

async function waFetch(path, options = {}) {
  const headers = {
    Authorization: `Bearer ${WA_INSTANCE_TOKEN}`,
    ...(options.headers || {}),
  };
  const response = await fetch(`${WA_API_URL}${path}`, { ...options, headers });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!response.ok) {
    const err = new Error(`WA API ${response.status}: ${JSON.stringify(body)}`);
    err.status = response.status;
    err.body = body;
    throw err;
  }
  return body;
}

async function enviarTexto(numero, texto) {
  if (!numero) throw new Error("Número vazio");
  return waFetch(`/message/sendText/${encodeURIComponent(WA_INSTANCE_NAME)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      number: numero,
      textMessage: { text: texto },
    }),
  });
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bot_conversations (
      jid TEXT PRIMARY KEY,
      active BOOLEAN NOT NULL DEFAULT FALSE,
      last_activity BIGINT NOT NULL DEFAULT 0,
      paused_until BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bot_seen_messages (
      message_id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log("✅ Banco do bot pronto.");
}

async function getSession(jid) {
  const { rows } = await pool.query(
    "SELECT * FROM bot_conversations WHERE jid=$1",
    [jid]
  );
  return rows[0] || null;
}

async function startSession(jid) {
  await pool.query(
    `INSERT INTO bot_conversations(jid, active, last_activity, paused_until)
     VALUES($1, TRUE, $2, 0)
     ON CONFLICT (jid) DO UPDATE
       SET active=TRUE, last_activity=EXCLUDED.last_activity, paused_until=0, updated_at=NOW()`,
    [jid, Date.now()]
  );
}

async function touchSession(jid) {
  await pool.query(
    `INSERT INTO bot_conversations(jid, active, last_activity, paused_until)
     VALUES($1, FALSE, $2, 0)
     ON CONFLICT (jid) DO UPDATE
       SET last_activity=EXCLUDED.last_activity, updated_at=NOW()`,
    [jid, Date.now()]
  );
}

async function endSession(jid) {
  await pool.query(
    `INSERT INTO bot_conversations(jid, active, last_activity, paused_until)
     VALUES($1, FALSE, $2, 0)
     ON CONFLICT (jid) DO UPDATE
       SET active=FALSE, last_activity=EXCLUDED.last_activity, paused_until=0, updated_at=NOW()`,
    [jid, Date.now()]
  );
}

async function pauseForHuman(jid) {
  const until = Date.now() + HUMAN_PAUSE_MINUTES * 60 * 1000;
  await pool.query(
    `INSERT INTO bot_conversations(jid, active, last_activity, paused_until)
     VALUES($1, TRUE, $2, $3)
     ON CONFLICT (jid) DO UPDATE
       SET paused_until=$3, last_activity=$2, updated_at=NOW()`,
    [jid, Date.now(), until]
  );
  console.log(`👤 Atendimento humano detectado em ${jid}. Bot pausado até ${new Date(until).toISOString()}`);
}

async function markSeen(messageId) {
  if (!messageId) return false;
  try {
    await pool.query(
      "INSERT INTO bot_seen_messages(message_id) VALUES($1)",
      [messageId]
    );
    return false;
  } catch (e) {
    if (e.code === "23505") return true;
    throw e;
  }
}
async function processIncoming(payload) {
  if (payload?.event !== "messages.upsert") {
    return;
  }

  const d = payload.data || {};

  /*
    Algumas versões do whatsapp-api-go retornam
    os campos diretamente em data.

    Outras retornam parte deles dentro de content.

    Então aceitamos os dois formatos.
  */
  const c =
    d.content &&
    typeof d.content === "object"
      ? d.content
      : {};

  const jid =
    d.keyRemoteJid ||
    c.keyRemoteJid ||
    d.chatJid ||
    c.chatJid ||
    d.keyLid ||
    c.keyLid;

  const keyFromMe =
    d.keyFromMe ??
    c.keyFromMe ??
    false;

  const isGroup =
    d.isGroup ??
    d.metadata?.isGroup ??
    c.isGroup ??
    (jid
      ? jid.endsWith("@g.us")
      : false);

  const messageId =
    d.messageId ||
    c.messageId ||
    d.keyId ||
    c.keyId ||
    String(d.id || c.id || "");

  const text =
    d.text ||
    d.content?.text ||
    d.message?.conversation ||
    d.message?.extendedTextMessage?.text ||
    "";

  console.log("🔎 Mensagem interpretada:", {
    jid,
    messageId,
    keyFromMe,
    isGroup,
    text,
  });

  if (!jid) {
    console.log(
      "⚠️ Mensagem ignorada: JID não encontrado."
    );
    return;
  }

  if (isGroup || jid.endsWith("@g.us")) {
    console.log(
      "ℹ️ Mensagem de grupo ignorada."
    );
    return;
  }

  if (await markSeen(messageId)) {
    console.log(
      `ℹ️ Mensagem duplicada ignorada: ${messageId}`
    );
    return;
  }

  /*
    Se foi uma mensagem enviada manualmente
    pelo próprio WhatsApp do hotel,
    pausamos o bot nessa conversa.
  */
  if (keyFromMe) {
    await pauseForHuman(jid);
    return;
  }

  if (!text) {
    console.log(
      "ℹ️ Mensagem sem texto ignorada."
    );
    return;
  }

  const normalized =
    normalizarTexto(text);

  console.log(
    `📩 ${jid}: ${text}`
  );

  let session =
    await getSession(jid);

  /*
    Se o atendente humano respondeu recentemente,
    o bot fica quieto.
  */
  if (
    session?.paused_until &&
    Number(session.paused_until) >
      Date.now()
  ) {
    console.log(
      `👤 Bot pausado para ${jid}`
    );
    return;
  }

  const numero =
    phoneFromJid(jid);

  if (!numero) {
    console.error(
      "❌ Não consegui extrair número do JID:",
      jid
    );
    return;
  }

  /*
    Palavras que iniciam/reiniciam o menu.
  */
  if (deveIniciar(normalized)) {
    await startSession(jid);

    console.log(
      `🤖 Iniciando atendimento para ${numero}`
    );

    await enviarTexto(
      numero,
      MENU
    );

    return;
  }

  /*
    Fora de uma sessão ativa,
    mensagens comuns são ignoradas.
  */
  if (!session?.active) {
    console.log(
      `ℹ️ ${jid} sem sessão ativa. Ignorando.`
    );
    return;
  }

  await touchSession(jid);

  if (normalized === "1") {
    await enviarTexto(
      numero,
      SOLICITACAO
    );

    await enviarTexto(
      numero,
      MENU
    );

    return;
  }

  if (normalized === "2") {
    await enviarTexto(
      numero,
      VALORES
    );

    await enviarTexto(
      numero,
      MENU
    );

    return;
  }

  if (normalized === "3") {
    await enviarTexto(
      numero,
      HORARIOS
    );

    await enviarTexto(
      numero,
      MENU
    );

    return;
  }

  if (normalized === "4") {
    await enviarTexto(
      numero,
      CONTATOS
    );

    await enviarTexto(
      numero,
      MENU
    );

    return;
  }

  if (normalized === "5") {
    await enviarTexto(
      numero,
      CANCELAMENTO
    );

    await endSession(jid);

    return;
  }

  if (normalized === "6") {
    await enviarTexto(
      numero,
      FINALIZAR
    );

    await endSession(jid);

    return;
  }

  await enviarTexto(
    numero,
    INVALIDA
  );
}

app.get("/health", async (_req, res) => {
  let db = false;
  let wa = null;
  try {
    await pool.query("SELECT 1");
    db = true;
  } catch {}
  try {
    wa = await waFetch(`/instance/connectionState/${encodeURIComponent(WA_INSTANCE_NAME)}`);
  } catch (e) {
    wa = { error: e.message };
  }
  res.json({ ok: db, db, wa });
});

app.post("/webhook", async (req, res) => {
  if (req.query.secret !== WEBHOOK_SECRET) {
    console.log("❌ Webhook recusado: secret incorreto");
    return res.status(403).json({ error: "forbidden" });
  }

  console.log("==============================================");
  console.log("📨 WEBHOOK RECEBIDO");
  console.log("Evento:", req.body?.event);
  console.log("Data:", JSON.stringify(req.body?.data, null, 2));
  console.log("==============================================");

  res.status(200).json({ ok: true });

  processIncoming(req.body).catch((e) =>
    console.error("❌ Erro no webhook:", e.stack || e)
  );
});

function findBase64(obj) {
  if (!obj || typeof obj !== "object") return null;
  if (typeof obj.base64 === "string" && obj.base64.startsWith("data:image/")) return obj.base64;
  for (const v of Object.values(obj)) {
    const found = findBase64(v);
    if (found) return found;
  }
  return null;
}

app.get("/admin", async (req, res) => {
  if (!adminOk(req)) return res.status(403).send("Chave inválida.");

  let state;
  try {
    state = await waFetch(`/instance/connectionState/${encodeURIComponent(WA_INSTANCE_NAME)}`);
  } catch (e) {
    state = { error: e.message };
  }

  const key = encodeURIComponent(ADMIN_KEY);
  res.type("html").send(`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bot Hotel de Trânsito</title>
<style>
body{font-family:Arial,sans-serif;max-width:900px;margin:30px auto;padding:0 18px;background:#f5f7f8;color:#16202a}
.card{background:#fff;border:1px solid #dfe5e8;border-radius:14px;padding:20px;margin:14px 0}
button,a.btn{display:inline-block;background:#146c43;color:white;border:0;border-radius:9px;padding:11px 16px;margin:5px 4px 5px 0;text-decoration:none;cursor:pointer;font-size:15px}
button.secondary,a.secondary{background:#40566b}
pre{white-space:pre-wrap;word-break:break-word;background:#eef2f4;padding:12px;border-radius:8px}
#passkeyStatus{font-weight:bold}
</style>
</head>
<body>
<h1>Hotel de Trânsito 23º BI</h1>
<div class="card">
<h2>Status</h2>
<pre>${escapeHtml(JSON.stringify(state, null, 2))}</pre>
<a class="btn secondary" href="/admin?key=${key}">Atualizar</a>
</div>

<div class="card">
<h2>1. Parear pelo QR</h2>
<p>Gere o QR aqui e escaneie pelo WhatsApp Business. Se o telefone pedir Passkey e a conexão não concluir, use a etapa 2.</p>
<a class="btn" href="/admin/qr?key=${key}">Gerar / atualizar QR</a>
</div>

<div class="card">
<h2>2. Passkey</h2>
<p>Use esta etapa somente se a conta exigir Passkey. A extensão <b>WA Passkey Connector</b> precisa estar carregada no Chrome.</p>
<p id="connector">Verificando extensão...</p>
<button onclick="runPasskey()">Executar Passkey</button>
<pre id="passkeyStatus">Aguardando.</pre>
</div>

<div class="card">
<h2>3. Webhook do bot</h2>
<p>Depois que o WhatsApp estiver conectado, configure o webhook para o bot responder.</p>
<button onclick="configureWebhook()">Configurar webhook automaticamente</button>
<pre id="webhookStatus">Aguardando.</pre>
</div>

<script>
const ADMIN_KEY=${JSON.stringify(ADMIN_KEY)};
let connectorReady=false;

function log(id, value){
  document.getElementById(id).textContent =
    typeof value === "string" ? value : JSON.stringify(value,null,2);
}

window.addEventListener("message", async (e) => {
  if (e.data?.source !== "wa-passkey-connector") return;
  if (e.data.type === "CONNECTOR_READY") {
    connectorReady=true;
    document.getElementById("connector").textContent="✅ Extensão detectada";
  }
});

window.postMessage({target:"wa-passkey-connector",type:"PING"},"*");
setTimeout(()=>{
  if(!connectorReady) document.getElementById("connector").textContent="⚠️ Extensão não detectada";
},1500);

async function runPasskey(){
  try{
    log("passkeyStatus","Buscando challenge no WhatsApp...");
    const r=await fetch("/admin/passkey/challenge?key="+encodeURIComponent(ADMIN_KEY),{method:"POST"});
    const challenge=await r.json();
    if(!r.ok) throw new Error(JSON.stringify(challenge));
    const localRequestId=crypto.randomUUID();

    const result=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error("Tempo esgotado aguardando a extensão.")),180000);
      const handler=(e)=>{
        if(e.data?.source!=="wa-passkey-connector") return;
        if(e.data.type!=="PASSKEY_ASSERTION_RESULT") return;
        if(e.data.requestId!==localRequestId) return;
        window.removeEventListener("message",handler);
        clearTimeout(timer);
        if(e.data.error) reject(new Error(e.data.error));
        else resolve(e.data.assertion);
      };
      window.addEventListener("message",handler);
      window.postMessage({
        target:"wa-passkey-connector",
        type:"RUN_PASSKEY_ASSERTION",
        requestId:localRequestId,
        publicKey:challenge.publicKey
      },"*");
    });

    log("passkeyStatus","Passkey assinada. Enviando ao WhatsApp...");
    const s=await fetch("/admin/passkey/assertion?key="+encodeURIComponent(ADMIN_KEY),{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({requestId:challenge.requestId,assertion:result})
    });
    const body=await s.json();
    if(!s.ok) throw new Error(JSON.stringify(body));
    log("passkeyStatus",body);
  }catch(e){
    log("passkeyStatus","❌ "+e.message);
  }
}

async function configureWebhook(){
  try{
    const r=await fetch("/admin/configure-webhook?key="+encodeURIComponent(ADMIN_KEY),{method:"POST"});
    const body=await r.json();
    if(!r.ok) throw new Error(JSON.stringify(body));
    log("webhookStatus",body);
  }catch(e){
    log("webhookStatus","❌ "+e.message);
  }
}
</script>
</body>
</html>`);
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

app.get("/admin/qr", async (req, res) => {
  if (!adminOk(req)) return res.status(403).send("Chave inválida.");
  try {
    const body = await waFetch(`/instance/connect/${encodeURIComponent(WA_INSTANCE_NAME)}`);
    const img = findBase64(body);
    const key = encodeURIComponent(ADMIN_KEY);
    res.type("html").send(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>QR WhatsApp</title></head>
<body style="font-family:Arial;text-align:center;padding:24px">
<h2>QR do WhatsApp</h2>
${img ? `<img src="${img}" style="max-width:430px;width:95%">` : `<pre style="text-align:left;white-space:pre-wrap">${escapeHtml(JSON.stringify(body,null,2))}</pre>`}
<p>Escaneie em WhatsApp Business → Aparelhos conectados → Conectar aparelho.</p>
<p><a href="/admin?key=${key}">Voltar</a></p>
</body></html>`);
  } catch (e) {
    res.status(e.status || 500).type("text").send(e.message);
  }
});

app.post("/admin/passkey/challenge", async (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ error: "forbidden" });
  try {
    const body = await waFetch(
      `/instance/connect/${encodeURIComponent(WA_INSTANCE_NAME)}/passkey/challenge`,
      { method: "POST" }
    );
    res.json(body);
  } catch (e) {
    res.status(e.status || 500).json(e.body || { error: e.message });
  }
});

app.post("/admin/passkey/assertion", async (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ error: "forbidden" });
  try {
    const body = await waFetch(
      `/instance/connect/${encodeURIComponent(WA_INSTANCE_NAME)}/passkey/assertion`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
      }
    );
    res.json(body);
  } catch (e) {
    res.status(e.status || 500).json(e.body || { error: e.message });
  }
});

app.post("/admin/configure-webhook", async (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ error: "forbidden" });
  if (!PUBLIC_BASE_URL) {
    return res.status(400).json({ error: "PUBLIC_BASE_URL não configurada" });
  }
  const url = `${PUBLIC_BASE_URL}/webhook?secret=${encodeURIComponent(WEBHOOK_SECRET)}`;
  try {
    const body = await waFetch(
      `/webhook/set/${encodeURIComponent(WA_INSTANCE_NAME)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          enabled: true,
          events: {
            messagesUpsert: true,
            connectionUpdated: true
          }
        }),
      }
    );
    res.json({ ok: true, webhookUrl: url, result: body });
  } catch (e) {
    res.status(e.status || 500).json(e.body || { error: e.message });
  }
});

setInterval(async () => {
  try {
    const limit = Date.now() - SESSION_TIMEOUT_MS;
    const { rows } = await pool.query(
      `SELECT jid FROM bot_conversations
       WHERE active=TRUE AND last_activity <= $1`,
      [limit]
    );
    for (const row of rows) {
      const number = phoneFromJid(row.jid);
      try {
        if (number) await enviarTexto(number, FINALIZAR);
      } catch (e) {
        console.error("Erro ao finalizar sessão expirada:", e.message);
      }
      await endSession(row.jid);
    }
    await pool.query(
      "DELETE FROM bot_seen_messages WHERE created_at < NOW() - INTERVAL '3 days'"
    );
  } catch (e) {
    console.error("Erro no timeout:", e.stack || e);
  }
}, 60 * 1000);

initDb()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`🌐 Bot bridge ouvindo na porta ${PORT}`);
      console.log(`🔐 Admin: /admin?key=SUA_ADMIN_KEY`);
    });
  })
  .catch((e) => {
    console.error("❌ Falha ao iniciar:", e.stack || e);
    process.exit(1);
  });
