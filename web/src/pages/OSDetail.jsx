import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
  pronto_retirada: "Pronto para retirada",
  encerrado: "Encerrado",
  cancelado: "Cancelado",
};

export default function OSDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const token = useMemo(() => localStorage.getItem("token"), []);
  const user = getUser();
  const isTecnico = user?.role === "tecnico";

  const [os, setOs] = useState(null);
  const [pecas, setPecas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [addingPiece, setAddingPiece] = useState(false);
  const [removingPieceId, setRemovingPieceId] = useState(null);
  const [msg, setMsg] = useState("");
  const [initialForm, setInitialForm] = useState(emptyForm());
  const [form, setForm] = useState(emptyForm());
  const [pieceForm, setPieceForm] = useState({
    nome: "",
    quantidade: "1",
    valor_unitario: "",
  });

  const total = useMemo(
    () => parseMoneyInput(form.mao_obra) + parseMoneyInput(form.valor_pecas),
    [form.mao_obra, form.valor_pecas]
  );

  const pieceSubtotal = useMemo(() => {
    const qtd = Number(pieceForm.quantidade || 0);
    const unit = parseMoneyInput(pieceForm.valor_unitario);
    if (!Number.isFinite(qtd) || qtd <= 0) return 0;
    return qtd * unit;
  }, [pieceForm.quantidade, pieceForm.valor_unitario]);

  const hasUnsavedChanges = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(initialForm),
    [form, initialForm]
  );

  const whatsappDisabled =
    saving || addingPiece || form.status === "encerrado" || form.status === "cancelado";

  useEffect(() => {
    const handleBeforeUnload = (event) => {
      if (!hasUnsavedChanges || saving || addingPiece) return;
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges, saving, addingPiece]);

  useEffect(() => {
    loadOS();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function loadOS({ preserveMessage = false } = {}) {
    if (!token) {
      setMsg("Sessão não encontrada. Faça login novamente.");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      if (!preserveMessage) setMsg("");
const osData = await apiFetch(`/os/${id}`);

let pecasData = [];

if (!isTecnico) {
  pecasData = await apiFetch(`/os/${id}/pecas`);
}

const nextForm = buildFormState(osData);

setOs(osData);
setPecas(Array.isArray(pecasData) ? pecasData : []);
setForm(nextForm);
setInitialForm(nextForm);
    } catch (error) {
      setMsg(error.message);
    } finally {
      setLoading(false);
    }
  }

  function handleChange(field, value) {
    setForm((prev) => ({
      ...prev,
      [field]: field === "placa" ? value.toUpperCase() : value,
    }));
  }

  function handleMoneyChange(field, value) {
    setForm((prev) => ({
      ...prev,
      [field]: sanitizeMoneyInput(value),
    }));
  }

  function handleMoneyBlur(field) {
    setForm((prev) => {
      const currentValue = prev[field];

      if (!String(currentValue || "").trim()) {
        return {
          ...prev,
          [field]: "",
        };
      }

      return {
        ...prev,
        [field]: formatMoneyInput(currentValue),
      };
    });
  }

  function handlePieceFieldChange(field, value) {
    setPieceForm((prev) => ({
      ...prev,
      [field]:
        field === "valor_unitario" ? sanitizeMoneyInput(value) : value,
    }));
  }

  function handlePieceMoneyBlur() {
    setPieceForm((prev) => ({
      ...prev,
      valor_unitario: prev.valor_unitario
        ? formatMoneyInput(prev.valor_unitario)
        : "",
    }));
  }

  function resetPieceForm() {
    setPieceForm({
      nome: "",
      quantidade: "1",
      valor_unitario: "",
    });
  }

  function confirmDiscardChanges() {
    if (!hasUnsavedChanges) return true;
    return window.confirm("Há alterações não salvas. Deseja sair mesmo assim?");
  }

  function goTo(path) {
    if (!confirmDiscardChanges()) return;
    navigate(path);
  }

  async function salvarAlteracoes() {
    const problemaRelatado = form.problema_relatado.trim();

    if (!problemaRelatado) {
      setMsg("Informe a descrição do serviço.");
      return;
    }

    try {
      setSaving(true);
      setMsg("");

const payload = isTecnico
  ? {
      problema_relatado: problemaRelatado,
      status: form.status,
    }
  : {
      problema_relatado: problemaRelatado,
      modelo: form.modelo.trim(),
      placa: form.placa.trim(),
      mao_obra: parseMoneyInput(form.mao_obra),
      status: form.status,
    };

await apiFetch(`/os/${id}`, {
  method: "PUT",
  body: JSON.stringify(payload),
});

      await loadOS({ preserveMessage: true });
      setMsg(`OS #${id} salva com sucesso.`);
    } catch (error) {
      setMsg(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function adicionarPeca() {
    if (hasUnsavedChanges) {
      setMsg("Salve as alterações da OS antes de adicionar peças.");
      return;
    }

    const nome = String(pieceForm.nome || "").trim();
    const quantidade = Number(pieceForm.quantidade || 0);
    const valorUnitario = parseMoneyInput(pieceForm.valor_unitario);

    if (!nome) {
      setMsg("Informe o nome da peça.");
      return;
    }

    if (!Number.isFinite(quantidade) || quantidade <= 0) {
      setMsg("Informe uma quantidade válida para a peça.");
      return;
    }

    if (!Number.isFinite(valorUnitario) || valorUnitario < 0) {
      setMsg("Informe um valor unitário válido para a peça.");
      return;
    }

    try {
      setAddingPiece(true);
      setMsg("");

      await apiFetch(`/os/${id}/pecas`, {
        method: "POST",
        body: JSON.stringify({
          nome,
          quantidade,
          valor_unitario: valorUnitario,
        }),
      });

      resetPieceForm();
      await loadOS({ preserveMessage: true });
      setMsg(`Peça "${nome}" adicionada com sucesso.`);
    } catch (error) {
      setMsg(error.message);
    } finally {
      setAddingPiece(false);
    }
  }

  async function removerPeca(pecaId) {
    if (hasUnsavedChanges) {
      setMsg("Salve as alterações da OS antes de remover peças.");
      return;
    }

    const confirmed = window.confirm("Deseja remover esta peça da OS?");
    if (!confirmed) return;

    try {
      setRemovingPieceId(pecaId);
      setMsg("");

      await apiFetch(`/os/${id}/pecas/${pecaId}`, {
        method: "DELETE",
      });

      await loadOS({ preserveMessage: true });
      setMsg("Peça removida com sucesso.");
    } catch (error) {
      setMsg(error.message);
    } finally {
      setRemovingPieceId(null);
    }
  }

  async function abrirWhatsapp() {
    if (whatsappDisabled) return;

    try {
      setMsg("");
      const data = await apiFetch(`/os/${id}/whatsapp-link`);
      window.open(data.whatsapp_url, "_blank");
    } catch (error) {
      setMsg(error.message);
    }
  }

  function logout() {
    if (!confirmDiscardChanges()) return;
    clearToken();
    window.location.href = "/login";
  }

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
          <div className="card">Carregando detalhes da OS...</div>
        </div>
      </div>
    );
  }

  if (!os) {
    return (
      <div className="page">
        <div className="container">
          {msg ? <AlertMessage message={msg} /> : <div className="card">OS não encontrada.</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="container">
        <PageHeader
          eyebrow="Detalhes da ordem de serviço"
          title={`OS #${os.id}`}
          clientName={os.cliente_nome || "-"}
          footer={
            <span
              className={`info-chip ${
                hasUnsavedChanges ? "info-chip--unsaved" : "info-chip--saved"
              }`}
            >
              {hasUnsavedChanges ? "Alterações não salvas" : "Tudo salvo"}
            </span>
          }
          right={
            <>
              <button
                className="btn btn--header-main header-action--main"
                type="button"
                onClick={() => goTo("/os")}
              >
                Voltar para lista
              </button>





              {!isTecnico ? (
  <button
    className="btn btn--header-secondary"
    type="button"
    onClick={() => goTo("/dashboard")}
  >
    Dashboard
  </button>
) : null}








              <button
                onClick={logout}
                className="btn btn--header-danger"
                type="button"
              >
                Sair
              </button>
            </>
          }
        />

        {msg ? <AlertMessage message={msg} /> : null}

        <div className="section grid-2">
          <div className="card">
            <SectionTitle
              title="Resumo da OS"
              subtitle="Informações principais para leitura rápida."
            />

            <div className="soft-box detail-box">
              <div className="label detail-label-tight">Cliente</div>
              <div className="detail-value-lg">{os.cliente_nome || "-"}</div>
            </div>

            <div className="grid-2 section-gap-sm">
              <div className="soft-box">
                <div className="label detail-label-tight">Veículo</div>
                <div className="detail-value-md">{form.modelo || "-"}</div>
              </div>

              <div className="soft-box">
                <div className="label detail-label-tight">Placa</div>
                <div className="detail-value-md">{form.placa || "-"}</div>
              </div>
            </div>

            <div className="soft-box detail-box">
              <div className="label detail-label-tight">Descrição do serviço</div>
              <div className="detail-text">{form.problema_relatado || "Sem descrição"}</div>
            </div>
          </div>

          <div className="card">
            <SectionTitle
              title="Situação da OS"
              subtitle="Acompanhe datas, status e orçamento."
            />

            <div className="detail-status-row">
              <div className="status-pill-wrap">
                <div className="label detail-status-label">Status atual</div>
                <span className={`badge badge--status ${statusBadgeClass(form.status)}`}>
                  {statusLabel(form.status)}
                </span>
              </div>

              {!isTecnico ? (
                <button
                  onClick={abrirWhatsapp}
                  className="btn btn--primary whatsapp-btn"
                  type="button"
                  disabled={whatsappDisabled}
                  title={
                    whatsappDisabled
                      ? "Envio indisponível para OS encerrada ou cancelada."
                      : "Enviar orçamento no WhatsApp"
                  }
                >
                  Enviar orçamento no WhatsApp
                </button>
              ) : null}
            </div>

            <div className="grid-2">
              <div className="soft-box">
                <div className="label detail-label-tight">Criada em</div>
                <div className="detail-date-value">{formatDateBR(os.created_at)}</div>
              </div>

              <div className="soft-box">
                <div className="label detail-label-tight">Atualizada em</div>
                <div className="detail-date-value">{formatDateBR(os.updated_at)}</div>
              </div>
            </div>

            {!isTecnico ? (
              <div className="soft-box detail-box">
                <div className="label detail-label-tight">Total atual</div>
                <div className="kpi kpi--dark detail-kpi-compact">{money(total)}</div>
              </div>
            ) : null}
          </div>
        </div>

        {!isTecnico ? (
          <div className="section">
            <div className="card">
              <SectionTitle
                title="Peças da OS"
                subtitle="Adicione peças para montar o orçamento completo."
              />

              <div className="grid-3 section-gap-sm">
                <div className="form-group">
                  <label className="label">Nome da peça</label>
                  <input
                    type="text"
                    value={pieceForm.nome}
                    onChange={(event) => handlePieceFieldChange("nome", event.target.value)}
                    placeholder="Ex.: Filtro de óleo"
                  />
                </div>

                <div className="form-group">
                  <label className="label">Quantidade</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={pieceForm.quantidade}
                    onChange={(event) => handlePieceFieldChange("quantidade", event.target.value)}
                    placeholder="1"
                  />
                </div>

                <div className="form-group">
                  <label className="label">Valor unitário (R$)</label>
                  <input
                    className="input--money"
                    value={pieceForm.valor_unitario}
                    onChange={(event) => handlePieceFieldChange("valor_unitario", event.target.value)}
                    onBlur={handlePieceMoneyBlur}
                    inputMode="decimal"
                    placeholder="0,00"
                  />
                </div>
              </div>

              <div
                className="piece-form-actions section-gap-sm"
                style={{
                  marginTop: 16,
                  marginBottom: 18,
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 14,
                  alignItems: "end",
                }}
              >
                <div className="soft-box piece-subtotal-box">
                  <div className="label detail-label-tight">Subtotal da peça</div>
                  <div className="piece-subtotal-value">{money(pieceSubtotal)}</div>
                </div>

                <button
                  onClick={adicionarPeca}
                  className="btn btn--primary"
                  type="button"
                  disabled={addingPiece}
                  style={{ alignSelf: "end" }}
                >
                  {addingPiece ? "Adicionando..." : "Adicionar peça"}
                </button>
              </div>

              {pecas.length === 0 ? (
                <div className="empty-state-box section-gap-md">
                  Nenhuma peça adicionada nesta OS ainda.
                </div>
              ) : (
                <div
                  className="piece-list section-gap-md"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr",
                    gap: 14,
                    marginTop: 18,
                  }}
                >
                  {pecas.map((peca) => (
                    <div
                      key={peca.id}
                      className="piece-item"
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr",
                        gap: 10,
                        padding: 16,
                        border: "1px solid #d9e3ee",
                        borderRadius: 18,
                        background: "linear-gradient(180deg, #ffffff 0%, #f7fbff 100%)",
                        boxShadow: "0 8px 18px rgba(15, 23, 42, 0.05)",
                      }}
                    >
                      <div
                        className="piece-item-main"
                        style={{ display: "grid", gap: 6, minWidth: 0 }}
                      >
                        <div
                          className="piece-item-name"
                          style={{
                            fontSize: 18,
                            fontWeight: 900,
                            lineHeight: 1.25,
                            color: "var(--text)",
                            wordBreak: "break-word",
                          }}
                        >
                          {peca.nome}
                        </div>

                        <div
                          className="piece-item-meta"
                          style={{
                            fontSize: 15,
                            lineHeight: 1.5,
                            color: "var(--text-soft)",
                            wordBreak: "break-word",
                          }}
                        >
                          {Number(peca.quantidade)}x {money(peca.valor_unitario)} ={" "}
                          <strong>{money(peca.valor_total)}</strong>
                        </div>
                      </div>

                      <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={() => removerPeca(peca.id)}
                        disabled={removingPieceId === peca.id}
                        style={{ width: "100%" }}
                      >
                        {removingPieceId === peca.id ? "Removendo..." : "Remover"}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid-2 section-gap-md">
                <div className="soft-box total-box">
                  <div className="label detail-label-tight">Total das peças</div>
                  <div className="total-box-value">{money(parseMoneyInput(form.valor_pecas))}</div>
                </div>

                <div className="soft-box total-box">
                  <div className="label detail-label-tight">Total geral da OS</div>
                  <div className="total-box-value">{money(total)}</div>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="section">
          <div className="card">
            <SectionTitle
  title="Editar OS"
  subtitle={
    isTecnico
      ? "Atualize a descrição técnica e o status do serviço."
      : "Atualize dados, valores e andamento do serviço."
  }
/>

            <div className="form-group">
             <label className="label">Descrição do serviço</label>
              <textarea
                rows={5}
                value={form.problema_relatado}
                onChange={(event) => handleChange("problema_relatado", event.target.value)}
                placeholder="Descreva o serviço, diagnóstico ou observações técnicas..."
              />
            </div>





            {!isTecnico ? (
  <div className="grid-2 section-gap-sm">
    <div className="form-group">
      <label className="label">Modelo</label>
      <input
        type="text"
        value={form.modelo}
        onChange={(event) => handleChange("modelo", event.target.value)}
        placeholder="Ex.: Gol, Uno, Civic..."
      />
    </div>

    <div className="form-group">
      <label className="label">Placa</label>
      <input
        type="text"
        value={form.placa}
        onChange={(event) => handleChange("placa", event.target.value)}
        placeholder="ABC1D23"
        maxLength={8}
      />
    </div>
  </div>
) : null}



            

            {!isTecnico ? (
              <div className="grid-2 section-gap-sm">
                <div className="form-group">
                  <label className="label">Mão de obra (R$)</label>
                  <input
                    className="input--money"
                    value={form.mao_obra}
                    onChange={(event) => handleMoneyChange("mao_obra", event.target.value)}
                    onBlur={() => handleMoneyBlur("mao_obra")}
                    inputMode="decimal"
                    placeholder="0,00"
                  />
                </div>

                <div className="form-group">
                  <label className="label">Peças (R$)</label>
                  <input
                    className="input--money"
                    value={form.valor_pecas}
                    inputMode="decimal"
                    placeholder="0,00"
                    disabled
                    readOnly
                  />
                  <div className="help">
                    Total calculado automaticamente pelas peças adicionadas.
                  </div>
                </div>
              </div>
            ) : null}







            <div className="grid-2 section-gap-sm">
              <div className="form-group">
                <label className="label">Status</label>
                <select
                  value={form.status}
                  onChange={(event) => handleChange("status", event.target.value)}
                >
                  {STATUS.map((status) => (
                    <option key={status} value={status}>
                      {statusLabel(status)}
                    </option>
                  ))}
                </select>
              </div>

              {!isTecnico ? (
                <div className="soft-box total-box">
                  <div className="label detail-label-tight">Total calculado</div>
                  <div className="total-box-value">{money(total)}</div>
                </div>
              ) : null}
            </div>

            <div className="form-actions section-gap-md">
              <button
                onClick={salvarAlteracoes}
                className="btn btn--primary"
                type="button"
                disabled={saving}
              >
                {saving ? "Salvando..." : "Salvar alterações"}
              </button>

              <button
                className="btn btn--ghost"
                type="button"
                onClick={() => goTo("/os")}
              >
                Voltar para lista
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PageHeader({ eyebrow, title, clientName, footer, right }) {
  return (
    <div className="topbar">
      <div className="page-header-meta">
        <div className="page-eyebrow">{eyebrow}</div>
        <h1 className="page-title">{title}</h1>

        <div className="os-detail-header-client">
          <div className="os-detail-client-label">Cliente</div>
          <div className="os-detail-client-name">{clientName || "-"}</div>
        </div>

        {footer ? <div className="page-header-footer">{footer}</div> : null}
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

function AlertMessage({ message }) {
  const text = String(message || "").toLowerCase();
  const isError =
    text.includes("erro") ||
    text.includes("expirada") ||
    text.includes("obrigatório") ||
    text.includes("obrigatoria") ||
    text.includes("invál") ||
    text.includes("nao") ||
    text.includes("não");

  return (
    <div className={`card section alert ${isError ? "alert--error" : "alert--success"}`}>
      {message}
    </div>
  );
}

function emptyForm() {
  return {
    problema_relatado: "",
    modelo: "",
    placa: "",
    mao_obra: "",
    valor_pecas: "",
    status: "triagem",
  };
}

function buildFormState(data) {
  return {
    problema_relatado: data.problema_relatado || "",
    modelo: data.modelo || "",
    placa: data.placa || "",
    mao_obra: formatMoneyInput(data.mao_obra ?? 0),
    valor_pecas: formatMoneyInput(data.valor_pecas ?? 0),
    status: data.status || "triagem",
  };
}

function sanitizeMoneyInput(value) {
  return String(value ?? "").replace(/[^\d,.\s]/g, "").replace(/\s+/g, "");
}

function parseMoneyInput(value) {
  if (value === null || value === undefined || value === "") return 0;

  let text = String(value).trim();

  if (!text) return 0;

  text = text.replace(/\s+/g, "").replace(/[R$ ]/g, "");

  const hasComma = text.includes(",");
  const hasDot = text.includes(".");

  if (hasComma && hasDot) {
    if (text.lastIndexOf(",") > text.lastIndexOf(".")) {
      text = text.replace(/\./g, "").replace(",", ".");
    } else {
      text = text.replace(/,/g, "");
    }
  } else if (hasComma) {
    text = text.replace(/\./g, "").replace(",", ".");
  } else if (hasDot) {
    const parts = text.split(".");
    if (parts.length > 2) {
      const decimalPart = parts.pop();
      text = `${parts.join("")}.${decimalPart}`;
    }
  }

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoneyInput(value) {
  return parseMoneyInput(value).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function statusLabel(status) {
  return STATUS_LABEL[status] || status || "-";
}

function statusBadgeClass(status) {
  if (status === "encerrado") return "badge--success";
  if (status === "cancelado") return "badge--danger";
  if (status === "aguardando_aprovacao") return "badge--warning";
  if (status === "aprovado" || status === "em_execucao" || status === "aguardando_peca") {
    return "badge--default";
  }
  return "badge--gray";
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
