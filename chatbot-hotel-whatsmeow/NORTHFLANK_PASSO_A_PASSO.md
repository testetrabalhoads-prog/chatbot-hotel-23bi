# PASSO A PASSO — trocar whatsapp-web.js pela solução com Passkey

## 0. Por que trocar

O erro `Invariant Violation ... getStorage/getUserPrefsTable` acontece antes do bot.
A conta está entrando no fluxo novo de Passkey/WebAuthn do WhatsApp.
O `whatsapp-web.js` não completa esse fluxo headless.

A solução usa `whatsmeow`, que já expõe `PairPasskeyRequest`,
`SendPasskeyResponse` e `SendPasskeyConfirmation`.

## 1. Pare e remova o serviço antigo

No Northflank:
- pare/remova `chatbot-whatsapp` antigo depois de guardar o repositório;
- remova o addon MongoDB `whatsapp-session`.

Precisamos liberar:
- 2 serviços grátis;
- 1 addon grátis.

## 2. Crie PostgreSQL

No projeto `chatbot-hotel-transito`:
- Deploy database
- PostgreSQL
- nome: `whatsapp-db`
- 1 réplica
- menor plano disponível no Sandbox
- privado

Depois copie a URI privada/Postgres URI.
Não mande essa URI no chat.

## 3. Serviço 1: WhatsApp API

Crie `Combined service`:
- Name: `whatsapp-api`
- Source: GitHub
- Repositório: `code-chat-br/whatsapp-api-go`
- Branch: `main`
- Build type: Dockerfile
- Dockerfile: `/Dockerfile`
- Build context: `/`
- Porta pública: `8084`, HTTP

Variáveis de runtime:

DOCKER_ENV=true
SERVER_PORT=8084
DATABASE_URL=<URI PRIVADA DO POSTGRES>
WHATSAPP_SESSION_STORE=postgres
WHATSAPP_SESSION_POSTGRES_URL=<MESMA URI DO POSTGRES>
WHATSAPP_AUTO_RECONNECT=true
WHATSAPP_STARTUP_RECONNECT_CONCURRENCY=1
AUTHENTICATION_JWT_EXPIRES_IN=8760h
AUTHENTICATION_JWT_SECRET=<uma chave longa aleatória>
AUTHENTICATION_GLOBAL_AUTH_TOKEN=<outra chave longa aleatória>
QRCODE_LIMIT=10
QRCODE_EXPIRATION_TIME=60
QRCODE_LIGHT_COLOR=#ffffff
QRCODE_DARK_COLOR=#000000
WHATSAPP_CONNECT_TIMEOUT=120
WHATSAPP_RECONNECT_INITIAL_DELAY=2
WHATSAPP_RECONNECT_MAX_DELAY=30
WHATSAPP_PROFILE_PICTURE_TIMEOUT=15
DATABASE_SAVE_DATA_NEW_MESSAGE=true

Se alguma variável adicional for exigida pelo build/startup, o log dirá o nome.
Use os padrões documentados pelo projeto para as opcionais.

## 4. Crie a instância do WhatsApp

Depois de `whatsapp-api` ficar Running, copie a URL pública.

No PowerShell do seu PC:

$API="https://SEU-WHATSAPP-API.code.run"
$GLOBAL="SUA_CHAVE_GLOBAL"

Invoke-RestMethod `
  -Method POST `
  -Uri "$API/instance/create" `
  -Headers @{ apikey=$GLOBAL } `
  -ContentType "application/json" `
  -Body '{"instanceName":"hotel23bi","description":"Hotel de Transito 23 BI"}'

A resposta terá `auth.token`.

GUARDE esse token. Ele será `WA_INSTANCE_TOKEN`.

## 5. Serviço 2: bot bridge

Crie um repositório GitHub com os arquivos deste ZIP.

No Northflank:
- Combined service
- Source: seu repositório
- Dockerfile `/Dockerfile`
- Build context `/`
- porta `3000`, HTTP, Public
- 1 instância

Variáveis:

DATABASE_URL=<MESMA URI PRIVADA DO POSTGRES>
WA_API_URL=https://URL-PUBLICA-DO-WHATSAPP-API.code.run
WA_INSTANCE_NAME=hotel23bi
WA_INSTANCE_TOKEN=<token retornado ao criar a instância>
WEBHOOK_SECRET=<chave aleatória>
ADMIN_KEY=<outra chave aleatória>
PUBLIC_BASE_URL=https://URL-PUBLICA-DO-BOT-BRIDGE.code.run
HUMAN_PAUSE_MINUTES=60

## 6. Abra o painel

https://URL-DO-BOT-BRIDGE.code.run/admin?key=SUA_ADMIN_KEY

Clique em `Gerar / atualizar QR`.

Escaneie no WhatsApp Business.

### Se o WhatsApp concluir
Ótimo. Pule para a etapa 8.

### Se pedir Passkey / não concluir
Continue na etapa 7.

## 7. Passkey

Carregue a extensão da pasta `passkey-extension` no Chrome:

1. Abra `chrome://extensions`
2. Ative `Modo do desenvolvedor`
3. Clique `Carregar sem compactação`
4. Escolha a pasta `passkey-extension`

Volte ao painel `/admin`.

Ele deve mostrar:
`✅ Extensão detectada`

Com o QR/pairing ainda ativo, clique:
`Executar Passkey`

O Chrome abrirá/ativará `web.whatsapp.com`.
Confirme a Passkey no navegador/Windows/telefone quando solicitado.

A assertion não é salva pelo bot; ela é encaminhada uma vez para o worker Whatsmeow.

## 8. Configurar webhook

No painel do bot bridge clique:
`Configurar webhook automaticamente`

Ele configura a instância para entregar `messages.upsert` ao bot.

## 9. Teste

De outro número, mande:
`oi`

Deve receber menu 1 a 6.

Mande:
`2`

Deve receber valores e menu novamente.

## Atendimento humano

Se alguém responder manualmente pelo WhatsApp Business,
o webhook recebe uma mensagem com `keyFromMe=true`.
O bot pausa aquela conversa por 60 minutos.

O celular e o WhatsApp do atendente continuam sendo usados normalmente.

## Segurança

Nunca publique:
- DATABASE_URL
- WA_INSTANCE_TOKEN
- AUTHENTICATION_GLOBAL_AUTH_TOKEN
- AUTHENTICATION_JWT_SECRET
- ADMIN_KEY
- WEBHOOK_SECRET

Coloque tudo como Secret/Runtime variable no Northflank.
