import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { apiFetch, clearToken, getUser } from "../api";
import { AppIcon } from "../components/AppIcon";
import { appIcons } from "../config/icons";
import "./Dashboard.css";

const STATUS_LABEL = {
  triagem: "Triagem",
  em_analise: "Em análise",
  aguardando_aprovacao: "Aguardando aprovação",
  aprovado: "Aprovado",
  em_execucao: "Em execução",
  aguardando_peca: "Aguardando peça",
  pronto_retirada: "Pronto retirada",
  encerrado: "Encerrado",
  cancelado: "Cancelado",
  orcamento_enviado: "Orçamento enviado",
  finalizado: "Finalizado",
};

const PERIOD_OPTIONS = [
  { value: "today", label: "Hoje" },
  { value: "7d", label: "Últimos 7 dias" },
  { value: "month", label: "Mês atual" },
  { value: "all", label: "Todo o período" },
  { value: "custom", label: "Personalizado" },
];

const PENDING_BUDGETS_URL = "/os?period=all&status=aguardando_aprovacao";


const NOTIFICATION_FALLBACK_ITEMS = [
  {
    key: "aguardando_aprovacao",
    title: "Orçamentos aguardando aprovação",
    description: "Clientes precisam aprovar orçamento.",
    count: 0,
    severity: "warning",
    href: PENDING_BUDGETS_URL,
  },
];

function normalizeNotifications(notifications, pendingBudgets) {
  if (notifications?.items?.length) {
    const items = notifications.items
      .map((item) => ({ ...item, count: Number(item.count || 0) }))
      .filter((item) => item.count > 0);

    return {
      total: Number(notifications.total ?? items.reduce((sum, item) => sum + item.count, 0)),
      items,
    };
  }

  const total = Number(pendingBudgets || 0);

  return {
    total,
    items: total > 0
      ? NOTIFICATION_FALLBACK_ITEMS.map((item) => ({ ...item, count: total }))
      : [],
  };
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [agoraSP, setAgoraSP] = useState(formatSaoPauloNow());
  const [period, setPeriod] = useState("month");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [isFinancialVisible, setIsFinancialVisible] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 1280
  );

  const user = getUser();
  const isAdmin = user?.role === "admin";
  const isAtendimento = user?.role === "atendimento";
  const canAccessDashboard = isAdmin || isAtendimento;

  useEffect(() => {
    const timer = setInterval(() => {
      setAgoraSP(formatSaoPauloNow());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setIsNotificationOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    function handleResize() {
      setViewportWidth(window.innerWidth);
    }

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!canAccessDashboard) return;

    loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccessDashboard]);

  async function loadDashboard(
    nextPeriod = period,
    nextStart = startDate,
    nextEnd = endDate
  ) {
    try {
      setLoading(true);
      setError("");

      const params = new URLSearchParams();
      params.set("period", nextPeriod);

      if (nextPeriod === "custom") {
        if (!nextStart || !nextEnd) {
          setError(
            "Informe a data inicial e a data final para aplicar o período personalizado."
          );
          setLoading(false);
          return;
        }

        if (nextStart > nextEnd) {
          setError("A data inicial não pode ser maior que a data final.");
          setLoading(false);
          return;
        }

        params.set("start_date", nextStart);
        params.set("end_date", nextEnd);
      }

      const body = await apiFetch(`/dashboard?${params.toString()}`);
      setData(body);
    } catch (e) {
      if (e.message === "Sessão expirada. Faça login novamente.") {
        clearToken();
        window.location.href = "/login";
        return;
      }

      setError(e.message || "Erro ao carregar dashboard.");
    } finally {
      setLoading(false);
    }
  }

  function applyFilters() {
    loadDashboard(period, startDate, endDate);
  }

  function logout() {
    clearToken();
    window.location.href = "/login";
  }
  function toggleNotifications() {
    setIsNotificationOpen((current) => !current);
  }

  if (!canAccessDashboard) {
    return <Navigate to="/os" replace />;
  }

  if (loading) {
    return <DashboardState message="Carregando dashboard..." />;
  }

  if (!data) {
    return <DashboardState message="Sem dados para exibir." />;
  }

  const { cards, ultimas_os, period: periodInfo } = data;
  const canShowFinancials = isAdmin;
  const pendingBudgets = Number(cards?.orcamentos_pendentes ?? 0);
  const notifications = normalizeNotifications(data?.notifications, pendingBudgets);
  const notificationTotal = notifications.total;
  const pendingBudgetsUrl = buildPeriodStatusUrl(periodInfo, "aguardando_aprovacao");
  const allOrdersUrl = buildPeriodUrl(periodInfo);
  const inProgressOrdersUrl = buildPeriodStatusUrl(periodInfo, "em_execucao");
  const finishedOrdersUrl = buildPeriodStatusUrl(periodInfo, "encerrado");
  const isMobileViewport = viewportWidth <= 768;

  return (
    <div className="dashboard-premium-page">

      <main className="dashboard-premium-main">

        <div className="dashboard-premium-container">
          {!isMobileViewport ? (
            <TopHeader
              period={period}
              setPeriod={setPeriod}
              startDate={startDate}
              setStartDate={setStartDate}
              endDate={endDate}
              setEndDate={setEndDate}
              onApply={applyFilters}
              notificationTotal={notificationTotal}
              notifications={notifications}
              isNotificationOpen={isNotificationOpen}
              onToggleNotifications={toggleNotifications}
            />
          ) : null}

          {error ? (
            <div className="dashboard-premium-alert-error">Erro: {error}</div>
          ) : null}

          {isMobileViewport ? (
            <section className="dashboard-mobile-actions dashboard-mobile-actions--only-mobile" aria-label="Ações rápidas">
              <MobileNotificationSummary
                notificationTotal={notificationTotal}
                notifications={notifications}
                isNotificationOpen={isNotificationOpen}
                onToggleNotifications={toggleNotifications}
              />

              <PeriodControls
                period={period}
                setPeriod={setPeriod}
                startDate={startDate}
                setStartDate={setStartDate}
                endDate={endDate}
                setEndDate={setEndDate}
                onApply={applyFilters}
                compact
              />

              <Link to="/os/new" className="dashboard-premium-new-os">
                <span aria-hidden="true">+</span>
                Nova OS
              </Link>
            </section>
          ) : null}

          <section className="dashboard-premium-kpi-grid" aria-label="Indicadores do dashboard">
            <MainMetricCard
              cards={cards}
              periodLabel={periodInfo?.label || "-"}
              canShowFinancials={canShowFinancials}
              isFinancialVisible={isFinancialVisible}
              onToggleFinancialVisibility={() =>
                setIsFinancialVisible((current) => !current)
              }
            />

            <SmallMetricCard
              icon={appIcons.osAbertas}
              title="OS abertas"
              value={cards?.abertas_periodo ?? 0}
              hint="Serviços registrados no período"
              tone="blue"
              to={allOrdersUrl}
              ariaLabel="Ver OS abertas do período na lista de OS"
            />

            <SmallMetricCard
              icon={appIcons.osAndamento}
              title="Em andamento"
              value={cards?.em_andamento ?? 0}
              hint="OS ainda em execução"
              tone="blue"
              to={inProgressOrdersUrl}
              ariaLabel="Ver OS em andamento na lista de OS"
            />

            <SmallMetricCard
              icon={appIcons.orcamentosPendentes}
              title="Orçamentos pendentes"
              value={cards?.orcamentos_pendentes ?? 0}
              hint="Aguardando aprovação"
              tone="orange"
              to={pendingBudgetsUrl}
              ariaLabel="Ver orçamentos pendentes na lista de OS"
            />

            <SmallMetricCard
              icon={appIcons.finalizados}
              title="Finalizadas"
              value={cards?.finalizados_no_periodo ?? 0}
              hint="Concluídas no período"
              tone="green"
              to={finishedOrdersUrl}
              ariaLabel="Ver OS finalizadas na lista de OS"
            />
          </section>

          {pendingBudgets > 0 ? (
            <PendingBudgetsAlert total={pendingBudgets} url={pendingBudgetsUrl} />
          ) : null}

          <section className="dashboard-premium-os-section">
            <div className="dashboard-premium-section-head">
              <div>
                <h2>Últimas OS do período</h2>
                <p>As ordens mais recentes dentro do filtro selecionado.</p>
              </div>

              <Link to="/os" className="dashboard-premium-link">
                Ver todas as OS
              </Link>
            </div>

            {ultimas_os?.length === 0 ? (
              <div className="dashboard-premium-empty">
                <strong>Nenhuma OS encontrada para este período.</strong>
                <span>Altere o filtro ou crie uma nova ordem de serviço.</span>
                <Link to="/os/new" className="dashboard-premium-empty-action">
                  Criar nova OS
                </Link>
              </div>
            ) : (
              <OrdersPreview
                orders={ultimas_os}
                canShowFinancials={canShowFinancials}
              />
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function DashboardState({ message }) {
  return (
    <div className="dashboard-premium-page dashboard-premium-state-page">
      <div className="dashboard-premium-state-card">{message}</div>
    </div>
  );
}

function DesktopSidebar({ user, isAdmin, onLogout }) {
  return (
    <aside className="dashboard-premium-sidebar" aria-label="Menu principal">
      <div className="dashboard-premium-brand">
        <div className="dashboard-premium-logo">OP</div>
        <div>
          <strong>OficinaPro</strong>
          <span>Gestão de oficina</span>
        </div>
      </div>

      <nav className="dashboard-premium-menu">
        <SidebarLink to="/dashboard" icon={appIcons.dashboard} label="Dashboard" active />
        <SidebarLink to="/os" icon={appIcons.os} label="OS" />
        <SidebarLink to="/kanban" icon={appIcons.kanban} label="Quadro de OS" />
        <SidebarLink to="/clientes" icon={appIcons.clientes} label="Clientes" />
        {isAdmin ? <SidebarLink to="/usuarios" icon={appIcons.usuarios} label="Usuários" /> : null}
      </nav>

      <div className="dashboard-premium-sidebar-footer">
        <div className="dashboard-premium-user-card">
          <div className="dashboard-premium-user-avatar">
            {(user?.name || user?.email || "U").slice(0, 1).toUpperCase()}
          </div>
          <div>
            <strong>{user?.name || "Usuário"}</strong>
            <span>{roleLabel(user?.role)}</span>
          </div>
        </div>

        <button type="button" onClick={onLogout} className="dashboard-premium-logout">
          Sair
        </button>
      </div>
    </aside>
  );
}

function SidebarLink({ to, icon, label, active = false }) {
  return (
    <Link
      to={to}
      className={`dashboard-premium-menu-item ${active ? "is-active" : ""}`}
    >
      <AppIcon icon={icon} size={18} />
      {label}
    </Link>
  );
}

function TopHeader({
  period,
  setPeriod,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  onApply,
  notificationTotal,
  notifications,
  isNotificationOpen,
  onToggleNotifications,
}) {
  return (
    <header className="dashboard-premium-header">
      <div>
        <h1>Dashboard</h1>
        <p>Visão geral da operação da oficina</p>
      </div>

      <div className="dashboard-premium-header-actions">
        <PeriodControls
          period={period}
          setPeriod={setPeriod}
          startDate={startDate}
          setStartDate={setStartDate}
          endDate={endDate}
          setEndDate={setEndDate}
          onApply={onApply}
        />

        <div className="dashboard-premium-notification-wrap">
          <button
            type="button"
            className="dashboard-premium-notification"
            title="Ações necessárias"
            aria-label={`${notificationTotal} ações necessárias`}
            aria-expanded={isNotificationOpen}
            onClick={onToggleNotifications}
          >
            <AppIcon icon={appIcons.alertas} size={18} />
            {notificationTotal > 0 ? <span>{notificationTotal}</span> : null}
          </button>

          {isNotificationOpen ? (
            <NotificationPanel notifications={notifications} />
          ) : null}
        </div>

        <Link to="/os/new" className="dashboard-premium-new-os">
          <span aria-hidden="true">+</span>
          Nova OS
        </Link>
      </div>
    </header>
  );
}

function MobileHeader({
  notificationTotal,
  notifications,
  isNotificationOpen,
  onToggleMenu,
  onToggleNotifications,
}) {
  return (
    <header className="dashboard-premium-mobile-header">
      <button
        type="button"
        aria-label="Abrir menu"
        className="dashboard-premium-icon-btn"
        onClick={onToggleMenu}
      >
        ☰
      </button>
      <strong>Dashboard</strong>
      <div className="dashboard-premium-mobile-notification-wrap">
        <button
          type="button"
          aria-label={`${notificationTotal} ações necessárias`}
          aria-expanded={isNotificationOpen}
          className="dashboard-premium-mobile-bell"
          onClick={onToggleNotifications}
        >
          <i className="dashboard-premium-bell-icon" aria-hidden="true">
            <AppIcon icon={appIcons.alertas} size={18} />
          </i>
          {notificationTotal > 0 ? <span className="dashboard-premium-bell-badge">{notificationTotal}</span> : null}
        </button>

        {isNotificationOpen ? (
          <NotificationPanel notifications={notifications} mobile />
        ) : null}
      </div>
    </header>
  );
}

function NotificationPanel({ notifications, mobile = false }) {
  const items = notifications?.items || [];
  const total = Number(notifications?.total || 0);
  const hasItems = items.length > 0;

  return (
    <div
      className={`dashboard-premium-notification-panel ${
        mobile ? "dashboard-premium-notification-panel--mobile" : ""
      }`}
      role="dialog"
      aria-label="Central de ações necessárias"
    >
      <strong>{hasItems ? "Ações necessárias" : "Tudo certo por aqui"}</strong>
      <p>
        {hasItems
          ? `${total} OS exigem atenção operacional.`
          : "Nenhuma ação pendente no período selecionado."}
      </p>

      {hasItems ? (
        <div className="dashboard-premium-notification-list">
          {items.map((item) => (
            <Link
              key={item.key}
              to={item.href || "/os"}
              className={`dashboard-premium-notification-item is-${item.severity || "info"}`}
            >
              <span className="dashboard-premium-notification-item-icon" aria-hidden="true">
                <AppIcon icon={notificationIcon(item.key)} size={18} />
              </span>
              <span className="dashboard-premium-notification-item-body">
                <strong>{item.title}</strong>
                <small>{item.description}</small>
              </span>
              <span className="dashboard-premium-notification-count">{item.count}</span>
            </Link>
          ))}
        </div>
      ) : null}

      <Link
        to={hasItems ? "/os?period=all" : "/os"}
        className="dashboard-premium-notification-action"
      >
        {hasItems ? "Ver todas as OS" : "Abrir lista de OS"}
      </Link>
    </div>
  );
}

function MobileNotificationSummary({
  notificationTotal,
  notifications,
  isNotificationOpen,
  onToggleNotifications,
}) {
  return (
    <div className="dashboard-mobile-notification-wrap">
      <button
        type="button"
        className="dashboard-mobile-notification-card"
        aria-label={`${notificationTotal} ações necessárias`}
        aria-expanded={isNotificationOpen}
        onClick={onToggleNotifications}
      >
        <span className="dashboard-mobile-notification-icon" aria-hidden="true">
          <AppIcon icon={appIcons.alertas} size={18} />
          {notificationTotal > 0 ? <em>{notificationTotal}</em> : null}
        </span>
        <span>
          <strong>{notificationTotal} ação{notificationTotal === 1 ? "" : "ões"} necessária{notificationTotal === 1 ? "" : "s"}</strong>
          <small>Toque no sino para filtrar OS que exigem atenção.</small>
        </span>
      </button>

      {isNotificationOpen ? (
        <NotificationPanel notifications={notifications} mobile />
      ) : null}
    </div>
  );
}

function notificationIcon(key) {
  if (key === "aguardando_aprovacao" || key === "orcamento_enviado") return appIcons.orcamentosPendentes;
  if (key === "aguardando_peca") return appIcons.aguardandoPeca;
  if (key === "pronto_retirada") return appIcons.prontoRetirada;
  if (key === "em_execucao") return appIcons.emExecucao;
  if (key === "em_analise") return appIcons.emAnalise;
  if (key === "aprovado") return appIcons.aprovado;
  return appIcons.alertas;
}

function MobileMenuOverlay({ isOpen, user, isAdmin, onClose, onLogout }) {
  if (!isOpen) return null;

  return (
    <div className="dashboard-premium-mobile-menu-overlay" role="presentation">
      <button
        type="button"
        className="dashboard-premium-mobile-menu-backdrop"
        aria-label="Fechar menu"
        onClick={onClose}
      />

      <aside className="dashboard-premium-mobile-menu" aria-label="Menu mobile">
        <div className="dashboard-premium-mobile-menu-head">
          <div className="dashboard-premium-brand">
            <div className="dashboard-premium-logo">OP</div>
            <div>
              <strong>OficinaPro</strong>
              <span>Gestão de oficina</span>
            </div>
          </div>

          <button
            type="button"
            className="dashboard-premium-mobile-menu-close"
            aria-label="Fechar menu"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <nav className="dashboard-premium-mobile-menu-links">
          <MobileMenuLink to="/dashboard" label="Dashboard" icon={appIcons.dashboard} active onClose={onClose} />
          <MobileMenuLink to="/os" label="OS" icon={appIcons.os} onClose={onClose} />
          <MobileMenuLink to="/kanban" label="Quadro de OS" icon={appIcons.kanban} onClose={onClose} />
          <MobileMenuLink to="/clientes" label="Clientes" icon={appIcons.clientes} onClose={onClose} />
          {isAdmin ? (
            <MobileMenuLink to="/usuarios" label="Usuários" icon={appIcons.usuarios} onClose={onClose} />
          ) : null}
        </nav>

        <div className="dashboard-premium-mobile-menu-user">
          <div className="dashboard-premium-user-avatar">
            {(user?.name || user?.email || "U").slice(0, 1).toUpperCase()}
          </div>
          <div>
            <strong>{user?.name || "Usuário"}</strong>
            <span>{roleLabel(user?.role)}</span>
          </div>
        </div>

        <button
          type="button"
          onClick={onLogout}
          className="dashboard-premium-mobile-menu-logout"
        >
          Sair
        </button>
      </aside>
    </div>
  );
}

function MobileMenuLink({ to, label, icon, active = false, onClose }) {
  return (
    <Link
      to={to}
      onClick={onClose}
      className={`dashboard-premium-mobile-menu-link ${active ? "is-active" : ""}`}
    >
      <AppIcon icon={icon} size={18} />
      {label}
    </Link>
  );
}

function PeriodControls({
  period,
  setPeriod,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  onApply,
  compact = false,
}) {
  return (
    <div className={`dashboard-premium-period ${compact ? "is-compact" : ""}`}>
      <div className="dashboard-premium-period-select">
        <AppIcon icon={appIcons.calendario} size={18} />
        <select value={period} onChange={(e) => setPeriod(e.target.value)}>
          {PERIOD_OPTIONS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      {period === "custom" ? (
        <div className="dashboard-premium-custom-dates">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            aria-label="Data inicial"
          />
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            aria-label="Data final"
          />
        </div>
      ) : null}

      <button type="button" onClick={onApply} className="dashboard-premium-apply">
        Aplicar
      </button>
    </div>
  );
}

function MainMetricCard({
  cards,
  periodLabel,
  canShowFinancials,
  isFinancialVisible = false,
  onToggleFinancialVisibility = () => {},
}) {
  if (!canShowFinancials) {
    return (
      <article className="dashboard-premium-main-card dashboard-premium-main-card--operation">
        <div className="dashboard-premium-main-card-top">
          <span>Resumo operacional</span>
          <span className="dashboard-premium-main-card-info">{periodLabel}</span>
        </div>
        <strong>{cards?.abertas_periodo ?? 0}</strong>
        <p>OS abertas no período selecionado.</p>
        <div className="dashboard-premium-main-card-foot">
          <span>{cards?.orcamentos_pendentes ?? 0} orçamentos pendentes</span>
        </div>
      </article>
    );
  }

  return (
    <article className="dashboard-premium-main-card">
      <div className="dashboard-premium-main-card-top">
        <span>Faturamento do período</span>
        <button
          type="button"
          className="dashboard-premium-money-toggle"
          onClick={onToggleFinancialVisibility}
          aria-label={
            isFinancialVisible
              ? "Ocultar faturamento do período"
              : "Mostrar faturamento do período"
          }
          title={isFinancialVisible ? "Ocultar faturamento" : "Mostrar faturamento"}
        >
          {isFinancialVisible ? <AppIcon icon={appIcons.esconder} size={18} /> : <AppIcon icon={appIcons.visualizar} size={18} />}
        </button>
      </div>
      <strong className={isFinancialVisible ? "" : "is-hidden-money"}>
        {isFinancialVisible ? money(cards?.faturamento_periodo ?? 0) : "R$ •••••"}
      </strong>
      <span className="dashboard-premium-revenue-period">
        Referente a: {periodLabel}
      </span>
      <p>Somente OS encerradas/finalizadas no período.</p>
      <div className="dashboard-premium-main-card-foot">
        <span>Período: {periodLabel}</span>
        <span>Baseado em OS fechadas</span>
      </div>
      <div className="dashboard-premium-chart-line" aria-hidden="true" />
    </article>
  );
}

function SmallMetricCard({ icon, title, value, hint, tone, to, ariaLabel }) {
  const content = (
    <>
      <div className="dashboard-premium-small-icon" aria-hidden="true">
        <AppIcon icon={icon} size={22} />
      </div>
      <div>
        <span>{title}</span>
        <strong>{value}</strong>
        <p>{hint}</p>
      </div>
    </>
  );

  const className = `dashboard-premium-small-card dashboard-premium-small-card--${tone}${
    to ? " dashboard-premium-small-card--link" : ""
  }`;

  if (to) {
    return (
      <Link to={to} className={className} aria-label={ariaLabel || `Ver ${title}`}>
        {content}
      </Link>
    );
  }

  return <article className={className}>{content}</article>;
}

function PendingBudgetsAlert({ total, url = PENDING_BUDGETS_URL }) {
  const plural = total === 1 ? "orçamento pendente" : "orçamentos pendentes";

  return (
    <section className="dashboard-premium-warning-card">
      <div className="dashboard-premium-warning-icon" aria-hidden="true">
        ⚠
      </div>
      <div>
        <strong>
          {total} {plural} aguardando aprovação
        </strong>
        <p>Revise e aprove para manter o fluxo da oficina acelerado.</p>
      </div>
      <Link to={url} className="dashboard-premium-warning-action">
        Ver orçamentos
      </Link>
    </section>
  );
}

function OrdersPreview({ orders, canShowFinancials }) {
  return (
    <div className="dashboard-premium-orders-card">
      <div
        className={`dashboard-premium-orders-table ${
          canShowFinancials ? "" : "dashboard-premium-orders-table--no-money"
        }`}
      >
        <div className="dashboard-premium-orders-head">
          <span>OS</span>
          <span>Cliente</span>
          <span>Veículo / Placa</span>
          <span>Data de criação</span>
          {canShowFinancials ? <span>Valor total</span> : null}
          <span>Status</span>
          <span>Ações</span>
        </div>

        {orders.map((os) => (
          <OrderDesktopRow
            key={os.id}
            os={os}
            canShowFinancials={canShowFinancials}
          />
        ))}
      </div>

      <div className="dashboard-premium-orders-mobile-list">
        {orders.map((os) => (
          <OrderMobileCard
            key={os.id}
            os={os}
            canShowFinancials={canShowFinancials}
          />
        ))}
      </div>
    </div>
  );
}

function OrderDesktopRow({ os, canShowFinancials }) {
  return (
    <div
      className={`dashboard-premium-order-row dashboard-premium-order-row--${statusToneName(
        os.status
      )}`}
    >
      <Link to={`/os/${os.id}`} className="dashboard-premium-order-id">
        #{os.id}
      </Link>
      <div>
        <strong>{os.cliente_nome || "-"}</strong>
      </div>
      <div>{vehicleLabel(os)}</div>
      <div>{formatDateBR(os.created_at)}</div>
      {canShowFinancials ? <div>{money(os.valor_total)}</div> : null}
      <div>
        <span className={`badge badge--status ${statusBadgeClass(os.status)}`}>
          {statusLabel(os.status)}
        </span>
      </div>
      <Link to={`/os/${os.id}`} className="dashboard-premium-row-action">
        Ver
      </Link>
    </div>
  );
}

function OrderMobileCard({ os, canShowFinancials }) {
  return (
    <article
      className={`dashboard-premium-order-mobile dashboard-premium-order-mobile--${statusToneName(
        os.status
      )}`}
    >
      <div className="dashboard-premium-order-mobile-top">
        <Link to={`/os/${os.id}`}>#{os.id}</Link>
        <span className={`badge badge--status ${statusBadgeClass(os.status)}`}>
          {statusLabel(os.status)}
        </span>
      </div>
      <strong>{os.cliente_nome || "-"}</strong>
      <span>{vehicleLabel(os)}</span>
      <div className="dashboard-premium-order-mobile-bottom">
        <span>{formatDateBR(os.created_at)}</span>
        {canShowFinancials ? <strong>{money(os.valor_total)}</strong> : null}
      </div>
    </article>
  );
}



function MobileBottomNav({ isAdmin, onLogout }) {
  return (
    <nav className="dashboard-premium-bottom-nav" aria-label="Navegação mobile">
      <Link to="/dashboard" className="is-active">
        <span aria-hidden="true">▦</span>
        Dashboard
      </Link>
      <Link to="/os">
        <span aria-hidden="true">▤</span>
        OS
      </Link>
      <Link to="/os/new" className="dashboard-premium-bottom-plus" aria-label="Nova OS">
        +
      </Link>
      <Link to="/clientes">
        <span aria-hidden="true">◎</span>
        Clientes
      </Link>
      {isAdmin ? (
        <Link to="/usuarios">
          <span aria-hidden="true">◌</span>
          Usuários
        </Link>
      ) : (
        <button type="button" onClick={onLogout}>
          <span aria-hidden="true">⇥</span>
          Sair
        </button>
      )}
    </nav>
  );
}

function statusLabel(status) {
  return STATUS_LABEL[status] || status || "-";
}

function statusBadgeClass(status) {
  if (status === "encerrado" || status === "finalizado") return "badge--success";
  if (status === "cancelado") return "badge--danger";

  if (status === "aguardando_aprovacao" || status === "orcamento_enviado") {
    return "badge--warning";
  }

  if (
    status === "aprovado" ||
    status === "em_execucao" ||
    status === "aguardando_peca" ||
    status === "pronto_retirada"
  ) {
    return "badge--info";
  }

  return "badge--gray";
}

function statusToneName(status) {
  if (status === "encerrado" || status === "finalizado") return "success";
  if (status === "cancelado") return "danger";
  if (status === "aguardando_aprovacao" || status === "orcamento_enviado") return "warning";

  if (
    status === "aprovado" ||
    status === "em_execucao" ||
    status === "aguardando_peca" ||
    status === "pronto_retirada"
  ) {
    return "info";
  }

  return "gray";
}

function vehicleLabel(os) {
  const modelo = os.modelo || "-";
  const placa = os.placa || "-";
  return `${modelo} • ${placa}`;
}

function roleLabel(role) {
  if (role === "admin") return "Administrador";
  if (role === "atendimento") return "Atendimento";
  if (role === "tecnico") return "Técnico";
  return "Usuário";
}


function buildPeriodUrl(periodInfo) {
  const params = new URLSearchParams();
  params.set("period", periodInfo?.key || "all");

  if (periodInfo?.key === "custom") {
    if (periodInfo.start_date) params.set("start_date", periodInfo.start_date);
    if (periodInfo.end_date) params.set("end_date", periodInfo.end_date);
  }

  return `/os?${params.toString()}`;
}

function buildPeriodStatusUrl(periodInfo, status) {
  const params = new URLSearchParams();
  params.set("period", periodInfo?.key || "all");
  params.set("status", status);

  if (periodInfo?.key === "custom") {
    if (periodInfo.start_date) params.set("start_date", periodInfo.start_date);
    if (periodInfo.end_date) params.set("end_date", periodInfo.end_date);
  }

  return `/os?${params.toString()}`;
}

function money(value) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function formatDateBR(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSaoPauloNow() {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
}
