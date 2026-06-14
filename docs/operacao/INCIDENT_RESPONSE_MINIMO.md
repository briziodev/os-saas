\# Resposta mínima a incidentes - OS SaaS



\## Objetivo



Definir um procedimento mínimo para reagir a incidentes operacionais e de segurança no OS SaaS.



Este documento é inicial e deve evoluir antes de uso comercial em escala.



\## Incidentes possíveis



\- backend fora do ar;

\- banco indisponível;

\- falha em deploy;

\- erro de login;

\- erro ao abrir OS;

\- técnico vendo dados financeiros;

\- usuário acessando dados de outra empresa;

\- link de convite exposto;

\- token exposto;

\- `.env` exposto;

\- backup enviado ao Git por engano;

\- dados de teste em produção;

\- erro no dashboard financeiro;

\- orçamento WhatsApp gerando mensagem incorreta;

\- logs contendo dados sensíveis.



\## Procedimento geral



1\. Identificar o problema.

2\. Registrar data e hora.

3\. Registrar ambiente afetado: local, produção, Render, Vercel ou Neon.

4\. Coletar `requestId`, se existir.

5\. Identificar usuário e empresa afetados, se aplicável.

6\. Classificar severidade.

7\. Reduzir impacto imediatamente.

8\. Corrigir causa raiz.

9\. Testar correção localmente.

10\. Subir correção com cuidado.

11\. Registrar o que foi feito.



\## Severidade



\### Crítica



\- vazamento entre empresas;

\- técnico vendo dados financeiros;

\- segredo exposto;

\- banco de produção comprometido;

\- aplicação fora do ar para todos;

\- perda de dados.



Ação:

\- parar deploy se necessário;

\- bloquear acesso afetado;

\- invalidar tokens/convites;

\- corrigir imediatamente;

\- validar antes de liberar.



\### Alta



\- login quebrado;

\- criação de OS quebrada;

\- dashboard quebrado para admin/atendimento;

\- orçamento WhatsApp quebrado;

\- backup falhando;

\- erro recorrente no backend.



Ação:

\- corrigir antes de novas features;

\- gerar teste manual;

\- registrar no checkpoint.



\### Média



\- bug visual sem vazamento;

\- texto confuso;

\- lentidão moderada;

\- inconsistência de UX.



Ação:

\- priorizar após segurança/operação.



\## Casos específicos



\### Link de convite exposto



1\. Identificar usuário.

2\. Reenviar convite ou limpar invite\_token.

3\. Confirmar que link antigo não funciona.

4\. Registrar ocorrência.



\### Usuário com role antiga member



1\. Identificar usuário.

2\. Decidir role correta: admin, atendimento ou tecnico.

3\. Migrar ou desativar.

4\. Testar login/permissão.



\### Técnico vendo valores



1\. Tratar como incidente crítico.

2\. Bloquear deploy se alteração for recente.

3\. Revisar backend.

4\. Revisar frontend.

5\. Testar OSList, OSDetail, Dashboard, eventos e WhatsApp.

6\. Confirmar que backend não retorna dados financeiros.



\### Vazamento entre tenants



1\. Tratar como incidente crítico.

2\. Identificar rota.

3\. Revisar company\_id.

4\. Testar empresa A tentando acessar empresa B.

5\. Confirmar resposta 404 ou 403 segura.

6\. Registrar correção.



\### Banco indisponível



1\. Testar `/health`.

2\. Testar `/health/db`.

3\. Se `/health` OK e `/health/db` falhar, investigar banco.

4\. Verificar Neon/local.

5\. Verificar DATABASE\_URL.

6\. Verificar logs do backend.



\### Backup no Git



1\. Remover arquivo do Git.

2\. Garantir regra no `.gitignore`.

3\. Considerar rotação de dados se backup continha dados reais.

4\. Nunca commitar backups.



\## Dados que não devem aparecer em logs



\- senha;

\- password\_hash;

\- JWT;

\- JWT\_SECRET;

\- DATABASE\_URL;

\- invite\_token;

\- invite\_link completo;

\- mensagem completa de WhatsApp;

\- telefone completo sem necessidade;

\- dados financeiros detalhados sem necessidade.



\## Pendências futuras



\- criar audit\_logs em banco;

\- configurar retenção de logs;

\- configurar ferramenta externa de observabilidade;

\- definir responsável por incidente;

\- criar política de comunicação ao cliente;

\- criar rotina formal de backup e restore;

\- testar restore completo em banco separado.

