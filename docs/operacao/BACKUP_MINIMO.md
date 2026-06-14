\# Backup mínimo - OS SaaS



\## Status local - Semana 11



Data: 2026-06-07

Ambiente testado: local

Banco origem: os\_saas

Usuário usado no dump: os

Arquivo gerado: backups/os\_saas\_semana11\_local.dump



\## Resultado



Backup local gerado com sucesso usando:



pg\_dump -U os -d os\_saas -F c -f ./backups/os\_saas\_semana11\_local.dump



O arquivo foi criado e validado com:



pg\_restore -l ./backups/os\_saas\_semana11\_local.dump



\## Conteúdo confirmado no dump



O dump contém as principais estruturas do banco:



\- TYPE public os\_status

\- TABLE public clientes

\- TABLE public companies

\- TABLE public ordens\_servico

\- TABLE public os\_events

\- TABLE public os\_pecas

\- TABLE public users

\- TABLE DATA public clientes

\- TABLE DATA public companies

\- TABLE DATA public ordens\_servico

\- TABLE DATA public os\_events

\- TABLE DATA public os\_pecas

\- TABLE DATA public users

\- Primary keys

\- Indexes

\- Foreign keys

\- Sequences



\## Status do restore



Restore completo em banco separado ainda não foi executado.



Motivo:

\- usuário local os não possui permissão CREATEDB;

\- senha do usuário postgres local não foi confirmada.



\## Risco



O backup foi gerado e o dump é legível, mas ainda falta validar restauração completa em banco separado.



\## Decisão segura



Não restaurar sobre o banco principal os\_saas.



\## Próximo passo futuro



Criar banco temporário os\_saas\_restore\_test via usuário com permissão adequada ou pelo pgAdmin, com owner os, e executar:



pg\_restore -U os -d os\_saas\_restore\_test ./backups/os\_saas\_semana11\_local.dump



Depois validar:



\\\\dt



SELECT COUNT(\*) FROM users;

SELECT COUNT(\*) FROM companies;

SELECT COUNT(\*) FROM clientes;

SELECT COUNT(\*) FROM ordens\_servico;

SELECT COUNT(\*) FROM os\_pecas;

SELECT COUNT(\*) FROM os\_events;



\## Regra de segurança



A pasta backups/ deve permanecer fora do Git.



Foram adicionadas ao .gitignore as regras:



backups/

\*.dump

\*.backup

\*.sql

