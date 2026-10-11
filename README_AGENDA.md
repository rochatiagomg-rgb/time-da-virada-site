# Agenda pública — Encontros da Virada
Implementação independente da consulta municipal. Não modifica data/, propostas ou Apps Script.
## Ativação
1. Criar bancos D1 separados para preview e produção. Executar db/agenda.sql.
2. Pages > Settings > Bindings: vincular o banco correto como AGENDA_DB em cada ambiente.
3. Criar widget Turnstile para os hosts autorizados da preview e produção.
4. Configurar TURNSTILE_SITE_KEY (pública), TURNSTILE_SECRET (secret) e AGENDA_RATE_SECRET (secret aleatório).
5. Ativar Cloudflare Access. Proteger /admin-agenda/* e /api/agenda/admin/* no domínio público e no alias da preview.
6. Regra de acesso: somente e-mail do responsável confirmado. Sem bypass. Configurar ACCESS_TEAM_DOMAIN (apenas hostname), ACCESS_AUD e ADMIN_EMAIL.
7. Após testar acesso negado, entrada do responsável e fluxo de revisão, definir AGENDA_ENABLED=true.
Recebimento fica desativado se qualquer configuração necessária estiver ausente. JWT é verificado também no servidor, protegendo acesso direto via pages.dev.
## Funcionamento
Envios começam pendentes. O administrador aprova, oculta ou devolve à revisão. O endpoint público retorna só aprovados, até 200 registros recentes. Limite: 10 tentativas verificadas por IP por hora, com identificador derivado de segredo; IP não é armazenado.
Apelido é opcional e público após revisão. Não são coletados nome real, contato, opiniões de participantes ou desempenho individual.
O ponto selecionado deve representar local público. Geolocalização apenas centraliza o mapa.
## Validação
Testes: dados inválidos, datas impossíveis, consentimento, JWT com assinatura/audiência/e-mail/expiração inválidos, origem externa, registros pendentes, duplicações e filtro de publicação.
Ainda exige teste integrado com D1 e login real antes de produção.
## Produção
Manter main como produção. Publicar apenas após testes; usar merge revisado de migration-cloudflare. Bancos de preview e produção devem ser separados para não publicar dados de teste.
## Operação
Ocultação é reversível. Exclusão definitiva e política de retenção devem ser definidas pelo responsável antes de receber dados reais. O protocolo identifica o registro, não concede permissão administrativa.
