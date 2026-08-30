import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AppIcon } from "../components/AppIcon";
import { appIcons } from "../config/icons";
import { apiFetch, getUser } from "../api";
import "./Clientes.css";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeSearch(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function formatPhone(value) {
  const digits = normalizePhone(value);

  if (!digits) return "Sem telefone";

  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }

  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }

  return value || digits;
}

function formatDateTime(value) {
  if (!value) return "Data não informada";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Data não informada";
  }

  return date.toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function hasValidEmail(cliente) {
  return Boolean(normalizeEmail(cliente?.email));
}

function hasValidPhone(cliente) {
  return normalizePhone(cliente?.telefone).length >= 10;
}

const RESUMO_FILTER_LABELS = {
  all: "Todos os clientes",
  with_phone: "Com telefone",
  with_email: "Com email",
  without_email: "Sem email",
};

function validateClienteForm(values) {
  const nome = normalizeText(values.nome);
  const email = normalizeEmail(values.email);
  const telefone = normalizePhone(values.telefone);

  if (!nome) return "Nome é obrigatório.";
  if (!telefone) return "Telefone é obrigatório.";
  if (telefone.length < 10) return "Telefone inválido (mínimo 10 dígitos).";
  if (email && !EMAIL_REGEX.test(email)) return "Email inválido.";

  return "";
}

function getInitials(value) {
  const clean = String(value || "C").trim();
  const parts = clean.split(/\s+/).filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }

  return clean.slice(0, 2).toUpperCase();
}

export default function Clientes() {
  const [clientes, setClientes] = useState([]);
  const [erro, setErro] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [savingEdit, setSavingEdit] = useState(false);
  const [actionId, setActionId] = useState(null);
  const [modoLista, setModoLista] = useState("active");
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [archiveReason, setArchiveReason] = useState("");
  const [archiveError, setArchiveError] = useState("");
  const [busca, setBusca] = useState("");
  const [filtroResumo, setFiltroResumo] = useState("all");
  const [refreshOk, setRefreshOk] = useState(false);
  const listaRef = useRef(null);
  const user = getUser();
  const isAdmin = user?.role === "admin";

  const [form, setForm] = useState({
    nome: "",
    email: "",
    telefone: "",
  });

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({
    nome: "",
    email: "",
    telefone: "",
  });

  async function carregarClientes({
    silent = false,
    showSuccess = false,
    status = modoLista,
  } = {}) {
    if (!silent) setLoadingList(true);
    setErro("");
    if (showSuccess) setMsg("");

    try {
      const endpoint =
        status === "archived"
          ? "/clientes?status=archived"
          : "/clientes";

      const data = await apiFetch(endpoint);
      setClientes(Array.isArray(data) ? data : []);

      if (showSuccess) {
        setMsg(
          status === "archived"
            ? "Lista de clientes arquivados atualizada com sucesso."
            : "Lista de clientes ativos atualizada com sucesso."
        );
        setRefreshOk(true);

        window.setTimeout(() => {
          setRefreshOk(false);
        }, 2600);
      }
    } catch (e) {
      setErro(e?.message || "Erro ao carregar clientes.");
      setRefreshOk(false);
    } finally {
      if (!silent) setLoadingList(false);
    }
  }

  useEffect(() => {
    carregarClientes();
  }, []);

  useEffect(() => {
    if (!archiveTarget) return undefined;

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [archiveTarget]);

  function irParaTopo() {
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  function clearFeedback() {
    if (erro) setErro("");
    if (msg) setMsg("");
  }

  async function trocarModoLista(nextMode) {
    if (nextMode === modoLista) return;
    if (nextMode === "archived" && !isAdmin) return;

    setModoLista(nextMode);
    setBusca("");
    setFiltroResumo("all");
    setEditingId(null);
    setArchiveTarget(null);
    setArchiveReason("");
    setArchiveError("");
    setErro("");
    setMsg("");

    await carregarClientes({
      status: nextMode,
    });
  }

  function scrollParaLista() {
    window.setTimeout(() => {
      listaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  function aplicarFiltroResumo(tipo) {
    setFiltroResumo(tipo);
    setEditingId(null);
    scrollParaLista();
  }

  function limparFiltrosClientes() {
    setBusca("");
    setFiltroResumo("all");
    scrollParaLista();
  }

  function handleBuscarClientes() {
    scrollParaLista();
  }

  function handleChange(e) {
    const { name, value } = e.target;
    clearFeedback();
    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  }

  function handleEditChange(e) {
    const { name, value } = e.target;
    clearFeedback();
    setEditForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErro("");
    setMsg("");

    const validationError = validateClienteForm(form);
    if (validationError) {
      setErro(validationError);
      irParaTopo();
      return;
    }

    const payload = {
      nome: normalizeText(form.nome),
      email: normalizeEmail(form.email),
      telefone: normalizePhone(form.telefone),
    };

    setLoading(true);

    try {
      await apiFetch("/clientes", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      setForm({ nome: "", email: "", telefone: "" });
      await carregarClientes({
        silent: true,
        status: "active",
      });
      setMsg("Cliente cadastrado com sucesso.");
      irParaTopo();
    } catch (e) {
      setErro(e?.message || "Erro ao cadastrar cliente.");
      irParaTopo();
    } finally {
      setLoading(false);
    }
  }

  function iniciarEdicao(cliente) {
    setMsg("");
    setErro("");
    setEditingId(cliente.id);
    setEditForm({
      nome: cliente.nome || "",
      email: cliente.email || "",
      telefone: cliente.telefone || "",
    });
  }

  function cancelarEdicao() {
    setEditingId(null);
    setEditForm({
      nome: "",
      email: "",
      telefone: "",
    });
  }

  async function salvarEdicao(id) {
    setErro("");
    setMsg("");

    const validationError = validateClienteForm(editForm);
    if (validationError) {
      setErro(validationError);
      irParaTopo();
      return;
    }

    const payload = {
      nome: normalizeText(editForm.nome),
      email: normalizeEmail(editForm.email),
      telefone: normalizePhone(editForm.telefone),
    };

    setSavingEdit(true);

    try {
      await apiFetch(`/clientes/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });

      cancelarEdicao();
      await carregarClientes({
        silent: true,
        status: "active",
      });
      setMsg("Cliente atualizado com sucesso.");
      irParaTopo();
    } catch (e) {
      setErro(e?.message || "Erro ao atualizar cliente.");
      irParaTopo();
    } finally {
      setSavingEdit(false);
    }
  }

  function abrirArquivamento(cliente) {
    setErro("");
    setMsg("");
    setArchiveTarget(cliente);
    setArchiveReason("");
    setArchiveError("");
  }

  function fecharArquivamento() {
    if (actionId) return;
    setArchiveTarget(null);
    setArchiveReason("");
    setArchiveError("");
  }

  async function arquivarCliente(e) {
    e.preventDefault();

    if (!archiveTarget) return;

    const motivo = normalizeText(archiveReason);

    if (motivo.length < 3) {
      setArchiveError("Informe um motivo de arquivamento com pelo menos 3 caracteres.");
      return;
    }

    setArchiveError("");
    setErro("");
    setMsg("");
    setActionId(archiveTarget.id);

    try {
      await apiFetch(`/clientes/${archiveTarget.id}/archive`, {
        method: "POST",
        body: JSON.stringify({
          motivo,
        }),
      });

      const nome = archiveTarget.nome || "Cliente";

      setArchiveTarget(null);
      setArchiveReason("");
      setArchiveError("");

      await carregarClientes({
        silent: true,
        status: "active",
      });

      setMsg(`${nome} foi arquivado com sucesso.`);
      irParaTopo();
    } catch (e) {
      setArchiveError(e?.message || "Erro ao arquivar cliente.");
    } finally {
      setActionId(null);
    }
  }

  async function reativarCliente(cliente) {
    const ok = window.confirm(
      `Deseja reativar ${cliente.nome || "este cliente"}? Ele voltará a aparecer nas operações e poderá receber novas ordens de serviço.`
    );

    if (!ok) return;

    setErro("");
    setMsg("");
    setActionId(cliente.id);

    try {
      await apiFetch(`/clientes/${cliente.id}/reactivate`, {
        method: "POST",
      });

      await carregarClientes({
        silent: true,
        status: "archived",
      });

      setMsg(`${cliente.nome || "Cliente"} foi reativado com sucesso.`);
      irParaTopo();
    } catch (e) {
      setErro(e?.message || "Erro ao reativar cliente.");
      irParaTopo();
    } finally {
      setActionId(null);
    }
  }

  const clientesFiltrados = useMemo(() => {
    const term = normalizeSearch(busca);
    const phoneTerm = normalizePhone(term);

    return clientes.filter((cliente) => {
      const matchesBusca =
        !term ||
        normalizeSearch(cliente.nome).includes(term) ||
        normalizeSearch(cliente.email).includes(term) ||
        normalizeSearch(cliente.telefone).includes(term) ||
        (Boolean(phoneTerm) && normalizePhone(cliente.telefone).includes(phoneTerm));

      const matchesResumo =
        filtroResumo === "all" ||
        (filtroResumo === "with_phone" && hasValidPhone(cliente)) ||
        (filtroResumo === "with_email" && hasValidEmail(cliente)) ||
        (filtroResumo === "without_email" && !hasValidEmail(cliente));

      return matchesBusca && matchesResumo;
    });
  }, [clientes, busca, filtroResumo]);

  const stats = useMemo(() => {
    const total = clientes.length;
    const comTelefone = clientes.filter(hasValidPhone).length;
    const comEmail = clientes.filter(hasValidEmail).length;
    const semEmail = Math.max(total - comEmail, 0);

    return { total, comTelefone, comEmail, semEmail };
  }, [clientes]);

  const filtroResumoLabel = RESUMO_FILTER_LABELS[filtroResumo] || RESUMO_FILTER_LABELS.all;
  const temFiltroAtivo = filtroResumo !== "all" || Boolean(busca.trim());

  return (
    <section className="clientes-premium-page">
      <div className="clientes-premium-container">
        <header className="clientes-premium-header">
          <div>
            <span className="clientes-premium-eyebrow">Cadastro da oficina</span>
            <h1>Clientes</h1>
            <p>Cadastre, consulte e mantenha a base de clientes pronta para abrir ordens de serviço.</p>
          </div>

          <button
            type="button"
            className={`clientes-premium-refresh${refreshOk ? " is-success" : ""}`}
            onClick={() => carregarClientes({ showSuccess: true })}
            disabled={loadingList}
            title={
              modoLista === "archived"
                ? "Sincroniza a lista de clientes arquivados com o banco de dados."
                : "Sincroniza a lista de clientes ativos com o banco de dados."
            }
          >
            <AppIcon icon={appIcons.atualizar} size={18} className={loadingList ? "is-spinning" : ""} />
            {loadingList
              ? "Atualizando..."
              : refreshOk
                ? "Atualizado"
                : modoLista === "archived"
                  ? "Atualizar arquivados"
                  : "Atualizar clientes"}
          </button>
        </header>

        {erro ? (
          <div className="clientes-premium-alert is-error" role="alert">
            <AppIcon icon={appIcons.alerta} size={19} />
            <span>{erro}</span>
          </div>
        ) : null}

        {msg ? (
          <div className="clientes-premium-alert is-success" role="status">
            <AppIcon icon={appIcons.sucesso} size={19} />
            <span>{msg}</span>
          </div>
        ) : null}

        <div className="clientes-premium-tabs" role="tablist" aria-label="Situação dos clientes">
          <button
            type="button"
            role="tab"
            aria-selected={modoLista === "active"}
            className={`clientes-premium-tab${modoLista === "active" ? " is-active" : ""}`}
            onClick={() => trocarModoLista("active")}
            disabled={loadingList}
          >
            <AppIcon icon={appIcons.clientes} size={18} />
            Clientes ativos
          </button>

          {isAdmin ? (
            <button
              type="button"
              role="tab"
              aria-selected={modoLista === "archived"}
              className={`clientes-premium-tab${modoLista === "archived" ? " is-active" : ""}`}
              onClick={() => trocarModoLista("archived")}
              disabled={loadingList}
            >
              <AppIcon icon={appIcons.alerta} size={18} />
              Arquivados
            </button>
          ) : null}
        </div>

        {modoLista === "active" ? (
        <div className="clientes-premium-stats-grid" aria-label="Resumo dos clientes">
          <button
            type="button"
            className={`clientes-premium-stat-card is-blue${filtroResumo === "all" ? " is-active" : ""}`}
            onClick={() => aplicarFiltroResumo("all")}
            aria-pressed={filtroResumo === "all"}
          >
            <span><AppIcon icon={appIcons.clientes} size={22} /></span>
            <div>
              <strong>Total</strong>
              <b>{stats.total}</b>
              <small>Ver todos os clientes</small>
            </div>
          </button>

          <button
            type="button"
            className={`clientes-premium-stat-card is-green${filtroResumo === "with_phone" ? " is-active" : ""}`}
            onClick={() => aplicarFiltroResumo("with_phone")}
            aria-pressed={filtroResumo === "with_phone"}
          >
            <span><AppIcon icon={appIcons.telefone} size={22} /></span>
            <div>
              <strong>Com telefone</strong>
              <b>{stats.comTelefone}</b>
              <small>Filtrar contatos prontos</small>
            </div>
          </button>

          <button
            type="button"
            className={`clientes-premium-stat-card is-indigo${filtroResumo === "with_email" ? " is-active" : ""}`}
            onClick={() => aplicarFiltroResumo("with_email")}
            aria-pressed={filtroResumo === "with_email"}
          >
            <span><AppIcon icon={appIcons.email} size={22} /></span>
            <div>
              <strong>Com email</strong>
              <b>{stats.comEmail}</b>
              <small>Filtrar cadastros completos</small>
            </div>
          </button>

          <button
            type="button"
            className={`clientes-premium-stat-card is-orange${filtroResumo === "without_email" ? " is-active" : ""}`}
            onClick={() => aplicarFiltroResumo("without_email")}
            aria-pressed={filtroResumo === "without_email"}
          >
            <span><AppIcon icon={appIcons.alerta} size={22} /></span>
            <div>
              <strong>Sem email</strong>
              <b>{stats.semEmail}</b>
              <small>Clique para listar</small>
            </div>
          </button>
        </div>

        ) : (
          <div className="clientes-premium-archive-summary">
            <AppIcon icon={appIcons.info} size={19} />
            <div>
              <strong>Clientes fora da operação diária</strong>
              <span>
                Arquivar não apaga histórico. As OS e resultados anteriores continuam preservados,
                mas o cliente deixa de aparecer na Nova OS até ser reativado.
              </span>
            </div>
          </div>
        )}

        <div className={`clientes-premium-grid${modoLista === "archived" ? " is-archived" : ""}`}>
          {modoLista === "active" ? (
            <article className="clientes-premium-card clientes-premium-card--form">
            <div className="clientes-premium-card-head">
              <span><AppIcon icon={appIcons.adicionar} size={21} /></span>
              <div>
                <h2>Novo cliente</h2>
                <p>Dados mínimos para atendimento e criação de OS.</p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="clientes-premium-form" noValidate>
              <label className="clientes-premium-field">
                <span>Nome</span>
                <input
                  name="nome"
                  placeholder="Nome do cliente"
                  value={form.nome}
                  onChange={handleChange}
                  autoComplete="name"
                />
              </label>

              <label className="clientes-premium-field">
                <span>Email</span>
                <input
                  name="email"
                  type="text"
                  inputMode="email"
                  placeholder="cliente@email.com"
                  value={form.email}
                  onChange={handleChange}
                  autoComplete="email"
                />
              </label>

              <label className="clientes-premium-field">
                <span>Telefone</span>
                <input
                  name="telefone"
                  type="text"
                  inputMode="tel"
                  placeholder="(44) 99999-9999"
                  value={form.telefone}
                  onChange={handleChange}
                  autoComplete="tel"
                />
              </label>

              <button type="submit" disabled={loading} className="clientes-premium-primary-action">
                <AppIcon icon={appIcons.adicionar} size={18} />
                {loading ? "Salvando..." : "Cadastrar cliente"}
              </button>
            </form>
            </article>
          ) : null}

          <article className="clientes-premium-card clientes-premium-card--filter">
            <div className="clientes-premium-card-head">
              <span><AppIcon icon={appIcons.pesquisar} size={21} /></span>
              <div>
                <h2>{modoLista === "archived" ? "Buscar arquivado" : "Buscar cliente"}</h2>
                <p>
                  {modoLista === "archived"
                    ? "Localize clientes fora da operação para consultar ou reativar."
                    : "Localize por nome, email ou telefone."}
                </p>
              </div>
            </div>

            <div className="clientes-premium-search-tools">
              <label className="clientes-premium-search-field">
                <AppIcon icon={appIcons.pesquisar} size={18} />
                <input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleBuscarClientes();
                    }
                  }}
                  placeholder="Digite nome, email ou telefone..."
                />
              </label>

              <div className="clientes-premium-search-actions">
                <button type="button" className="clientes-premium-search-action" onClick={handleBuscarClientes}>
                  <AppIcon icon={appIcons.pesquisar} size={17} />
                  Buscar
                </button>

                {busca || filtroResumo !== "all" ? (
                  <button type="button" className="clientes-premium-search-clear" onClick={limparFiltrosClientes}>
                    <AppIcon icon={appIcons.fechar} size={17} />
                    Limpar
                  </button>
                ) : null}
              </div>
            </div>

            <div className="clientes-premium-info-note">
              <AppIcon icon={appIcons.seguranca} size={18} />
              <span>
                {modoLista === "archived"
                  ? "Somente administradores consultam e reativam clientes arquivados."
                  : "Dados de clientes ficam vinculados à empresa logada pelo isolamento multi-tenant."}
              </span>
            </div>
          </article>
        </div>

        <article className="clientes-premium-card clientes-premium-list-card" ref={listaRef}>
          <div className="clientes-premium-list-head">
            <div>
              <h2>
                {modoLista === "archived"
                  ? "Clientes arquivados"
                  : filtroResumo === "without_email"
                    ? "Clientes sem email"
                    : "Clientes ativos da oficina"}
              </h2>
              <p>
                Mostrando {clientesFiltrados.length} de {clientes.length}{" "}
                {modoLista === "archived" ? "clientes arquivados" : "clientes ativos"}
                {modoLista === "active" && filtroResumo !== "all" ? ` • Filtro: ${filtroResumoLabel}` : ""}
                {busca.trim() ? ` • Busca: ${busca.trim()}` : ""}.
              </p>
            </div>

            <div className="clientes-premium-list-head-actions">
              <div className="clientes-premium-count-pill">
                <AppIcon icon={appIcons.clientes} size={17} />
                {clientesFiltrados.length} {modoLista === "archived" ? "arquivados" : "clientes"}
              </div>

              {temFiltroAtivo ? (
                <button type="button" className="clientes-premium-list-clear-filter" onClick={limparFiltrosClientes}>
                  <AppIcon icon={appIcons.fechar} size={15} />
                  Limpar filtros
                </button>
              ) : null}
            </div>
          </div>

          {loadingList ? (
            <div className="clientes-premium-empty">Carregando clientes...</div>
          ) : clientesFiltrados.length === 0 ? (
            <div className="clientes-premium-empty">
              {temFiltroAtivo
                ? "Nenhum cliente encontrado para os filtros aplicados."
                : modoLista === "archived"
                  ? "Nenhum cliente arquivado."
                  : "Nenhum cliente ativo cadastrado."}
            </div>
          ) : (
            <div className="clientes-premium-list">
              {clientesFiltrados.map((cliente) => {
                const editando = editingId === cliente.id;

                return (
                  <div
                    key={cliente.id}
                    className={`clientes-premium-item${modoLista === "archived" ? " is-archived" : ""}`}
                  >
                    {editando && modoLista === "active" ? (
                      <div className="clientes-premium-edit-panel">
                        <div className="clientes-premium-client-identity">
                          <div className="clientes-premium-avatar">{getInitials(editForm.nome || cliente.nome)}</div>
                          <div>
                            <strong>Editando cliente</strong>
                            <span>Atualize os dados com cuidado.</span>
                          </div>
                        </div>

                        <div className="clientes-premium-edit-grid">
                          <label className="clientes-premium-field">
                            <span>Nome</span>
                            <input
                              name="nome"
                              value={editForm.nome}
                              onChange={handleEditChange}
                              autoComplete="name"
                            />
                          </label>

                          <label className="clientes-premium-field">
                            <span>Email</span>
                            <input
                              name="email"
                              type="text"
                              inputMode="email"
                              value={editForm.email}
                              onChange={handleEditChange}
                              autoComplete="email"
                            />
                          </label>

                          <label className="clientes-premium-field">
                            <span>Telefone</span>
                            <input
                              name="telefone"
                              type="text"
                              inputMode="tel"
                              value={editForm.telefone}
                              onChange={handleEditChange}
                              autoComplete="tel"
                            />
                          </label>
                        </div>

                        <div className="clientes-premium-actions">
                          <button
                            type="button"
                            onClick={() => salvarEdicao(cliente.id)}
                            disabled={savingEdit}
                            className="clientes-premium-save-action"
                          >
                            <AppIcon icon={appIcons.sucesso} size={17} />
                            {savingEdit ? "Salvando..." : "Salvar alterações"}
                          </button>

                          <button type="button" onClick={cancelarEdicao} className="clientes-premium-ghost-action">
                            <AppIcon icon={appIcons.fechar} size={17} />
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="clientes-premium-view-panel">
                        <div className="clientes-premium-client-identity">
                          <div className="clientes-premium-avatar">{getInitials(cliente.nome)}</div>
                          <div>
                            <strong>{cliente.nome}</strong>
                            <span>
                              {modoLista === "archived" ? "Cliente arquivado" : "Cliente ativo da oficina"}
                            </span>
                          </div>
                        </div>

                        <div className="clientes-premium-contact-grid">
                          <div className="clientes-premium-contact-tile">
                            <AppIcon icon={appIcons.email} size={17} />
                            <div>
                              <small>Email</small>
                              <span>{cliente.email || "Sem email"}</span>
                            </div>
                          </div>

                          <div className="clientes-premium-contact-tile">
                            <AppIcon icon={appIcons.telefone} size={17} />
                            <div>
                              <small>Telefone</small>
                              <span>{formatPhone(cliente.telefone)}</span>
                            </div>
                          </div>

                          {modoLista === "archived" ? (
                            <>
                              <div className="clientes-premium-contact-tile is-archive-detail">
                                <AppIcon icon={appIcons.info} size={17} />
                                <div>
                                  <small>Arquivado em</small>
                                  <span>{formatDateTime(cliente.archived_at)}</span>
                                </div>
                              </div>

                              <div className="clientes-premium-contact-tile is-archive-detail">
                                <AppIcon icon={appIcons.alerta} size={17} />
                                <div>
                                  <small>Motivo</small>
                                  <span title={cliente.archive_reason || ""}>
                                    {cliente.archive_reason || "Motivo não informado"}
                                  </span>
                                </div>
                              </div>
                            </>
                          ) : null}
                        </div>

                        <div className="clientes-premium-actions">
                          {modoLista === "active" ? (
                            <>
                              <button
                                type="button"
                                onClick={() => iniciarEdicao(cliente)}
                                className="clientes-premium-ghost-action"
                              >
                                <AppIcon icon={appIcons.editar} size={17} />
                                Editar
                              </button>

                              {isAdmin ? (
                                <button
                                  type="button"
                                  onClick={() => abrirArquivamento(cliente)}
                                  disabled={actionId === cliente.id}
                                  className="clientes-premium-archive-action"
                                >
                                  <AppIcon icon={appIcons.alerta} size={17} />
                                  {actionId === cliente.id ? "Arquivando..." : "Arquivar"}
                                </button>
                              ) : null}
                            </>
                          ) : isAdmin ? (
                            <button
                              type="button"
                              onClick={() => reativarCliente(cliente)}
                              disabled={actionId === cliente.id}
                              className="clientes-premium-reactivate-action"
                            >
                              <AppIcon icon={appIcons.atualizar} size={17} />
                              {actionId === cliente.id ? "Reativando..." : "Reativar"}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </article>

        {archiveTarget
          ? createPortal(
              <div
                className="clientes-premium-modal-backdrop"
            role="presentation"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) {
                fecharArquivamento();
              }
            }}
          >
            <div
              className="clientes-premium-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="clientes-archive-title"
            >
              <div className="clientes-premium-modal-head">
                <div>
                  <span className="clientes-premium-modal-icon">
                    <AppIcon icon={appIcons.alerta} size={20} />
                  </span>
                  <div>
                    <h2 id="clientes-archive-title">Arquivar cliente</h2>
                    <p>{archiveTarget.nome}</p>
                  </div>
                </div>

                <button
                  type="button"
                  className="clientes-premium-modal-close"
                  onClick={fecharArquivamento}
                  disabled={actionId === archiveTarget.id}
                  aria-label="Fechar"
                >
                  <AppIcon icon={appIcons.fechar} size={18} />
                </button>
              </div>

              <div className="clientes-premium-modal-warning">
                <AppIcon icon={appIcons.info} size={19} />
                <span>
                  O histórico deste cliente e suas OS não serão apagados. Após o arquivamento,
                  ele deixa de aparecer nas operações e não poderá receber nova OS até ser reativado.
                </span>
              </div>

              <form onSubmit={arquivarCliente} className="clientes-premium-archive-form">
                {archiveError ? (
                  <div className="clientes-premium-modal-error" role="alert">
                    <AppIcon icon={appIcons.alerta} size={18} />
                    <span>{archiveError}</span>
                  </div>
                ) : null}

                <label className="clientes-premium-field">
                  <span>Motivo do arquivamento</span>
                  <textarea
                    value={archiveReason}
                    onChange={(e) => {
                      setArchiveReason(e.target.value);
                      setArchiveError("");
                      clearFeedback();
                    }}
                    placeholder="Ex.: cliente mudou de cidade, encerrou relacionamento com a oficina..."
                    maxLength={300}
                    autoFocus
                  />
                  <small>{archiveReason.trim().length}/300 caracteres</small>
                </label>

                <div className="clientes-premium-modal-actions">
                  <button
                    type="button"
                    className="clientes-premium-ghost-action"
                    onClick={fecharArquivamento}
                    disabled={actionId === archiveTarget.id}
                  >
                    Cancelar
                  </button>

                  <button
                    type="submit"
                    className="clientes-premium-archive-action"
                    disabled={actionId === archiveTarget.id}
                  >
                    <AppIcon icon={appIcons.alerta} size={17} />
                    {actionId === archiveTarget.id ? "Arquivando..." : "Confirmar arquivamento"}
                  </button>
                </div>
              </form>
              </div>
            </div>,
            document.body
          )
          : null}
      </div>
    </section>
  );
}
