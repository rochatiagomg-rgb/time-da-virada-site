# Migração para Cloudflare Pages

Branch de trabalho: `migration-cloudflare`

## Fonte recebida

Pacote-base: `time-da-virada-beta-consolidada(2).zip`

SHA-256: `4fa4824822a51a497d5a9c00fcba0f21b16b4256ffcc28ee8b79c4e02b299ff2`

Arquivos principais do app atual:

- `index.html`
- `styles.html`
- `app.html`
- `Code.gs`
- `ConfigService.gs`
- `IBGEService.gs`
- `TSEService.gs`
- `PlanosService.gs`
- `CardsEngine.gs`
- `SourceService.gs`
- `AccessService.gs`

## Estratégia

1. Manter `main` estável para o primeiro deploy do Pages.
2. Trabalhar a migração na branch `migration-cloudflare`.
3. Converter o frontend Apps Script em HTML/CSS/JS estático.
4. Substituir `google.script.run` por leitura via `fetch()`.
5. Ler a base eleitoral diretamente dos JSON já hospedados no repositório de dados.
6. Consumir IBGE diretamente no navegador ou via camada leve da Cloudflare quando necessário.
7. Exportar propostas, retrospecto, fontes e configurações para JSON estático.
8. Deixar qualquer função dinâmica mínima fora do caminho crítico da consulta.

## Estado

A branch foi criada a partir da `main`. O primeiro deploy do Pages deve continuar apontando para `main` até a migração funcional ser validada.
