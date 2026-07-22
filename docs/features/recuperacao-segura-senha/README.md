# Recuperação segura e alteração de senha

## Status

Arquitetura aprovada. Camada de banco implementada e validada localmente.

## Objetivo

Permitir que qualquer usuário ativo do OS SaaS:

1. altere a própria senha estando autenticado;
2. recupere o acesso por um link temporário enviado ao e-mail cadastrado.

## Escopo incluído

- alterar senha autenticado;
- solicitar recuperação por e-mail;
- redefinir senha por token;
- invalidar sessões antigas;
- token aleatório armazenado somente como hash;
- expiração e uso único;
- rate limit;
- política única para novas senhas;
- resposta pública genérica;
- alertas de segurança por e-mail;
- logs estruturados sem dados secretos;
- página Minha conta;
- páginas Esqueci minha senha e Redefinir senha;
- testes funcionais, multi-tenant e de segurança.

## Escopo não incluído

- autenticação em dois fatores;
- recuperação por SMS;
- recuperação por WhatsApp;
- CAPTCHA;
- painel avançado de dispositivos;
- admin escolhendo senha de funcionário;
- migração de JWT para cookie HttpOnly;
- correção ampla do fluxo de convite.

## Endpoints planejados

- POST /auth/forgot-password
- POST /auth/reset-password
- POST /auth/change-password

## Banco planejado

Alterações em users:

- session_version INTEGER NOT NULL DEFAULT 1
- password_changed_at TIMESTAMPTZ NULL

Nova tabela:

- password_reset_tokens

## Regras de senha

- mínimo de 10 caracteres;
- máximo de 72 bytes;
- confirmação obrigatória;
- nova senha diferente da atual;
- sem regras artificiais obrigatórias de maiúscula, número ou símbolo.

## Regras de segurança

- token criptograficamente aleatório;
- somente SHA-256 do token salvo no banco;
- validade de 30 minutos;
- token de uso único;
- tokens anteriores revogados;
- usuário inativo não recebe token;
- resposta não revela se o e-mail existe;
- redefinição invalida todas as sessões;
- alteração autenticada invalida outras sessões;
- senha e token nunca são registrados em logs;
- APP_URL define o domínio oficial dos links.

## Fluxo autenticado

Minha conta
→ Alterar senha
→ Informar senha atual
→ Informar e confirmar nova senha
→ Invalidar sessões anteriores
→ Emitir novo JWT para o dispositivo atual

## Fluxo de recuperação

Login
→ Esqueci minha senha
→ Informar e-mail
→ Receber resposta genérica
→ Receber link por e-mail
→ Definir nova senha
→ Invalidar todas as sessões
→ Voltar ao login

## Critério de conclusão

A feature somente poderá ser integrada à main depois de:

- migration validada localmente;
- login atual preservado;
- convite e ativação preservados;
- tokens antigos invalidados após troca;
- link expirado bloqueado;
- reutilização bloqueada;
- usuário inativo bloqueado;
- rate limit validado;
- e-mail real testado;
- build frontend aprovado;
- smoke test local aprovado;
- revisão de segurança concluída.

## Validação local da migration

Data: 2026-07-17

Ambiente:

- PostgreSQL local 18.4;
- banco os_saas;
- branch feature/recuperacao-segura-senha.

Resultados:

- backup pré-migration criado e catálogo validado;
- migration UP aplicada com transação;
- 8 usuários migrados com session_version igual a 1;
- nenhum password_changed_at preenchido;
- tabela password_reset_tokens criada vazia;
- constraints e índices validados;
- cinco tentativas de violação foram corretamente bloqueadas;
- testes encerrados com rollback;
- migration DOWN executada com sucesso;
- tabela e colunas removidas completamente;
- assinatura agregada dos usuários permaneceu idêntica;
- migration UP reaplicada com sucesso;
- nenhum dado de usuário ou senha foi alterado.

Backup pré-migration:

- arquivo: backups/os_saas_pre_password_security_20260717_204348.dump
- SHA-256: 01AD8650865E27DC08A13617F6D2AF4DE05010A4DF3B88D5B92BF02E4C8B0635

Observação:

Esta validação ocorreu somente no banco local. A migration ainda não foi aplicada no Neon de produção.
## Validação local da sessão versionada

Data: 2026-07-18

Ambiente:

- backend Node.js local;
- PostgreSQL local 18.4;
- API em http://localhost:3000;
- usuário admin ativo da empresa 1.

Resultados:

- health da aplicação respondeu 200;
- login emitiu JWT contendo session_version;
- JWT versionado foi aceito em GET /auth/me;
- session_version do JWT correspondeu ao banco;
- JWT legado sem session_version foi bloqueado com 401;
- session_version do usuário de teste foi incrementado de 1 para 2;
- JWT emitido antes do incremento foi bloqueado com 401;
- novo login recebeu session_version igual a 2;
- novo JWT foi aceito em GET /auth/me;
- eventos TOKEN_WITHOUT_SESSION_VERSION e TOKEN_SESSION_REVOKED foram registrados;
- e-mail foi mascarado nos logs;
- senha e JWT não apareceram nos logs;
- session_version do usuário de teste permaneceu em 2 intencionalmente.

Decisão de compatibilidade:

- JWTs antigos sem session_version serão invalidados;
- após o futuro deploy, usuários previamente autenticados precisarão fazer login novamente uma única vez;
- versões de sessão nunca devem ser reduzidas.

Observação:

A implementação e os testes ocorreram somente no ambiente local. A migration e o backend ainda não foram aplicados em produção.
## Validação do sanitizador de logs

Data: 2026-07-19

Resultados:

- campos de senha aninhados foram substituídos por REDACTED;
- authorization e tokens aninhados foram protegidos;
- campo não sensível foi preservado;
- objetos circulares foram tratados;
- arrays circulares foram tratados;
- Buffer foi representado somente pelo tamanho;
- BigInt foi convertido para texto antes da serialização;
- nenhum valor secreto usado no teste apareceu na saída.

## Troca autenticada de senha — implementação e validação local

Data: 2026-07-19

Status: implementado e validado somente no ambiente local.

Implementação:

- criada política central para novas senhas no backend;
- criada política equivalente e reutilizável no frontend;
- senha nova exige no mínimo 10 caracteres;
- limite máximo seguro de 72 bytes UTF-8 para bcrypt;
- senha composta somente por espaços é bloqueada;
- caractere nulo é bloqueado;
- login continua aceitando senhas legadas com mínimo de 6 caracteres;
- ativação de conta passou a usar a nova política;
- criada rota POST /auth/change-password;
- rota protegida por authRequired, loadUser e limiter específico;
- senha atual é obrigatória e validada com bcrypt;
- reutilização da senha atual é bloqueada;
- operação usa transação e SELECT FOR UPDATE;
- query utiliza id, company_id e session_version do usuário autenticado;
- password_hash e password_changed_at são atualizados;
- session_version é incrementada;
- tokens de recuperação pendentes são revogados;
- um novo JWT é emitido para preservar somente a sessão atual;
- JWTs anteriores deixam de funcionar imediatamente.

Validações executadas:

- confirmação divergente bloqueada com HTTP 400;
- senha atual incorreta bloqueada sem invalidar uma sessão válida;
- troca válida concluída com HTTP 200;
- session_version incrementada de 1 para 2 no usuário temporário;
- JWT anterior rejeitado com HTTP 401;
- JWT novo aceito em /auth/me;
- senha antiga deixou de autenticar;
- senha nova passou a autenticar;
- password_changed_at persistido;
- token de recuperação pendente revogado;
- reutilização da senha atual bloqueada com HTTP 409;
- usuário e token temporários removidos ao final;
- política frontend validada para caracteres e bytes UTF-8;
- build do frontend aprovado com Vite.

Observação operacional:

A implementação não foi aplicada em produção. O backend atualizado depende das colunas session_version e password_changed_at e da tabela password_reset_tokens. A migration deve ser aplicada no PostgreSQL 18 antes de qualquer deploy desta branch.

## Tela Minha Conta e validação integrada — 2026-07-19

### Implementação

Foi adicionada a rota autenticada `/minha-conta`, disponível para admin, atendimento e tecnico.

A página apresenta nome, e-mail e perfil em modo somente leitura e permite alterar a senha mediante confirmação da senha atual.

A política de novas senhas exige:

- mínimo de 10 caracteres;
- máximo de 72 bytes em UTF-8, compatível com o bcrypt;
- bloqueio de senha composta somente por espaços;
- bloqueio de caractere NUL;
- confirmação idêntica;
- senha nova diferente da senha atual.

### Segurança de sessões

Após uma troca válida:

1. `users.session_version` é incrementado;
2. JWTs anteriores são revogados;
3. a sessão atual recebe um JWT novo;
4. `password_changed_at` é atualizado;
5. tokens de recuperação pendentes são revogados.

JWT sem `session_version` é rejeitado.

### Tratamento de HTTP 401

O frontend somente trata um HTTP 401 como sessão expirada quando a chamada exige autenticação.

No login público, credenciais incorretas preservam a mensagem segura do backend: `Credenciais inválidas`.

### Proteção de logs

O sanitizador central remove segredos incorporados em caminhos e query strings.

Exemplos:

```text
/auth/invite/[REDACTED]
/rota?token=[REDACTED]
```

Também são protegidos parâmetros como `invite_token`, `reset_token`, `access_token`, `refresh_token`, `authorization` e JWT.

### Validação local concluída

Foram aprovados:

- acesso à Minha Conta pelos três perfis;
- validações do formulário;
- troca real de senha;
- preservação da sessão atual;
- revogação das sessões anteriores;
- rejeição da senha antiga;
- autenticação com a senha nova;
- layout desktop e mobile;
- sanitização unitária e HTTP integrada dos logs;
- ausência de senha e token nos logs;
- remoção segura do usuário temporário;
- build Vite.

### Restrição de produção

Esta implementação permanece somente no ambiente local.

Antes do deploy é obrigatório concluir o backup e restore P0 do PostgreSQL 18, aplicar a migration no Neon, validar o schema e somente então publicar o backend e o frontend.

O fluxo de recuperação por e-mail ainda depende da configuração de um provedor de envio seguro.
