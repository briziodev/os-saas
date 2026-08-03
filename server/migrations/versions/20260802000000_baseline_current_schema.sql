-- OS-SaaS canonical database baseline.
-- Generated from the aligned local/production public schema.
-- Schema only: this file contains no application data.
-- The migration runner owns the transaction.
SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

CREATE SCHEMA IF NOT EXISTS public;
COMMENT ON SCHEMA public IS 'standard public schema';

CREATE TYPE public.os_status AS ENUM (
    'em_analise',
    'orcamento_enviado',
    'aprovado',
    'em_execucao',
    'aguardando_peca',
    'finalizado',
    'cancelado',
    'triagem',
    'aguardando_aprovacao',
    'pronto_retirada',
    'encerrado'
);

SET default_tablespace = '';

SET default_table_access_method = heap;

CREATE TABLE public.clientes (
    id integer NOT NULL,
    nome character varying(120) NOT NULL,
    email character varying(120),
    telefone character varying(30),
    created_at timestamp without time zone DEFAULT now(),
    user_id integer,
    company_id integer
);

CREATE SEQUENCE public.clientes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.clientes_id_seq OWNED BY public.clientes.id;

CREATE TABLE public.companies (
    id integer NOT NULL,
    name text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);

CREATE SEQUENCE public.companies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.companies_id_seq OWNED BY public.companies.id;

CREATE TABLE public.ordens_servico (
    id integer NOT NULL,
    cliente_id integer NOT NULL,
    placa character varying(20),
    modelo character varying(80),
    problema_relatado text NOT NULL,
    mao_obra numeric(10,2) DEFAULT 0,
    valor_pecas numeric(10,2) DEFAULT 0,
    valor_total numeric(10,2) DEFAULT 0,
    status public.os_status DEFAULT 'em_analise'::public.os_status NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    closed_at timestamp without time zone,
    user_id integer,
    company_id integer
);

CREATE SEQUENCE public.ordens_servico_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.ordens_servico_id_seq OWNED BY public.ordens_servico.id;

CREATE TABLE public.os_events (
    id integer NOT NULL,
    company_id integer NOT NULL,
    os_id integer NOT NULL,
    user_id integer,
    event_type character varying(80) NOT NULL,
    title character varying(160) NOT NULL,
    description text,
    metadata jsonb,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.os_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.os_events_id_seq OWNED BY public.os_events.id;

CREATE TABLE public.os_pecas (
    id integer NOT NULL,
    os_id integer NOT NULL,
    company_id integer NOT NULL,
    nome text NOT NULL,
    quantidade integer DEFAULT 1 NOT NULL,
    valor_unitario numeric(12,2) DEFAULT 0 NOT NULL,
    valor_total numeric(12,2) GENERATED ALWAYS AS (((quantidade)::numeric * valor_unitario)) STORED,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT os_pecas_quantidade_check CHECK ((quantidade > 0)),
    CONSTRAINT os_pecas_valor_unitario_check CHECK ((valor_unitario >= (0)::numeric))
);

CREATE SEQUENCE public.os_pecas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.os_pecas_id_seq OWNED BY public.os_pecas.id;

CREATE TABLE public.password_reset_tokens (
    id bigint NOT NULL,
    user_id integer NOT NULL,
    token_hash character varying(64) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT password_reset_tokens_expiry_after_creation CHECK ((expires_at > created_at)),
    CONSTRAINT password_reset_tokens_hash_length CHECK ((char_length((token_hash)::text) = 64)),
    CONSTRAINT password_reset_tokens_terminal_state CHECK ((NOT ((used_at IS NOT NULL) AND (revoked_at IS NOT NULL))))
);

ALTER TABLE public.password_reset_tokens ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.password_reset_tokens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.users (
    id integer NOT NULL,
    name character varying(100),
    email character varying(100) NOT NULL,
    password_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    company_id integer,
    role text DEFAULT 'member'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    invite_token text,
    invite_expires_at timestamp without time zone,
    activated_at timestamp without time zone,
    invited_by integer,
    phone character varying(20),
    session_version integer DEFAULT 1 NOT NULL,
    password_changed_at timestamp with time zone,
    CONSTRAINT users_session_version_positive CHECK ((session_version >= 1))
);

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;

ALTER TABLE ONLY public.clientes ALTER COLUMN id SET DEFAULT nextval('public.clientes_id_seq'::regclass);

ALTER TABLE ONLY public.companies ALTER COLUMN id SET DEFAULT nextval('public.companies_id_seq'::regclass);

ALTER TABLE ONLY public.ordens_servico ALTER COLUMN id SET DEFAULT nextval('public.ordens_servico_id_seq'::regclass);

ALTER TABLE ONLY public.os_events ALTER COLUMN id SET DEFAULT nextval('public.os_events_id_seq'::regclass);

ALTER TABLE ONLY public.os_pecas ALTER COLUMN id SET DEFAULT nextval('public.os_pecas_id_seq'::regclass);

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT clientes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ordens_servico
    ADD CONSTRAINT ordens_servico_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.os_events
    ADD CONSTRAINT os_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.os_pecas
    ADD CONSTRAINT os_pecas_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_token_hash_unique UNIQUE (token_hash);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_invite_token_key UNIQUE (invite_token);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

CREATE INDEX idx_os_cliente ON public.ordens_servico USING btree (cliente_id);

CREATE INDEX idx_os_company ON public.ordens_servico USING btree (company_id);

CREATE INDEX idx_os_events_company_os_created ON public.os_events USING btree (company_id, os_id, created_at DESC);

CREATE INDEX idx_os_events_os_id ON public.os_events USING btree (os_id);

CREATE INDEX idx_os_pecas_company_id ON public.os_pecas USING btree (company_id);

CREATE INDEX idx_os_pecas_os_id ON public.os_pecas USING btree (os_id);

CREATE INDEX password_reset_tokens_expires_at_idx ON public.password_reset_tokens USING btree (expires_at);

CREATE UNIQUE INDEX password_reset_tokens_one_pending_per_user_idx ON public.password_reset_tokens USING btree (user_id) WHERE ((used_at IS NULL) AND (revoked_at IS NULL));

CREATE INDEX password_reset_tokens_user_created_idx ON public.password_reset_tokens USING btree (user_id, created_at DESC);

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT clientes_company_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT clientes_user_fk FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.ordens_servico
    ADD CONSTRAINT ordens_servico_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id);

ALTER TABLE ONLY public.ordens_servico
    ADD CONSTRAINT ordens_servico_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);

ALTER TABLE ONLY public.ordens_servico
    ADD CONSTRAINT ordens_servico_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.os_events
    ADD CONSTRAINT os_events_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.os_events
    ADD CONSTRAINT os_events_os_id_fkey FOREIGN KEY (os_id) REFERENCES public.ordens_servico(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.os_events
    ADD CONSTRAINT os_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.os_pecas
    ADD CONSTRAINT os_pecas_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.os_pecas
    ADD CONSTRAINT os_pecas_os_id_fkey FOREIGN KEY (os_id) REFERENCES public.ordens_servico(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_user_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_company_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_invited_by_fk FOREIGN KEY (invited_by) REFERENCES public.users(id);
