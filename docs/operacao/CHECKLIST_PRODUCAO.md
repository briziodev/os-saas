\# Checklist mínimo de produção - OS SaaS



\## Ambiente



\- \[ ] NODE\_ENV=production no Render

\- \[ ] JWT\_SECRET forte e protegido

\- \[ ] DATABASE\_URL protegida

\- \[ ] CORS\_ORIGIN sem "\*"

\- \[ ] Frontend Vercel apontando para backend correto

\- \[ ] Backend Render apontando para Neon correto



\## Health check



\- \[x] /health implementado

\- \[x] /health/db implementado localmente

\- \[x] /health/db validado localmente

\- \[ ] /health/db validado em produção após deploy



\## Banco e dados



\- \[x] Banco local usando configuração local, não DATABASE\_URL

\- \[x] Backup local gerado

\- \[x] Dump local listado com pg\_restore -l

\- \[ ] Restore completo testado em banco separado

\- \[ ] Backup/restore validado em produção ou ambiente controlado



\## Usuários e permissões



\- \[x] Nenhuma role member encontrada no banco local

\- \[x] Roles locais oficiais: admin, atendimento, tecnico

\- \[x] Nenhum invite\_token ativo no banco local

\- \[ ] Produção validada sem role member

\- \[ ] Produção validada sem convites expostos

\- \[ ] Usuários de teste em produção removidos/desativados



\## Segurança operacional



\- \[ ] sensitiveActionLimiter aplicado/validado em rotas sensíveis

\- \[ ] audit\_logs avaliado/criado futuramente

\- \[ ] logs externos avaliados futuramente

\- \[ ] plano mínimo de incidente documentado

\- \[ ] LGPD mínima documentada



\## Antes de cliente real



\- \[ ] Validar login por perfil em produção

\- \[ ] Validar multi-tenant em produção controlada

\- \[ ] Validar técnico sem valores/peças/WhatsApp

\- \[ ] Validar dashboard por perfil

\- \[ ] Validar orçamento WhatsApp sem logar telefone/mensagem completa

