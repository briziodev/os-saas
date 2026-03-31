import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

const API = "http://localhost:3000";
const INITIAL_VISIBLE_PER_COLUMN = 4;

const COLUMNS = [
  { key: "triagem", title: "Triagem" },
  { key: "em_analise", title: "Em análise" },
  { key: "aguardando_aprovacao", title: "Aguardando aprovação" },
  { key: "aprovado", title: "Aprovado" },
  { key: "em_execucao", title: "Em execução" },
  { key: "aguardando_peca", title: "Aguardando peça" },
  { key: "pronto_retirada", title: "Pronto para retirada" },
  { key: "encerrado", title: "Encerrado" },
];

const STATUS_LABEL = Object.fromEntries(COLUMNS.map((c) => [c.key, c.title]));

function money(value) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function statusLabel(status) {
  return STATUS_LABEL[status] || status || "-";
}

function statusBadgeClass(status) {
  if (status === "encerrado" || status === "finalizado") return "badge--success";
  if (status === "cancelado") return "badge--danger";
  if (status === "aguardando_aprovacao" || status === "orcamento_enviado") return "badge--warning";

  if (
    status === "aprovado" ||
    status === "em_execucao" ||
    status === "aguardando_peca" ||
    status === "pronto_retirada"
  ) {
    return "badge--default";
  }

  return "badge--gray";
}

function getOrderTimestamp(os) {
  const raw = os?.updated_at || os?.created_at || 0;
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

export default function Kanban() {
  const token = useMemo(() => localStorage.getItem("token"), []);
  const [osList, setOsList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgType, setMsgType] = useState("success");
  const [expandedColumns, setExpandedColumns] = useState({});

  async function apiFetch(path, options = {}) {
    const res = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });

    const data = await res.json().catch(() => ({}));

    if (res.status === 401) {
      localStorage.removeItem("token");
      window.location.href = "/login";
      throw new Error("Sessão expirada. Faça login novamente.");
    }

    if (!res.ok) {
      throw new Error(data.error || `Erro ${res.status}`);
    }

    return data;
  }

  async function loadOS({ silent = false } = {}) {
    if (!silent) {
      setLoading(true);
      setMsg("");
    }

    setRefreshing(true);

    try {
      const data = await apiFetch("/os");
      setOsList(sortOSList(data));

      if (silent) {
        setMsgType("success");
        setMsg("Quadro atualizado com sucesso.");
      }
    } catch (e) {
      setMsgType("error");
      setMsg(e.message || "Erro ao carregar quadro.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadOS();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

      setMsgType("success");
      setMsg(`OS #${id} movida para ${statusLabel(novoStatus)}.`);
    } catch (e) {
      setMsgType("error");
      setMsg(e.message || "Erro ao atualizar status.");
    }
  }

  function toggleColumn(columnKey) {
    setExpandedColumns((prev) => ({
      ...prev,
      [columnKey]: !prev[columnKey],
    }));
  }

  if (!token) {
    return (
      <div className="page kanban-page">
        <div className="container">
          <div className="card alert alert--error">
            Sessão não encontrada. Faça login novamente.
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="page kanban-page">
        <div className="container">
          <div className="card">
            <div className="muted">Carregando quadro de OS...</div>
          </div>
        </div>
      </div>
    );
  }

  const byStatus = Object.fromEntries(COLUMNS.map((c) => [c.key, []]));

  for (const os of osList) {
    if (byStatus[os.status]) {
      byStatus[os.status].push(os);
    }
  }

  for (const key of Object.keys(byStatus)) {
    byStatus[key] = sortOSList(byStatus[key]);
  }

  const totalOS = osList.length;

  return (
    <div className="page kanban-page">
      <div className="container">
        <div className="topbar kanban-topbar">
          <div className="page-header-meta">
            <div className="page-eyebrow">Fluxo operacional</div>
            <h1 className="page-title">Quadro de OS</h1>

            <p className="page-description">
              Acompanhe as ordens por etapa e atualize o andamento da oficina de forma simples.
            </p>

            <div className="page-header-footer">
              <div className="info-chip info-chip--dark">
                Total no quadro: {totalOS} OS
              </div>
            </div>
          </div>

          <div className="kanban-topbar-actions">
            <Link to="/os" className="kanban-topbar-main-link">
              <button className="btn btn--ghost" type="button">
                Lista de OS
              </button>
            </Link>

            <div className="kanban-topbar-secondary">
              <Link to="/dashboard">
                <button className="btn btn--ghost-dark" type="button">
                  Dashboard
                </button>
              </Link>

              <button
                onClick={() => loadOS({ silent: true })}
                className="btn btn--solid"
                type="button"
                disabled={refreshing}
              >
                {refreshing ? "Atualizando..." : "Atualizar"}
              </button>
            </div>
          </div>
        </div>

        {msg ? (
          <div className="section">
            <div className={`card alert ${msgType === "error" ? "alert--error" : "alert--success"}`}>
              {msg}
            </div>
          </div>
        ) : null}

        <div className="section">
          <div className="section-header">
            <h2>Etapas da oficina</h2>
            <div className="section-subtitle">
              Visualize as ordens por etapa e atualize o status de cada OS.
            </div>
          </div>

          <div className="kanban-board">
            {COLUMNS.map((col) => {
              const allCards = byStatus[col.key];
              const isExpanded = Boolean(expandedColumns[col.key]);
              const visibleCards = isExpanded
                ? allCards
                : allCards.slice(0, INITIAL_VISIBLE_PER_COLUMN);
              const hiddenCount = Math.max(allCards.length - INITIAL_VISIBLE_PER_COLUMN, 0);

              return (
                <section key={col.key} className="kanban-column">
                  <div className={`kanban-column-head kanban-column-head--${col.key}`}>
                    <div className="kanban-stage-title">{col.title}</div>

                    <div className="kanban-stage-meta">
                      <div className="kanban-stage-count">
                        {allCards.length} OS nesta etapa
                      </div>
                      <div className="kanban-stage-pill">{allCards.length}</div>
                    </div>
                  </div>

                  <div className="kanban-column-body">
                    {allCards.length === 0 ? (
                      <div className="kanban-empty">Nenhuma ordem nesta etapa.</div>
                    ) : (
                      <>
                        <div className="kanban-card-list">
                          {visibleCards.map((os) => (
                            <article key={os.id} className="kanban-os-card">
                              <div className="kanban-os-card-head">
                                <div className="kanban-os-title-wrap">
                                  <Link to={`/os/${os.id}`} className="kanban-os-link">
                                    OS #{os.id}
                                  </Link>

                                  <Link to={`/os/${os.id}`} className="kanban-os-open-link">
                                    Abrir detalhes
                                  </Link>
                                </div>

                                <span className={`badge badge--status ${statusBadgeClass(os.status)}`}>
                                  {statusLabel(os.status)}
                                </span>
                              </div>

                              <div className="kanban-os-price">{money(os.valor_total)}</div>

                              <div className="kanban-os-body">
                                <div className="kanban-field">
                                  <div className="kanban-field-label">Cliente</div>
                                  <div className="kanban-field-value">{os.cliente_nome || "-"}</div>
                                </div>

                                <div className="kanban-os-meta">
                                  <span>{os.modelo || "Modelo não informado"}</span>
                                  <span>•</span>
                                  <span>{os.placa || "Placa não informada"}</span>
                                </div>
                              </div>

                              <div className="kanban-os-actions">
                                <div className="kanban-select-wrap">
                                  <label className="label kanban-select-label">Mover para etapa</label>
                                  <select
                                    value={os.status}
                                    onChange={(e) => moverStatus(os.id, e.target.value)}
                                  >
                                    {COLUMNS.map((c) => (
                                      <option key={c.key} value={c.key}>
                                        {c.title}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                            </article>
                          ))}
                        </div>

                        {allCards.length > INITIAL_VISIBLE_PER_COLUMN ? (
                          <div className="kanban-column-footer">
                            <button
                              type="button"
                              className="btn btn--ghost kanban-column-toggle"
                              onClick={() => toggleColumn(col.key)}
                            >
                              {isExpanded
                                ? "Mostrar menos"
                                : `Ver mais ${hiddenCount} OS`}
                            </button>
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}