import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../api";

export default function Usuarios() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

const [name, setName] = useState("");
const [email, setEmail] = useState("");
const [phone, setPhone] = useState("");
const [role, setRole] = useState("atendimento");

  const [inviteResult, setInviteResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [copiedUserId, setCopiedUserId] = useState(null);
  const [copiedTopLink, setCopiedTopLink] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);

  async function loadUsers() {
    try {
      setError("");
      setLoading(true);
      const data = await apiFetch("/users");
      setUsers(data);
    } catch (err) {
      setError(err.message || "Erro ao carregar usuários");
    } finally {
      setLoading(false);
    }
  }

  async function loadCurrentUser() {
    try {
      const data = await apiFetch("/auth/me");
      setCurrentUser(data);
    } catch (err) {
      setError(err.message || "Erro ao carregar usuário logado");
    }
  }

  useEffect(() => {
    loadUsers();
    loadCurrentUser();
  }, []);

  async function handleInvite(e) {
    e.preventDefault();
    if (submitting) return;

    try {
      setSubmitting(true);
      setError("");
      setInviteResult(null);
      setCopiedTopLink(false);

      const data = await apiFetch("/users/invite", {
        method: "POST",
        body: JSON.stringify({ name, email, phone, role }),
      });

      setInviteResult(data);

      setName("");
setEmail("");
setPhone("");
setRole("atendimento");

      await loadUsers();
    } catch (err) {
      setError(err.message || "Erro ao convidar usuário");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyText(text) {
    if (!text) return false;

    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  async function copyTopInviteLink() {
    const ok = await copyText(inviteResult?.invite_link);
    if (!ok) {
      setError("Não foi possível copiar o link.");
      return;
    }

    setCopiedTopLink(true);
    setTimeout(() => setCopiedTopLink(false), 2000);
  }

  async function changeRole(id, newRole) {
    try {
      setError("");
      await apiFetch(`/users/${id}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role: newRole }),
      });
      await loadUsers();
    } catch (err) {
      setError(err.message || "Erro ao trocar perfil");
    }
  }

  async function toggleActive(id) {
    try {
      setError("");
      await apiFetch(`/users/${id}/toggle-active`, {
        method: "PATCH",
      });
      await loadUsers();
    } catch (err) {
      setError(err.message || "Erro ao alterar status do usuário");
    }
  }

  async function resendInvite(id) {
    try {
      setError("");
      const data = await apiFetch(`/users/${id}/resend-invite`, {
        method: "POST",
      });

      const ok = await copyText(data?.invite_link);
      if (!ok) {
        setError("Link gerado, mas não foi possível copiar automaticamente.");
        return;
      }

      setCopiedUserId(id);
      setTimeout(() => setCopiedUserId(null), 2000);

      await loadUsers();
    } catch (err) {
      setError(err.message || "Erro ao reenviar convite");
    }
  }

  return (
    <div className="page">
      <div className="container stack">
        <div className="topbar">
          <div className="page-header-meta">
            <div className="page-eyebrow">Administração</div>
            <h1 className="page-title">Usuários</h1>
            <p className="page-description">
              Gerencie acessos da sua oficina e convide novos usuários.
            </p>
          </div>

          <div className="form-actions header-actions">
            <Link to="/dashboard">
              <button className="btn btn--ghost-dark">Dashboard</button>
            </Link>
          </div>
        </div>

        <div className="card stack">
          <h2>Convidar usuário</h2>

          <form onSubmit={handleInvite} className="form-grid">
            <div className="form-group">
              <label className="label">Nome</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="label">Email</label>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
  <label className="label">Telefone (opcional)</label>
  <input
    value={phone}
    onChange={(e) => setPhone(e.target.value)}
    placeholder="Ex.: 44999887766"
  />
</div>





            <div className="form-group">
              <label className="label">Perfil</label>
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="atendimento">Atendimento</option>
                <option value="tecnico">Técnico</option>
              </select>
            </div>

            <div className="form-actions">
              <button className="btn btn--primary" disabled={submitting}>
                {submitting ? "Enviando..." : "Enviar convite"}
              </button>
            </div>
          </form>

          {inviteResult && (
            <div className="soft-box stack">
              <strong>Convite criado</strong>

              <div className="muted">
                Link de ativação do usuário criado agora:
              </div>

              <textarea
                readOnly
                value={inviteResult.invite_link || ""}
                rows={3}
                style={{
                  width: "100%",
                  resize: "vertical",
                  borderRadius: 12,
                  padding: 12,
                  border: "1px solid #d7deea",
                  background: "#fff",
                  fontSize: 14,
                  lineHeight: 1.5,
                }}
                onFocus={(e) => e.target.select()}
              />

              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={copyTopInviteLink}
                >
                  {copiedTopLink ? "Copiado!" : "Copiar link"}
                </button>

                {inviteResult.whatsapp_link && (
                  <a
                    href={inviteResult.whatsapp_link}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn--primary"
                  >
                    Abrir WhatsApp
                  </a>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="card stack">
          <h2>Usuários da empresa</h2>

          {loading && <div>Carregando...</div>}
          {error && <div className="alert--error">Erro: {error}</div>}

          {!loading && users.length === 0 && (
            <div className="muted">Nenhum usuário encontrado</div>
          )}

          <div className="list">
            {users.map((u) => {
              const isSelf = currentUser?.id === u.id;

              return (
                <div key={u.id} className="table-like-row">
                  <strong>{u.name}</strong>

                  <div className="muted">{u.email}</div>

                  <div className="row">
                    <span className="badge badge--default">
                      {formatRoleLabel(u.role)}
                    </span>

                    {u.is_active ? (
                      <span className="badge badge--success">Ativo</span>
                    ) : (
                      <span className="badge badge--warning">Convite pendente</span>
                    )}
                  </div>

                  <div
                    className="row"
                    style={{ marginTop: 8, gap: 8, flexWrap: "wrap" }}
                  >
                    {!isSelf && (
                      <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={() =>
                          changeRole(
                            u.id,
                            u.role === "tecnico" ? "atendimento" : "tecnico"
                          )
                        }
                      >
                        Trocar perfil
                      </button>
                    )}

                    {!isSelf && (
                      <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={() => toggleActive(u.id)}
                      >
                        {u.is_active ? "Desativar" : "Ativar"}
                      </button>
                    )}

                    {!isSelf && !u.is_active && (
                      <>
                        <button
                          type="button"
                          className="btn btn--primary"
                          onClick={() => resendInvite(u.id)}
                        >
                          {copiedUserId === u.id
                            ? "Link copiado!"
                            : "Reenviar convite"}
                        </button>

                        <div className="muted" style={{ width: "100%", marginTop: 4 }}>
                          Ao reenviar, o novo link já é copiado automaticamente.
                        </div>
                      </>
                    )}

                    {isSelf && (
                      <div className="muted" style={{ width: "100%", marginTop: 4 }}>
                        Seu próprio usuário não pode ser alterado nesta tela.
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatRoleLabel(role) {
  if (role === "admin") return "Admin";
  if (role === "atendimento") return "Atendimento";
  if (role === "tecnico") return "Técnico";
  return role || "-";
}
