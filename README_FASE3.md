# Time da Virada - Fase 3

Patch restrito ao frontend (`app.js`).

Correções:
- propostas não são mais pareadas entre temas diferentes;
- propostas sem correspondente permanecem visíveis sem comparação artificial;
- links do retrospecto aceitam domínios sem `https://` e múltiplas fontes;
- links externos voltam a ser clicáveis no PDF, inclusive em blocos fatiados.

Não altera:
- planilha-mãe;
- arquivos JSON da Fase 2;
- `api-adapter.js`;
- DNS/Cloudflare;
- branch `main`.

A comparação 2022 não faz parte deste patch. O 404 será tratado separadamente para não mascarar nem substituir dado oficial.
