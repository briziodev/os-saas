import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiFetch, clearToken, getUser } from "../api";
import "./OSDetail.css";


const ICON_PATHS = {
  home: ["M3 11.5 12 4l9 7.5", "M5 10.5V20h14v-9.5", "M9 20v-6h6v6"],
  list: ["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"],
  board: ["M4 5h16v14H4z", "M9 5v14", "M15 5v14", "M4 11h16"],
  users: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M9 7a4 4 0 1 0 0 8", "M22 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75"],
  user: [
    "M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z",
    "M4 21v-1.5c0-3.05 3.58-5.5 8-5.5s8 2.45 8 5.5V21",
  ],
  clipboard: ["M9 4h6l1 2h3v16H5V6h3z", "M9 4a3 3 0 0 1 6 0", "M8 11h8", "M8 15h8"],
  car: [
    "M5 13l1.6-4.2A3 3 0 0 1 9.4 7h5.2a3 3 0 0 1 2.8 1.8L19 13",
    "M4 13h16v5H4z",
    "M7 18v2",
    "M17 18v2",
    "M7.5 16h.01",
    "M16.5 16h.01",
  ],
  plate: ["M4 7h16v10H4z", "M7 11h4", "M13 11h4", "M7 14h10"],
  clock: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20", "M12 6v6l4 2"],
  calendar: ["M7 3v4", "M17 3v4", "M4 8h16", "M5 5h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1"],
  dollar: ["M12 2v20", "M17 7.5A4 4 0 0 0 9.5 6c-2.2.5-3.5 2.7-2 4.3 1.1 1.2 2.9 1.5 5 1.9 2.7.5 4.3 1.4 4.3 3.5 0 2-1.7 3.5-4.5 3.5-2.2 0-4.2-.8-5.5-2.1"],
  file: [
    "M8 3h7l4 4v14H5V3h3",
    "M15 3v5h5",
    "M8 12h8",
    "M8 16h6",
  ],
  trend: [
    "M12 14a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
    "M4 14a8 8 0 1 1 16 0",
    "M12 14l4-4",
    "M5 19h14",
  ],
  parts: [
    "M21 16V8l-9-5-9 5v8l9 5 9-5Z",
    "M3.3 7.8 12 13l8.7-5.2",
    "M12 22V13",
    "M17 10v6",
    "M14 13h6",
  ],
  edit: [
    "M12 20h9",
    "M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5Z",
    "M15 5l4 4",
  ],
  box: ["M21 16V8l-9-5-9 5v8l9 5z", "M3.3 7.8 12 13l8.7-5.2", "M12 22V13"],
  filter: ["M4 5h16l-6 7v5l-4 2v-7z"],
  save: ["M5 3h12l2 2v16H5z", "M8 3v6h8V3", "M8 21v-7h8v7"],
  arrowLeft: ["M19 12H5", "M12 19l-7-7 7-7"],
  grid: [
    "M4 4h7v10H4z",
    "M13 4h7v6h-7z",
    "M13 12h7v8h-7z",
    "M4 16h7v4H4z",
  ],
  phone: [
    "M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6A8.38 8.38 0 0 1 12.5 3H13a8.48 8.48 0 0 1 8 8.5Z",
    "M8.5 10.5c.8 2 2.3 3.6 4.3 4.3l1.4-1.1c.3-.2.7-.3 1-.1.7.2 1.4.4 2.1.4",
  ],
  logOut: ["M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "M16 17l5-5-5-5", "M21 12H9"],
  check: ["M20 6 9 17l-5-5"],
};

function Icon({ name, className = "" }) {
  const paths = ICON_PATHS[name] || ICON_PATHS.file;

  return (
    <svg
      className={`osdetail-premium-svg-icon ${className}`.trim()}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
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

export default function OSDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const token = useMemo(() => localStorage.getItem("token"), []);
  const user = getUser();
  const isTecnico = user?.role === "tecnico";
  const canSeeDashboard = !isTecnico;
  const canSeeClientes = !isTecnico;
  const canSeeUsers = user?.role === "admin";

  const [os, setOs] = useState(null);
  const [pecas, setPecas] = useState([]);
  const [eventos, setEventos] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [addingPiece, setAddingPiece] = useState(false);
  const [removingPieceId, setRemovingPieceId] = useState(null);
  const [msg, setMsg] = useState("");
  const [pieceFeedback, setPieceFeedback] = useState(null);
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
      } catch (eventError) {
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
    } catch (error) {
      setMsg(error.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function loadEventos() {
    try {
      setEventsLoading(true);
      const eventosData = await apiFetch(`/os/${id}/events`);
      setEventos(Array.isArray(eventosData) ? eventosData : []);
    } catch (error) {
      setEventos([]);
    } finally {
      setEventsLoading(false);
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

  async function abrirWhatsapp() {
    if (whatsappDisabled) return;

    try {
      setMsg("");
      const data = await apiFetch(`/os/${id}/whatsapp-link`);
      window.open(data.whatsapp_url, "_blank");
      await loadEventos();
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
            onBack={() => goTo("/os")}
            onDashboard={() => goTo("/dashboard")}
            onWhatsapp={abrirWhatsapp}
          />

          {msg ? <AlertMessage message={msg} /> : null}

          <DesktopMetaStrip os={os} form={form} total={total} isTecnico={isTecnico} />

          <section className="osdetail-premium-grid-main">
            <ResumoCard os={os} form={form} />
            <SituacaoCard
              os={os}
              form={form}
              total={total}
              isTecnico={isTecnico}
              whatsappDisabled={whatsappDisabled}
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
    </div>
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
          <button
            type="button"
            className="osdetail-premium-btn osdetail-premium-btn--primary"
            onClick={onWhatsapp}
            disabled={whatsappDisabled}
          >
            <Icon name="phone" /> Enviar orçamento no WhatsApp
          </button>
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

function SituacaoCard({ os, form, total, isTecnico, whatsappDisabled, onWhatsapp }) {
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
        <button
          type="button"
          className="osdetail-premium-whatsapp-wide"
          onClick={onWhatsapp}
          disabled={whatsappDisabled}
          title={whatsappDisabled ? "Envio indisponível para OS encerrada ou cancelada." : "Enviar orçamento no WhatsApp"}
        >
          <Icon name="phone" /> Enviar orçamento no WhatsApp
        </button>
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
  onPieceChange,
  onPieceMoneyBlur,
  onAddPiece,
  onRemovePiece,
}) {
  return (
    <section className="osdetail-premium-card osdetail-premium-card--pieces">
      <CardTitle icon="parts" title="Peças da OS" subtitle="Adicione peças para montar o orçamento completo." />

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
          />
        </div>

        <div className="osdetail-premium-form-field osdetail-premium-form-field--subtotal">
          <label>Subtotal (R$)</label>
          <strong>{money(pieceSubtotal)}</strong>
        </div>

        <button type="button" className="osdetail-premium-btn osdetail-premium-btn--primary" onClick={onAddPiece} disabled={addingPiece}>
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
              <button type="button" onClick={() => onRemovePiece(peca.id)} disabled={removingPieceId === peca.id}>
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
            action={() => onRemovePiece(peca.id)}
            actionLabel={removingPieceId === peca.id ? "..." : "Remover"}
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

function EditarCard({ form, total, saving, isTecnico, onChange, onMoneyChange, onMoneyBlur, onSave, onBack }) {
  return (
    <section className="osdetail-premium-card osdetail-premium-card--edit">
      <CardTitle
        icon="edit"
        title="Editar OS"
        subtitle={isTecnico ? "Atualize a descrição técnica e o status do serviço." : "Atualize dados, valores e andamento do serviço."}
      />

      <div className="osdetail-premium-form-field">
        <label>Descrição do serviço</label>
        <textarea
          rows={5}
          value={form.problema_relatado}
          onChange={(event) => onChange("problema_relatado", event.target.value)}
          placeholder="Descreva o serviço, diagnóstico ou observações técnicas..."
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
          <select value={form.status} onChange={(event) => onChange("status", event.target.value)}>
            {STATUS.map((status) => (
              <option key={status} value={status}>
                {statusLabel(status)}
              </option>
            ))}
          </select>
        </div>

        {!isTecnico ? <InfoTile label="Total calculado" value={money(total)} isMoney accent /> : null}
      </div>

      <div className="osdetail-premium-edit-actions">
        <button type="button" className="osdetail-premium-btn osdetail-premium-btn--primary" onClick={onSave} disabled={saving}>
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
  if (eventType === "financial_updated") return "dollar";
  return "clock";
}

function eventTone(eventType) {
  if (eventType === "piece_removed") return "is-danger";
  if (eventType === "piece_added" || eventType === "piece_updated") return "is-blue";
  if (eventType === "whatsapp_quote_generated") return "is-green";
  if (eventType === "financial_updated") return "is-warning";
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
