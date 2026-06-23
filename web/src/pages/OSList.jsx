import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AppIcon } from "../components/AppIcon";
import { appIcons } from "../config/icons";
import { apiFetch, clearToken, getUser } from "../api";
import "./OSList.css";

const STATUS = [
  "triagem",
  "em_analise",
  "aguardando_aprovacao",
  "aprovado",
  "em_execucao",
  "aguardando_peca",
  "pronto_retirada",
  "encerrado",
  "cancelado",
];

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
  em_andamento: "Em andamento",
};

const PERIOD_OPTIONS = [
  { value: "all", label: "Todo o período" },
  { value: "today", label: "Hoje" },
  { value: "7d", label: "Últimos 7 dias" },
  { value: "month", label: "Mês atual" },
  { value: "custom", label: "Personalizado" },
];

const QUICK_FILTERS = [
  { key: "todos", label: "Todas", status: "todos" },
  { key: "em_andamento", label: "Em andamento", status: "em_andamento" },
  { key: "aguardando_aprovacao", label: "Pendentes", status: "aguardando_aprovacao" },
  { key: "encerrado", label: "Finalizadas", status: "encerrado" },
];

export default function OSList() {
  const token = useMemo(() => localStorage.getItem("token"), []);
  const [searchParams, setSearchParams] = useSearchParams();
  const searchParamString = searchParams.toString();

  const user = getUser();
  const role = user?.role;
  const isAdmin = role === "admin";
  const isTecnico = role === "tecnico";
  const canCreateOS = !isTecnico;
  const canAccessDashboard = !isTecnico;
  const canAccessClientes = !isTecnico;
  const canAccessUsuarios = isAdmin;
  const canSeeMoney = !isTecnico;

  const [osList, setOsList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [statusFiltro, setStatusFiltro] = useState(() => getInitialStatus(searchParams));
  const [period, setPeriod] = useState(() => getInitialPeriod(searchParams));
  const [startDate, setStartDate] = useState(() => searchParams.get("start_date") || "");
  const [endDate, setEndDate] = useState(() => searchParams.get("end_date") || "");
  const [searchText, setSearchText] = useState("");
  const [detalhesAbertos, setDetalhesAbertos] = useState({});
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notificationStats, setNotificationStats] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(searchParamString);

    loadOS({
      nextPeriod: getInitialPeriod(params),
      nextStart: params.get("start_date") || "",
      nextEnd: params.get("end_date") || "",
      nextStatus: getInitialStatus(params),
      syncState: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParamString]);

  useEffect(() => {
    if (!mobileMenuOpen) return;

    function onKeyDown(event) {
      if (event.key === "Escape") setMobileMenuOpen(false);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (period === "custom") {
      setFiltersOpen(true);
    }
  }, [period]);

  async function loadOS({
    nextPeriod = period,
    nextStart = startDate,
    nextEnd = endDate,
    nextStatus = statusFiltro,
    syncState = false,
  } = {}) {
    setLoading(true);
    setMsg("");

    try {
      const params = new URLSearchParams();
      params.set("period", nextPeriod);

      if (nextStatus && nextStatus !== "todos") {
        params.set("status", nextStatus);
      }

      if (nextPeriod === "custom") {
        if (!nextStart || !nextEnd) {
          setMsg("Informe data inicial e final para o período personalizado.");
          setLoading(false);
          return;
        }

        params.set("start_date", nextStart);
        params.set("end_date", nextEnd);
      }

      // Evita 304 sem corpo em desenvolvimento e garante que a lista de OS sempre receba payload novo.
      params.set("_ts", String(Date.now()));

      const data = await apiFetch(`/os?${params.toString()}`);
      const lista = Array.isArray(data) ? data : [];

      const ordenada = [...lista].sort((a, b) => {
        const idA = Number(a.id || 0);
        const idB = Number(b.id || 0);
        return idB - idA;
      });

      setOsList(ordenada);

      let sourceForNotifications = ordenada;

      if (nextStatus && nextStatus !== "todos") {
        try {
          const notificationParams = new URLSearchParams();
          notificationParams.set("period", nextPeriod);

          if (nextPeriod === "custom") {
            if (nextStart) notificationParams.set("start_date", nextStart);
            if (nextEnd) notificationParams.set("end_date", nextEnd);
          }

          notificationParams.set("_ts", String(Date.now()));

          const notificationData = await apiFetch(`/os?${notificationParams.toString()}`);
          sourceForNotifications = Array.isArray(notificationData) ? notificationData : ordenada;
        } catch {
          sourceForNotifications = ordenada;
        }
      }

      setNotificationStats(buildNotificationStats(sourceForNotifications));

      if (syncState) {
        setPeriod(nextPeriod);
        setStatusFiltro(nextStatus);
        setStartDate(nextStart);
        setEndDate(nextEnd);
      }
    } catch (e) {
      if (e.message === "Sessão expirada. Faça login novamente.") {
        clearToken();
        window.location.href = "/login";
        return;
      }
      setMsg(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function mudarStatus(id, novoStatus) {
    setMsg("");

    try {
      await apiFetch(`/os/${id}`, {
        method: "PUT",
        body: JSON.stringify({ status: novoStatus }),
      });

      await loadOS();
      setMsg(`OS #${id} atualizada para ${statusLabel(novoStatus)}.`);
    } catch (e) {
      if (e.message === "Sessão expirada. Faça login novamente.") {
        clearToken();
        window.location.href = "/login";
        return;
      }
      setMsg(e.message);
    }
  }

  async function abrirWhatsapp(id) {
    setMsg("");

    try {
      const data = await apiFetch(`/os/${id}/whatsapp-link`);
      window.open(data.whatsapp_url, "_blank", "noopener,noreferrer");
    } catch (e) {
      if (e.message === "Sessão expirada. Faça login novamente.") {
        clearToken();
        window.location.href = "/login";
        return;
      }
      setMsg(e.message);
    }
  }

  function toggleDetalhes(id) {
    setDetalhesAbertos((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  }

  function logout() {
    clearToken();
    window.location.href = "/login";
  }

  function updateUrl(nextPeriod, nextStart, nextEnd, nextStatus) {
    const params = new URLSearchParams();
    params.set("period", nextPeriod);

    if (nextStatus && nextStatus !== "todos") {
      params.set("status", nextStatus);
    }

    if (nextPeriod === "custom") {
      if (nextStart) params.set("start_date", nextStart);
      if (nextEnd) params.set("end_date", nextEnd);
    }

    setSearchParams(params);
  }

  function applyFilters() {
    updateUrl(period, startDate, endDate, statusFiltro);
    loadOS({ nextPeriod: period, nextStart: startDate, nextEnd: endDate, nextStatus: statusFiltro });
  }

  function clearFilters() {
    setStatusFiltro("todos");
    setPeriod("all");
    setStartDate("");
    setEndDate("");
    setSearchText("");
    setFiltersOpen(false);
    updateUrl("all", "", "", "todos");
    loadOS({ nextPeriod: "all", nextStart: "", nextEnd: "", nextStatus: "todos" });
  }

  function applyQuickStatus(nextStatus) {
    setStatusFiltro(nextStatus);
    updateUrl(period, startDate, endDate, nextStatus);
    loadOS({ nextPeriod: period, nextStart: startDate, nextEnd: endDate, nextStatus });
  }

  const filteredBySearch = useMemo(() => {
    const term = normalize(searchText.trim());
    if (!term) return osList;

    return osList.filter((os) => {
      const values = [
        os.id,
        os.cliente_nome,
        os.modelo,
        os.placa,
        os.problema_relatado,
        statusLabel(os.status),
      ];

      return values.some((value) => normalize(String(value || "")).includes(term));
    });
  }, [osList, searchText]);

  const stats = useMemo(() => buildStats(osList), [osList]);
  const notificationSummary = useMemo(() => notificationStats || buildNotificationStats(osList), [notificationStats, osList]);
  const notificationItems = useMemo(
    () => buildNotificationItems(notificationSummary, { period, startDate, endDate, role }),
    [notificationSummary, period, startDate, endDate, role]
  );
  const notificationCount = notificationItems.reduce((total, item) => total + item.count, 0);
  const periodLabel = PERIOD_OPTIONS.find((item) => item.value === period)?.label || "Período";

  if (!token) {
    return <StatePage message="Sem sessão. Faça login novamente." />;
  }

  if (loading) {
    return <StatePage message="Carregando ordens de serviço..." />;
  }

  const navItems = buildNavItems({ canAccessDashboard, canAccessClientes, canAccessUsuarios });

  return (
    <div className="oslist-premium-page">
      <aside className="oslist-premium-sidebar" aria-label="Navegação principal">
        <SidebarContent user={user} navItems={navItems} onLogout={logout} />
      </aside>

      {mobileMenuOpen ? (
        <div className="oslist-premium-mobile-menu-overlay" role="dialog" aria-modal="true">
          <button
            type="button"
            className="oslist-premium-mobile-menu-backdrop"
            aria-label="Fechar menu"
            onClick={() => setMobileMenuOpen(false)}
          />

          <div className="oslist-premium-mobile-menu">
            <div className="oslist-premium-mobile-menu-head">
              <Brand />
              <button
                type="button"
                className="oslist-premium-mobile-menu-close"
                aria-label="Fechar menu"
                onClick={() => setMobileMenuOpen(false)}
              >
                ×
              </button>
            </div>

            <nav className="oslist-premium-mobile-menu-links" aria-label="Menu mobile">
              {navItems.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`oslist-premium-mobile-menu-link ${item.active ? "is-active" : ""}`}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <IconSlot icon={item.icon} size={18} />
                  {item.label}
                </Link>
              ))}
            </nav>

            <UserCard user={user} compact />
            <button type="button" className="oslist-premium-mobile-menu-logout" onClick={logout}>
              Sair
            </button>
          </div>
        </div>
      ) : null}

      <main className="oslist-premium-main">
        <header className="oslist-premium-mobile-header">
          <button
            type="button"
            className="oslist-premium-icon-btn"
            aria-label="Abrir menu"
            onClick={() => setMobileMenuOpen(true)}
          >
            ☰
          </button>

          <div className="oslist-premium-mobile-title">
            <strong>Ordens de Serviço</strong>
            <span>OS</span>
          </div>

          <div className="oslist-premium-mobile-header-actions">
            <NotificationButton
              notificationCount={notificationCount}
              notifications={notificationItems}
              open={notificationOpen}
              onToggle={() => setNotificationOpen((prev) => !prev)}
              onClose={() => setNotificationOpen(false)}
            />

            {canCreateOS ? (
              <Link to="/os/new" className="oslist-premium-new-os oslist-premium-mobile-new-os-top">
                <AppIcon icon={appIcons.novaOS} size={18} />
                <span>Nova OS</span>
              </Link>
            ) : null}
          </div>
        </header>

        <div className="oslist-premium-container">
          <section className="oslist-premium-page-head">
            <div>
              <h1>Ordens de Serviço</h1>
              <p>Gerencie e acompanhe todas as OS da sua oficina.</p>
            </div>

            <div className="oslist-premium-head-actions">
              <NotificationButton
                notificationCount={notificationCount}
                notifications={notificationItems}
                open={notificationOpen}
                onToggle={() => setNotificationOpen((prev) => !prev)}
                onClose={() => setNotificationOpen(false)}
              />

              {canCreateOS ? (
                <Link to="/os/new" className="oslist-premium-new-os">
                  <span>+</span>
                  Nova OS
                </Link>
              ) : null}
            </div>
          </section>

          {msg ? <AlertMessage message={msg} /> : null}

          <section className="oslist-premium-mobile-actions">
            <div className="oslist-mobile-notification-row-v28">
              <NotificationButton
                notificationCount={notificationCount}
                notifications={notificationItems}
                open={notificationOpen}
                onToggle={() => setNotificationOpen((prev) => !prev)}
                onClose={() => setNotificationOpen(false)}
              />
              <div className="oslist-mobile-notification-copy-v28">
                <strong>{notificationCount > 0 ? `${notificationCount} ação necessária` : "Sem ações pendentes"}</strong>
                <span>Toque no sino para filtrar OS que exigem atenção.</span>
              </div>
            </div>

            <div className="oslist-premium-mobile-period">
              <AppIcon icon={appIcons.calendario} size={18} />
              <select value={period} onChange={(event) => setPeriod(event.target.value)}>
                {PERIOD_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>

            {canCreateOS ? (
              <Link to="/os/new" className="oslist-premium-new-os">
                <AppIcon icon={appIcons.novaOS} size={20} />
                Nova OS
              </Link>
            ) : null}

            <button type="button" className="oslist-premium-mobile-apply" onClick={applyFilters}>
              Aplicar período
            </button>
          </section>

          <FilterPanel
            period={period}
            setPeriod={setPeriod}
            statusFiltro={statusFiltro}
            setStatusFiltro={setStatusFiltro}
            startDate={startDate}
            setStartDate={setStartDate}
            endDate={endDate}
            setEndDate={setEndDate}
            searchText={searchText}
            setSearchText={setSearchText}
            filtersOpen={filtersOpen}
            onApply={applyFilters}
            onClear={clearFilters}
          />

          <section className="oslist-premium-stats" aria-label="Resumo de ordens de serviço">
            <StatCard icon={appIcons.os} label="Total de OS" value={stats.total} hint="Todas as ordens" tone="blue" />
            <StatCard icon={appIcons.osAndamento} label="Em andamento" value={stats.inProgress} hint="OS em execução" tone="blue" />
            <StatCard icon={appIcons.orcamentosPendentes} label="Orçamentos pendentes" value={stats.pending} hint="Aguardando aprovação" tone="orange" />
            <StatCard icon={appIcons.finalizados} label="Finalizadas" value={stats.finished} hint="OS concluídas" tone="green" />
          </section>

          <section className="oslist-premium-quick-row oslist-quick-filters-panel oslist-quick-filters-desktop-v26" aria-label="Filtros rápidos">
            <div className="oslist-premium-chip-group oslist-quick-filters-grid">
              {QUICK_FILTERS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`oslist-premium-chip oslist-quick-filter-chip ${statusFiltro === item.status ? "is-active" : ""}`}
                  onClick={() => applyQuickStatus(item.status)}
                >
                  <span className="oslist-quick-filter-label">{item.label}</span>
                  <span className="oslist-quick-filter-count">{quickCount(item.status, stats)}</span>
                </button>
              ))}
            </div>

            <button
              type="button"
              className="oslist-premium-filter-toggle oslist-quick-filter-advanced"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((prev) => !prev)}
            >
              <AppIcon icon={appIcons.filtrosAvancados} className="oslist-quick-filter-advanced-icon" size={18} />
              <span className="oslist-quick-filter-advanced-label">Filtros avançados</span>
            </button>
          </section>

          <section className="oslist-mobile-status-filters-v26" aria-label="Filtros rápidos">
            <div className="oslist-mobile-status-grid-v26">
              {QUICK_FILTERS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`oslist-mobile-status-chip-v26 ${statusFiltro === item.status ? "is-active" : ""}`}
                  onClick={() => applyQuickStatus(item.status)}
                >
                  <span className="oslist-mobile-status-label-v26">{item.label}</span>
                  <span className="oslist-mobile-status-count-v26">{quickCount(item.status, stats)}</span>
                </button>
              ))}
            </div>

            <button
              type="button"
              className="oslist-mobile-advanced-button-v26"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((prev) => !prev)}
            >
              <AppIcon icon={appIcons.filtrosAvancados} size={18} />
              <span>Filtros avançados</span>
            </button>
          </section>

          {filtersOpen ? (
            <section className="oslist-premium-mobile-filter-panel">
              <FilterPanel
                period={period}
                setPeriod={setPeriod}
                statusFiltro={statusFiltro}
                setStatusFiltro={setStatusFiltro}
                startDate={startDate}
                setStartDate={setStartDate}
                endDate={endDate}
                setEndDate={setEndDate}
                searchText={searchText}
                setSearchText={setSearchText}
                filtersOpen={filtersOpen}
                onApply={() => {
                  applyFilters();
                  setFiltersOpen(false);
                }}
                onClear={clearFilters}
                mobile
              />
            </section>
          ) : null}

          <section className="oslist-premium-list-card">
            <div className="oslist-premium-list-head">
              <div>
                <h2>Lista de OS</h2>
                <p>
                  Mostrando {filteredBySearch.length} de {stats.total} OS
                  {statusFiltro !== "todos" ? ` • ${statusLabel(statusFiltro)}` : ""} • {periodLabel}
                </p>
              </div>
            </div>

            {filteredBySearch.length === 0 ? (
              <div className="oslist-premium-empty-state">
                <strong>Nenhuma OS encontrada</strong>
                <span>Revise os filtros ou limpe a busca para visualizar as ordens.</span>
                <button type="button" onClick={clearFilters}>
                  Limpar filtros
                </button>
              </div>
            ) : (
              <>
                <DesktopTable
                  osList={filteredBySearch}
                  canSeeMoney={canSeeMoney}
                  detalhesAbertos={detalhesAbertos}
                  toggleDetalhes={toggleDetalhes}
                  mudarStatus={mudarStatus}
                  abrirWhatsapp={abrirWhatsapp}
                  isTecnico={isTecnico}
                />

                <MobileCards
                  osList={filteredBySearch}
                  canSeeMoney={canSeeMoney}
                  detalhesAbertos={detalhesAbertos}
                  toggleDetalhes={toggleDetalhes}
                  mudarStatus={mudarStatus}
                  abrirWhatsapp={abrirWhatsapp}
                  isTecnico={isTecnico}
                />
              </>
            )}
          </section>
        </div>
      </main>

      <BottomNav
        canCreateOS={canCreateOS}
        canAccessDashboard={canAccessDashboard}
        canAccessClientes={canAccessClientes}
        canAccessUsuarios={canAccessUsuarios}
        onLogout={logout}
      />
    </div>
  );
}

function StatePage({ message }) {
  return (
    <div className="oslist-premium-page oslist-premium-state-page">
      <div className="oslist-premium-state-card">{message}</div>
    </div>
  );
}

function FilterPanel({
  period,
  setPeriod,
  statusFiltro,
  setStatusFiltro,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  searchText,
  setSearchText,
  onApply,
  onClear,
  mobile = false,
}) {
  return (
    <section className={`oslist-premium-filter-card ${mobile ? "is-mobile" : ""}`}>
      <div className="oslist-premium-search-field">
        <label>Buscar</label>
        <div className="oslist-premium-search-input">
          <AppIcon icon={appIcons.pesquisar} size={21} />
          <input
            type="search"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Buscar por cliente, veículo, placa ou OS"
          />
        </div>
      </div>

      <div className="oslist-premium-field">
        <label>Status</label>
        <select value={statusFiltro} onChange={(event) => setStatusFiltro(event.target.value)}>
          <option value="todos">Todos os status</option>
          <option value="em_andamento">Em andamento</option>
          {STATUS.map((status) => (
            <option key={status} value={status}>
              {statusLabel(status)}
            </option>
          ))}
        </select>
      </div>

      <div className="oslist-premium-field">
        <label>Período</label>
        <select value={period} onChange={(event) => setPeriod(event.target.value)}>
          {PERIOD_OPTIONS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      {period === "custom" ? (
        <>
          <div className="oslist-premium-field">
            <label>Data inicial</label>
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </div>

          <div className="oslist-premium-field">
            <label>Data final</label>
            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </div>
        </>
      ) : null}

      <div className="oslist-premium-filter-actions">
        <button type="button" className="oslist-premium-apply" onClick={onApply}>
          Aplicar filtros
        </button>
        <button type="button" className="oslist-premium-clear" onClick={onClear}>
          Limpar
        </button>
      </div>
    </section>
  );
}

function DesktopTable({ osList, canSeeMoney, detalhesAbertos, toggleDetalhes, mudarStatus, abrirWhatsapp, isTecnico }) {
  return (
    <div className={`oslist-premium-table ${canSeeMoney ? "" : "is-no-money"}`}>
      <div className="oslist-premium-table-head">
        <span>OS</span>
        <span>Cliente</span>
        <span>Veículo / Placa</span>
        <span>Status</span>
        <span>Criada em</span>
        {canSeeMoney ? <span>Valor total</span> : null}
        <span>Ações</span>
      </div>

      {osList.map((os) => {
        const aberto = !!detalhesAbertos[os.id];
        const tone = statusToneClass(os.status);

        return (
          <div key={os.id} className={`oslist-premium-table-row ${tone}`}>
            <Link to={`/os/${os.id}`} className="oslist-premium-table-id">
              OS #{os.id}
            </Link>
            <strong>{os.cliente_nome || "-"}</strong>
            <span>{vehicleText(os)}</span>
            <span className={`oslist-premium-badge oslist-status-pill-v33 ${statusBadgeClass(os.status)} status-${os.status}`} title={statusLabel(os.status)}>{statusLabel(os.status)}</span>
            <span>{formatDateShort(os.created_at)}</span>
            {canSeeMoney ? <strong className="oslist-premium-money">{moneyOrEmpty(os.valor_total)}</strong> : null}
            <div className="oslist-premium-row-actions">
              <Link to={`/os/${os.id}`} className="oslist-premium-details-btn">
                Ver detalhes
              </Link>
              <button type="button" className="oslist-premium-icon-more" onClick={() => toggleDetalhes(os.id)}>
                {aberto ? "×" : "⋮"}
              </button>
            </div>

            {aberto ? (
              <div className="oslist-premium-inline-actions">
                <div className="oslist-premium-field">
                  <label>Atualizar status</label>
                  <select value={os.status} onChange={(event) => mudarStatus(os.id, event.target.value)}>
                    {STATUS.map((status) => (
                      <option key={status} value={status}>
                        {statusLabel(status)}
                      </option>
                    ))}
                  </select>
                </div>

                {!isTecnico ? (
                  <div className="oslist-premium-inline-action-box">
                    {os.status === "aguardando_aprovacao" ? (
                      <button type="button" onClick={() => abrirWhatsapp(os.id)}>
                        Enviar orçamento no WhatsApp
                      </button>
                    ) : (
                      <span>WhatsApp disponível somente em “Aguardando aprovação”.</span>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function MobileCards({ osList, canSeeMoney, detalhesAbertos, toggleDetalhes, mudarStatus, abrirWhatsapp, isTecnico }) {
  return (
    <div className="oslist-premium-mobile-list">
      {osList.map((os) => {
        const aberto = !!detalhesAbertos[os.id];
        const tone = statusToneClass(os.status);

        return (
          <article key={os.id} className={`oslist-premium-mobile-card ${tone}`}>
            <div className="oslist-premium-mobile-card-top">
              <Link to={`/os/${os.id}`}>OS #{os.id}</Link>
              <span className={`oslist-premium-badge oslist-status-pill-v33 ${statusBadgeClass(os.status)} status-${os.status}`} title={statusLabel(os.status)}>{statusLabel(os.status)}</span>
              <button type="button" onClick={() => toggleDetalhes(os.id)} aria-label="Abrir ações da OS">
                {aberto ? "×" : "⋯"}
              </button>
            </div>

            <div className="oslist-premium-mobile-grid">
              <div>
                <small>Cliente</small>
                <strong>{os.cliente_nome || "-"}</strong>
              </div>
              <div>
                <small>Veículo / Placa</small>
                <span>{vehicleText(os)}</span>
              </div>
              <div>
                <small>Criada em</small>
                <span>{formatDateShort(os.created_at)}</span>
              </div>
              {canSeeMoney ? (
                <div className="oslist-premium-mobile-value">
                  <small>Valor total</small>
                  <strong>{moneyOrEmpty(os.valor_total)}</strong>
                </div>
              ) : null}
            </div>

            <div className="oslist-premium-mobile-actions-row">
              <Link to={`/os/${os.id}`}>Ver detalhes</Link>
              <button type="button" onClick={() => toggleDetalhes(os.id)}>
                {aberto ? "Fechar" : "Atualizar OS"}
              </button>
            </div>

            {aberto ? (
              <div className="oslist-premium-mobile-update">
                <label>Atualizar status</label>
                <select value={os.status} onChange={(event) => mudarStatus(os.id, event.target.value)}>
                  {STATUS.map((status) => (
                    <option key={status} value={status}>
                      {statusLabel(status)}
                    </option>
                  ))}
                </select>

                {!isTecnico && os.status === "aguardando_aprovacao" ? (
                  <button type="button" onClick={() => abrirWhatsapp(os.id)}>
                    Enviar orçamento no WhatsApp
                  </button>
                ) : null}
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function StatCard({ icon, label, value, hint, tone }) {
  return (
    <div className={`oslist-premium-stat oslist-premium-stat--${tone}`}>
      <span aria-hidden="true">
        {icon ? <AppIcon icon={icon} size={22} /> : null}
      </span>
      <div>
        <strong>{label}</strong>
        <b>{value}</b>
        <p>{hint}</p>
      </div>
    </div>
  );
}

function SidebarContent({ user, navItems, onLogout }) {
  return (
    <>
      <Brand />
      <nav className="oslist-premium-menu" aria-label="Menu principal">
        {navItems.map((item) => (
          <Link key={item.to} to={item.to} className={`oslist-premium-menu-item ${item.active ? "is-active" : ""}`}>
            <IconSlot icon={item.icon} size={18} />
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="oslist-premium-sidebar-footer">
        <UserCard user={user} />
        <button type="button" className="oslist-premium-logout" onClick={onLogout}>
          <AppIcon icon={appIcons.sair} size={18} />
          Sair
        </button>
      </div>
    </>
  );
}

function Brand() {
  return (
    <div className="oslist-premium-brand">
      <div className="oslist-premium-logo">OS</div>
      <div>
        <strong>OS SaaS</strong>
        <span>Oficina mecânica</span>
      </div>
    </div>
  );
}

function UserCard({ user, compact = false }) {
  const name = user?.name || user?.nome || user?.email || "Usuário";

  return (
    <div className={`oslist-premium-user-card ${compact ? "is-compact" : ""}`}>
      <div className="oslist-premium-user-avatar">{String(name).charAt(0).toUpperCase()}</div>
      <div>
        <strong>{name}</strong>
        <span>{roleLabel(user?.role)}</span>
      </div>
    </div>
  );
}

function NotificationButton({ notificationCount, notifications = [], open, onToggle, onClose }) {
  const visibleNotifications = notifications.filter((item) => item.count > 0);

  return (
    <div className="oslist-premium-notification-wrap">
      <button type="button" className="oslist-premium-notification" onClick={onToggle} aria-label="Notificações">
        <AppIcon icon={appIcons.alertas} size={19} />
        {notificationCount > 0 ? <span>{notificationCount}</span> : null}
      </button>

      {open ? (
        <div className="oslist-premium-notification-panel">
          <strong>Central de ações</strong>
          <p>Atalhos para filtrar rapidamente as OS que exigem atenção operacional.</p>

          {visibleNotifications.length > 0 ? (
            <div className="oslist-premium-notification-list">
              {visibleNotifications.map((item) => {


                return (
                  <Link
                    key={item.key}
                    to={item.href}
                    className={`oslist-premium-notification-item is-${item.tone}`}
                    onClick={onClose}
                  >
                    <span className="oslist-premium-notification-item-icon" aria-hidden="true">
                      <AppIcon icon={item.icon} size={18} />
                    </span>
                    <span className="oslist-premium-notification-item-text">
                      <strong>{item.label}</strong>
                      <small>{item.description}</small>
                    </span>
                    <b>{item.count}</b>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="oslist-premium-notification-empty">Nenhuma ação crítica no período atual.</div>
          )}

          <Link to={statusUrl("todos", "all", "", "")} className="oslist-premium-notification-all" onClick={onClose}>
            Ver todas as OS
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function BottomNav({ canCreateOS, canAccessDashboard, canAccessClientes, canAccessUsuarios, onLogout }) {
  return (
    <nav className="oslist-premium-bottom-nav" aria-label="Navegação mobile">
      {canAccessDashboard ? (
        <Link to="/dashboard">
          <AppIcon icon={appIcons.dashboard} size={20} />
          Dashboard
        </Link>
      ) : null}

      <Link to="/os" className="is-active">
        <AppIcon icon={appIcons.os} size={20} />
        OS
      </Link>

      {canCreateOS ? (
        <Link to="/os/new" className="oslist-premium-bottom-plus" aria-label="Nova OS">
          <AppIcon icon={appIcons.novaOS} size={26} />
        </Link>
      ) : null}

      {canAccessClientes ? (
        <Link to="/clientes">
          <AppIcon icon={appIcons.clientes} size={20} />
          Clientes
        </Link>
      ) : null}

      {canAccessUsuarios ? (
        <Link to="/usuarios">
          <AppIcon icon={appIcons.usuarios} size={20} />
          Usuários
        </Link>
      ) : (
        <button type="button" onClick={onLogout}>
          <AppIcon icon={appIcons.sair} size={20} />
          Sair
        </button>
      )}
    </nav>
  );
}

function IconSlot({ icon, size = 18 }) {
  return (
    <span className="oslist-premium-menu-icon" aria-hidden="true">
      {icon ? <AppIcon icon={icon} size={size} /> : null}
    </span>
  );
}

function AlertMessage({ message }) {
  const textoBase = String(message || "").toLowerCase();
  const texto = textoBase.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const isError =
    texto.includes("erro") ||
    texto.includes("expirada") ||
    texto.includes("inval") ||
    texto.includes("nao") ||
    texto.includes("obrigatorio");

  return <div className={`oslist-premium-alert ${isError ? "is-error" : "is-success"}`}>{message}</div>;
}

function buildNavItems({ canAccessDashboard, canAccessClientes, canAccessUsuarios }) {
  const items = [];

  if (canAccessDashboard) items.push({ to: "/dashboard", label: "Dashboard", icon: appIcons.dashboard, active: false });
  items.push({ to: "/os", label: "OS", icon: appIcons.os, active: true });
  items.push({ to: "/kanban", label: "Quadro de OS", icon: appIcons.kanban, active: false });
  if (canAccessClientes) items.push({ to: "/clientes", label: "Clientes", icon: appIcons.clientes, active: false });
  if (canAccessUsuarios) items.push({ to: "/usuarios", label: "Usuários", icon: appIcons.usuarios, active: false });

  return items;
}

function buildStats(list) {
  const total = list.length;
  const inProgress = list.filter((os) => ["aprovado", "em_execucao", "aguardando_peca", "pronto_retirada"].includes(os.status)).length;
  const pending = list.filter((os) => ["aguardando_aprovacao", "orcamento_enviado"].includes(os.status)).length;
  const finished = list.filter((os) => ["encerrado", "finalizado"].includes(os.status)).length;

  return { total, inProgress, pending, finished };
}

function buildNotificationStats(list) {
  const count = (statuses) => list.filter((os) => statuses.includes(os.status)).length;

  return {
    total: list.length,
    triage: count(["triagem"]),
    analysis: count(["em_analise"]),
    waitingApproval: count(["aguardando_aprovacao", "orcamento_enviado"]),
    approved: count(["aprovado"]),
    execution: count(["em_execucao"]),
    waitingPart: count(["aguardando_peca"]),
    readyPickup: count(["pronto_retirada"]),
    finished: count(["encerrado", "finalizado"]),
    canceled: count(["cancelado"]),
  };
}

function buildNotificationItems(stats, { period, startDate, endDate, role }) {
  const isTecnico = role === "tecnico";

  const operationalItems = [
    {
      key: "analysis",
      label: "Em análise",
      description: "OS aguardando diagnóstico ou revisão técnica.",
      count: stats.analysis,
      href: statusUrl("em_analise", period, startDate, endDate),
      tone: "info",
      icon: appIcons.emAnalise,
    },
    {
      key: "execution",
      label: "Em execução",
      description: "Serviços em andamento na oficina.",
      count: stats.execution,
      href: statusUrl("em_execucao", period, startDate, endDate),
      tone: "info",
      icon: appIcons.osAndamento,
    },
    {
      key: "waitingPart",
      label: "Aguardando peça",
      description: "OS paradas por falta de peça.",
      count: stats.waitingPart,
      href: statusUrl("aguardando_peca", period, startDate, endDate),
      tone: "warning",
      icon: appIcons.manutencao,
    },
    {
      key: "readyPickup",
      label: "Prontas para retirada",
      description: "Veículos prontos para entregar ao cliente.",
      count: stats.readyPickup,
      href: statusUrl("pronto_retirada", period, startDate, endDate),
      tone: "success",
      icon: appIcons.prontoRetirada,
    },
  ];

  if (isTecnico) return operationalItems;

  return [
    {
      key: "waitingApproval",
      label: "Orçamentos pendentes",
      description: "Aguardando aprovação do cliente.",
      count: stats.waitingApproval,
      href: statusUrl("aguardando_aprovacao", period, startDate, endDate),
      tone: "warning",
      icon: appIcons.orcamentosPendentes,
    },
    {
      key: "approved",
      label: "Aprovadas",
      description: "OS aprovadas para iniciar execução.",
      count: stats.approved,
      href: statusUrl("aprovado", period, startDate, endDate),
      tone: "info",
      icon: appIcons.aprovado,
    },
    ...operationalItems,
    {
      key: "finished",
      label: "Finalizadas",
      description: "Conferir encerramento e faturamento.",
      count: stats.finished,
      href: statusUrl("encerrado", period, startDate, endDate),
      tone: "success",
      icon: appIcons.aprovado,
    },
  ];
}

function statusUrl(status, period = "all", startDate = "", endDate = "") {
  const params = new URLSearchParams();
  params.set("period", period || "all");

  if (status && status !== "todos") {
    params.set("status", status);
  }

  if (period === "custom") {
    if (startDate) params.set("start_date", startDate);
    if (endDate) params.set("end_date", endDate);
  }

  return `/os?${params.toString()}`;
}

function quickCount(status, stats) {
  if (status === "todos") return stats.total;
  if (status === "em_andamento") return stats.inProgress;
  if (status === "aguardando_aprovacao") return stats.pending;
  if (status === "encerrado") return stats.finished;
  return 0;
}

function getInitialStatus(params) {
  const status = params.get("status") || "todos";
  if (
    status === "todos" ||
    status === "em_andamento" ||
    STATUS.includes(status) ||
    status === "orcamento_enviado" ||
    status === "finalizado"
  ) {
    return status;
  }

  return "todos";
}

function getInitialPeriod(params) {
  const period = params.get("period") || "all";
  return PERIOD_OPTIONS.some((item) => item.value === period) ? period : "all";
}

function statusLabel(status) {
  return STATUS_LABEL[status] || status || "-";
}

function statusBadgeClass(status) {
  if (status === "encerrado" || status === "finalizado") return "is-success";
  if (status === "cancelado") return "is-danger";

  if (status === "aguardando_aprovacao" || status === "orcamento_enviado") {
    return "is-warning";
  }

  if (["aprovado", "em_execucao", "aguardando_peca", "pronto_retirada"].includes(status)) {
    return "is-info";
  }

  return "is-gray";
}

function statusToneClass(status) {
  if (status === "encerrado" || status === "finalizado") return "is-success";
  if (status === "cancelado") return "is-danger";

  if (status === "aguardando_aprovacao" || status === "orcamento_enviado") {
    return "is-warning";
  }

  if (["aprovado", "em_execucao", "aguardando_peca", "pronto_retirada"].includes(status)) {
    return "is-info";
  }

  return "is-gray";
}

function roleLabel(role) {
  if (role === "admin") return "Administrador";
  if (role === "atendimento") return "Atendimento";
  if (role === "tecnico") return "Técnico";
  return "Usuário";
}

function money(value) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function moneyOrEmpty(value) {
  return Number(value || 0) === 0 ? "Sem valor" : money(value);
}

function vehicleText(os) {
  const modelo = os.modelo || "-";
  const placa = os.placa || "-";
  return `${modelo} • ${placa}`;
}

function formatDateShort(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalize(value) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
