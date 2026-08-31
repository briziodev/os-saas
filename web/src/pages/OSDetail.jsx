import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiFetch, clearToken, getUser } from "../api";
import { AppIcon } from "../components/AppIcon";
import { appIcons } from "../config/icons";
import "./OSDetail.css";


const OSDETAIL_ICON_MAP = {
  home: appIcons.dashboard,
  list: appIcons.os,
  board: appIcons.kanban,
  users: appIcons.clientes,
  user: appIcons.usuario,
  clipboard: appIcons.os,
  car: appIcons.veiculo,
  plate: appIcons.veiculo,
  clock: appIcons.historico,
  calendar: appIcons.calendario,
  dollar: appIcons.financeiro,
  file: appIcons.os,
  trend: appIcons.osAndamento,
  parts: appIcons.pecas,
  edit: appIcons.editar,
  box: appIcons.pecas,
  filter: appIcons.filtrar,
  save: appIcons.salvar,
  arrowLeft: appIcons.voltar,
  grid: appIcons.dashboard,
  phone: appIcons.whatsapp,
  logOut: appIcons.sair,
  check: appIcons.sucesso,
  trash: appIcons.excluir,
};

function Icon({ name, className = "" }) {
  return (
    <AppIcon
      icon={OSDETAIL_ICON_MAP[name] || appIcons.os}
      className={`osdetail-premium-iconify-icon ${className}`.trim()}
      size={20}
    />
  );
}
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

const WHATSAPP_ALLOWED_STATUSES = new Set([
  "triagem",
  "em_analise",
  "aguardando_aprovacao",
  "orcamento_enviado",
]);

export default function OSDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const token = useMemo(() => localStorage.getItem("token"), []);
  const user = getUser();
  const isTecnico = user?.role === "tecnico";
  const isAdmin = user?.role === "admin";
  const canSeeDashboard = !isTecnico;
  const canSeeClientes = !isTecnico;
  const canSeeUsers = user?.role === "admin";

  const [os, setOs] = useState(null);
  const [pecas, setPecas] = useState([]);
  const [eventos, setEventos] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingWhatsapp, setSendingWhatsapp] = useState(false);
  const [addingPiece, setAddingPiece] = useState(false);
  const [removingPieceId, setRemovingPieceId] = useState(null);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [reopening, setReopening] = useState(false);
  const [reopenFeedback, setReopenFeedback] = useState("");
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discardReason, setDiscardReason] = useState("");
  const [discarding, setDiscarding] = useState(false);
  const [discardFeedback, setDiscardFeedback] = useState("");
  const [msg, setMsg] = useState("");
  const [pieceFeedback, setPieceFeedback] = useState(null);
  const [initialForm, setInitialForm] = useState(emptyForm());
  const [form, setForm] = useState(emptyForm());
  const [pieceForm, setPieceForm] = useState({
    nome: "",
    quantidade: "1",
    valor_unitario: "",
  });

  const isCancelled = os?.status === "cancelado";

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

  const canDiscardOS =
    os?.capabilities?.can_discard === true &&
    !isTecnico;

  const discardActionDisabled =
    saving ||
    addingPiece ||
    sendingWhatsapp ||
    reopening ||
    removingPieceId !== null ||
    discarding;

  const discardActionDisabledReason = useMemo(() => {
    if (
      saving ||
      addingPiece ||
      sendingWhatsapp ||
      reopening ||
      removingPieceId !== null ||
      discarding
    ) {
      return "Aguarde a operação atual terminar antes de excluir a OS.";
    }

    return "";
  }, [
    addingPiece,
    discarding,
    removingPieceId,
    reopening,
    saving,
    sendingWhatsapp,
  ]);

  const whatsappDisabled =
    saving ||
    addingPiece ||
    sendingWhatsapp ||
    hasUnsavedChanges ||
    !WHATSAPP_ALLOWED_STATUSES.has(form.status);

  const whatsappDisabledReason = useMemo(() => {
    if (sendingWhatsapp) return "Preparando orçamento...";
    if (saving || addingPiece) return "Aguarde a operação atual terminar.";
    if (hasUnsavedChanges) return "Salve as alterações da OS antes de preparar o orçamento.";
    if (!WHATSAPP_ALLOWED_STATUSES.has(form.status)) {
      return `Envio indisponível para OS com status ${statusLabel(form.status)}.`;
    }
    return "";
  }, [addingPiece, form.status, hasUnsavedChanges, saving, sendingWhatsapp]);

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
    if (!discardOpen) return undefined;

    const previousOverflow =
      document.body.style.overflow;

    document.body.style.overflow = "hidden";

    const handleDiscardEscape = (event) => {
      if (event.key !== "Escape" || discarding) return;

      setDiscardOpen(false);
      setDiscardReason("");
      setDiscardFeedback("");
    };

    document.addEventListener("keydown", handleDiscardEscape);

    return () => {
      document.removeEventListener(
        "keydown",
        handleDiscardEscape
      );
      document.body.style.overflow = previousOverflow;
    };
  }, [discardOpen, discarding]);

  useEffect(() => {
    loadOS();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function loadOS({ preserveMessage = false, silent = false } = {}) {
    if (!token) {
      setMsg("Sessão não encontrada. Faça login novamente.");
      setLoading(false);
      return;
    }

    try {
      if (!silent) setLoading(true);
      if (!preserveMessage) setMsg("");

      const osData = await apiFetch(`/os/${id}`);
      let pecasData = [];
      let eventosData = [];

      if (!isTecnico) {
        pecasData = await apiFetch(`/os/${id}/pecas`);
      }

      try {
        setEventsLoading(true);
        eventosData = await apiFetch(`/os/${id}/events`);
      } catch {
        eventosData = [];
      } finally {
        setEventsLoading(false);
      }

      const nextForm = buildFormState(osData);

      setOs(osData);
      setPecas(Array.isArray(pecasData) ? pecasData : []);
      setEventos(Array.isArray(eventosData) ? eventosData : []);
      setForm(nextForm);
      setInitialForm(nextForm);
      setReopenOpen(false);
      setReopenReason("");
      setReopenFeedback("");
      setDiscardOpen(false);
      setDiscardReason("");
      setDiscardFeedback("");
    } catch (error) {
      setMsg(error.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  function handleChange(field, value) {
    setMsg("");
    setForm((prev) => ({
      ...prev,
      [field]: field === "placa" ? value.toUpperCase() : value,
    }));
  }

  function handleMoneyChange(field, value) {
    setMsg("");
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
    setPieceFeedback(null);
    setPieceForm((prev) => ({
      ...prev,
      [field]: field === "valor_unitario" ? sanitizeMoneyInput(value) : value,
    }));
  }

  function handlePieceMoneyBlur() {
    setPieceForm((prev) => ({
      ...prev,
      valor_unitario: prev.valor_unitario ? formatMoneyInput(prev.valor_unitario) : "",
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
    if (isCancelled) {
      setMsg("Esta OS está cancelada e só pode ser alterada após reabertura.");
      return;
    }

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
    if (isCancelled) {
      setPieceFeedback({ type: "error", message: "OS cancelada: não é possível adicionar peças." });
      return;
    }

    if (hasUnsavedChanges) {
      setPieceFeedback({ type: "error", message: "Salve as alterações da OS antes de adicionar peças." });
      return;
    }

    const nome = String(pieceForm.nome || "").trim();
    const quantidade = Number(pieceForm.quantidade || 0);
    const valorUnitario = parseMoneyInput(pieceForm.valor_unitario);

    if (!nome) {
      setPieceFeedback({ type: "error", message: "Informe o nome da peça." });
      return;
    }

    if (!Number.isFinite(quantidade) || quantidade <= 0) {
      setPieceFeedback({ type: "error", message: "Informe uma quantidade válida para a peça." });
      return;
    }

    if (!Number.isFinite(valorUnitario) || valorUnitario < 0) {
      setPieceFeedback({ type: "error", message: "Informe um valor unitário válido para a peça." });
      return;
    }

    try {
      setAddingPiece(true);
      setPieceFeedback(null);

      await apiFetch(`/os/${id}/pecas`, {
        method: "POST",
        body: JSON.stringify({
          nome,
          quantidade,
          valor_unitario: valorUnitario,
        }),
      });

      resetPieceForm();
      await loadOS({ preserveMessage: true, silent: true });
      setPieceFeedback({ type: "success", message: `Peça "${nome}" adicionada com sucesso.` });
    } catch (error) {
      setPieceFeedback({ type: "error", message: error.message });
    } finally {
      setAddingPiece(false);
    }
  }

  async function removerPeca(pecaId) {
    if (isCancelled) {
      setPieceFeedback({ type: "error", message: "OS cancelada: não é possível remover peças." });
      return;
    }

    if (hasUnsavedChanges) {
      setPieceFeedback({ type: "error", message: "Salve as alterações da OS antes de remover peças." });
      return;
    }

    const confirmed = window.confirm("Deseja remover esta peça da OS?");
    if (!confirmed) return;

    try {
      setRemovingPieceId(pecaId);
      setPieceFeedback(null);

      await apiFetch(`/os/${id}/pecas/${pecaId}`, {
        method: "DELETE",
      });

      await loadOS({ preserveMessage: true, silent: true });
      setPieceFeedback({ type: "success", message: "Peça removida com sucesso." });
    } catch (error) {
      setPieceFeedback({ type: "error", message: error.message });
    } finally {
      setRemovingPieceId(null);
    }
  }

  function abrirPainelReabertura() {
    setMsg("");
    setReopenFeedback("");
    setReopenReason("");
    setReopenOpen(true);
  }

  function fecharPainelReabertura() {
    if (reopening) return;
    setReopenOpen(false);
    setReopenFeedback("");
    setReopenReason("");
  }

  async function reabrirOS() {
    const motivo = String(reopenReason || "").trim();

    if (motivo.length < 10) {
      setReopenFeedback("Informe um motivo com pelo menos 10 caracteres.");
      return;
    }

    if (motivo.length > 500) {
      setReopenFeedback("O motivo deve ter no máximo 500 caracteres.");
      return;
    }

    const confirmed = window.confirm(
      "Confirma a reabertura desta OS? Ela voltará para Triagem e poderá ser editada novamente."
    );

    if (!confirmed) return;

    try {
      setReopening(true);
      setReopenFeedback("");
      setMsg("");

      await apiFetch(`/os/${id}/reabrir`, {
        method: "POST",
        body: JSON.stringify({ motivo }),
      });

      setReopenOpen(false);
      setReopenReason("");
      await loadOS({ preserveMessage: true, silent: true });
      setMsg(`OS #${id} reaberta com sucesso e movida para Triagem.`);
    } catch (error) {
      setReopenFeedback(error.message);
    } finally {
      setReopening(false);
    }
  }

  function abrirDescarteSeguro() {
    if (!canDiscardOS) {
      setMsg("Esta OS não está disponível para exclusão controlada.");
      return;
    }

    if (discardActionDisabled) {
      if (discardActionDisabledReason) {
        setMsg(discardActionDisabledReason);
      }
      return;
    }

    setMsg("");
    setDiscardFeedback("");
    setDiscardReason("");
    setDiscardOpen(true);
  }

  function fecharDescarteSeguro() {
    if (discarding) return;
    setDiscardOpen(false);
    setDiscardReason("");
    setDiscardFeedback("");
  }

  async function descartarOS() {
    const motivo = String(discardReason || "").trim();

    if (!canDiscardOS) {
      setDiscardFeedback(
        "Esta OS não está mais disponível para exclusão controlada."
      );
      return;
    }

    if (motivo.length < 10) {
      setDiscardFeedback(
        "Informe um motivo com pelo menos 10 caracteres."
      );
      return;
    }

    if (motivo.length > 500) {
      setDiscardFeedback(
        "O motivo deve ter no máximo 500 caracteres."
      );
      return;
    }

    try {
      setDiscarding(true);
      setDiscardFeedback("");
      setMsg("");

      await apiFetch(`/os/${id}/descartar`, {
        method: "POST",
        body: JSON.stringify({ motivo }),
      });

      navigate("/os", {
        replace: true,
      });
    } catch (error) {
      if (
        error?.status === 409 ||
        error?.code === "OS_DISCARD_NOT_ALLOWED"
      ) {
        await loadOS({
          preserveMessage: true,
          silent: true,
        });

        setDiscardOpen(false);
        setDiscardReason("");
        setDiscardFeedback("");
        setMsg(
          "Esta OS deixou de atender aos critérios para exclusão controlada. O estado foi atualizado."
        );
        return;
      }

      setDiscardFeedback(error.message);
    } finally {
      setDiscarding(false);
    }
  }

  async function abrirWhatsapp() {
    if (whatsappDisabled) {
      if (whatsappDisabledReason) setMsg(whatsappDisabledReason);
      return;
    }

    const whatsappWindow = openWhatsappLoadingWindow();

    try {
      setSendingWhatsapp(true);
      setMsg("");

      const data = await apiFetch(`/os/${id}/enviar-orcamento`, {
        method: "POST",
      });

      if (whatsappWindow) {
        whatsappWindow.location.replace(data.whatsapp_url);
      } else {
        window.location.assign(data.whatsapp_url);
        return;
      }

      await loadOS({ preserveMessage: true, silent: true });

      setMsg(
        data.status_changed
          ? `Orçamento preparado. A OS #${id} foi movida para Aguardando aprovação.`
          : `Orçamento da OS #${id} preparado novamente.`
      );
    } catch (error) {
      whatsappWindow?.close();
      setMsg(error.message);
    } finally {
      setSendingWhatsapp(false);
    }
  }

  function logout() {
    if (!confirmDiscardChanges()) return;
    clearToken();
    window.location.href = "/login";
  }

  if (!token) {
    return <StatePage message="Sem sessão. Faça login novamente." />;
  }

  if (loading) {
    return <StatePage message="Carregando detalhes da OS..." />;
  }

  if (!os) {
    return <StatePage message={msg || "OS não encontrada."} isError />;
  }

  return (
    <div className="osdetail-premium-page">
      <DesktopSidebar
        user={user}
        canSeeDashboard={canSeeDashboard}
        canSeeClientes={canSeeClientes}
        canSeeUsers={canSeeUsers}
        onLogout={logout}
      />

      <main className="osdetail-premium-main">
        <MobileHero
          os={os}
          form={form}
          hasUnsavedChanges={hasUnsavedChanges}
          canSeeDashboard={canSeeDashboard}
          onBack={() => goTo("/os")}
          onDashboard={() => goTo("/dashboard")}
          onLogout={logout}
        />

        <div className="osdetail-premium-container">
          <DesktopHeader
            os={os}
            form={form}
            total={total}
            isTecnico={isTecnico}
            hasUnsavedChanges={hasUnsavedChanges}
            canSeeDashboard={canSeeDashboard}
            whatsappDisabled={whatsappDisabled}
            whatsappDisabledReason={whatsappDisabledReason}
            sendingWhatsapp={sendingWhatsapp}
            onBack={() => goTo("/os")}
            onDashboard={() => goTo("/dashboard")}
            onWhatsapp={abrirWhatsapp}
          />

          {msg ? <AlertMessage message={msg} /> : null}

          {isCancelled ? (
            <CancelledOSBanner
              isAdmin={isAdmin}
              reopenOpen={reopenOpen}
              reopenReason={reopenReason}
              reopenFeedback={reopenFeedback}
              reopening={reopening}
              onOpen={abrirPainelReabertura}
              onClose={fecharPainelReabertura}
              onReasonChange={(value) => {
                setReopenReason(value);
                setReopenFeedback("");
              }}
              onConfirm={reabrirOS}
            />
          ) : null}

          {canDiscardOS ? (
            <SafeDiscardAction
              disabled={discardActionDisabled}
              disabledReason={discardActionDisabledReason}
              hasUnsavedChanges={hasUnsavedChanges}
              onOpen={abrirDescarteSeguro}
            />
          ) : null}

          <DesktopMetaStrip os={os} form={form} total={total} isTecnico={isTecnico} />

          <section className="osdetail-premium-grid-main">
            <ResumoCard os={os} form={form} />
            <SituacaoCard
              os={os}
              form={form}
              total={total}
              isTecnico={isTecnico}
              whatsappDisabled={whatsappDisabled}
              whatsappDisabledReason={whatsappDisabledReason}
              sendingWhatsapp={sendingWhatsapp}
              onWhatsapp={abrirWhatsapp}
            />
          </section>

          {!isTecnico ? (
            <section className="osdetail-premium-grid-secondary">
              <PecasCard
                pecas={pecas}
                form={form}
                total={total}
                pieceForm={pieceForm}
                pieceSubtotal={pieceSubtotal}
                pieceFeedback={pieceFeedback}
                addingPiece={addingPiece}
                removingPieceId={removingPieceId}
                readOnly={isCancelled}
                onPieceChange={handlePieceFieldChange}
                onPieceMoneyBlur={handlePieceMoneyBlur}
                onAddPiece={adicionarPeca}
                onRemovePiece={removerPeca}
              />

              <EditarCard
                form={form}
                total={total}
                saving={saving}
                isTecnico={isTecnico}
                readOnly={isCancelled}
                onChange={handleChange}
                onMoneyChange={handleMoneyChange}
                onMoneyBlur={handleMoneyBlur}
                onSave={salvarAlteracoes}
                onBack={() => goTo("/os")}
              />
            </section>
          ) : (
            <section className="osdetail-premium-grid-secondary osdetail-premium-grid-secondary--single">
              <EditarCard
                form={form}
                total={total}
                saving={saving}
                isTecnico={isTecnico}
                readOnly={isCancelled}
                onChange={handleChange}
                onMoneyChange={handleMoneyChange}
                onMoneyBlur={handleMoneyBlur}
                onSave={salvarAlteracoes}
                onBack={() => goTo("/os")}
              />
            </section>
          )}

          <HistoricoCard eventos={eventos} loading={eventsLoading} isTecnico={isTecnico} />

          <div className="osdetail-premium-footer-note">
            OS criada em {formatDateBR(os.created_at)} · Última atualização em {formatDateBR(os.updated_at)}
          </div>
        </div>
      </main>

      {discardOpen ? (
        <SafeDiscardModal
          osId={os.id}
          reason={discardReason}
          feedback={discardFeedback}
          discarding={discarding}
          hasUnsavedChanges={hasUnsavedChanges}
          onReasonChange={(value) => {
            setDiscardReason(value);
            setDiscardFeedback("");
          }}
          onClose={fecharDescarteSeguro}
          onConfirm={descartarOS}
        />
      ) : null}
    </div>
  );
}

function SafeDiscardAction({
  disabled,
  disabledReason,
  hasUnsavedChanges,
  onOpen,
}) {
  return (
    <section className="osdetail-safe-discard-action">
      <div className="osdetail-safe-discard-action-copy">
        <span className="osdetail-safe-discard-icon" aria-hidden="true">
          <Icon name="trash" />
        </span>
        <div>
          <strong>OS criada por engano?</strong>
          <p>
            Esta opção está disponível apenas enquanto a OS ainda não possui
            movimentações que precisem ser preservadas.
          </p>
          {hasUnsavedChanges ? (
            <small role="status">
              Há alterações locais não salvas. Elas serão perdidas se a
              exclusão for confirmada.
            </small>
          ) : null}
          {disabledReason ? (
            <small role="status">{disabledReason}</small>
          ) : null}
        </div>
      </div>

      <button
        type="button"
        className="osdetail-safe-discard-open"
        onClick={onOpen}
        disabled={disabled}
      >
        <Icon name="trash" />
        Excluir OS criada por engano
      </button>
    </section>
  );
}

function SafeDiscardModal({
  osId,
  reason,
  feedback,
  discarding,
  hasUnsavedChanges,
  onReasonChange,
  onClose,
  onConfirm,
}) {
  const trimmedLength =
    String(reason || "").trim().length;

  const canConfirm =
    trimmedLength >= 10 &&
    trimmedLength <= 500 &&
    !discarding;

  return (
    <div className="osdetail-safe-discard-backdrop">
      <section
        className="osdetail-safe-discard-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="os-safe-discard-title"
        aria-describedby="os-safe-discard-description"
      >
        <div className="osdetail-safe-discard-modal-head">
          <span className="osdetail-safe-discard-modal-icon" aria-hidden="true">
            <Icon name="trash" />
          </span>

          <div>
            <span>Exclusão controlada</span>
            <h2 id="os-safe-discard-title">
              Excluir a OS #{osId} criada por engano?
            </h2>
          </div>
        </div>

        <div
          id="os-safe-discard-description"
          className="osdetail-safe-discard-warning"
        >
          <strong>Esta ação é permanente.</strong>
          <p>
            Use somente quando a OS foi criada por engano e ainda não virou
            histórico operacional. O sistema verificará novamente todas as
            regras antes de excluir.
          </p>
          {hasUnsavedChanges ? (
            <p>
              Há alterações locais não salvas nesta tela. Elas também serão
              perdidas ao confirmar a exclusão.
            </p>
          ) : null}
        </div>

        <label
          className="osdetail-safe-discard-field"
          htmlFor="os-safe-discard-reason"
        >
          <span>Motivo da exclusão</span>
          <textarea
            id="os-safe-discard-reason"
            rows={5}
            value={reason}
            onChange={(event) =>
              onReasonChange(event.target.value)
            }
            minLength={10}
            maxLength={500}
            disabled={discarding}
            autoFocus
            placeholder="Ex.: Cliente selecionado incorretamente na criação da OS."
          />
        </label>

        <div className="osdetail-safe-discard-counter">
          {trimmedLength}/500 caracteres
        </div>

        {feedback ? (
          <div
            className="osdetail-safe-discard-feedback"
            role="alert"
          >
            {feedback}
          </div>
        ) : null}

        <div className="osdetail-safe-discard-modal-actions">
          <button
            type="button"
            className="osdetail-premium-btn osdetail-premium-btn--ghost"
            onClick={onClose}
            disabled={discarding}
          >
            Cancelar
          </button>

          <button
            type="button"
            className="osdetail-safe-discard-confirm"
            onClick={onConfirm}
            disabled={!canConfirm}
          >
            <Icon name="trash" />
            {discarding
              ? "Excluindo..."
              : "Excluir permanentemente"}
          </button>
        </div>
      </section>
    </div>
  );
}

function CancelledOSBanner({
  isAdmin,
  reopenOpen,
  reopenReason,
  reopenFeedback,
  reopening,
  onOpen,
  onClose,
  onReasonChange,
  onConfirm,
}) {
  return (
    <section className="osdetail-premium-cancelled-banner" role="status">
      <div className="osdetail-premium-cancelled-banner-copy">
        <strong>OS cancelada — somente leitura</strong>
        <p>
          Dados, valores, peças, status e orçamento estão bloqueados para preservar a rastreabilidade.
        </p>
        {!isAdmin ? (
          <small>Somente um administrador pode reabrir esta OS.</small>
        ) : null}
      </div>

      {isAdmin && !reopenOpen ? (
        <button
          type="button"
          className="osdetail-premium-reopen-button"
          onClick={onOpen}
        >
          Reabrir OS
        </button>
      ) : null}

      {isAdmin && reopenOpen ? (
        <div className="osdetail-premium-reopen-panel">
          <label htmlFor="os-reopen-reason">Motivo da reabertura</label>
          <textarea
            id="os-reopen-reason"
            rows={4}
            value={reopenReason}
            onChange={(event) => onReasonChange(event.target.value)}
            maxLength={500}
            disabled={reopening}
            placeholder="Ex.: Cliente autorizou a retomada do diagnóstico."
          />
          <div className="osdetail-premium-reopen-counter">
            {reopenReason.trim().length}/500 caracteres
          </div>

          {reopenFeedback ? (
            <div className="osdetail-premium-reopen-feedback">
              {reopenFeedback}
            </div>
          ) : null}

          <div className="osdetail-premium-reopen-actions">
            <button
              type="button"
              className="osdetail-premium-btn osdetail-premium-btn--ghost"
              onClick={onClose}
              disabled={reopening}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="osdetail-premium-btn osdetail-premium-btn--primary"
              onClick={onConfirm}
              disabled={reopening || reopenReason.trim().length < 10}
            >
              {reopening ? "Reabrindo..." : "Confirmar reabertura"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function StatePage({ message, isError = false }) {
  return (
    <div className="osdetail-premium-state-page">
      <div className={`osdetail-premium-state-card ${isError ? "is-error" : ""}`}>
        {message}
      </div>
    </div>
  );
}

function DesktopSidebar({ user, canSeeDashboard, canSeeClientes, canSeeUsers, onLogout }) {
  return (
    <aside className="osdetail-premium-sidebar">
      <div className="osdetail-premium-brand">
        <div className="osdetail-premium-logo">OP</div>
        <div>
          <strong>OficinaPro</strong>
          <span>Gestão de oficina</span>
        </div>
      </div>

      <nav className="osdetail-premium-menu" aria-label="Menu principal">
        {canSeeDashboard ? (
          <Link to="/dashboard" className="osdetail-premium-menu-item">
            <span><Icon name="home" /></span> Dashboard
          </Link>
        ) : null}

        <Link to="/os" className="osdetail-premium-menu-item is-active">
          <span><Icon name="clipboard" /></span> OS
        </Link>

        <Link to="/kanban" className="osdetail-premium-menu-item">
          <span><Icon name="board" /></span> Quadro de OS
        </Link>

        {canSeeClientes ? (
          <Link to="/clientes" className="osdetail-premium-menu-item">
            <span><Icon name="users" /></span> Clientes
          </Link>
        ) : null}

        {canSeeUsers ? (
          <Link to="/usuarios" className="osdetail-premium-menu-item">
            <span><Icon name="user" /></span> Usuários
          </Link>
        ) : null}
      </nav>

      <div className="osdetail-premium-sidebar-footer">
        <div className="osdetail-premium-user-card">
          <div className="osdetail-premium-user-avatar">{initials(user?.name || user?.email || "U")}</div>
          <div>
            <strong>{firstName(user?.name || user?.email || "Usuário")}</strong>
            <span>{roleLabel(user?.role)}</span>
          </div>
        </div>

        <button type="button" className="osdetail-premium-logout" onClick={onLogout}>
          <Icon name="logOut" /> Sair
        </button>
      </div>
    </aside>
  );
}

function DesktopHeader({
  os,
  form,
  total,
  isTecnico,
  hasUnsavedChanges,
  canSeeDashboard,
  whatsappDisabled,
  whatsappDisabledReason,
  sendingWhatsapp,
  onBack,
  onDashboard,
  onWhatsapp,
}) {
  return (
    <header className="osdetail-premium-header">
      <div>
        <div className="osdetail-premium-eyebrow">Detalhes da ordem de serviço</div>
        <div className="osdetail-premium-title-row">
          <h1>OS #{os.id}</h1>
          <span className={`osdetail-premium-save-pill ${hasUnsavedChanges ? "is-unsaved" : "is-saved"}`}>
            {hasUnsavedChanges ? "Alterações não salvas" : "Tudo salvo"}
          </span>
        </div>
      </div>

      <div className="osdetail-premium-header-actions">
        <button type="button" className="osdetail-premium-btn osdetail-premium-btn--ghost" onClick={onBack}>
          <Icon name="arrowLeft" /> Voltar para lista
        </button>

        {canSeeDashboard ? (
          <button type="button" className="osdetail-premium-btn osdetail-premium-btn--ghost" onClick={onDashboard}>
            <Icon name="grid" /> Dashboard
          </button>
        ) : null}

        {!isTecnico ? (
          <div className="osdetail-premium-whatsapp-action osdetail-premium-whatsapp-action--header">
            <button
              type="button"
              className="osdetail-premium-btn osdetail-premium-btn--primary"
              onClick={onWhatsapp}
              disabled={whatsappDisabled}
              title={whatsappDisabledReason || "Preparar orçamento no WhatsApp"}
              aria-describedby={
                whatsappDisabledReason && !sendingWhatsapp
                  ? "osdetail-whatsapp-header-reason"
                  : undefined
              }
            >
              <Icon name="phone" /> {whatsappButtonLabel(form.status, sendingWhatsapp)}
            </button>

            {whatsappDisabledReason && !sendingWhatsapp ? (
              <small
                id="osdetail-whatsapp-header-reason"
                className="osdetail-premium-whatsapp-reason"
                role="status"
              >
                {whatsappDisabledReason}
              </small>
            ) : null}
          </div>
        ) : null}
      </div>

      {!isTecnico ? (
        <div className="osdetail-premium-total-floating">
          <span>Total atual</span>
          <strong>{money(total)}</strong>
        </div>
      ) : null}
    </header>
  );
}

function MobileHero({ os, form, hasUnsavedChanges, canSeeDashboard, onBack, onDashboard, onLogout }) {
  return (
    <header className="osdetail-premium-mobile-hero">
      <div className="osdetail-premium-mobile-topline">
        <button type="button" onClick={onBack} aria-label="Voltar"><Icon name="arrowLeft" /></button>
        <span>Detalhes da ordem de serviço</span>
        <button type="button" onClick={onLogout} aria-label="Sair">⋮</button>
      </div>

      <h1>OS #{os.id}</h1>

      <div className="osdetail-premium-mobile-client-label">Cliente</div>
      <strong className="osdetail-premium-mobile-client">{os.cliente_nome || "-"}</strong>

      <span className={`osdetail-premium-save-pill ${hasUnsavedChanges ? "is-unsaved" : "is-saved"}`}>
        {hasUnsavedChanges ? "Alterações não salvas" : "Tudo salvo"}
      </span>

      <div className="osdetail-premium-mobile-actions">
        <button type="button" className="osdetail-premium-mobile-main-action" onClick={onBack}>
          <Icon name="arrowLeft" /> Voltar para lista
        </button>

        {canSeeDashboard ? (
          <button type="button" onClick={onDashboard}><Icon name="grid" /> Dashboard</button>
        ) : null}

        <button type="button" onClick={onLogout}><Icon name="logOut" /> Sair</button>
      </div>

      <div className="osdetail-premium-mobile-status-mini">
        <span>Status atual</span>
        <strong>{statusLabel(form.status)}</strong>
      </div>
    </header>
  );
}

function DesktopMetaStrip({ os, form, total, isTecnico }) {
  const items = [
    { icon: "user", label: "Cliente", value: os.cliente_nome || "-" },
    { icon: "car", label: "Veículo", value: form.modelo || "-" },
    { icon: "plate", label: "Placa", value: form.placa || "-" },
    { icon: "clock", label: "Status atual", value: statusLabel(form.status), badge: true },
    { icon: "calendar", label: "Criada em", value: formatDateShort(os.created_at) },
    { icon: "calendar", label: "Atualizada em", value: formatDateShort(os.updated_at) },
  ];

  if (!isTecnico) {
    items.push({ icon: "dollar", label: "Total atual", value: money(total), money: true });
  }

  return (
    <section className={`osdetail-premium-meta-strip ${isTecnico ? "is-tecnico" : ""}`}>
      {items.map((item) => (
        <div key={item.label} className={`osdetail-premium-meta-item ${item.money ? "is-money" : ""}`}>
          <span className="osdetail-premium-meta-icon"><Icon name={item.icon} /></span>
          <div>
            <small>{item.label}</small>
            {item.badge ? (
              <b className={`osdetail-premium-status-badge ${statusTone(form.status)}`}>{item.value}</b>
            ) : (
              <strong>{item.value}</strong>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}

function ResumoCard({ os, form }) {
  return (
    <section className="osdetail-premium-card osdetail-premium-card--summary">
      <CardTitle icon="file" title="Resumo da OS" subtitle="Informações principais para leitura rápida." />

      <div className="osdetail-premium-description-block">
        <small>Descrição do serviço</small>
        <p>{form.problema_relatado || "Sem descrição"}</p>
      </div>

      <div className="osdetail-premium-summary-grid">
        <InfoTile label="Cliente" value={os.cliente_nome || "-"} />
        <InfoTile label="Veículo" value={form.modelo || "-"} />
        <InfoTile label="Placa" value={form.placa || "-"} />
      </div>
    </section>
  );
}

function SituacaoCard({
  os,
  form,
  total,
  isTecnico,
  whatsappDisabled,
  whatsappDisabledReason,
  sendingWhatsapp,
  onWhatsapp,
}) {
  return (
    <section className="osdetail-premium-card osdetail-premium-card--situation">
      <CardTitle icon="trend" title="Situação da OS" subtitle="Acompanhe datas, status e orçamento." />

      <div className={`osdetail-premium-situation-grid ${isTecnico ? "is-tecnico" : ""}`}>
        <InfoTile label="Status atual" value={statusLabel(form.status)} badgeClass={`osdetail-premium-status-badge ${statusTone(form.status)}`} />
        <InfoTile label="Criada em" value={formatDateShort(os.created_at)} />
        <InfoTile label="Atualizada em" value={formatDateShort(os.updated_at)} />
        {!isTecnico ? <InfoTile label="Total atual" value={money(total)} isMoney /> : null}
      </div>

      {!isTecnico ? (
        <div className="osdetail-premium-whatsapp-action osdetail-premium-whatsapp-action--card">
          <button
            type="button"
            className="osdetail-premium-whatsapp-wide"
            onClick={onWhatsapp}
            disabled={whatsappDisabled}
            title={whatsappDisabledReason || "Preparar orçamento no WhatsApp"}
            aria-describedby={
              whatsappDisabledReason && !sendingWhatsapp
                ? "osdetail-whatsapp-card-reason"
                : undefined
            }
          >
            <Icon name="phone" /> {whatsappButtonLabel(form.status, sendingWhatsapp)}
          </button>

          {whatsappDisabledReason && !sendingWhatsapp ? (
            <small
              id="osdetail-whatsapp-card-reason"
              className="osdetail-premium-whatsapp-reason"
              role="status"
            >
              {whatsappDisabledReason}
            </small>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function PecasCard({
  pecas,
  form,
  total,
  pieceForm,
  pieceSubtotal,
  pieceFeedback,
  addingPiece,
  removingPieceId,
  readOnly,
  onPieceChange,
  onPieceMoneyBlur,
  onAddPiece,
  onRemovePiece,
}) {
  return (
    <section className={`osdetail-premium-card osdetail-premium-card--pieces ${readOnly ? "is-readonly" : ""}`}>
      <CardTitle
        icon="parts"
        title="Peças da OS"
        subtitle={
          readOnly
            ? "OS cancelada: peças preservadas apenas para consulta."
            : "Adicione peças para montar o orçamento completo."
        }
      />

      {readOnly ? (
        <div className="osdetail-premium-readonly-note">
          OS cancelada — inclusão, alteração e remoção de peças estão bloqueadas.
        </div>
      ) : null}

      {pieceFeedback?.message ? (
        <div className={`osdetail-premium-piece-feedback is-${pieceFeedback.type || "success"}`}>
          {pieceFeedback.message}
        </div>
      ) : null}

      <div className="osdetail-premium-piece-form">
        <div className="osdetail-premium-form-field">
          <label>Nome da peça</label>
          <input
            type="text"
            value={pieceForm.nome}
            onChange={(event) => onPieceChange("nome", event.target.value)}
            placeholder="Ex.: Filtro de óleo"
            disabled={readOnly}
          />
        </div>

        <div className="osdetail-premium-form-field">
          <label>Quantidade</label>
          <input
            type="number"
            min="1"
            step="1"
            value={pieceForm.quantidade}
            onChange={(event) => onPieceChange("quantidade", event.target.value)}
            placeholder="1"
            disabled={readOnly}
          />
        </div>

        <div className="osdetail-premium-form-field">
          <label>Valor unitário (R$)</label>
          <input
            className="input--money"
            value={pieceForm.valor_unitario}
            onChange={(event) => onPieceChange("valor_unitario", event.target.value)}
            onBlur={onPieceMoneyBlur}
            inputMode="decimal"
            placeholder="0,00"
            disabled={readOnly}
          />
        </div>

        <div className="osdetail-premium-form-field osdetail-premium-form-field--subtotal">
          <label>Subtotal (R$)</label>
          <strong>{money(pieceSubtotal)}</strong>
        </div>

        <button
          type="button"
          className="osdetail-premium-btn osdetail-premium-btn--primary"
          onClick={onAddPiece}
          disabled={addingPiece || readOnly}
        >
          {addingPiece ? "Adicionando..." : (<><Icon name="parts" /> Adicionar peça</>)}
        </button>
      </div>

      {pecas.length === 0 ? (
        <div className="osdetail-premium-empty">Nenhuma peça adicionada nesta OS ainda.</div>
      ) : (
        <div className="osdetail-premium-piece-table">
          <div className="osdetail-premium-piece-head">
            <span>Nome da peça</span>
            <span>Quantidade</span>
            <span>Valor unitário (R$)</span>
            <span>Subtotal (R$)</span>
            <span>Ações</span>
          </div>

          {pecas.map((peca) => (
            <div key={peca.id} className="osdetail-premium-piece-row">
              <strong>{peca.nome}</strong>
              <span>{Number(peca.quantidade)}</span>
              <span>{money(peca.valor_unitario)}</span>
              <b>{money(peca.valor_total)}</b>
              <button
                type="button"
                onClick={() => onRemovePiece(peca.id)}
                disabled={readOnly || removingPieceId === peca.id}
              >
                {removingPieceId === peca.id ? "Removendo..." : "Remover"}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="osdetail-premium-piece-mobile-list">
        <InfoLine icon="box" label="Subtotal da peça" value={money(pieceSubtotal)} />
        {pecas.map((peca) => (
          <InfoLine
            key={peca.id}
            icon="parts"
            label={peca.nome}
            value={`${Number(peca.quantidade)}x ${money(peca.valor_unitario)} = ${money(peca.valor_total)}`}
            action={readOnly ? undefined : () => onRemovePiece(peca.id)}
            actionLabel={readOnly ? undefined : removingPieceId === peca.id ? "..." : "Remover"}
          />
        ))}
      </div>

      <div className="osdetail-premium-total-grid">
        <InfoTile label="Total das peças" value={money(parseMoneyInput(form.valor_pecas))} isMoney />
        <InfoTile label="Total geral da OS" value={money(total)} isMoney accent />
      </div>
    </section>
  );
}

function HistoricoCard({ eventos, loading, isTecnico }) {
  return (
    <section className="osdetail-premium-card osdetail-premium-card--history">
      <div className="osdetail-premium-history-head">
        <CardTitle
          icon="clock"
          title="Histórico da OS"
          subtitle="Últimas movimentações registradas nesta ordem."
        />
        <span>{loading ? "Atualizando..." : `${eventos.length} registro(s)`}</span>
      </div>

      {eventos.length === 0 ? (
        <div className="osdetail-premium-history-empty">
          Nenhuma movimentação registrada ainda. Alterações feitas a partir de agora aparecerão aqui.
        </div>
      ) : (
        <div className="osdetail-premium-history-list">
          {eventos.map((evento) => (
            <article key={evento.id} className={`osdetail-premium-history-item ${eventTone(evento.event_type)}`}>
              <div className="osdetail-premium-history-icon">
                <Icon name={eventIcon(evento.event_type)} />
              </div>

              <div className="osdetail-premium-history-content">
                <div className="osdetail-premium-history-title-row">
                  <strong>{evento.title || eventTitle(evento.event_type)}</strong>
                  <time>{formatDateShort(evento.created_at)}</time>
                </div>

                {evento.description ? <p>{evento.description}</p> : null}

                <div className="osdetail-premium-history-meta">
                  <span>{evento.user_name || "Sistema"}</span>
                  <span>{roleLabel(evento.user_role)}</span>
                  {!isTecnico && evento.metadata?.part_name ? <span>Peça: {evento.metadata.part_name}</span> : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function EditarCard({ form, total, saving, isTecnico, readOnly, onChange, onMoneyChange, onMoneyBlur, onSave, onBack }) {
  return (
    <section className={`osdetail-premium-card osdetail-premium-card--edit ${readOnly ? "is-readonly" : ""}`}>
      <CardTitle
        icon="edit"
        title={readOnly ? "OS em modo somente leitura" : "Editar OS"}
        subtitle={
          readOnly
            ? "Esta OS está cancelada. Reabra-a antes de fazer qualquer alteração."
            : isTecnico
              ? "Atualize a descrição técnica e o status do serviço."
              : "Atualize dados, valores e andamento do serviço."
        }
      />

      {readOnly ? (
        <div className="osdetail-premium-readonly-note">
          Campos, valores e status estão bloqueados enquanto a OS permanecer cancelada.
        </div>
      ) : null}

      <div className="osdetail-premium-form-field">
        <label>Descrição do serviço</label>
        <textarea
          rows={5}
          value={form.problema_relatado}
          onChange={(event) => onChange("problema_relatado", event.target.value)}
          placeholder="Descreva o serviço, diagnóstico ou observações técnicas..."
          disabled={readOnly}
        />
      </div>

      {!isTecnico ? (
        <div className="osdetail-premium-form-grid-2">
          <div className="osdetail-premium-form-field">
            <label>Modelo</label>
            <input
              type="text"
              value={form.modelo}
              onChange={(event) => onChange("modelo", event.target.value)}
              placeholder="Ex.: Gol, Uno, Civic..."
              disabled={readOnly}
            />
          </div>

          <div className="osdetail-premium-form-field">
            <label>Placa</label>
            <input
              type="text"
              value={form.placa}
              onChange={(event) => onChange("placa", event.target.value)}
              placeholder="ABC1D23"
              maxLength={8}
              disabled={readOnly}
            />
          </div>
        </div>
      ) : null}

      {!isTecnico ? (
        <div className="osdetail-premium-form-grid-2">
          <div className="osdetail-premium-form-field">
            <label>Mão de obra (R$)</label>
            <input
              className="input--money"
              value={form.mao_obra}
              onChange={(event) => onMoneyChange("mao_obra", event.target.value)}
              onBlur={() => onMoneyBlur("mao_obra")}
              inputMode="decimal"
              placeholder="0,00"
              disabled={readOnly}
            />
          </div>

          <div className="osdetail-premium-form-field">
            <label>Peças (R$)</label>
            <input className="input--money" value={form.valor_pecas} inputMode="decimal" placeholder="0,00" disabled readOnly />
            <small>Total calculado automaticamente pelas peças adicionadas.</small>
          </div>
        </div>
      ) : null}

      <div className="osdetail-premium-form-grid-2">
        <div className="osdetail-premium-form-field">
          <label>Status</label>
          <select
            value={form.status}
            onChange={(event) => onChange("status", event.target.value)}
            disabled={readOnly}
          >
            {STATUS.filter((status) => !(isTecnico && !readOnly && status === "cancelado")).map((status) => (
              <option key={status} value={status}>
                {statusLabel(status)}
              </option>
            ))}
          </select>
        </div>

        {!isTecnico ? <InfoTile label="Total calculado" value={money(total)} isMoney accent /> : null}
      </div>

      <div className="osdetail-premium-edit-actions">
        <button
          type="button"
          className="osdetail-premium-btn osdetail-premium-btn--primary"
          onClick={onSave}
          disabled={saving || readOnly}
        >
          <Icon name="save" /> {saving ? "Salvando..." : "Salvar alterações"}
        </button>

        <button type="button" className="osdetail-premium-btn osdetail-premium-btn--ghost" onClick={onBack}>
          Voltar para lista
        </button>
      </div>
    </section>
  );
}

function CardTitle({ icon, title, subtitle }) {
  return (
    <div className="osdetail-premium-card-title">
      <span><Icon name={icon} /></span>
      <div>
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
    </div>
  );
}

function InfoTile({ label, value, isMoney = false, accent = false, badgeClass = "" }) {
  return (
    <div className={`osdetail-premium-info-tile ${isMoney ? "is-money" : ""} ${accent ? "is-accent" : ""}`}>
      <small>{label}</small>
      {badgeClass ? <b className={badgeClass}>{value}</b> : <strong>{value}</strong>}
    </div>
  );
}

function InfoLine({ icon, label, value, action, actionLabel }) {
  return (
    <div className="osdetail-premium-info-line">
      <span><Icon name={icon} /></span>
      <div>
        <strong>{label}</strong>
        <small>{value}</small>
      </div>
      {action ? (
        <button type="button" onClick={action}>
          {actionLabel || "Abrir"}
        </button>
      ) : (
        <span aria-hidden="true">›</span>
      )}
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
    <div className={`osdetail-premium-alert ${isError ? "is-error" : "is-success"}`}>
      {message}
    </div>
  );
}

function whatsappButtonLabel(status, sendingWhatsapp) {
  if (sendingWhatsapp) return "Preparando...";

  if (status === "aguardando_aprovacao" || status === "orcamento_enviado") {
    return "Reenviar orçamento no WhatsApp";
  }

  return "Enviar orçamento no WhatsApp";
}

function openWhatsappLoadingWindow() {
  const popup = window.open("", "_blank");

  if (!popup) return null;

  popup.opener = null;
  popup.document.title = "Preparando orçamento";
  popup.document.body.textContent = "Preparando orçamento no WhatsApp...";

  return popup;
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

  text = text.replace(/\s+/g, "").replace(/[R$\u00a0]/g, "");

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

function statusTone(status) {
  if (status === "encerrado") return "is-success";
  if (status === "cancelado") return "is-danger";
  if (status === "aguardando_aprovacao" || status === "aguardando_peca") return "is-warning";
  if (status === "aprovado" || status === "em_execucao" || status === "em_analise") return "is-info";
  return "is-gray";
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

function eventIcon(eventType) {
  if (eventType === "status_changed") return "trend";
  if (eventType === "description_updated" || eventType === "os_updated") return "edit";
  if (eventType === "vehicle_updated") return "car";
  if (eventType === "piece_added" || eventType === "piece_updated" || eventType === "piece_removed") return "parts";
  if (eventType === "whatsapp_quote_generated") return "phone";
  if (eventType === "os_reopened") return "trend";
  if (eventType === "financial_updated") return "dollar";
  return "clock";
}

function eventTone(eventType) {
  if (eventType === "piece_removed") return "is-danger";
  if (eventType === "piece_added" || eventType === "piece_updated") return "is-blue";
  if (eventType === "whatsapp_quote_generated") return "is-green";
  if (eventType === "financial_updated") return "is-warning";
  if (eventType === "os_reopened") return "is-blue";
  if (eventType === "status_changed") return "is-purple";
  return "is-gray";
}

function eventTitle(eventType) {
  const titles = {
    os_created: "OS criada",
    os_updated: "OS atualizada",
    status_changed: "Status alterado",
    description_updated: "Descrição atualizada",
    vehicle_updated: "Dados do veículo atualizados",
    financial_updated: "Valor atualizado",
    piece_added: "Peça adicionada",
    piece_updated: "Peça atualizada",
    piece_removed: "Peça removida",
    whatsapp_quote_generated: "Orçamento WhatsApp gerado",
    os_reopened: "OS reaberta",
  };

  return titles[eventType] || "Movimentação registrada";
}

function formatDateShort(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");

  return `${day}/${month}/${year} ${hour}:${minute}`;
}

function initials(value) {
  return String(value || "U")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function firstName(value) {
  return String(value || "Usuário").trim().split(/\s+/)[0] || "Usuário";
}

function roleLabel(role) {
  if (role === "admin") return "Administrador";
  if (role === "atendimento") return "Atendimento";
  if (role === "tecnico") return "Técnico";
  return "Usuário";
}
