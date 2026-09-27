# WA Passkey Connector

Extensão Manifest V3 mínima para a etapa WebAuthn.

## Instalar

1. Chrome/Edge: abra `chrome://extensions` ou `edge://extensions`.
2. Ative Modo do desenvolvedor.
3. Clique `Carregar sem compactação`.
4. Selecione esta pasta `passkey-extension`.
5. Abra o painel `/admin?key=...` do bot bridge.
6. A página deve mostrar `Extensão detectada`.

Ela só atua em:
- `https://web.whatsapp.com/*`
- `https://*.code.run/*`
- `http://localhost/*`

A assertion é usada apenas durante a vinculação e não é gravada pela extensão.
