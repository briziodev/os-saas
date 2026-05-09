import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiFetch, clearToken, getUser } from "../api";

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
  { key: "em_execucao", label: "Em andamento", status: "em_execucao" },
  { key: "aguardando_aprovacao", label: "Pendentes", status: "aguardando_aprovacao" },
  { key: "encerrado", label: "Finalizadas", status: "encerrado" },
];

export default function OSList() {
  const token = useMemo(() => localStorage.getItem("token"), []);
  const [searchParams, setSearchParams] = useSearchParams();

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

  useEffect(() => {
    loadOS({
      nextPeriod: getInitialPeriod(searchParams),
      nextStart: searchParams.get("start_date") || "",
      nextEnd: searchParams.get("end_date") || "",
      nextStatus: getInitialStatus(searchParams),
      syncState: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

      const data = await apiFetch(`/os?${params.toString()}`);
      const lista = Array.isArray(data) ? data : [];

      const ordenada = [...lista].sort((a, b) => {
        const idA = Number(a.id || 0);
        const idB = Number(b.id || 0);
        return idB - idA;
      });

      setOsList(ordenada);

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
  const pendingCount = stats.pending;
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
                  <span>{item.icon}</span>
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
          <strong>Ordens de Serviço</strong>
          <NotificationButton
            pendingCount={pendingCount}
            open={notificationOpen}
            onToggle={() => setNotificationOpen((prev) => !prev)}
          />
        </header>

        <div className="oslist-premium-container">
          <section className="oslist-premium-page-head">
            <div>
              <h1>Ordens de Serviço</h1>
              <p>Gerencie e acompanhe todas as OS da sua oficina.</p>
            </div>

            <div className="oslist-premium-head-actions">
              <NotificationButton
                pendingCount={pendingCount}
                open={notificationOpen}
                onToggle={() => setNotificationOpen((prev) => !prev)}
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
            <div className="oslist-premium-mobile-period">
              <span>🗓️</span>
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
                <span>+</span>
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
            <StatCard icon="▣" label="Total de OS" value={stats.total} hint="Todas as ordens" tone="blue" />
            <StatCard icon="↻" label="Em andamento" value={stats.inProgress} hint="OS em execução" tone="blue" />
            <StatCard icon="◷" label="Orçamentos pendentes" value={stats.pending} hint="Aguardando aprovação" tone="orange" />
            <StatCard icon="✓" label="Finalizadas" value={stats.finished} hint="OS concluídas" tone="green" />
          </section>

          <section className="oslist-premium-quick-row" aria-label="Filtros rápidos">
            <div className="oslist-premium-chip-group">
              {QUICK_FILTERS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`oslist-premium-chip ${statusFiltro === item.status ? "is-active" : ""}`}
                  onClick={() => applyQuickStatus(item.status)}
                >
                  {item.label}
                  <span>{quickCount(item.status, stats)}</span>
                </button>
              ))}
            </div>

            <button
              type="button"
              className="oslist-premium-filter-toggle"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((prev) => !prev)}
            >
              ☷
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
          <span>⌕</span>
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
            <span className={`oslist-premium-badge ${statusBadgeClass(os.status)}`}>{statusLabel(os.status)}</span>
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
              <span className={`oslist-premium-badge ${statusBadgeClass(os.status)}`}>{statusLabel(os.status)}</span>
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
      <span>{icon}</span>
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
            <span>{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="oslist-premium-sidebar-footer">
        <UserCard user={user} />
        <button type="button" className="oslist-premium-logout" onClick={onLogout}>
          ↪ Sair
        </button>
      </div>
    </>
  );
}

function Brand() {
  return (
    <div className="oslist-premium-brand">
      <div className="oslist-premium-logo">OP</div>
      <div>
        <strong>OficinaPro</strong>
        <span>Gestão de oficina</span>
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

function NotificationButton({ pendingCount, open, onToggle }) {
  return (
    <div className="oslist-premium-notification-wrap">
      <button type="button" className="oslist-premium-notification" onClick={onToggle} aria-label="Notificações">
        🔔
        {pendingCount > 0 ? <span>{pendingCount}</span> : null}
      </button>

      {open ? (
        <div className="oslist-premium-notification-panel">
          <strong>Ação necessária</strong>
          <p>
            {pendingCount > 0
              ? `${pendingCount} orçamento${pendingCount === 1 ? "" : "s"} pendente${pendingCount === 1 ? "" : "s"} aguardando aprovação.`
              : "Nenhum orçamento pendente no filtro atual."}
          </p>
          <Link to="/os?period=all&status=aguardando_aprovacao">Ver orçamentos</Link>
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
          <span>▦</span>
          Dashboard
        </Link>
      ) : null}

      <Link to="/os" className="is-active">
        <span>▤</span>
        OS
      </Link>

      {canCreateOS ? (
        <Link to="/os/new" className="oslist-premium-bottom-plus" aria-label="Nova OS">
          +
        </Link>
      ) : null}

      {canAccessClientes ? (
        <Link to="/clientes">
          <span>♙</span>
          Clientes
        </Link>
      ) : null}

      {canAccessUsuarios ? (
        <Link to="/usuarios">
          <span>◌</span>
          Usuários
        </Link>
      ) : (
        <button type="button" onClick={onLogout}>
          <span>↪</span>
          Sair
        </button>
      )}
    </nav>
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

  if (canAccessDashboard) items.push({ to: "/dashboard", label: "Dashboard", icon: "▦", active: false });
  items.push({ to: "/os", label: "OS", icon: "▤", active: true });
  items.push({ to: "/kanban", label: "Quadro de OS", icon: "▥", active: false });
  if (canAccessClientes) items.push({ to: "/clientes", label: "Clientes", icon: "◎", active: false });
  if (canAccessUsuarios) items.push({ to: "/usuarios", label: "Usuários", icon: "○", active: false });

  return items;
}

function buildStats(list) {
  const total = list.length;
  const inProgress = list.filter((os) => ["aprovado", "em_execucao", "aguardando_peca", "pronto_retirada"].includes(os.status)).length;
  const pending = list.filter((os) => ["aguardando_aprovacao", "orcamento_enviado"].includes(os.status)).length;
  const finished = list.filter((os) => ["encerrado", "finalizado"].includes(os.status)).length;

  return { total, inProgress, pending, finished };
}

function quickCount(status, stats) {
  if (status === "todos") return stats.total;
  if (status === "em_execucao") return stats.inProgress;
  if (status === "aguardando_aprovacao") return stats.pending;
  if (status === "encerrado") return stats.finished;
  return 0;
}

function getInitialStatus(params) {
  const status = params.get("status") || "todos";
  if (status === "todos" || STATUS.includes(status) || status === "orcamento_enviado" || status === "finalizado") return status;
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
