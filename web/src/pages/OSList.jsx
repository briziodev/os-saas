import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
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

export default function OSList() {
  const token = useMemo(() => localStorage.getItem("token"), []);
  const [osList, setOsList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [statusFiltro, setStatusFiltro] = useState("todos");
  const [period, setPeriod] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [detalhesAbertos, setDetalhesAbertos] = useState({});
  const user = getUser();
  const isTecnico = user?.role === "tecnico";

  useEffect(() => {
    loadOS();
  }, []);

  async function loadOS(nextPeriod = period, nextStart = startDate, nextEnd = endDate) {
    setLoading(true);
    setMsg("");

    try {
      const params = new URLSearchParams();
      params.set("period", nextPeriod);

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
      window.open(data.whatsapp_url, "_blank");
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

  function applyFilters() {
    loadOS(period, startDate, endDate);
  }

  const osFiltradas =
    statusFiltro === "todos"
      ? osList
      : osList.filter((os) => os.status === statusFiltro);

  if (!token) {
    return (
      <div className="page">
        <div className="container">
          <div className="card">Sem sessão. Faça login novamente.</div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="page">
        <div className="container">
          <div className="card">Carregando ordens de serviço...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="container">
        <PageHeader
          eyebrow="Painel da oficina"
          title="Ordens de Serviço"
          description="Controle de OS, andamento da oficina e envio de orçamento."
          right={
            <>
              {!isTecnico && (
                <Link to="/os/new">
                  <button className="btn btn--solid" type="button">
                    Nova OS
                  </button>
                </Link>
              )}




              {!isTecnico && (
  <Link to="/dashboard">
    <button className="btn btn--ghost-dark" type="button">
      Dashboard
    </button>
  </Link>
)}







              <button onClick={logout} className="btn btn--ghost-dark" type="button">
                Sair
              </button>
            </>
          }
        />

        {msg ? <AlertMessage message={msg} /> : null}

        <div className="card section filter-panel">
          <div className="filter-bar">
            <div className="filter-bar-field">
              <label className="label">Filtrar status</label>
              <select value={statusFiltro} onChange={(e) => setStatusFiltro(e.target.value)}>
                <option value="todos">Todos</option>
                {STATUS.map((status) => (
                  <option key={status} value={status}>
                    {statusLabel(status)}
                  </option>
                ))}
              </select>
            </div>

            <div className="filter-bar-field">
              <label className="label">Período</label>
              <select value={period} onChange={(e) => setPeriod(e.target.value)}>
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
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>

                <div className="filter-bar-field">
                  <label className="label">Data final</label>
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </div>
              </>
            )}




           <div className="filter-bar-action" style={{ display: "flex", alignItems: "center", gap: "12px" }}>
  <button onClick={applyFilters} className="btn btn--primary" type="button">
    Aplicar filtros
  </button>

  <div className="soft-box filter-bar-total">
    Total: {osFiltradas.length}
  </div>
</div>






          </div>
        </div>

        {osFiltradas.length === 0 ? (
          <div className="card section">
            <div className="muted">Nenhuma OS para este filtro.</div>
          </div>
        ) : (
          <div className="list section">
            {osFiltradas.map((os) => {
              const aberto = !!detalhesAbertos[os.id];
              const toneClass = statusToneClass(os.status);

              return (
                <div key={os.id} className={`card table-like-row--status ${toneClass}`}>
                  <div className="os-card-layout">
                    <div className="os-card-main">
                      <div className="os-row-head" style={{ marginBottom: 14, alignItems: "center" }}>
                        <Link to={`/os/${os.id}`} className="os-row-title-link" style={{ textDecoration: "none" }}>
                          <strong
                            className="os-row-title"
                            style={{
                              fontWeight: 900,
                              fontSize: "1.35rem",
                              letterSpacing: "-0.02em",
                            }}
                          >
                            OS #{os.id}
                          </strong>
                        </Link>

                        <span
                          className={`badge badge--status ${statusBadgeClass(os.status)}`}
                          style={{
                            fontWeight: 900,
                            fontSize: "0.84rem",
                            padding: "8px 14px",
                          }}
                        >
                          {statusLabel(os.status)}
                        </span>
                      </div>

                      <div className="soft-box field-stack">
                        <div className="label field-label-tight">Cliente</div>
                        <div className="field-value-lg" style={{ fontWeight: 800 }}>
                          {os.cliente_nome || "-"}
                        </div>
                      </div>

                      <div className="grid-2 field-stack">
                        <div className="soft-box">
                          <div className="label field-label-tight">Veículo</div>
                          <div className="field-value-md" style={{ fontWeight: 700 }}>
                            {os.modelo || "-"}
                          </div>
                        </div>

                        <div className="soft-box">
                          <div className="label field-label-tight">Placa</div>
                          <div className="field-value-md" style={{ fontWeight: 700 }}>
                            {os.placa || "-"}
                          </div>
                        </div>
                      </div>

                      <div className="soft-box field-stack">
                        <div className="label field-label-tight">Problema relatado</div>
                        <div className="field-text" style={{ fontWeight: 500 }}>
                          {os.problema_relatado || "Sem descrição"}
                        </div>
                      </div>
                    </div>

                    <div className="os-card-side">
                      {!isTecnico ? (
                        <div className="soft-box">
                          <div className="label" style={{ marginBottom: 6 }}>
                            Valor da OS
                          </div>

                          <div className="kpi kpi--green">
                            {Number(os.valor_total) === 0 ? "Sem Valor No Orçamento" : money(os.valor_total)}
                          </div>
                        </div>
                      ) : null}

                      <div className="soft-box field-stack">
                        <div className="meta-label">Criada em</div>
                        <div className="meta-value" style={{ fontWeight: 800 }}>
                          {formatDateBR(os.created_at)}
                        </div>

                        {os.updated_at !== os.created_at && (
                          <>
                            <div className="meta-label" style={{ marginTop: 12 }}>
                              Atualizada em
                            </div>
                            <div className="meta-value" style={{ fontWeight: 800 }}>
                              {formatDateBR(os.updated_at)}
                            </div>
                          </>
                        )}
                      </div>

                      <div className="form-actions field-stack">
                        <Link to={`/os/${os.id}`}>
                          <button className="btn btn--solid" type="button">
                            Ver detalhes
                          </button>
                        </Link>

                        <button className="btn btn--ghost" type="button" onClick={() => toggleDetalhes(os.id)}>
                          {aberto ? "Fechar" : "Atualizar OS"}
                        </button>
                      </div>
                    </div>
                  </div>

                  {aberto ? (
                    <>
                      <div className="divider" />

                      <div className="grid-2">
                        <div className="soft-box">
                          <label className="label">Atualizar status</label>
                          <select value={os.status} onChange={(e) => mudarStatus(os.id, e.target.value)}>
                            {STATUS.map((status) => (
                              <option key={status} value={status}>
                                {statusLabel(status)}
                              </option>
                            ))}
                          </select>
                        </div>

                        {!isTecnico ? (
                          <div className="soft-box">
                            <label className="label">Ações rápidas</label>

                            {os.status === "aguardando_aprovacao" ? (
                              <button onClick={() => abrirWhatsapp(os.id)} className="btn whatsapp-btn" type="button">
                                Enviar orçamento no WhatsApp
                              </button>
                            ) : (
                              <div className="help">Disponível somente em “Aguardando aprovação”.</div>
                            )}
                          </div>
                        ) : null}
                      </div>
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
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

function AlertMessage({ message }) {
  const textoBase = String(message || "").toLowerCase();
  const texto = textoBase.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const isError =
    texto.includes("erro") ||
    texto.includes("expirada") ||
    texto.includes("inval") ||
    texto.includes("nao") ||
    texto.includes("obrigatorio");

  return <div className={`card section alert ${isError ? "alert--error" : "alert--success"}`}>{message}</div>;
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
