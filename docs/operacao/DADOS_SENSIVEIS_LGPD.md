\# Dados sensíveis e LGPD mínima - OS SaaS



\## Status



Documento inicial criado na Semana 11 para mapear dados sensíveis, riscos de privacidade e pendências mínimas antes de uso comercial mais sério.



\## Dados tratados pelo sistema



O OS SaaS pode tratar os seguintes dados:



\- nome de clientes;

\- telefone de clientes;

\- dados de veículos;

\- placa;

\- modelo;

\- problema relatado;

\- histórico da ordem de serviço;

\- peças usadas;

\- valores de peças;

\- mão de obra;

\- valor total;

\- dados de usuários internos da oficina;

\- nome de usuários;

\- e-mail de usuários;

\- telefone de usuários;

\- perfil de acesso;

\- eventos operacionais da OS;

\- dados de empresa/tenant;

\- tokens de convite;

\- registros de autenticação;

\- logs operacionais.



\## Dados que exigem maior cuidado



\- JWT;

\- senha;

\- password\_hash;

\- DATABASE\_URL;

\- JWT\_SECRET;

\- invite\_token;

\- invite\_link completo;

\- telefone de cliente;

\- mensagem completa de WhatsApp;

\- dados financeiros;

\- dados entre empresas diferentes;

\- histórico da OS;

\- metadata de eventos.



\## Regras mínimas atuais



\- Não colar `.env` completo em conversas.

\- Não colar `DATABASE\_URL`.

\- Não colar `JWT\_SECRET`.

\- Não colar JWT real.

\- Não colar invite\_token real.

\- Não colar invite\_link completo.

\- Não salvar backup de banco no Git.

\- Não expor dados financeiros para técnico.

\- Não permitir acesso entre empresas diferentes.

\- Não logar senha.

\- Não logar token.

\- Não logar mensagem completa de WhatsApp.

\- Não logar telefone completo sem necessidade.

\- Manter `company\_id` como fronteira obrigatória de tenant.

\- Manter backend como fonte real de autorização.



\## Regras por perfil



\### Admin



Pode acessar dados operacionais e financeiros da própria empresa.



\### Atendimento



Pode acessar fluxo operacional/comercial conforme regra atual da aplicação.



\### Técnico



Não deve acessar:



\- dashboard;

\- clientes;

\- usuários;

\- peças com valores;

\- mão de obra;

\- valor total;

\- valor de peças;

\- orçamento via WhatsApp;

\- eventos financeiros;

\- eventos de peças;

\- eventos de WhatsApp.



\## Retenção de dados



Ainda não definida formalmente.



Pendência futura:



\- definir por quanto tempo manter clientes;

\- definir por quanto tempo manter OS;

\- definir por quanto tempo manter eventos da OS;

\- definir retenção de logs;

\- definir retenção de backups;

\- definir exclusão de dados de teste;

\- definir exclusão de dados mediante solicitação.



\## Exclusão de dados



Ainda não existe fluxo formal de exclusão.



Pendência futura:



\- criar procedimento para excluir ou anonimizar cliente;

\- criar procedimento para desativar usuários;

\- definir se OS será excluída, arquivada ou anonimizada;

\- definir política para dados financeiros/históricos.



\## Consentimento e transparência



Ainda não existe política pública de privacidade.



Pendência futura:



\- criar Política de Privacidade;

\- criar Termos de Uso;

\- informar finalidade do tratamento dos dados;

\- informar contato para solicitação de exclusão/correção;

\- documentar responsabilidades da oficina como usuária do sistema.



\## Riscos atuais



\- usuários de teste em produção;

\- convites expostos em prints;

\- ausência de audit\_logs genérico;

\- ausência de retenção formal de logs;

\- ausência de política de backup;

\- ausência de política pública de privacidade;

\- ausência de processo formal de incidente;

\- risco de novas features esquecerem filtro por company\_id;

\- risco de logs futuros incluírem dados sensíveis.



\## Decisão atual



Antes de cobrança em escala, o SaaS precisa manter:



\- isolamento multi-tenant;

\- controle de perfis;

\- logs sem dados sensíveis;

\- backup mínimo;

\- checklist de produção;

\- plano mínimo de incidente;

\- política mínima de privacidade futura.

