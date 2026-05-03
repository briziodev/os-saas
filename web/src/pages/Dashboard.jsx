import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { apiFetch, clearToken, getUser } from "../api";

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

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [agoraSP, setAgoraSP] = useState(formatSaoPauloNow());
  const [period, setPeriod] = useState("month");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const user = getUser();
  const isTecnico = user?.role === "tecnico";

  if (user?.role !== "admin" && user?.role !== "atendimento") {
    return <Navigate to="/os" replace />;
  }

  useEffect(() => {
    const timer = setInterval(() => {
      setAgoraSP(formatSaoPauloNow());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  if (loading) {
    return (
      <div className="page">
        <div className="container">
          <div className="card">
            <div className="muted">Carregando dashboard...</div>
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="page">
        <div className="container">
          <div className="card">
            <div className="muted">Sem dados para exibir.</div>
          </div>
        </div>
      </div>
    );
  }

  const { cards, ultimas_os, period: periodInfo } = data;

  return (
    <div className="page">
      <div className="container">
        <PageHeader
          eyebrow="Painel da oficina"
          title="Dashboard"
          description="Visão por período da operação, orçamentos, OS encerradas e resultado financeiro."
          right={
            <>
              {!isTecnico && (
                <Link to="/os/new">
                  <button className="btn btn--solid">Nova OS</button>
                </Link>
              )}

              <Link to="/os">
                <button className="btn btn--ghost-dark">OS</button>
              </Link>

              <Link to="/kanban">
                <button className="btn btn--ghost-dark">Quadro de OS</button>
              </Link>

              {!isTecnico && (
                <Link to="/clientes">
                  <button className="btn btn--ghost-dark">Clientes</button>
                </Link>
              )}

              {user?.role === "admin" && (
                <Link to="/usuarios">
                  <button className="btn btn--ghost-dark">Usuários</button>
                </Link>
              )}

              <button onClick={logout} className="btn btn--ghost-dark">
                Sair
              </button>
            </>
          }
          footer={
            <div
              className="page-header-footer"
              style={{ gap: 10, flexWrap: "wrap" }}
            >
              <div className="info-chip info-chip--dark">
                São Paulo agora: {agoraSP}
              </div>
              <div className="info-chip">
                Período aplicado: {periodInfo?.label || "-"}
              </div>
            </div>
          }
        />

        {error ? (
          <div className="card alert alert--error section">Erro: {error}</div>
        ) : null}

        <div className="card section filter-panel">
          <div className="filter-bar">
            <div className="filter-bar-field">
              <label className="label">Período do dashboard</label>
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
              >
                {PERIOD_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>

            {period === "custom" && (
              <>
                <div className="filter-bar-field">
                  <label className="label">Data inicial</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>

                <div className="filter-bar-field">
                  <label className="label">Data final</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </>
            )}

            <div className="filter-bar-action filter-bar-action--spaced">
              <button
                className="btn btn--primary"
                type="button"
                onClick={applyFilters}
              >
                Aplicar período
              </button>
            </div>
          </div>
        </div>

        <div className="section grid-4">
          <StatCard
            title="OS abertas no período"
            value={cards?.abertas_periodo ?? 0}
            hint="Total de OS criadas dentro do período selecionado"
            kpiClass="kpi--blue"
          />

          <StatCard
            title="Em andamento"
            value={cards?.em_andamento ?? 0}
            hint="OS criadas no período e ainda em andamento"
            kpiClass="kpi--blue"
          />

          <StatCard
            title="Orçamentos pendentes"
            value={cards?.orcamentos_pendentes ?? 0}
            hint="Triagem + análise + aguardando aprovação"
            kpiClass="kpi--amber"
          />

          <StatCard
            title="Finalizados no período"
            value={cards?.finalizados_no_periodo ?? 0}
            hint="OS encerradas/finalizadas no período selecionado"
            kpiClass="kpi--green"
          />

          {user?.role === "admin" && (
            <StatCard
              title="Faturamento do período"
              value={money(cards?.faturamento_periodo ?? 0)}
              hint="Somente OS encerradas/finalizadas"
              kpiClass="kpi--dark"
            />
          )}
        </div>

        <div className="section">
          <SectionTitle
            title="Últimas OS do período"
            subtitle="As ordens mais recentes dentro do filtro selecionado."
          />

          {ultimas_os?.length === 0 ? (
            <div className="card">
              <div className="muted">
                Nenhuma OS encontrada para este período.
              </div>

              <div className="page-header-footer">
                {!isTecnico && (
                  <Link to="/os/new">
                    <button className="btn btn--solid">Criar nova OS</button>
                  </Link>
                )}
              </div>
            </div>
          ) : (
            <div className="card">
              <div className="list">
                {ultimas_os.map((os) => (
                  <DashboardOsRow key={os.id} os={os} isTecnico={isTecnico} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DashboardOsRow({ os, isTecnico }) {
  const toneClass = statusToneClass(os.status);

  return (
    <div className={`table-like-row table-like-row--status ${toneClass}`}>
      <div className="os-row">
        <div className="os-row-main">
          <div className="os-row-head">
            <Link to={`/os/${os.id}`} className="os-row-title-link">
              <strong className="os-row-title">OS #{os.id}</strong>
            </Link>

            <span className={`badge badge--status ${statusBadgeClass(os.status)}`}>
              {statusLabel(os.status)}
            </span>
          </div>

          <div className="os-row-text">
            <strong>Cliente:</strong> {os.cliente_nome || "-"}
          </div>

          <div className="os-row-subtext">
            {os.modelo || "-"} • {os.placa || "-"}
          </div>
        </div>

        <div className="os-row-side">
          <div className="meta-label">Criada em</div>
          <div className="meta-value">{formatDateBR(os.created_at)}</div>

          {!isTecnico ? (
            <>
              <div className="meta-label page-header-footer">Valor total</div>
              <div className="meta-value-strong">{money(os.valor_total)}</div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, hint, kpiClass = "kpi--dark" }) {
  return (
    <div className="card">
      <div className="stat-card-title">{title}</div>
      <div className={`kpi ${kpiClass}`}>{value}</div>
      <div className="stat-card-hint">{hint}</div>
    </div>
  );
}

function PageHeader({ eyebrow, title, description, right, footer }) {
  return (
    <div className="topbar">
      <div className="page-header-meta">
        <div className="page-eyebrow">{eyebrow}</div>
        <h1 className="page-title">{title}</h1>
        <p className="page-description">{description}</p>
        {footer || null}
      </div>

      <div className="form-actions header-actions">{right}</div>
    </div>
  );
}

function SectionTitle({ title, subtitle }) {
  return (
    <div className="section-header">
      <h2>{title}</h2>
      {subtitle ? <div className="section-subtitle">{subtitle}</div> : null}
    </div>
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

function statusToneClass(status) {
  if (status === "encerrado" || status === "finalizado") {
    return "table-like-row--success";
  }

  if (status === "cancelado") {
    return "table-like-row--danger";
  }

  if (status === "aguardando_aprovacao" || status === "orcamento_enviado") {
    return "table-like-row--warning";
  }

  if (
    status === "aprovado" ||
    status === "em_execucao" ||
    status === "aguardando_peca" ||
    status === "pronto_retirada"
  ) {
    return "table-like-row--info";
  }

  return "table-like-row--gray";
}

function money(value) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function formatDateBR(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("pt-BR");
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