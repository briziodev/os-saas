import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../api";

export default function Usuarios() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

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
      setNotice("");
      setInviteResult(null);
      setCopiedTopLink(false);

      const data = await apiFetch("/users/invite", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          role,
        }),
      });

      setInviteResult({
        ...data,
        type: "created",
      });

      setNotice("Convite criado com sucesso. Copie o link ou envie pelo WhatsApp.");
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
      setError("Não foi possível copiar automaticamente. Selecione o link e copie manualmente.");
      return;
    }

    setError("");
    setCopiedTopLink(true);
    setTimeout(() => setCopiedTopLink(false), 2000);
  }

  async function changeRole(id, newRole) {
    try {
      setError("");
      setNotice("");

      await apiFetch(`/users/${id}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role: newRole }),
      });

      setNotice("Perfil atualizado com sucesso.");
      await loadUsers();
    } catch (err) {
      setError(err.message || "Erro ao trocar perfil");
    }
  }

  async function toggleActive(id) {
    try {
      setError("");
      setNotice("");

      await apiFetch(`/users/${id}/toggle-active`, {
        method: "PATCH",
      });

      setNotice("Status do usuário atualizado com sucesso.");
      await loadUsers();
    } catch (err) {
      setError(err.message || "Erro ao alterar status do usuário");
    }
  }

  async function resendInvite(id) {
    try {
      setError("");
      setNotice("");
      setCopiedTopLink(false);

      const data = await apiFetch(`/users/${id}/resend-invite`, {
        method: "POST",
      });

      setInviteResult({
        ...data,
        type: "resent",
      });

      const ok = await copyText(data?.invite_link);

      if (ok) {
        setCopiedUserId(id);
        setCopiedTopLink(true);
        setNotice("Convite reenviado e link copiado.");
        setTimeout(() => setCopiedUserId(null), 2000);
        setTimeout(() => setCopiedTopLink(false), 2000);
      } else {
        setNotice("Convite reenviado. Não foi possível copiar automaticamente, mas o link está visível acima.");
      }

      await loadUsers();
    } catch (err) {
      setError(err.message || "Erro ao reenviar convite");
    }
  }

  function getInviteTitle() {
    if (inviteResult?.type === "resent") return "Convite reenviado";
    return "Convite criado";
  }

  function getInviteDescription() {
    if (inviteResult?.type === "resent") {
      return "Um novo link foi gerado. O link antigo deixa de ser o link recomendado.";
    }

    return "Link de ativação criado agora. Envie este link para o usuário definir a senha.";
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

        {error && <div className="alert--error">Erro: {error}</div>}
        {notice && <div className="soft-box">{notice}</div>}

        <div className="card stack">
          <h2>Convidar usuário</h2>

          <form onSubmit={handleInvite} className="form-grid">
            <div className="form-group">
              <label className="label">Nome</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nome do usuário"
                required
              />
            </div>

            <div className="form-group">
              <label className="label">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="usuario@oficina.com"
                required
              />
            </div>

            <div className="form-group">
              <label className="label">Telefone para WhatsApp (opcional)</label>
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
              <strong>{getInviteTitle()}</strong>

              <div className="muted">{getInviteDescription()}</div>

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

              <div className="muted">
                Este link é sensível. Envie somente para o usuário convidado.
              </div>
            </div>
          )}
        </div>

        <div className="card stack">
          <h2>Usuários da empresa</h2>

          {loading && <div>Carregando...</div>}

          {!loading && users.length === 0 && (
            <div className="muted">Nenhum usuário encontrado</div>
          )}

          <div className="list">
            {users.map((u) => {
  const isSelf = currentUser?.id === u.id;

  const isPendingInvite =
    !u.is_active && !u.activated_at && Boolean(u.invite_expires_at);

  const canToggleActive = !isSelf && (u.is_active || !isPendingInvite);
  const canResendInvite = !isSelf && isPendingInvite;

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
) : isPendingInvite ? (
  <span className="badge badge--warning">Convite pendente</span>
) : (
  <span className="badge badge--default">Inativo</span>
)}
                  </div>

                  {isPendingInvite ? (
  <div className="muted" style={{ marginTop: 6 }}>
    Convite válido até: {formatarDataHora(u.invite_expires_at)}
  </div>
) : null}

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

                    {canToggleActive && (
  <button
    type="button"
    className="btn btn--ghost"
    onClick={() => toggleActive(u.id)}
  >
    {u.is_active ? "Desativar" : "Ativar"}
  </button>
)}

                    {canResendInvite && (
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
                          Ao reenviar, um novo link será gerado e exibido acima.
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

function formatarDataHora(valor) {
  if (!valor) return "Não informado";

  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return valor;

  return data.toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}