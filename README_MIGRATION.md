# Time da Virada — migração Cloudflare (fase 1)

Esta fase converte a casca do Google Apps Script para site estático sem alterar a lógica de interface do `app.html`.

## O que já foi retirado do Apps Script

- lista de municípios: navegador → API do IBGE;
- resultado eleitoral e locais de votação: navegador → JSON estático do repositório `time-da-virada-dados`;
- malha municipal: navegador → API de malhas do IBGE;
- indicadores municipais: navegador → APIs do IBGE;
- comparação Lula 2022 × 2026: tentativa direta no endpoint oficial do TSE, com falha não bloqueante.

## Compatibilidade

`api-adapter.js` implementa uma camada compatível com `google.script.run`. Isso permite manter `app.js` praticamente igual à beta validada, reduzindo risco de regressão.

## Ainda não migrado nesta fase

Os arquivos abaixo estão vazios de propósito e devem ser preenchidos com exportação ATUAL da planilha-mãe antes do merge em `main`:

- `data/planos.json`
- `data/retrospecto.json`
- `data/plano-de-jogo.json`
- `data/fontes.json`
- `data/regras-cards.json`

O contador de “craques” também ainda é apenas local na preview. A versão final pode usar uma função mínima Cloudflare/Worker, sem colocar a consulta municipal no backend.

## Segurança de deploy

Trabalhar e testar em `migration-cloudflare`. Não fazer merge em `main` até validar dados, mapa, PDF, propostas e retrospecto.
