import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch, clearToken, getUser } from "../api";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
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

export default function Clientes({ onLogout }) {
  const [clientes, setClientes] = useState([]);
  const [erro, setErro] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
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

  async function carregarClientes() {
    setErro("");
    try {
      const data = await apiFetch("/clientes");
      setClientes(data);
    } catch (e) {
      setErro(e.message);
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
      await carregarClientes();
      setMsg("Cliente cadastrado com sucesso.");
      irParaTopo();
    } catch (e) {
      setErro(e.message);
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
      await carregarClientes();
      setMsg("Cliente atualizado com sucesso.");
      irParaTopo();
    } catch (e) {
      setErro(e.message);
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

      await carregarClientes();
      setMsg("Cliente excluído com sucesso.");
      irParaTopo();
    } catch (e) {
      setErro(e.message);
      irParaTopo();
    } finally {
      setDeletingId(null);
    }
  }

  function sair() {
    clearToken();
    onLogout?.();
    window.location.href = "/login";
  }

  const clientesFiltrados = clientes.filter((c) =>
    String(c.nome || "")
      .toLowerCase()
      .includes(busca.trim().toLowerCase())
  );

  return (
    <div className="page">
      <div className="container stack">
        <PageHeader
          eyebrow="Cadastro da oficina"
          title="Clientes"
          description="Cadastre, edite e organize a base de clientes da oficina."
          right={
            <>
              <Link to="/dashboard">
                <button className="btn btn--solid" type="button">Dashboard</button>
              </Link>

              <Link to="/os">
                <button className="btn btn--ghost-dark" type="button">Ordens de Serviço</button>
              </Link>

              <button onClick={sair} className="btn btn--ghost-dark" type="button">
                Sair
              </button>
            </>
          }
        />

        {erro ? <div className="alert-box alert-box--error">Erro: {erro}</div> : null}
        {msg ? <div className="alert-box alert-box--success">{msg}</div> : null}

        <div className="card">
          <div className="card-title">Novo cliente</div>

          <form onSubmit={handleSubmit} className="form-grid" noValidate>
            <div className="form-grid-clientes">
              <label className="form-group">
                <span className="label">Nome</span>
                <input
                  name="nome"
                  placeholder="Nome do cliente"
                  value={form.nome}
                  onChange={handleChange}
                  className="input-clean"
                  autoComplete="name"
                />
              </label>

              <label className="form-group">
                <span className="label">Email</span>
                <input
                  name="email"
                  type="text"
                  inputMode="email"
                  placeholder="cliente@email.com"
                  value={form.email}
                  onChange={handleChange}
                  className="input-clean"
                  autoComplete="email"
                />
              </label>

              <label className="form-group">
                <span className="label">Telefone</span>
                <input
                  name="telefone"
                  type="text"
                  inputMode="tel"
                  placeholder="(44) 99999-9999"
                  value={form.telefone}
                  onChange={handleChange}
                  className="input-clean"
                  autoComplete="tel"
                />
              </label>

              <button
                type="submit"
                disabled={loading}
                className="btn btn--primary"
              >
                {loading ? "Salvando..." : "Cadastrar"}
              </button>
            </div>
          </form>
        </div>

        <div className="card">
          <div className="stack" style={{ gap: 16 }}>
            <div className="section-title-row">
              <div className="section-title-lg">Lista de clientes</div>

              <div className="counter-chip">
                Mostrando {clientesFiltrados.length} de {clientes.length}
              </div>
            </div>

            <div className="search-panel">
              <div className="search-panel-title">
                <span>🔎</span>
                <span>Buscar cliente</span>
              </div>

              <div className="search-panel-help">
                Digite o primeiro nome ou parte do nome para localizar mais rápido.
              </div>

              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Digite nome ou primeiro nome do cliente"
              />
            </div>
          </div>

          <div className="section">
            {clientesFiltrados.length === 0 ? (
              <div className="empty-state-box">
                {busca.trim()
                  ? "Nenhum cliente encontrado para essa busca."
                  : "Nenhum cliente cadastrado."}
              </div>
            ) : (
              <div className="client-list">
                {clientesFiltrados.map((c) => {
                  const editando = editingId === c.id;

                  return (
                    <div key={c.id} className="client-item">
                      {editando ? (
                        <div className="client-edit-grid">
                          <label className="form-group">
                            <span className="label">Nome</span>
                            <input
                              name="nome"
                              value={editForm.nome}
                              onChange={handleEditChange}
                              autoComplete="name"
                            />
                          </label>

                          <label className="form-group">
                            <span className="label">Email</span>
                            <input
                              name="email"
                              type="text"
                              inputMode="email"
                              value={editForm.email}
                              onChange={handleEditChange}
                              autoComplete="email"
                            />
                          </label>

                          <label className="form-group">
                            <span className="label">Telefone</span>
                            <input
                              name="telefone"
                              type="text"
                              inputMode="tel"
                              value={editForm.telefone}
                              onChange={handleEditChange}
                              autoComplete="tel"
                            />
                          </label>

                          <button
                            type="button"
                            onClick={() => salvarEdicao(c.id)}
                            disabled={savingEdit}
                            className="btn"
                            style={{
                              background: "#198754",
                              color: "#fff",
                              border: "none",
                              opacity: savingEdit ? 0.7 : 1,
                            }}
                          >
                            {savingEdit ? "Salvando..." : "Salvar"}
                          </button>

                          <button
                            type="button"
                            onClick={cancelarEdicao}
                            className="btn btn--ghost"
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <div className="client-view-grid">
                          <div className="client-info-grid">
                            <div className="info-tile">
                              <div className="info-tile-label">NOME</div>
                              <div className="info-tile-value">{c.nome}</div>
                            </div>

                            <div className="info-tile">
                              <div className="info-tile-label">EMAIL</div>
                              <div className="info-tile-value info-tile-value--normal">
                                {c.email || "sem email"}
                              </div>
                            </div>

                            <div className="info-tile">
                              <div className="info-tile-label">TELEFONE</div>
                              <div className="info-tile-value info-tile-value--normal">
                                {c.telefone || "sem telefone"}
                              </div>
                            </div>
                          </div>

                          <div className="client-actions-grid">
                            <button
                              type="button"
                              onClick={() => iniciarEdicao(c)}
                              className="btn btn--ghost"
                            >
                              Editar
                            </button>

                            {isAdmin && (
  <button
    type="button"
    onClick={() => excluirCliente(c.id)}
    disabled={deletingId === c.id}
    className="btn btn--danger"
    style={{ opacity: deletingId === c.id ? 0.7 : 1 }}
  >
    {deletingId === c.id ? "Excluindo..." : "Excluir"}
  </button>
)}

                            
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PageHeader({ eyebrow, title, description, right }) {
  return (
    <div className="topbar">
      <div className="page-header-meta">
        <div className="page-eyebrow">{eyebrow}</div>
        <h1 className="page-title">{title}</h1>
        <p className="page-description">{description}</p>
      </div>

      <div className="form-actions header-actions">{right}</div>
    </div>
  );
}
