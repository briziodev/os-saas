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