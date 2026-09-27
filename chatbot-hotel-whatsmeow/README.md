# Chatbot Hotel de Trânsito 23º BI - solução com Whatsmeow/Passkey

Este projeto é o **bot bridge**. Ele não controla o WhatsApp diretamente.
O WhatsApp fica em um serviço separado usando `code-chat-br/whatsapp-api-go`,
que usa `whatsmeow` e possui suporte ao fluxo de Passkey.

## Arquitetura

WhatsApp Business no celular/PC
↕
whatsapp-api-go (Whatsmeow) - serviço 1 no Northflank
↕ webhook/API
este bot bridge - serviço 2 no Northflank
↕
PostgreSQL - 1 addon gratuito

O bot é determinístico: só responde os textos programados.

## O que o bot faz

- Menu 1 a 6 igual ao fluxo do ChatFácil.
- Opções 1 a 4 respondem e voltam ao menu.
- 5 e 6 encerram o fluxo.
- Timeout de 1 dia.
- Mensagem manual enviada pelo operador pausa o bot por `HUMAN_PAUSE_MINUTES`.
- Painel `/admin?key=...` para QR, Passkey e configuração do webhook.
- Estado das conversas persistido no mesmo PostgreSQL.

## Northflank

Você precisa de:
- 1 addon PostgreSQL
- 1 serviço `whatsapp-api-go`
- 1 serviço deste bot bridge

Isso usa exatamente os 2 serviços + 1 addon do Developer Sandbox.

Veja `NORTHFLANK_PASSO_A_PASSO.md`.
