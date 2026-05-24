import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Edit3,
  Mail,
  Phone,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react";
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
  const [deletingId, setDeletingId] = useState(null);
  const [busca, setBusca] = useState("");
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

  async function carregarClientes({ silent = false } = {}) {
    if (!silent) setLoadingList(true);
    setErro("");

    try {
      const data = await apiFetch("/clientes");
      setClientes(Array.isArray(data) ? data : []);
    } catch (e) {
      setErro(e?.message || "Erro ao carregar clientes.");
    } finally {
      if (!silent) setLoadingList(false);
    }
  }

  useEffect(() => {
    carregarClientes();
  }, []);

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
      await carregarClientes({ silent: true });
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
      await carregarClientes({ silent: true });
      setMsg("Cliente atualizado com sucesso.");
      irParaTopo();
    } catch (e) {
      setErro(e?.message || "Erro ao atualizar cliente.");
      irParaTopo();
    } finally {
      setSavingEdit(false);
    }
  }

  async function excluirCliente(id) {
    const ok = window.confirm("Deseja excluir este cliente?");
    if (!ok) return;

    setErro("");
    setMsg("");
    setDeletingId(id);

    try {
      await apiFetch(`/clientes/${id}`, {
        method: "DELETE",
      });

      await carregarClientes({ silent: true });
      setMsg("Cliente excluído com sucesso.");
      irParaTopo();
    } catch (e) {
      setErro(e?.message || "Erro ao excluir cliente.");
      irParaTopo();
    } finally {
      setDeletingId(null);
    }
  }

  const clientesFiltrados = useMemo(() => {
    const term = normalizeSearch(busca);

    return clientes.filter((cliente) => {
      if (!term) return true;

      return (
        normalizeSearch(cliente.nome).includes(term) ||
        normalizeSearch(cliente.email).includes(term) ||
        normalizeSearch(cliente.telefone).includes(term) ||
        normalizePhone(cliente.telefone).includes(normalizePhone(term))
      );
    });
  }, [clientes, busca]);

  const stats = useMemo(() => {
    const total = clientes.length;
    const comTelefone = clientes.filter((cliente) => normalizePhone(cliente.telefone).length >= 10).length;
    const comEmail = clientes.filter((cliente) => normalizeEmail(cliente.email)).length;
    const semEmail = Math.max(total - comEmail, 0);

    return { total, comTelefone, comEmail, semEmail };
  }, [clientes]);

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
            className="clientes-premium-refresh"
            onClick={() => carregarClientes()}
            disabled={loadingList}
          >
            <RefreshCw size={18} />
            {loadingList ? "Atualizando..." : "Atualizar"}
          </button>
        </header>

        {erro ? (
          <div className="clientes-premium-alert is-error" role="alert">
            <AlertTriangle size={19} />
            <span>{erro}</span>
          </div>
        ) : null}

        {msg ? (
          <div className="clientes-premium-alert is-success" role="status">
            <CheckCircle2 size={19} />
            <span>{msg}</span>
          </div>
        ) : null}

        <div className="clientes-premium-stats-grid" aria-label="Resumo dos clientes">
          <article className="clientes-premium-stat-card is-blue">
            <span><Users size={22} /></span>
            <div>
              <strong>Total</strong>
              <b>{stats.total}</b>
              <small>Clientes cadastrados</small>
            </div>
          </article>

          <article className="clientes-premium-stat-card is-green">
            <span><Phone size={22} /></span>
            <div>
              <strong>Com telefone</strong>
              <b>{stats.comTelefone}</b>
              <small>Prontos para contato</small>
            </div>
          </article>

          <article className="clientes-premium-stat-card is-indigo">
            <span><Mail size={22} /></span>
            <div>
              <strong>Com email</strong>
              <b>{stats.comEmail}</b>
              <small>Cadastro mais completo</small>
            </div>
          </article>

          <article className="clientes-premium-stat-card is-orange">
            <span><AlertTriangle size={22} /></span>
            <div>
              <strong>Sem email</strong>
              <b>{stats.semEmail}</b>
              <small>Completar depois</small>
            </div>
          </article>
        </div>

        <div className="clientes-premium-grid">
          <article className="clientes-premium-card clientes-premium-card--form">
            <div className="clientes-premium-card-head">
              <span><Plus size={21} /></span>
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
                <Plus size={18} />
                {loading ? "Salvando..." : "Cadastrar cliente"}
              </button>
            </form>
          </article>

          <article className="clientes-premium-card clientes-premium-card--filter">
            <div className="clientes-premium-card-head">
              <span><Search size={21} /></span>
              <div>
                <h2>Buscar cliente</h2>
                <p>Localize por nome, email ou telefone.</p>
              </div>
            </div>

            <label className="clientes-premium-search-field">
              <Search size={18} />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Digite nome, email ou telefone..."
              />
              {busca ? (
                <button type="button" onClick={() => setBusca("")} aria-label="Limpar busca">
                  <X size={17} />
                </button>
              ) : null}
            </label>

            <div className="clientes-premium-info-note">
              <ShieldCheck size={18} />
              <span>Dados de clientes ficam vinculados à empresa logada pelo isolamento multi-tenant.</span>
            </div>
          </article>
        </div>

        <article className="clientes-premium-card clientes-premium-list-card">
          <div className="clientes-premium-list-head">
            <div>
              <h2>Clientes da oficina</h2>
              <p>
                Mostrando {clientesFiltrados.length} de {clientes.length} clientes cadastrados.
              </p>
            </div>

            <div className="clientes-premium-count-pill">
              <Users size={17} />
              {clientesFiltrados.length} clientes
            </div>
          </div>

          {loadingList ? (
            <div className="clientes-premium-empty">Carregando clientes...</div>
          ) : clientesFiltrados.length === 0 ? (
            <div className="clientes-premium-empty">
              {busca.trim() ? "Nenhum cliente encontrado para essa busca." : "Nenhum cliente cadastrado."}
            </div>
          ) : (
            <div className="clientes-premium-list">
              {clientesFiltrados.map((cliente) => {
                const editando = editingId === cliente.id;

                return (
                  <div key={cliente.id} className="clientes-premium-item">
                    {editando ? (
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
                            <CheckCircle2 size={17} />
                            {savingEdit ? "Salvando..." : "Salvar alterações"}
                          </button>

                          <button type="button" onClick={cancelarEdicao} className="clientes-premium-ghost-action">
                            <X size={17} />
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
                            <span>Cliente da oficina</span>
                          </div>
                        </div>

                        <div className="clientes-premium-contact-grid">
                          <div className="clientes-premium-contact-tile">
                            <Mail size={17} />
                            <div>
                              <small>Email</small>
                              <span>{cliente.email || "Sem email"}</span>
                            </div>
                          </div>

                          <div className="clientes-premium-contact-tile">
                            <Phone size={17} />
                            <div>
                              <small>Telefone</small>
                              <span>{formatPhone(cliente.telefone)}</span>
                            </div>
                          </div>
                        </div>

                        <div className="clientes-premium-actions">
                          <button
                            type="button"
                            onClick={() => iniciarEdicao(cliente)}
                            className="clientes-premium-ghost-action"
                          >
                            <Edit3 size={17} />
                            Editar
                          </button>

                          {isAdmin ? (
                            <button
                              type="button"
                              onClick={() => excluirCliente(cliente.id)}
                              disabled={deletingId === cliente.id}
                              className="clientes-premium-danger-action"
                            >
                              <Trash2 size={17} />
                              {deletingId === cliente.id ? "Excluindo..." : "Excluir"}
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
      </div>
    </section>
  );
}
