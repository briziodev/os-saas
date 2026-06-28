import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch, clearToken, getUser } from "../api";
import { AppIcon } from "../components/AppIcon";
import { appIcons } from "../config/icons";
import "./Kanban.css";

const INITIAL_VISIBLE_PER_COLUMN = 4;


const KANBAN_ICON_MAP = {
  dashboard: appIcons.dashboard,
  clipboard: appIcons.os,
  kanban: appIcons.kanban,
  users: appIcons.clientes,
  userCog: appIcons.usuarios,
  plus: appIcons.adicionar,
  refresh: appIcons.atualizar,
  bell: appIcons.alertas,
  search: appIcons.pesquisar,
  filter: appIcons.filtrar,
  close: appIcons.fechar,
  more: appIcons.visualizar,
  arrowUpRight: appIcons.visualizar,
  logout: appIcons.sair,
  triage: appIcons.triagem,
  analysis: appIcons.emAnalise,
  clock: appIcons.aguardandoAprovacao,
  check: appIcons.sucesso,
  approved: appIcons.aprovado,
  vehicleReady: appIcons.veiculo,
  closed: appIcons.encerrado,
  wrench: appIcons.emExecucao,
  package: appIcons.aguardandoPeca,
  square: appIcons.kanban,
};

function Icon({ name, className = "" }) {
  return (
    <AppIcon
      icon={KANBAN_ICON_MAP[name] || appIcons.kanban}
      className={`kanban-premium-iconify-icon ${className}`.trim()}
      size={20}
    />
  );
}
const COLUMNS = [
  { key: "triagem", title: "Triagem", icon: "triage", tone: "gray" },
  { key: "em_analise", title: "Em análise", icon: "analysis", tone: "blue" },
  { key: "aguardando_aprovacao", title: "Aguardando aprovação", shortTitle: "Aguard. aprovação", icon: "clock", tone: "orange" },
  { key: "aprovado", title: "Aprovado", icon: "approved", tone: "cyan" },
  { key: "em_execucao", title: "Em execução", icon: "wrench", tone: "purple" },
  { key: "aguardando_peca", title: "Aguardando peça", icon: "package", tone: "brown" },
  { key: "pronto_retirada", title: "Pronto para retirada", icon: "vehicleReady", tone: "teal" },
  { key: "encerrado", title: "Encerrado", pluralTitle: "Encerradas", icon: "closed", tone: "green" },
  { key: "cancelado", title: "Cancelado", pluralTitle: "Canceladas", icon: "close", tone: "red" },
];

const STATUS_LABEL = Object.fromEntries(COLUMNS.map((column) => [column.key, column.title]));
const STATUS_KEYS = COLUMNS.map((column) => column.key);
const ACTIVE_STATUS_KEYS = STATUS_KEYS.filter((key) => !["encerrado", "cancelado"].includes(key));

function normalizeStatus(status) {
  if (status === "finalizado") return "encerrado";
  if (status === "orcamento_enviado") return "aguardando_aprovacao";
  return status || "triagem";
}

function money(value) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function statusLabel(status) {
  const normalized = normalizeStatus(status);
  return STATUS_LABEL[normalized] || status || "-";
}

function statusBadgeClass(status) {
  const normalized = normalizeStatus(status);

  if (normalized === "encerrado") return "kanban-premium-badge is-success";
  if (normalized === "cancelado") return "kanban-premium-badge is-danger";
  if (normalized === "aguardando_aprovacao" || normalized === "aguardando_peca") {
    return "kanban-premium-badge is-warning";
  }
  if (normalized === "aprovado" || normalized === "em_execucao" || normalized === "pronto_retirada") {
    return "kanban-premium-badge is-info";
  }

  return "kanban-premium-badge is-gray";
}

function getOrderTimestamp(os) {
  const raw = os?.updated_at || os?.created_at || 0;
  const timestamp = new Date(raw).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getCreatedTimestamp(os) {
  const raw = os?.created_at || os?.updated_at || 0;
  const timestamp = new Date(raw).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sortOSList(list) {
  return [...list].sort((a, b) => {
    const timeDiff = getOrderTimestamp(b) - getOrderTimestamp(a);
    if (timeDiff !== 0) return timeDiff;
    return Number(b?.id || 0) - Number(a?.id || 0);
  });
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function isSameDay(dateA, dateB) {
  return (
    dateA.getFullYear() === dateB.getFullYear() &&
    dateA.getMonth() === dateB.getMonth() &&
    dateA.getDate() === dateB.getDate()
  );
}

function isInPeriod(os, period) {
  const normalizedStatus = normalizeStatus(os?.status);

  if (period === "active") {
    return !["encerrado", "cancelado"].includes(normalizedStatus);
  }

  if (period === "all") return true;

  const timestamp = getCreatedTimestamp(os);
  if (!timestamp) return false;

  const date = new Date(timestamp);
  const now = new Date();

  if (period === "today") return isSameDay(date, now);

  if (period === "7d") {
    const start = new Date(now);
    start.setDate(now.getDate() - 7);
    start.setHours(0, 0, 0, 0);
    return timestamp >= start.getTime();
  }

  if (period === "month") {
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  }

  return true;
}

function daysSinceLastUpdate(os) {
  const timestamp = getOrderTimestamp(os);
  if (!timestamp) return null;

  const diff = Date.now() - timestamp;
  if (diff < 0) return 0;

  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function roleLabel(role) {
  if (role === "admin") return "Administrador";
  if (role === "atendimento") return "Atendimento";
  if (role === "tecnico") return "Técnico";
  return role || "Usuário";
}

function initials(nameOrEmail) {
  const clean = String(nameOrEmail || "U").trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return clean.slice(0, 2).toUpperCase();
}

function getUserName(user) {
  return user?.name || user?.nome || user?.email || "Usuário";
}

function MenuLinks({ role, onNavigate }) {
  const isTecnico = role === "tecnico";
  const isAdmin = role === "admin";
  const canAccessDashboard = !isTecnico;
  const canAccessClients = role === "admin" || role === "atendimento";

  return (
    <>
      {canAccessDashboard ? (
        <Link to="/dashboard" className="kanban-premium-menu-item" onClick={onNavigate}>
          <span><Icon name="dashboard" /></span>
          Dashboard
        </Link>
      ) : null}

      <Link to="/os" className="kanban-premium-menu-item" onClick={onNavigate}>
        <span><Icon name="clipboard" /></span>
        OS
      </Link>

      <Link to="/kanban" className="kanban-premium-menu-item is-active" onClick={onNavigate}>
        <span><Icon name="kanban" /></span>
        Quadro de OS
      </Link>

      {canAccessClients ? (
        <Link to="/clientes" className="kanban-premium-menu-item" onClick={onNavigate}>
          <span><Icon name="users" /></span>
          Clientes
        </Link>
      ) : null}

      {isAdmin ? (
        <Link to="/usuarios" className="kanban-premium-menu-item" onClick={onNavigate}>
          <span><Icon name="userCog" /></span>
          Usuários
        </Link>
      ) : null}
    </>
  );
}

export default function Kanban() {
  const token = useMemo(() => localStorage.getItem("token"), []);
  const [osList, setOsList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgType, setMsgType] = useState("success");
  const [expandedColumns, setExpandedColumns] = useState({});
  const [openActionId, setOpenActionId] = useState(null);
  const [draftStatusById, setDraftStatusById] = useState({});
  const [searchTerm, setSearchTerm] = useState("");
  const [period, setPeriod] = useState("active");
  const [stageFilter, setStageFilter] = useState("all");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);

  const user = getUser();
  const userRole = user?.role;
  const isTecnico = userRole === "tecnico";
  const isAdmin = userRole === "admin";
  const canViewMoney = !isTecnico;
  const canCreateOS = !isTecnico;
  const canAccessDashboard = !isTecnico;
  const canAccessClients = userRole === "admin" || userRole === "atendimento";
  const displayName = getUserName(user);

  async function loadOS({ silent = false } = {}) {
    if (!silent) {
      setLoading(true);
      setMsg("");
    }

    setRefreshing(true);

    try {
      const data = await apiFetch("/os");
      const lista = Array.isArray(data) ? data : [];
      setOsList(sortOSList(lista));

      if (silent) {
        setMsgType("success");
        setMsg("Quadro atualizado com sucesso.");
      }
    } catch (e) {
      if (e.message === "Sessão expirada. Faça login novamente.") {
        clearToken();
        window.location.href = "/login";
        return;
      }

      setMsgType("error");
      setMsg(e.message || "Erro ao carregar quadro.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadOS();
  }, []);

  async function moverStatus(id, novoStatus) {
    try {
      setMsg("");

      await apiFetch(`/os/${id}`, {
        method: "PUT",
        body: JSON.stringify({ status: novoStatus }),
      });

      setOsList((prev) =>
        sortOSList(
          prev.map((os) =>
            os.id === id
              ? {
                  ...os,
                  status: novoStatus,
                  updated_at: new Date().toISOString(),
                }
              : os
          )
        )
      );

      setOpenActionId(null);
      setMsgType("success");
      setMsg(`OS #${id} movida para ${statusLabel(novoStatus)}.`);
    } catch (e) {
      if (e.message === "Sessão expirada. Faça login novamente.") {
        clearToken();
        window.location.href = "/login";
        return;
      }

      setMsgType("error");
      setMsg(e.message || "Erro ao atualizar status.");
    }
  }

  function logout() {
    clearToken();
    window.location.href = "/login";
  }

  function toggleColumn(columnKey) {
    setExpandedColumns((prev) => ({
      ...prev,
      [columnKey]: !prev[columnKey],
    }));
  }

  function openActionsForOS(os) {
    const normalizedStatus = normalizeStatus(os.status);

    setOpenActionId((currentId) => (currentId === os.id ? null : os.id));
    setDraftStatusById((prev) => ({
      ...prev,
      [os.id]: prev[os.id] || normalizedStatus,
    }));
  }

  function clearFilters() {
    setSearchTerm("");
    setPeriod("active");
    setStageFilter("all");
  }

  const filteredOS = useMemo(() => {
    const query = normalizeText(searchTerm);

    return osList.filter((os) => {
      const normalizedStatus = normalizeStatus(os.status);

      if (stageFilter !== "all" && normalizedStatus !== stageFilter) return false;
      if (!isInPeriod(os, period)) return false;

      if (!query) return true;

      const searchable = normalizeText(
        [os.id, os.cliente_nome, os.modelo, os.placa, os.status].filter(Boolean).join(" ")
      );

      return searchable.includes(query);
    });
  }, [osList, period, searchTerm, stageFilter]);

  const byStatus = useMemo(() => {
    const grouped = Object.fromEntries(STATUS_KEYS.map((key) => [key, []]));

    for (const os of filteredOS) {
      const normalizedStatus = normalizeStatus(os.status);
      if (!grouped[normalizedStatus]) grouped[normalizedStatus] = [];
      grouped[normalizedStatus].push(os);
    }

    for (const key of Object.keys(grouped)) {
      grouped[key] = sortOSList(grouped[key]);
    }

    return grouped;
  }, [filteredOS]);

  const metrics = useMemo(() => {
    const countByStatus = Object.fromEntries(STATUS_KEYS.map((key) => [key, 0]));
    let stuck = 0;

    for (const os of filteredOS) {
      const normalizedStatus = normalizeStatus(os.status);
      if (countByStatus[normalizedStatus] !== undefined) countByStatus[normalizedStatus] += 1;

      const days = daysSinceLastUpdate(os);
      if (
        days !== null &&
        days >= 3 &&
        normalizedStatus !== "encerrado" &&
        normalizedStatus !== "cancelado"
      ) {
        stuck += 1;
      }
    }

    return {
      total: filteredOS.length,
      stuck,
      countByStatus,
    };
  }, [filteredOS]);

  const attentionOSIds = useMemo(() => {
    const ids = new Set();

    for (const os of filteredOS) {
      const normalizedStatus = normalizeStatus(os.status);
      const staleDays = daysSinceLastUpdate(os);
      const isStale =
        staleDays !== null &&
        staleDays >= 3 &&
        normalizedStatus !== "encerrado" &&
        normalizedStatus !== "cancelado";

      if (
        normalizedStatus === "aguardando_aprovacao" ||
        normalizedStatus === "aguardando_peca" ||
        isStale
      ) {
        ids.add(os.id);
      }
    }

    return ids;
  }, [filteredOS]);

  const approvalAlerts = metrics.countByStatus.aguardando_aprovacao;
  const partsAlerts = metrics.countByStatus.aguardando_peca;
  const stuckAlerts = metrics.stuck;
  const notificationCount = attentionOSIds.size;
  const filtersActive = searchTerm || period !== "active" || stageFilter !== "all";
  const isAllHistoryMode = period === "all";

  const columnsToRender = useMemo(() => {
    if (stageFilter !== "all") {
      return COLUMNS.filter((column) => column.key === stageFilter);
    }

    if (period === "active") {
      return COLUMNS.filter((column) => ACTIVE_STATUS_KEYS.includes(column.key));
    }

    return COLUMNS;
  }, [period, stageFilter]);

  const summaryCards = [
    { label: "Total de OS", value: metrics.total, icon: "clipboard", tone: "blue" },
    { label: "Em análise", value: metrics.countByStatus.em_analise, icon: "analysis", tone: "blue" },
    {
      label: "Aguard. aprovação",
      value: metrics.countByStatus.aguardando_aprovacao,
      icon: "clock",
      tone: "orange",
    },
    { label: "Em execução", value: metrics.countByStatus.em_execucao, icon: "wrench", tone: "purple" },
    period === "active"
      ? { label: "Aguard. peça", value: metrics.countByStatus.aguardando_peca, icon: "package", tone: "orange" }
      : { label: "Encerradas", value: metrics.countByStatus.encerrado, icon: "closed", tone: "green" },
  ];

  if (!token) {
    return (
      <div className="kanban-premium-state-page">
        <div className="kanban-premium-state-card is-error">
          Sessão não encontrada. Faça login novamente.
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="kanban-premium-state-page">
        <div className="kanban-premium-state-card">Carregando quadro de OS...</div>
      </div>
    );
  }

  return (
    <div className="kanban-premium-page">
      <aside className="kanban-premium-sidebar" aria-label="Menu principal">
        <div className="kanban-premium-brand">
          <div className="kanban-premium-logo">OP</div>
          <div>
            <strong>OficinaPro</strong>
            <span>Gestão de oficina</span>
          </div>
        </div>

        <nav className="kanban-premium-menu">
          <MenuLinks role={userRole} />
        </nav>

        <div className="kanban-premium-sidebar-footer">
          <div className="kanban-premium-user-card">
            <div className="kanban-premium-user-avatar">{initials(displayName)}</div>
            <div>
              <strong>{displayName}</strong>
              <span>{roleLabel(userRole)}</span>
            </div>
          </div>

          <button className="kanban-premium-logout" type="button" onClick={logout}>
            <Icon name="logout" /> Sair
          </button>
        </div>
      </aside>

      <main className="kanban-premium-main">
        <header className="kanban-premium-mobile-header">
          <button
            type="button"
            className="kanban-premium-icon-btn"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Abrir menu"
          >
            <Icon name="kanban" />
          </button>

          <strong>Quadro de OS</strong>

          <div className="kanban-premium-mobile-notification-wrap">
            <button
              type="button"
              className="kanban-premium-mobile-bell"
              onClick={() => setNotificationOpen((value) => !value)}
              aria-label="Alertas operacionais"
            >
              <Icon name="bell" />
              {notificationCount > 0 ? <span>{notificationCount}</span> : null}
            </button>

            {notificationOpen ? (
              <div className="kanban-premium-notification-panel is-mobile">
                <strong>Atenção operacional</strong>
                <p>
                  {notificationCount > 0
                    ? `${notificationCount} OS ${notificationCount === 1 ? "precisa" : "precisam"} de acompanhamento agora.`
                    : "Nenhuma OS crítica no quadro filtrado."}
                </p>

                {notificationCount > 0 ? (
                  <ul className="kanban-premium-notification-list">
                    {approvalAlerts > 0 ? (
                      <li>
                        {approvalAlerts} OS aguardando aprovação do cliente.
                      </li>
                    ) : null}

                    {partsAlerts > 0 ? (
                      <li>
                        {partsAlerts} OS aguardando peça.
                      </li>
                    ) : null}

                    {stuckAlerts > 0 ? (
                      <li>
                        {stuckAlerts} OS parada há 3 dias ou mais.
                      </li>
                    ) : null}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
        </header>

        {mobileMenuOpen ? (
          <div className="kanban-premium-mobile-menu-overlay">
            <button
              type="button"
              aria-label="Fechar menu"
              className="kanban-premium-mobile-menu-backdrop"
              onClick={() => setMobileMenuOpen(false)}
            />

            <div className="kanban-premium-mobile-menu">
              <div className="kanban-premium-mobile-menu-head">
                <div className="kanban-premium-brand is-mobile-menu">
                  <div className="kanban-premium-logo">OP</div>
                  <div>
                    <strong>OficinaPro</strong>
                    <span>Gestão de oficina</span>
                  </div>
                </div>

                <button
                  type="button"
                  className="kanban-premium-mobile-menu-close"
                  onClick={() => setMobileMenuOpen(false)}
                  aria-label="Fechar menu"
                >
                  <Icon name="close" />
                </button>
              </div>

              <nav className="kanban-premium-mobile-menu-links">
                <MenuLinks role={userRole} onNavigate={() => setMobileMenuOpen(false)} />
              </nav>

              <div className="kanban-premium-mobile-menu-user">
                <div className="kanban-premium-user-avatar">{initials(displayName)}</div>
                <div>
                  <strong>{displayName}</strong>
                  <span>{roleLabel(userRole)}</span>
                </div>
              </div>

              <button className="kanban-premium-mobile-menu-logout" type="button" onClick={logout}>
                Sair
              </button>
            </div>
          </div>
        ) : null}

        <div className="kanban-premium-container">
          <div className="kanban-premium-page-head">
            <div>
              <h1>Quadro de OS</h1>
              <p>Acompanhe as ordens por etapa e atualize o andamento da oficina.</p>
              <span>Total no quadro: {metrics.total} OS</span>
            </div>

            <div className="kanban-premium-head-actions">
              <Link to="/os" className="kanban-premium-secondary-action">
                <Icon name="clipboard" /> Lista de OS
              </Link>

              <button
                type="button"
                className="kanban-premium-secondary-action"
                onClick={() => loadOS({ silent: true })}
                disabled={refreshing}
              >
                <Icon name="refresh" /> {refreshing ? "Atualizando..." : "Atualizar"}
              </button>

              {canCreateOS ? (
                <Link to="/os/new" className="kanban-premium-primary-action">
                  <span><Icon name="plus" /></span> Nova OS
                </Link>
              ) : null}
            </div>
          </div>

          <div className="kanban-premium-mobile-actions">
            <Link to="/os" className="kanban-premium-secondary-action is-main">
              <Icon name="clipboard" /> Lista de OS
            </Link>

            {canCreateOS ? (
              <Link to="/os/new" className="kanban-premium-primary-action">
                <span><Icon name="plus" /></span> Nova OS
              </Link>
            ) : null}

            <button
              type="button"
              className="kanban-premium-secondary-action is-dark"
              onClick={() => loadOS({ silent: true })}
              disabled={refreshing}
            >
              <Icon name="refresh" /> {refreshing ? "Atualizando..." : "Atualizar"}
            </button>
          </div>

          {msg ? (
            <div className={`kanban-premium-alert ${msgType === "error" ? "is-error" : "is-success"}`}>
              {msg}
            </div>
          ) : null}

          <section className="kanban-premium-filter-card" aria-label="Filtros do quadro">
            <label className="kanban-premium-search-field">
              <span>Buscar</span>
              <div className="kanban-premium-search-input">
                <b><Icon name="search" /></b>
                <input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar por cliente, placa ou número da OS..."
                />
              </div>
            </label>

            <label className="kanban-premium-field">
              <span>Período</span>
              <select value={period} onChange={(e) => setPeriod(e.target.value)}>
                <option value="active">OS ativas</option>
                <option value="month">Mês atual</option>
                <option value="today">Hoje</option>
                <option value="7d">Últimos 7 dias</option>
                <option value="all">Todo o histórico</option>
              </select>
            </label>

            <label className="kanban-premium-field">
              <span>Etapa</span>
              <select
                value={stageFilter}
                onChange={(e) => {
                  const nextStage = e.target.value;
                  setStageFilter(nextStage);

                  if (period === "active" && ["encerrado", "cancelado"].includes(nextStage)) {
                    setPeriod("all");
                  }
                }}
              >
                <option value="all">Filtrar por etapa</option>
                {COLUMNS.map((column) => (
                  <option key={column.key} value={column.key}>
                    {column.title}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              className="kanban-premium-clear-action"
              onClick={clearFilters}
              disabled={!filtersActive}
            >
              <Icon name="close" /> Limpar filtros
            </button>
          </section>

          {isAllHistoryMode ? (
            <div className="kanban-premium-history-warning" role="note">
              <strong>Você está vendo todo o histórico de OS.</strong>
              <span>Para encontrar uma OS antiga, prefira a Lista de OS com busca por cliente, placa ou número. O Kanban é melhor para operação atual.</span>
            </div>
          ) : (
            <div className="kanban-premium-operation-hint" role="note">
              Quadro em modo operacional: mostrando OS ativas. Encerradas e canceladas ficam fora do padrão para manter a tela limpa.
            </div>
          )}

          <section className="kanban-premium-summary-grid" aria-label="Resumo do quadro">
            {summaryCards.map((card) => (
              <button
                key={card.label}
                type="button"
                className={`kanban-premium-summary-card is-${card.tone}`}
                onClick={() => {
                  if (card.label === "Total de OS") {
                    setStageFilter("all");
                    return;
                  }

                  const target = COLUMNS.find(
                    (column) => column.title === card.label || column.shortTitle === card.label || column.pluralTitle === card.label
                  );
                  if (target) {
                    setStageFilter(target.key);

                    if (period === "active" && ["encerrado", "cancelado"].includes(target.key)) {
                      setPeriod("all");
                    }
                  }
                }}
              >
                <span><Icon name={card.icon} /></span>
                <div>
                  <strong>{card.label}</strong>
                  <b>{card.value}</b>
                </div>
              </button>
            ))}
          </section>

          <section className="kanban-premium-section-head">
            <div>
              <h2>Etapas da oficina</h2>
              <p>Visualize as ordens por etapa e atualize o status de cada OS.</p>
            </div>
          </section>

          <section className="kanban-premium-board" aria-label="Quadro operacional de OS">
            {columnsToRender.map((column) => {
              const allCards = byStatus[column.key] || [];
              const isExpanded = Boolean(expandedColumns[column.key]);
              const visibleCards = isExpanded
                ? allCards
                : allCards.slice(0, INITIAL_VISIBLE_PER_COLUMN);
              const hiddenCount = Math.max(allCards.length - INITIAL_VISIBLE_PER_COLUMN, 0);

              return (
                <article key={column.key} className="kanban-premium-column">
                  <div className={`kanban-premium-column-head is-${column.tone}`}>
                    <div>
                      <span><Icon name={column.icon} /></span>
                      <strong>{column.title}</strong>
                    </div>
                    <b>{allCards.length}</b>
                  </div>

                  <div className="kanban-premium-column-body">
                    {allCards.length === 0 ? (
                      <div className="kanban-premium-empty">Nenhuma ordem nesta etapa.</div>
                    ) : (
                      <>
                        <div className="kanban-premium-card-list">
                          {visibleCards.map((os) => {
                            const normalizedStatus = normalizeStatus(os.status);
                            const selectedStatus = draftStatusById[os.id] || normalizedStatus;
                            const staleDays = daysSinceLastUpdate(os);
                            const isStale =
                              staleDays !== null &&
                              staleDays >= 3 &&
                              normalizedStatus !== "encerrado" &&
                              normalizedStatus !== "cancelado";

                            return (
                              <div key={os.id} className="kanban-premium-os-card">
                                <div className="kanban-premium-os-card-top">
                                  <Link to={`/os/${os.id}`} className="kanban-premium-os-id">
                                    OS #{os.id}
                                  </Link>

                                  <span className={statusBadgeClass(normalizedStatus)}>
                                    {statusLabel(normalizedStatus)}
                                  </span>
                                </div>

                                <strong className="kanban-premium-client">
                                  {os.cliente_nome || "Cliente não informado"}
                                </strong>

                                <div className="kanban-premium-vehicle">
                                  <span>{os.modelo || "Modelo não informado"}</span>
                                  <i>•</i>
                                  <span>{os.placa || "Placa não informada"}</span>
                                </div>

                                {canViewMoney ? (
                                  <div className="kanban-premium-money">{money(os.valor_total)}</div>
                                ) : null}

                                {isStale ? (
                                  <div className="kanban-premium-stale-warning">
                                    Parada há {staleDays} dia{staleDays === 1 ? "" : "s"}
                                  </div>
                                ) : null}

                                <div className="kanban-premium-card-footer">
                                  <Link to={`/os/${os.id}`} className="kanban-premium-open-link">
                                    Abrir detalhes <Icon name="arrowUpRight" />
                                  </Link>

                                  <button
                                    type="button"
                                    className="kanban-premium-more-btn"
                                    onClick={() => openActionsForOS(os)}
                                    aria-label={`Ações da OS ${os.id}`}
                                  >
                                    <Icon name="more" />
                                  </button>
                                </div>

                                {openActionId === os.id ? (
                                  <div className="kanban-premium-actions-panel">
                                    <label>
                                      <span>Mover para etapa</span>
                                      <select
                                        value={selectedStatus}
                                        onChange={(e) =>
                                          setDraftStatusById((prev) => ({
                                            ...prev,
                                            [os.id]: e.target.value,
                                          }))
                                        }
                                      >
                                        {COLUMNS.map((item) => (
                                          <option key={item.key} value={item.key}>
                                            {item.title}
                                          </option>
                                        ))}
                                      </select>
                                    </label>

                                    <button
                                      type="button"
                                      onClick={() => moverStatus(os.id, selectedStatus)}
                                      disabled={selectedStatus === normalizedStatus}
                                    >
                                      Atualizar etapa
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>

                        {allCards.length > INITIAL_VISIBLE_PER_COLUMN ? (
                          <button
                            type="button"
                            className="kanban-premium-column-toggle"
                            onClick={() => toggleColumn(column.key)}
                          >
                            {isExpanded ? "Mostrar menos" : `Ver mais ${hiddenCount} OS`}
                          </button>
                        ) : null}
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </section>
        </div>
      </main>

      <nav className="kanban-premium-bottom-nav" aria-label="Navegação inferior">
        {canAccessDashboard ? (
          <Link to="/dashboard">
            <span><Icon name="dashboard" /></span>
            Dashboard
          </Link>
        ) : null}

        <Link to="/os">
          <span><Icon name="clipboard" /></span>
          OS
        </Link>

        {canCreateOS ? (
          <Link to="/os/new" className="kanban-premium-bottom-plus" aria-label="Nova OS">
            <Icon name="plus" />
          </Link>
        ) : null}

        {canAccessClients ? (
          <Link to="/clientes">
            <span><Icon name="users" /></span>
            Clientes
          </Link>
        ) : null}

        <button type="button" onClick={() => setMobileMenuOpen(true)}>
          <span><Icon name="more" /></span>
          Mais
        </button>
      </nav>
    </div>
  );
}
