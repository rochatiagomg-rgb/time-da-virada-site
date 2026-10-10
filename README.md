# Time da Virada — Site

Repositório do site público do projeto **Time da Virada**.

## Objetivo

Hospedar a versão web pública do projeto em Cloudflare Pages, com domínio próprio:

**https://timedavirada.app.br**

## Arquitetura prevista

- Frontend: HTML, CSS e JavaScript
- Hospedagem: Cloudflare Pages
- DNS/CDN: Cloudflare
- Dados eleitorais estáticos: repositório separado `time-da-virada-dados`
- Dados de propostas, retrospecto e configurações: serão exportados para JSON no pack de migração
- O Google Apps Script atual permanece funcionando durante a migração

## Importante

Este repositório é separado do repositório de dados.

- `time-da-virada-site` → código do site
- `time-da-virada-dados` → arquivos JSON eleitorais e demais bases estáticas

Não apagar, mover ou alterar o repositório `time-da-virada-dados`.

## Estado atual

Repositório inicial preparado para conexão com Cloudflare Pages.

O arquivo `index.html` é apenas uma página temporária de teste. Ele será substituído pelo pack completo do site.

## Branch principal

`main`
