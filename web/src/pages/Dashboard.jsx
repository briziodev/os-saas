import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch, clearToken } from "../api";

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

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [agoraSP, setAgoraSP] = useState(formatSaoPauloNow());

  useEffect(() => {
    const timer = setInterval(() => {
      setAgoraSP(formatSaoPauloNow());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    try {
      setLoading(true);
      setError("");

      const body = await apiFetch("/dashboard");
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

  if (error) {
    return (
      <div className="page">
        <div className="container">
          <div className="card alert alert--error">Erro: {error}</div>
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

  const { cards, ultimas_os } = data;

  return (
    <div className="page">
      <div className="container">
        <PageHeader
          eyebrow="Painel da oficina"
          title="Dashboard"
          description="Visão rápida da operação, orçamentos e últimas ordens de serviço."
          right={
            <>
              <Link to="/os/new">
                <button className="btn btn--solid">Nova OS</button>
              </Link>

              <Link to="/os">
                <button className="btn btn--ghost-dark">OS</button>
              </Link>

              <Link to="/kanban">
                <button className="btn btn--ghost-dark">Quadro de OS</button>
              </Link>

              <Link to="/clientes">
                <button className="btn btn--ghost-dark">Clientes</button>
              </Link>

              <button onClick={logout} className="btn btn--ghost-dark">
                Sair
              </button>
            </>
          }
          footer={
            <div className="page-header-footer">
              <div className="info-chip info-chip--dark">
                São Paulo agora: {agoraSP}
              </div>
            </div>
          }
        />

        <div className="section grid-4">
          <StatCard
            title="Em andamento"
            value={cards?.em_andamento ?? 0}
            hint="Aprovado + execução + aguardando peça + pronto retirada"
            kpiClass="kpi--blue"
          />

          <StatCard
            title="Orçamentos pendentes"
            value={cards?.orcamentos_pendentes ?? 0}
            hint="Triagem + análise + aguardando aprovação"
            kpiClass="kpi--amber"
          />

          <StatCard
            title="Finalizados no mês"
            value={cards?.finalizados_no_mes ?? 0}
            hint="OS encerradas no mês atual"
            kpiClass="kpi--green"
          />

          <StatCard
            title="Faturamento do mês"
            value={money(cards?.faturamento_mes ?? 0)}
            hint="Somente OS encerradas/finalizadas"
            kpiClass="kpi--dark"
          />
        </div>

        <div className="section">
          <SectionTitle
            title="Últimas OS"
            subtitle="As ordens mais recentes para acompanhamento rápido."
          />

          {ultimas_os?.length === 0 ? (
            <div className="card">
              <div className="muted">Nenhuma OS cadastrada ainda.</div>

              <div className="page-header-footer">
                <Link to="/os/new">
                  <button className="btn btn--solid">Criar primeira OS</button>
                </Link>
              </div>
            </div>
          ) : (
            <div className="card">
              <div className="list">
                {ultimas_os.map((os) => (
                  <DashboardOsRow key={os.id} os={os} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DashboardOsRow({ os }) {
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

          <div className="meta-label page-header-footer">Valor total</div>
          <div className="meta-value-strong">{money(os.valor_total)}</div>
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