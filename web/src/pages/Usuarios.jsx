import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AppIcon } from "../components/AppIcon";
import { appIcons } from "../config/icons";
import { apiFetch } from "../api";
import "./Usuarios.css";

const STATUS_FILTERS = [
  { value: "all", label: "Todos os status" },
  { value: "active", label: "Ativos" },
  { value: "pending", label: "Convite pendente" },
  { value: "expired", label: "Convite expirado" },
  { value: "inactive", label: "Inativos" },
];

const ROLE_FILTERS = [
  { value: "all", label: "Todos os perfis" },
  { value: "admin", label: "Admin" },
  { value: "atendimento", label: "Atendimento" },
  { value: "tecnico", label: "Técnico" },
];

export default function Usuarios() {
  const [users, setUsers] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState("");

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("atendimento");

  const [inviteResult, setInviteResult] = useState(null);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [copiedUserId, setCopiedUserId] = useState(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  async function loadUsers() {
    try {
      setError("");
      setLoading(true);
      const data = await apiFetch("/users");
      setUsers(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err?.message || "Erro ao carregar usuários.");
    } finally {
      setLoading(false);
    }
  }

  async function loadCurrentUser() {
    try {
      const data = await apiFetch("/auth/me");
      setCurrentUser(data);
    } catch {
      try {
        const stored = JSON.parse(localStorage.getItem("user") || "null");
        setCurrentUser(stored);
      } catch {
        setCurrentUser(null);
      }
    }
  }

  useEffect(() => {
    loadUsers();
    loadCurrentUser();
  }, []);

  const stats = useMemo(() => {
    const total = users.length;
    const active = users.filter((user) => getUserState(user).statusKey === "active").length;
    const pending = users.filter((user) => getUserState(user).statusKey === "pending").length;
    const expired = users.filter((user) => getUserState(user).statusKey === "expired").length;
    const inactive = users.filter((user) => getUserState(user).statusKey === "inactive").length;

    return { total, active, pending, expired, inactive };
  }, [users]);

  const filteredUsers = useMemo(() => {
    const term = normalizeText(searchTerm);

    return users.filter((user) => {
      const state = getUserState(user);

      const matchesSearch =
        !term ||
        normalizeText(user.name).includes(term) ||
        normalizeText(user.email).includes(term) ||
        normalizeText(user.phone).includes(term);

      const matchesRole = roleFilter === "all" || user.role === roleFilter;
      const matchesStatus = statusFilter === "all" || state.statusKey === statusFilter;

      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [users, searchTerm, roleFilter, statusFilter]);

  async function handleInvite(event) {
    event.preventDefault();
    if (submitting) return;

    try {
      setSubmitting(true);
      setError("");
      setNotice("");
      setInviteResult(null);
      setCopiedInvite(false);

      const data = await apiFetch("/users/invite", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          role,
        }),
      });

      setInviteResult({ ...data, type: "created" });
      setNotice("Convite criado com sucesso. Envie o link para o usuário ativar a conta.");

      setName("");
      setEmail("");
      setPhone("");
      setRole("atendimento");

      await loadUsers();
    } catch (err) {
      setError(err?.message || "Erro ao convidar usuário.");
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

  async function copyInviteLink() {
    const ok = await copyText(inviteResult?.invite_link);

    if (!ok) {
      setError("Não foi possível copiar automaticamente. Selecione o link e copie manualmente.");
      return;
    }

    setCopiedInvite(true);
    setTimeout(() => setCopiedInvite(false), 2000);
  }

  async function changeRole(user) {
    const nextRole = user.role === "tecnico" ? "atendimento" : "tecnico";

    try {
      setBusyId(`role-${user.id}`);
      setError("");
      setNotice("");

      await apiFetch(`/users/${user.id}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role: nextRole }),
      });

      setNotice("Perfil atualizado com sucesso.");
      await loadUsers();
    } catch (err) {
      setError(err?.message || "Erro ao trocar perfil.");
    } finally {
      setBusyId("");
    }
  }

  async function toggleActive(user) {
    const state = getUserState(user);

    if (state.requiresInviteActivation) {
      setError("Usuário com convite pendente ou expirado deve ativar a conta pelo link. Reenvie o convite em vez de ativar manualmente.");
      return;
    }

    try {
      setBusyId(`active-${user.id}`);
      setError("");
      setNotice("");

      await apiFetch(`/users/${user.id}/toggle-active`, {
        method: "PATCH",
      });

      setNotice(user.is_active ? "Usuário desativado com sucesso." : "Usuário ativado com sucesso.");
      await loadUsers();
    } catch (err) {
      setError(err?.message || "Erro ao alterar status do usuário.");
    } finally {
      setBusyId("");
    }
  }

  async function resendInvite(user) {
    try {
      setBusyId(`resend-${user.id}`);
      setError("");
      setNotice("");
      setCopiedInvite(false);

      const data = await apiFetch(`/users/${user.id}/resend-invite`, {
        method: "POST",
      });

      setInviteResult({ ...data, type: "resent" });

      const copied = await copyText(data?.invite_link);
      if (copied) {
        setCopiedUserId(user.id);
        setCopiedInvite(true);
        setTimeout(() => setCopiedUserId(null), 2000);
        setTimeout(() => setCopiedInvite(false), 2000);
      }

      setNotice(copied ? "Convite reenviado e link copiado." : "Convite reenviado. O novo link está visível acima.");
      await loadUsers();
    } catch (err) {
      setError(err?.message || "Erro ao reenviar convite.");
    } finally {
      setBusyId("");
    }
  }

  function clearFilters() {
    setSearchTerm("");
    setRoleFilter("all");
    setStatusFilter("all");
  }

  return (
    <div className="usuarios-status-page">
      <aside className="usuarios-status-sidebar" aria-label="Menu principal">
        <div className="usuarios-status-brand">
          <div className="usuarios-status-logo">OS</div>
          <div>
            <strong>OS SaaS</strong>
            <span>Oficina mecânica</span>
          </div>
        </div>

        <nav className="usuarios-status-menu" aria-label="Navegação">
          <Link to="/dashboard">
            <AppIcon icon={appIcons.dashboard} size={19} />
            <span>Dashboard</span>
          </Link>

          <Link to="/os">
            <AppIcon icon={appIcons.os} size={19} />
            <span>OS</span>
          </Link>

          <Link to="/kanban">
            <AppIcon icon={appIcons.kanban} size={19} />
            <span>Quadro de OS</span>
          </Link>

          <Link to="/clientes">
            <AppIcon icon={appIcons.clientes} size={19} />
            <span>Clientes</span>
          </Link>

          <Link to="/usuarios" className="is-active">
            <AppIcon icon={appIcons.usuarios} size={19} />
            <span>Usuários</span>
          </Link>
        </nav>

        <div className="usuarios-status-sidebar-footer">
          <div className="usuarios-status-side-card">
            <AppIcon icon={appIcons.seguranca} size={18} />
            <div>
              <strong>Administração</strong>
              <span>Acessos e permissões</span>
            </div>
          </div>

          <div className="usuarios-status-side-card">
            <div className="usuarios-status-mini-avatar">{getInitials(currentUser?.name || "Você")}</div>
            <div>
              <strong>{currentUser?.name || "Usuário logado"}</strong>
              <span>{formatRoleLabel(currentUser?.role)}</span>
            </div>
          </div>
        </div>
      </aside>

      <main className="usuarios-status-main">
        <header className="usuarios-status-mobile-header">
          <div className="usuarios-status-brand">
            <div className="usuarios-status-logo">OS</div>
            <div>
              <strong>OS SaaS</strong>
              <span>Administração</span>
            </div>
          </div>

          <Link to="/dashboard" className="usuarios-status-mobile-dashboard">
            <AppIcon icon={appIcons.dashboard} size={18} />
            <span>Dashboard</span>
          </Link>

          <div>
            <h1>Usuários</h1>
            <p>Equipe, convites e permissões.</p>
          </div>
        </header>

        <div className="usuarios-status-container">
          <header className="usuarios-status-header">
            <div>
              <span>Administração</span>
              <h1>Usuários</h1>
              <p>Gerencie a equipe, convites e permissões da oficina.</p>
            </div>

            <div className="usuarios-status-header-actions">
              <Link to="/dashboard" className="usuarios-status-button is-light">
                <AppIcon icon={appIcons.dashboard} size={17} />
                Dashboard
              </Link>

              <a href="#usuarios-convite" className="usuarios-status-button is-primary">
                <AppIcon icon={appIcons.convidarUsuario} size={17} />
                Convidar usuário
              </a>
            </div>
          </header>

          {error ? (
            <div className="usuarios-status-alert is-error">
              <AppIcon icon={appIcons.alerta} size={18} />
              <span>Erro: {error}</span>
            </div>
          ) : null}

          {notice ? (
            <div className="usuarios-status-alert is-success">
              <AppIcon icon={appIcons.sucesso} size={18} />
              <span>{notice}</span>
            </div>
          ) : null}

          <section className="usuarios-status-stats" aria-label="Resumo dos usuários">
            <StatCard icon={<AppIcon icon={appIcons.usuarios} size={24} />} label="Total" value={stats.total} helper="Usuários cadastrados" active={statusFilter === "all"} onClick={() => setStatusFilter("all")} tone="blue" />
            <StatCard icon={<AppIcon icon={appIcons.usuarioAtivo} size={24} />} label="Ativos" value={stats.active} helper="Com acesso ativo" active={statusFilter === "active"} onClick={() => setStatusFilter("active")} tone="green" />
            <StatCard icon={<AppIcon icon={appIcons.info} size={24} />} label="Pendentes" value={stats.pending} helper="Convite válido" active={statusFilter === "pending"} onClick={() => setStatusFilter("pending")} tone="orange" />
            <StatCard icon={<AppIcon icon={appIcons.alerta} size={24} />} label="Expirados" value={stats.expired} helper="Precisa reenviar" active={statusFilter === "expired"} onClick={() => setStatusFilter("expired")} tone="red" />
            <StatCard icon={<AppIcon icon={appIcons.usuarioInativo} size={24} />} label="Inativos" value={stats.inactive} helper="Já ativados antes" active={statusFilter === "inactive"} onClick={() => setStatusFilter("inactive")} tone="gray" />
          </section>

          {inviteResult ? (
            <section className="usuarios-status-invite-result">
              <div>
                <strong>{inviteResult.type === "resent" ? "Convite reenviado" : "Convite criado"}</strong>
                <span>
                  {inviteResult.type === "resent"
                    ? "Um novo link foi gerado. Envie apenas o link mais recente."
                    : "Envie este link para o usuário ativar a conta."}
                </span>
              </div>

              <textarea readOnly value={inviteResult.invite_link || ""} rows={3} onFocus={(event) => event.target.select()} />

              <div className="usuarios-status-result-actions">
                <button type="button" className="usuarios-status-button is-light" onClick={copyInviteLink}>
                  <AppIcon icon={appIcons.copiar} size={16} />
                  {copiedInvite ? "Copiado!" : "Copiar link"}
                </button>

                {inviteResult.whatsapp_link ? (
                  <a href={inviteResult.whatsapp_link} target="_blank" rel="noreferrer" className="usuarios-status-button is-primary">
                    <AppIcon icon={appIcons.whatsapp} size={16} />
                    Abrir WhatsApp
                  </a>
                ) : null}
              </div>
            </section>
          ) : null}

          <section className="usuarios-status-workgrid">
            <form id="usuarios-convite" className="usuarios-status-panel" onSubmit={handleInvite}>
              <div className="usuarios-status-panel-title">
                <AppIcon icon={appIcons.convidarUsuario} size={20} />
                <strong>Convidar novo usuário</strong>
              </div>

              <div className="usuarios-status-form-grid">
                <label>
                  <span>Nome</span>
                  <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome completo" required />
                </label>

                <label>
                  <span>Email</span>
                  <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="email@exemplo.com" required />
                </label>

                <label>
                  <span>Telefone para WhatsApp (opcional)</span>
                  <div className="usuarios-status-input-icon">
                    <AppIcon icon={appIcons.telefone} size={17} />
                    <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Ex.: 44999887766" />
                  </div>
                </label>

                <label>
                  <span>Perfil</span>
                  <select value={role} onChange={(event) => setRole(event.target.value)}>
                    <option value="atendimento">Atendimento</option>
                    <option value="tecnico">Técnico</option>
                  </select>
                </label>
              </div>

              <div className="usuarios-status-role-help">
                <div>
                  <AppIcon icon={appIcons.seguranca} size={18} />
                  <strong>Admin</strong>
                  <span>Acesso total ao sistema.</span>
                </div>

                <div>
                  <AppIcon icon={appIcons.atendimento} size={18} />
                  <strong>Atendimento</strong>
                  <span>Cria clientes e acompanha OS.</span>
                </div>

                <div>
                  <AppIcon icon={appIcons.tecnico} size={18} />
                  <strong>Técnico</strong>
                  <span>Atualiza andamento das OS.</span>
                </div>
              </div>

              <button type="submit" disabled={submitting} className="usuarios-status-button is-primary is-full">
                <AppIcon icon={appIcons.enviar} size={17} />
                {submitting ? "Enviando..." : "Enviar convite"}
              </button>
            </form>

            <section className="usuarios-status-panel">
              <div className="usuarios-status-panel-title">
                <AppIcon icon={appIcons.filtrar} size={20} />
                <strong>Filtros</strong>
              </div>

              <div className="usuarios-status-filters">
                <label className="is-full">
                  <span>Buscar por nome, email ou telefone</span>
                  <div className="usuarios-status-input-icon">
                    <AppIcon icon={appIcons.pesquisar} size={17} />
                    <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Digite nome, email ou telefone" />
                  </div>
                </label>

                <label>
                  <span>Perfil</span>
                  <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
                    {ROLE_FILTERS.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                </label>

                <label>
                  <span>Status</span>
                  <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                    {STATUS_FILTERS.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                </label>

                <button type="button" className="usuarios-status-button is-primary">
                  <AppIcon icon={appIcons.filtrar} size={16} />
                  Aplicar filtros
                </button>

                <button type="button" className="usuarios-status-button is-light" onClick={clearFilters}>
                  <AppIcon icon={appIcons.resetar} size={16} />
                  Limpar
                </button>
              </div>

              <div className="usuarios-status-note">
                <AppIcon icon={appIcons.info} size={17} />
                <span>Convite pendente ou expirado não deve ser ativado manualmente. Use Reenviar convite.</span>
              </div>
            </section>
          </section>

          <section className="usuarios-status-list-panel">
            <div className="usuarios-status-list-head">
              <div>
                <div className="usuarios-status-panel-title">
                  <AppIcon icon={appIcons.usuarios} size={20} />
                  <strong>Usuários da empresa</strong>
                </div>
                <p>Mostrando {filteredUsers.length} de {users.length} usuários</p>
              </div>

              <button type="button" className="usuarios-status-button is-light" onClick={loadUsers}>
                <AppIcon icon={appIcons.atualizar} size={16} />
                Atualizar
              </button>
            </div>

            <div className="usuarios-status-chips">
              <button type="button" className={statusFilter === "all" ? "is-active" : ""} onClick={() => setStatusFilter("all")}>Todos <b>{stats.total}</b></button>
              <button type="button" className={statusFilter === "active" ? "is-active" : ""} onClick={() => setStatusFilter("active")}>Ativos <b>{stats.active}</b></button>
              <button type="button" className={statusFilter === "pending" ? "is-active" : ""} onClick={() => setStatusFilter("pending")}>Pendentes <b>{stats.pending}</b></button>
              <button type="button" className={statusFilter === "expired" ? "is-active is-danger" : ""} onClick={() => setStatusFilter("expired")}>Expirados <b>{stats.expired}</b></button>
              <button type="button" className={statusFilter === "inactive" ? "is-active" : ""} onClick={() => setStatusFilter("inactive")}>Inativos <b>{stats.inactive}</b></button>
            </div>

            {loading ? <div className="usuarios-status-empty">Carregando usuários...</div> : null}

            {!loading && filteredUsers.length === 0 ? (
              <div className="usuarios-status-empty">Nenhum usuário encontrado com os filtros atuais.</div>
            ) : null}

            {!loading && filteredUsers.length > 0 ? (
              <>
                <div className="usuarios-status-desktop-list">
                  <div className="usuarios-status-table-head">
                    <span>Usuário</span>
                    <span>Email</span>
                    <span>Telefone</span>
                    <span>Perfil</span>
                    <span>Status</span>
                    <span>Acesso / convite</span>
                    <span>Ações</span>
                  </div>

                  {filteredUsers.map((user) => (
                    <UserDesktopRow
                      key={user.id}
                      user={user}
                      currentUser={currentUser}
                      copiedUserId={copiedUserId}
                      busyId={busyId}
                      onChangeRole={changeRole}
                      onToggleActive={toggleActive}
                      onResendInvite={resendInvite}
                    />
                  ))}
                </div>

                <div className="usuarios-status-mobile-list">
                  {filteredUsers.map((user) => (
                    <UserMobileCard
                      key={user.id}
                      user={user}
                      currentUser={currentUser}
                      copiedUserId={copiedUserId}
                      busyId={busyId}
                      onChangeRole={changeRole}
                      onToggleActive={toggleActive}
                      onResendInvite={resendInvite}
                    />
                  ))}
                </div>
              </>
            ) : null}
          </section>
        </div>

        <nav className="usuarios-status-bottom-nav" aria-label="Navegação mobile">
          <Link to="/dashboard">
            <AppIcon icon={appIcons.dashboard} size={21} />
            <span>Dashboard</span>
          </Link>

          <Link to="/os">
            <AppIcon icon={appIcons.os} size={21} />
            <span>OS</span>
          </Link>

          <Link to="/clientes">
            <AppIcon icon={appIcons.clientes} size={21} />
            <span>Clientes</span>
          </Link>

          <Link to="/usuarios" className="is-active">
            <AppIcon icon={appIcons.usuarios} size={21} />
            <span>Usuários</span>
          </Link>
        </nav>
      </main>
    </div>
  );
}

function StatCard({ icon, label, value, helper, active, onClick, tone }) {
  return (
    <button type="button" className={`usuarios-status-stat is-${tone} ${active ? "is-selected" : ""}`} onClick={onClick}>
      <span>{icon}</span>
      <div>
        <strong>{label}</strong>
        <b>{value}</b>
        <small>{helper}</small>
      </div>
    </button>
  );
}

function UserDesktopRow({ user, currentUser, copiedUserId, busyId, onChangeRole, onToggleActive, onResendInvite }) {
  const state = getUserState(user);
  const isSelf = currentUser?.id === user.id;

  return (
    <article className="usuarios-status-row">
      <UserIdentity user={user} isSelf={isSelf} />

      <div className="usuarios-status-cell is-email">{user.email || "-"}</div>

      <div className="usuarios-status-cell">
        <PhoneValue phone={user.phone} />
      </div>

      <Badge className={getRoleBadgeClass(user.role)}>{formatRoleLabel(user.role)}</Badge>
      <Badge className={state.statusClass}>{state.statusLabel}</Badge>

      <AccessPill user={user} state={state} />

      <UserActions
        user={user}
        isSelf={isSelf}
        state={state}
        copiedUserId={copiedUserId}
        busyId={busyId}
        onChangeRole={onChangeRole}
        onToggleActive={onToggleActive}
        onResendInvite={onResendInvite}
      />
    </article>
  );
}

function UserMobileCard({ user, currentUser, copiedUserId, busyId, onChangeRole, onToggleActive, onResendInvite }) {
  const state = getUserState(user);
  const isSelf = currentUser?.id === user.id;

  return (
    <article className="usuarios-status-mobile-card">
      <div className="usuarios-status-mobile-top">
        <UserIdentity user={user} isSelf={isSelf} />
      </div>

      <div className="usuarios-status-mobile-line">
        <AppIcon icon={appIcons.email} size={15} />
        <span>{user.email || "-"}</span>
      </div>

      <div className="usuarios-status-mobile-meta">
        <PhoneValue phone={user.phone} />
        <Badge className={getRoleBadgeClass(user.role)}>{formatRoleLabel(user.role)}</Badge>
        <Badge className={state.statusClass}>{state.statusLabel}</Badge>
      </div>

      <AccessPill user={user} state={state} mobile />

      <UserActions
        user={user}
        isSelf={isSelf}
        state={state}
        copiedUserId={copiedUserId}
        busyId={busyId}
        onChangeRole={onChangeRole}
        onToggleActive={onToggleActive}
        onResendInvite={onResendInvite}
        mobile
      />
    </article>
  );
}

function UserIdentity({ user, isSelf }) {
  return (
    <div className="usuarios-status-identity">
      <div className={`usuarios-status-avatar ${getUserState(user).avatarClass}`}>{getInitials(user.name || user.email)}</div>
      <div>
        <strong>
          {user.name || "Sem nome"}
          {isSelf ? <span>Você</span> : null}
        </strong>
        <small>{isSelf ? "Este é seu usuário administrador." : "Usuário da oficina"}</small>
      </div>
    </div>
  );
}

function UserActions({ user, isSelf, state, copiedUserId, busyId, onChangeRole, onToggleActive, onResendInvite, mobile = false }) {
  const canChangeRole = !isSelf && user.role !== "admin";
  const canActivateOrDeactivate = !isSelf && !state.requiresInviteActivation;
  const canResendInvite = !isSelf && state.requiresInviteActivation;

  if (isSelf) {
    return <div className="usuarios-status-self-note">Não pode ser alterado</div>;
  }

  return (
    <div className={`usuarios-status-actions ${mobile ? "is-mobile" : ""}`}>
      {canChangeRole ? (
        <button type="button" onClick={() => onChangeRole(user)} disabled={busyId === `role-${user.id}`}>
          Perfil
        </button>
      ) : null}

      {canActivateOrDeactivate ? (
        <button type="button" onClick={() => onToggleActive(user)} disabled={busyId === `active-${user.id}`}>
          {user.is_active ? "Desativar" : "Ativar"}
        </button>
      ) : null}

      {canResendInvite ? (
        <button type="button" className="is-primary" onClick={() => onResendInvite(user)} disabled={busyId === `resend-${user.id}`}>
          {copiedUserId === user.id ? "Copiado" : "Reenviar convite"}
        </button>
      ) : null}
    </div>
  );
}

function PhoneValue({ phone }) {
  if (!phone) return <span className="usuarios-status-muted">Sem telefone</span>;

  return (
    <a className="usuarios-status-whatsapp" href={buildWhatsappProfileLink(phone)} target="_blank" rel="noreferrer">
      <AppIcon icon={appIcons.whatsapp} size={15} />
      <span>{formatPhone(phone)}</span>
    </a>
  );
}

function Badge({ className, children }) {
  return <span className={`usuarios-status-badge ${className}`}>{children}</span>;
}

function AccessPill({ user, state, mobile = false }) {
  return (
    <div className={`usuarios-status-access ${state.accessClass} ${mobile ? "is-mobile" : ""}`}>
      {state.requiresInviteActivation ? <AppIcon icon={appIcons.alerta} size={15} /> : user?.is_active ? <AppIcon icon={appIcons.sucesso} size={15} /> : <AppIcon icon={appIcons.usuarioInativo} size={15} />}
      <span>{getAccessText(user, state)}</span>
    </div>
  );
}

function requiresInviteActivation(user) {
  return !user?.is_active && !user?.activated_at && Boolean(user?.invite_expires_at);
}

function isExpiredInvite(user) {
  if (!requiresInviteActivation(user)) return false;

  const expiresAt = new Date(user.invite_expires_at);
  if (Number.isNaN(expiresAt.getTime())) return false;

  return expiresAt.getTime() < Date.now();
}

function getUserState(user) {
  const needsInvite = requiresInviteActivation(user);
  const expired = isExpiredInvite(user);

  if (user?.is_active) {
    return {
      statusKey: "active",
      requiresInviteActivation: false,
      statusLabel: "Ativo",
      statusClass: "is-success",
      accessClass: "is-access-ok",
      avatarClass: "is-active",
    };
  }

  if (needsInvite && expired) {
    return {
      statusKey: "expired",
      requiresInviteActivation: true,
      statusLabel: "Convite expirado",
      statusClass: "is-danger",
      accessClass: "is-access-danger",
      avatarClass: "is-pending",
    };
  }

  if (needsInvite) {
    return {
      statusKey: "pending",
      requiresInviteActivation: true,
      statusLabel: "Convite pendente",
      statusClass: "is-warning",
      accessClass: "is-access-warning",
      avatarClass: "is-pending",
    };
  }

  return {
    statusKey: "inactive",
    requiresInviteActivation: false,
    statusLabel: "Inativo",
    statusClass: "is-gray",
    accessClass: "is-access-muted",
    avatarClass: "is-inactive",
  };
}

function getAccessText(user, state) {
  const lastAccess = user?.last_login_at || user?.last_access_at || user?.last_seen_at || user?.ultimo_acesso;

  if (lastAccess) return `Último acesso em ${formatarDataHora(lastAccess)}`;

  if (state.statusKey === "expired") {
    return `Convite expirou em ${formatarDataHora(user.invite_expires_at)}`;
  }

  if (state.statusKey === "pending") {
    return `Convite válido até ${formatarDataHora(user.invite_expires_at)}`;
  }

  if (user?.activated_at) return `Ativado em ${formatarDataHora(user.activated_at)}`;
  if (user?.is_active) return "Acesso ativo";

  return "Sem acesso registrado";
}

function formatRoleLabel(role) {
  if (role === "admin") return "Admin";
  if (role === "atendimento") return "Atendimento";
  if (role === "tecnico") return "Técnico";
  if (role === "member") return "Perfil antigo";
  return role || "-";
}

function getRoleBadgeClass(role) {
  if (role === "admin") return "is-info";
  if (role === "atendimento") return "is-success";
  if (role === "tecnico") return "is-purple";
  if (role === "member") return "is-gray";
  return "is-gray";
}

function formatarDataHora(value) {
  if (!value) return "Não informado";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getInitials(value) {
  const words = String(value || "").trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) return "U";

  const first = words[0]?.[0] || "";
  const second = words.length > 1 ? words[1]?.[0] || "" : words[0]?.[1] || "";

  return `${first}${second}`.toUpperCase();
}

function formatPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");

  if (!digits) return "";

  const normalized = digits.startsWith("55") && digits.length > 11 ? digits.slice(2) : digits;

  if (normalized.length === 11) {
    return `(${normalized.slice(0, 2)}) ${normalized.slice(2, 7)}-${normalized.slice(7)}`;
  }

  if (normalized.length === 10) {
    return `(${normalized.slice(0, 2)}) ${normalized.slice(2, 6)}-${normalized.slice(6)}`;
  }

  return value;
}

function buildWhatsappProfileLink(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "#";

  const normalized = digits.startsWith("55") ? digits : `55${digits}`;
  return `https://wa.me/${normalized}`;
}
