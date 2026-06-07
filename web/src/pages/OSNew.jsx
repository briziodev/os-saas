import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch, clearToken, getUser } from "../api";
import "./OSNew.css";

const MAX_RESULTADOS = 5;

export default function OSNew() {
  const token = useMemo(() => localStorage.getItem("token"), []);
  const nav = useNavigate();
  const user = getUser();
  const isTecnico = user?.role === "tecnico";

  const buscaRef = useRef(null);

  const [clientes, setClientes] = useState([]);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingCliente, setSavingCliente] = useState(false);
  const [savingOS, setSavingOS] = useState(false);
  const [showNovoCliente, setShowNovoCliente] = useState(false);
  const [buscaCliente, setBuscaCliente] = useState("");
  const [buscaAtiva, setBuscaAtiva] = useState(false);

  const [form, setForm] = useState({
    cliente_id: "",
    problema_relatado: "",
    mao_obra: "",
    valor_pecas: "",
    placa: "",
    modelo: "",
  });

  const [novoCliente, setNovoCliente] = useState({
    nome: "",
    telefone: "",
    email: "",
  });

  async function loadClientes({ silent = false } = {}) {
    try {
      if (!silent) setLoading(true);
      setMsg("");
      const data = await apiFetch("/clientes");
      setClientes(Array.isArray(data) ? data : []);
    } catch (e) {
      if (e.message === "Sessão expirada. Faça login novamente.") {
        clearToken();
        window.location.href = "/login";
        return;
      }
      setMsg(e.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    loadClientes();
  }, []);

  useEffect(() => {
    function handleClickOutside(event) {
      if (buscaRef.current && !buscaRef.current.contains(event.target)) {
        setBuscaAtiva(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const termoTexto = normalizeText(buscaCliente);
  const termoNumeros = digitsOnly(buscaCliente);

  const clientesFiltrados = useMemo(() => {
    if (!termoTexto && !termoNumeros) return [];

    return clientes
      .filter((c) => {
        const id = String(c.id || "");
        const nome = normalizeText(c.nome || "");
        const email = normalizeText(c.email || "");
        const telefoneNumeros = digitsOnly(c.telefone || "");

        const matchTexto =
          !!termoTexto &&
          (nome.includes(termoTexto) ||
            email.includes(termoTexto) ||
            id.includes(termoTexto));

        const matchNumero =
          !!termoNumeros &&
          (telefoneNumeros.includes(termoNumeros) || id.includes(termoNumeros));

        return matchTexto || matchNumero;
      })
      .slice(0, MAX_RESULTADOS);
  }, [clientes, termoTexto, termoNumeros]);

  const clienteSelecionado = useMemo(() => {
    return clientes.find((c) => String(c.id) === String(form.cliente_id)) || null;
  }, [clientes, form.cliente_id]);

  const mostrarDropdown =
    !clienteSelecionado && buscaAtiva && buscaCliente.trim().length > 0;

  const totalPrevisto =
    safeMoneyValue(form.mao_obra) + safeMoneyValue(form.valor_pecas);

  const modelo = form.modelo.trim();
  const placa = form.placa.trim().toUpperCase();
  const problema = form.problema_relatado.trim();
  const veiculoPreenchido = Boolean(modelo || placa);
  const podeCriarOS = Boolean(clienteSelecionado && problema && veiculoPreenchido);

  async function criarNovoCliente() {
    setMsg("");

    const nome = novoCliente.nome.trim();
    const email = novoCliente.email.trim();
    const telefone = novoCliente.telefone.trim();
    const telefoneNumeros = digitsOnly(telefone);

    if (!nome) {
      setMsg("Nome do cliente é obrigatório.");
      return;
    }

    if (!telefoneNumeros) {
      setMsg("Telefone do cliente é obrigatório.");
      return;
    }

    if (telefoneNumeros.length < 10) {
      setMsg("Informe um telefone válido do cliente.");
      return;
    }

    if (email && !isValidEmail(email)) {
      setMsg("Informe um email válido ou deixe o campo em branco.");
      return;
    }

    try {
      setSavingCliente(true);

      const criado = await apiFetch("/clientes", {
        method: "POST",
        body: JSON.stringify({
          nome,
          telefone,
          email: email || null,
        }),
      });

      await loadClientes({ silent: true });

      setForm((prev) => ({
        ...prev,
        cliente_id: String(criado.id),
      }));

      setBuscaCliente(criado.nome || "");
      setBuscaAtiva(false);

      setNovoCliente({
        nome: "",
        telefone: "",
        email: "",
      });

      setShowNovoCliente(false);
      setMsg("Cliente cadastrado com sucesso.");
    } catch (e) {
      if (e.message === "Sessão expirada. Faça login novamente.") {
        clearToken();
        window.location.href = "/login";
        return;
      }
      setMsg(e.message);
    } finally {
      setSavingCliente(false);
    }
  }

  async function onSubmit(e) {
    e.preventDefault();
    setMsg("");

    if (!form.cliente_id) {
      setMsg("Selecione um cliente.");
      return;
    }

    if (!form.problema_relatado.trim()) {
      setMsg("Informe o problema relatado.");
      return;
    }

    const modelo = form.modelo.trim();
    const placa = form.placa.trim().toUpperCase();

    if (!modelo && !placa) {
      setMsg("Informe ao menos a placa ou o modelo do veículo.");
      return;
    }

    const maoObra = parseMoneyBR(form.mao_obra);
    const valorPecas = parseMoneyBR(form.valor_pecas);

    if (!Number.isFinite(maoObra) || maoObra < 0) {
      setMsg("Informe um valor válido para mão de obra.");
      return;
    }

    if (!Number.isFinite(valorPecas) || valorPecas < 0) {
      setMsg("Informe um valor válido para peças.");
      return;
    }

    try {
      setSavingOS(true);

      const payload = {
        cliente_id: Number(form.cliente_id),
        problema_relatado: form.problema_relatado.trim(),
        mao_obra: maoObra,
        valor_pecas: valorPecas,
        placa: placa || null,
        modelo: modelo || null,
      };

      await apiFetch("/os", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      nav("/os");
    } catch (e) {
      if (e.message === "Sessão expirada. Faça login novamente.") {
        clearToken();
        window.location.href = "/login";
        return;
      }
      setMsg(e.message);
    } finally {
      setSavingOS(false);
    }
  }

  function handleFormChange(field, value) {
    setForm((prev) => ({
      ...prev,
      [field]: field === "placa" ? value.toUpperCase() : value,
    }));
  }

  function handleNovoClienteChange(field, value) {
    setNovoCliente((prev) => ({
      ...prev,
      [field]: value,
    }));
  }

  function handleMoneyBlur(field) {
    setForm((prev) => ({
      ...prev,
      [field]: formatMoneyInput(prev[field]),
    }));
  }

  function selectCliente(cliente) {
    setForm((prev) => ({
      ...prev,
      cliente_id: String(cliente.id),
    }));
    setBuscaCliente(cliente.nome || "");
    setBuscaAtiva(false);
    setMsg("");
  }

  function limparClienteSelecionado() {
    setForm((prev) => ({
      ...prev,
      cliente_id: "",
    }));
    setBuscaCliente("");
    setBuscaAtiva(true);
    setShowNovoCliente(false);
    requestAnimationFrame(() => {
      const input = document.getElementById("busca-cliente-input");
      if (input) input.focus();
    });
  }

  if (isTecnico) {
    return (
      <StatePage
        type="error"
        title="Acesso negado"
        description="O perfil técnico não pode criar nova OS. Use a lista de OS para acompanhar os serviços liberados para execução."
      />
    );
  }

  if (!token) {
    return (
      <StatePage
        type="error"
        title="Sem sessão"
        description="Faça login novamente para abrir uma nova ordem de serviço."
      />
    );
  }

  if (loading) {
    return (
      <StatePage
        type="loading"
        title="Carregando clientes"
        description="Buscando os clientes da oficina para iniciar a abertura da OS."
      />
    );
  }

  return (
    <div className="osnew-premium-page">
      <div className="osnew-premium-container">
        <header className="osnew-premium-hero">
          <div className="osnew-premium-hero-content">
            <span className="osnew-premium-eyebrow">Painel da oficina</span>
            <h1>Nova OS</h1>
            <p>
              Abra uma ordem de serviço com cliente, veículo, problema relatado e
              valores previstos em um fluxo rápido e seguro.
            </p>
          </div>

          <div className="osnew-premium-hero-actions">
            <Link to="/os" className="osnew-premium-btn osnew-premium-btn--ghost-dark">
              <SvgIcon name="arrow-left" />
              Voltar para OS
            </Link>

            <Link
              to="/dashboard"
              className="osnew-premium-btn osnew-premium-btn--ghost-dark"
            >
              <SvgIcon name="grid" />
              Dashboard
            </Link>
          </div>
        </header>

        {msg ? <AlertMessage message={msg} /> : null}

        <form onSubmit={onSubmit} className="osnew-premium-layout" noValidate>
          <main className="osnew-premium-main-stack">
            <section className="osnew-premium-card osnew-premium-card--client">
              <CardTitle
                icon="user"
                title="Cliente"
                subtitle="Busque um cliente existente ou cadastre rapidamente sem sair da OS."
                status={clienteSelecionado ? "Cliente selecionado" : "Obrigatório"}
                statusType={clienteSelecionado ? "success" : "warning"}
              />

              {!clienteSelecionado ? (
                <div ref={buscaRef} className="osnew-premium-client-search cliente-search-wrap">
                  <label className="osnew-premium-label" htmlFor="busca-cliente-input">
                    Buscar cliente
                  </label>

                  <div className="osnew-premium-input-shell">
                    <SvgIcon name="search" />
                    <input
                      id="busca-cliente-input"
                      value={buscaCliente}
                      onChange={(e) => {
                        setBuscaCliente(e.target.value);
                        setBuscaAtiva(true);
                      }}
                      onFocus={() => setBuscaAtiva(true)}
                      placeholder="Digite nome, telefone ou ID"
                      autoComplete="off"
                    />
                  </div>

                  <div className="osnew-premium-helper helper-text">
                    {buscaCliente.trim()
                      ? clientesFiltrados.length > 0
                        ? `${clientesFiltrados.length} cliente(s) encontrado(s).`
                        : "Nenhum cliente encontrado. Você pode cadastrar um novo cliente abaixo."
                      : "Comece digitando nome, telefone ou ID do cliente."}
                  </div>

                  {mostrarDropdown ? (
                    <div className="cliente-dropdown osnew-premium-client-dropdown">
                      {clientesFiltrados.length > 0 ? (
                        clientesFiltrados.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            className="cliente-dropdown__item"
                            onClick={() => selectCliente(c)}
                          >
                            <span className="cliente-dropdown__title">
                              #{c.id} — {c.nome}
                            </span>
                            <span className="cliente-dropdown__meta">
                              {c.telefone || "Sem telefone"}
                              {c.email ? ` • ${c.email}` : ""}
                            </span>
                          </button>
                        ))
                      ) : (
                        <div className="cliente-dropdown__empty">
                          Nenhum cliente encontrado.
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : (
                <SelectedClientBox
                  cliente={clienteSelecionado}
                  onChangeClient={limparClienteSelecionado}
                />
              )}

              {!clienteSelecionado ? (
                <div className="osnew-premium-inline-actions">
                  <button
                    type="button"
                    onClick={() => setShowNovoCliente((prev) => !prev)}
                    className={
                      showNovoCliente
                        ? "osnew-premium-btn osnew-premium-btn--secondary"
                        : "osnew-premium-btn osnew-premium-btn--primary"
                    }
                  >
                    <SvgIcon name={showNovoCliente ? "x" : "plus"} />
                    {showNovoCliente ? "Cancelar cadastro" : "Novo cliente"}
                  </button>
                </div>
              ) : null}

              {showNovoCliente ? (
                <div className="osnew-premium-new-client-panel">
                  <CardTitle
                    icon="user-plus"
                    title="Cadastro rápido"
                    subtitle="Preencha o mínimo necessário para usar o cliente nesta OS."
                  />

                  <div className="osnew-premium-grid-2">
                    <FormField label="Nome" required>
                      <input
                        value={novoCliente.nome}
                        onChange={(e) =>
                          handleNovoClienteChange("nome", e.target.value)
                        }
                        placeholder="Nome do cliente"
                      />
                    </FormField>

                    <FormField label="Telefone" required>
                      <input
                        value={novoCliente.telefone}
                        onChange={(e) =>
                          handleNovoClienteChange("telefone", e.target.value)
                        }
                        placeholder="(44) 99999-9999"
                        inputMode="tel"
                      />
                    </FormField>
                  </div>

                  <FormField label="Email" hint="Opcional">
                    <input
                      value={novoCliente.email}
                      onChange={(e) => handleNovoClienteChange("email", e.target.value)}
                      placeholder="cliente@email.com"
                      inputMode="email"
                    />
                  </FormField>

                  <div className="osnew-premium-inline-actions">
                    <button
                      type="button"
                      onClick={criarNovoCliente}
                      disabled={savingCliente}
                      className="osnew-premium-btn osnew-premium-btn--dark"
                    >
                      <SvgIcon name="save" />
                      {savingCliente ? "Salvando cliente..." : "Salvar cliente"}
                    </button>
                  </div>
                </div>
              ) : null}
            </section>

            <section className="osnew-premium-card">
              <CardTitle
                icon="car"
                title="Veículo"
                subtitle="Informe placa e/ou modelo para identificar rapidamente o serviço."
                status={veiculoPreenchido ? "Preenchido" : "Placa ou modelo"}
                statusType={veiculoPreenchido ? "success" : "warning"}
              />

              <div className="osnew-premium-grid-2">
                <FormField label="Modelo">
                  <input
                    value={form.modelo}
                    onChange={(e) => handleFormChange("modelo", e.target.value)}
                    placeholder="Ex.: Gol, Uno, Civic..."
                  />
                </FormField>

                <FormField label="Placa">
                  <input
                    value={form.placa}
                    onChange={(e) => handleFormChange("placa", e.target.value)}
                    placeholder="ABC1D23"
                    maxLength={8}
                  />
                </FormField>
              </div>
            </section>

            <section className="osnew-premium-card">
              <CardTitle
                icon="clipboard"
                title="Serviço"
                subtitle="Registre o problema relatado e os valores previstos para abrir a OS."
                status={problema ? "Descrição pronta" : "Descrição obrigatória"}
                statusType={problema ? "success" : "warning"}
              />

              <FormField label="Problema relatado" required>
                <textarea
                  value={form.problema_relatado}
                  onChange={(e) =>
                    handleFormChange("problema_relatado", e.target.value)
                  }
                  placeholder="Ex.: Cliente relata barulho na suspensão ao passar em lombadas..."
                  rows={5}
                />
              </FormField>

              <div className="osnew-premium-grid-2 osnew-premium-money-grid">
                <FormField label="Mão de obra (R$)">
                  <input
                    value={form.mao_obra}
                    onChange={(e) => handleFormChange("mao_obra", e.target.value)}
                    onBlur={() => handleMoneyBlur("mao_obra")}
                    inputMode="decimal"
                    placeholder="0,00"
                  />
                </FormField>

                <FormField label="Peças (R$)">
                  <input
                    value={form.valor_pecas}
                    onChange={(e) => handleFormChange("valor_pecas", e.target.value)}
                    onBlur={() => handleMoneyBlur("valor_pecas")}
                    inputMode="decimal"
                    placeholder="0,00"
                  />
                </FormField>
              </div>
            </section>
          </main>

          <aside className="osnew-premium-summary-card" aria-label="Resumo da nova OS">
            <div className="osnew-premium-summary-top">
              <span>
                <SvgIcon name="receipt" />
              </span>
              <div>
                <h2>Resumo da OS</h2>
                <p>Confirme os dados antes de criar.</p>
              </div>
            </div>

            <div className="osnew-premium-total-box">
              <small>Total previsto</small>
              <strong>{money(totalPrevisto)}</strong>
            </div>

            <div className="osnew-premium-checklist">
              <SummaryItem
                ok={Boolean(clienteSelecionado)}
                label="Cliente"
                value={clienteSelecionado ? clienteSelecionado.nome : "Selecione um cliente"}
              />
              <SummaryItem
                ok={veiculoPreenchido}
                label="Veículo"
                value={modelo || placa ? [modelo, placa].filter(Boolean).join(" • ") : "Informe placa ou modelo"}
              />
              <SummaryItem
                ok={Boolean(problema)}
                label="Problema"
                value={problema ? truncate(problema, 70) : "Descreva o problema relatado"}
              />
              <SummaryItem
                ok={true}
                label="Valores"
                value={`Mão de obra ${money(safeMoneyValue(form.mao_obra))} • Peças ${money(safeMoneyValue(form.valor_pecas))}`}
              />
            </div>

            {!podeCriarOS ? (
              <div className="osnew-premium-summary-warning">
                Preencha cliente, veículo e problema relatado para criar a OS com segurança.
              </div>
            ) : null}

            <button
              type="submit"
              className="osnew-premium-btn osnew-premium-btn--submit"
              disabled={savingOS}
            >
              <SvgIcon name="check" />
              {savingOS ? "Criando OS..." : "Criar OS"}
            </button>
          </aside>
        </form>
      </div>
    </div>
  );
}

function StatePage({ type, title, description }) {
  return (
    <div className="osnew-premium-page osnew-premium-state-page">
      <div className={`osnew-premium-state-card is-${type}`}>
        <span>{type === "error" ? <SvgIcon name="alert" /> : <SvgIcon name="loader" />}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
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
    <div className={`osnew-premium-alert ${isError ? "is-error" : "is-success"}`}>
      <SvgIcon name={isError ? "alert" : "check"} />
      <span>{message}</span>
    </div>
  );
}

function CardTitle({ icon, title, subtitle, status, statusType }) {
  return (
    <div className="osnew-premium-card-title">
      <span className="osnew-premium-card-icon">
        <SvgIcon name={icon} />
      </span>

      <div className="osnew-premium-card-title-text">
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>

      {status ? (
        <span className={`osnew-premium-status-pill is-${statusType || "neutral"}`}>
          {status}
        </span>
      ) : null}
    </div>
  );
}

function FormField({ label, required, hint, children }) {
  return (
    <label className="osnew-premium-field">
      <span>
        {label}
        {required ? <b>*</b> : null}
        {hint ? <em>{hint}</em> : null}
      </span>
      {children}
    </label>
  );
}

function SelectedClientBox({ cliente, onChangeClient }) {
  return (
    <div className="osnew-premium-selected-client selected-client-box">
      <div className="osnew-premium-selected-client-main">
        <span className="osnew-premium-selected-avatar">
          <SvgIcon name="user" />
        </span>
        <div>
          <small>Cliente selecionado</small>
          <strong>
            #{cliente.id} — {cliente.nome}
          </strong>
          <p>
            {cliente.telefone || "Sem telefone"}
            {cliente.email ? ` • ${cliente.email}` : ""}
          </p>
        </div>
      </div>

      <button
        type="button"
        className="osnew-premium-btn osnew-premium-btn--secondary"
        onClick={onChangeClient}
      >
        <SvgIcon name="refresh" />
        Trocar cliente
      </button>
    </div>
  );
}

function SummaryItem({ ok, label, value }) {
  return (
    <div className={`osnew-premium-summary-item ${ok ? "is-ok" : "is-pending"}`}>
      <span>{ok ? <SvgIcon name="check" /> : <SvgIcon name="dot" />}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function SvgIcon({ name }) {
  const icons = {
    "arrow-left": (
      <>
        <path d="M19 12H5" />
        <path d="m12 19-7-7 7-7" />
      </>
    ),
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    user: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </>
    ),
    "user-plus": (
      <>
        <circle cx="9" cy="8" r="4" />
        <path d="M3 21a6 6 0 0 1 12 0" />
        <path d="M19 8v6" />
        <path d="M16 11h6" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </>
    ),
    car: (
      <>
        <path d="M5 17h14" />
        <path d="M6 17v-5l2-5h8l2 5v5" />
        <circle cx="8" cy="17" r="2" />
        <circle cx="16" cy="17" r="2" />
      </>
    ),
    clipboard: (
      <>
        <path d="M9 4h6" />
        <path d="M9 4a3 3 0 0 0 6 0" />
        <rect x="5" y="4" width="14" height="17" rx="2" />
        <path d="M8 12h8" />
        <path d="M8 16h5" />
      </>
    ),
    receipt: (
      <>
        <path d="M6 2v20l3-2 3 2 3-2 3 2V2Z" />
        <path d="M9 7h6" />
        <path d="M9 11h6" />
        <path d="M9 15h4" />
      </>
    ),
    plus: (
      <>
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </>
    ),
    x: (
      <>
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
      </>
    ),
    save: (
      <>
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
        <path d="M17 21v-8H7v8" />
        <path d="M7 3v5h8" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    alert: (
      <>
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
        <path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.4 0Z" />
      </>
    ),
    loader: (
      <>
        <path d="M21 12a9 9 0 1 1-6.2-8.56" />
      </>
    ),
    refresh: (
      <>
        <path d="M21 12a9 9 0 0 1-15.3 6.4" />
        <path d="M3 12a9 9 0 0 1 15.3-6.4" />
        <path d="M3 3v6h6" />
        <path d="M21 21v-6h-6" />
      </>
    ),
    dot: <circle cx="12" cy="12" r="3" />,
  };

  return (
    <svg
      className="osnew-premium-svg-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {icons[name] || icons.dot}
    </svg>
  );
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function parseMoneyBR(value) {
  const raw = String(value ?? "").trim();

  if (!raw) return 0;

  let normalized = raw.replace(/\s/g, "");

  if (normalized.includes(",")) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else {
    normalized = normalized.replace(/[^\d.-]/g, "");
  }

  const numberValue = Number(normalized);
  return Number.isFinite(numberValue) ? numberValue : NaN;
}

function safeMoneyValue(value) {
  const parsed = parseMoneyBR(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoneyInput(value) {
  const raw = String(value ?? "").trim();

  if (!raw) return "";

  const parsed = parseMoneyBR(raw);
  if (!Number.isFinite(parsed)) return raw;

  return parsed.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function money(value) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function truncate(value, maxLength) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}
