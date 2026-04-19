import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch, clearToken, getUser } from "../api";

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

  async function loadClientes() {
    try {
      setLoading(true);
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
      setLoading(false);
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

      await loadClientes();

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
    requestAnimationFrame(() => {
      const input = document.getElementById("busca-cliente-input");
      if (input) input.focus();
    });
  }

  const totalPrevisto =
    safeMoneyValue(form.mao_obra) + safeMoneyValue(form.valor_pecas);
      if (isTecnico) {
    return (
      <div className="page">
        <div className="container">
          <div className="card alert alert--error">
            Acesso negado. O perfil técnico não pode criar nova OS.
          </div>
        </div>
      </div>
    );
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
          <div className="card">Carregando clientes...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="container">
        <PageHeader
          eyebrow="Painel da oficina"
          title="Nova OS"
          description="Abra uma nova ordem de serviço com cliente, veículo e valores previstos."
          right={
            <>
              <Link to="/os">
                <button className="btn btn--ghost-dark" type="button">
                  Voltar para OS
                </button>
              </Link>

              <Link to="/dashboard">
                <button className="btn btn--ghost-dark" type="button">
                  Dashboard
                </button>
              </Link>
            </>
          }
        />

        {msg ? <AlertMessage message={msg} /> : null}

        <form onSubmit={onSubmit} className="section stack" noValidate>
          <div className="card">
            <SectionTitle
              title="Cliente"
              subtitle="Busque e selecione o cliente de forma rápida."
            />

            {!clienteSelecionado ? (
              <div ref={buscaRef} className="cliente-search-wrap">
                <div className="form-group">
                  <label className="label">Buscar cliente</label>
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

                <div className="helper-text">
                  {buscaCliente.trim()
                    ? clientesFiltrados.length > 0
                      ? `${clientesFiltrados.length} cliente(s) encontrado(s).`
                      : "Nenhum cliente encontrado."
                    : "Digite nome, telefone ou ID para buscar o cliente."}
                </div>

                {mostrarDropdown ? (
                  <div className="cliente-dropdown">
                    {clientesFiltrados.length > 0 ? (
                      clientesFiltrados.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className="cliente-dropdown__item"
                          onClick={() => selectCliente(c)}
                        >
                          <div className="cliente-dropdown__title">
                            #{c.id} — {c.nome}
                          </div>
                          <div className="cliente-dropdown__meta">
                            {c.telefone || "Sem telefone"}
                            {c.email ? ` • ${c.email}` : ""}
                          </div>
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
              <div className="soft-box selected-client-box">
                <div className="selected-client-box__label">Cliente selecionado</div>
                <div className="selected-client-box__name">
                  #{clienteSelecionado.id} — {clienteSelecionado.nome}
                </div>
                <div className="selected-client-box__meta">
                  {clienteSelecionado.telefone || "Sem telefone"}
                  {clienteSelecionado.email ? ` • ${clienteSelecionado.email}` : ""}
                </div>

                <div className="form-actions section-gap-sm">
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={limparClienteSelecionado}
                  >
                    Trocar cliente
                  </button>
                </div>
              </div>
            )}

            <div className="form-actions section-gap-sm">
              <button
                type="button"
                onClick={() => setShowNovoCliente((prev) => !prev)}
                className={showNovoCliente ? "btn btn--ghost" : "btn btn--primary"}
              >
                {showNovoCliente ? "Cancelar novo cliente" : "+ Novo cliente"}
              </button>
            </div>

            {showNovoCliente ? (
              <>
                <div className="divider" />

                <div className="soft-box form-panel-soft">
                  <SectionTitle
                    title="Cadastro rápido de cliente"
                    subtitle="Cadastre o cliente sem sair da abertura da OS."
                  />

                  <div className="grid-2">
                    <div className="form-group">
                      <label className="label">Nome</label>
                      <input
                        value={novoCliente.nome}
                        onChange={(e) => handleNovoClienteChange("nome", e.target.value)}
                        placeholder="Nome do cliente"
                      />
                    </div>

                    <div className="form-group">
                      <label className="label">Telefone</label>
                      <input
                        value={novoCliente.telefone}
                        onChange={(e) =>
                          handleNovoClienteChange("telefone", e.target.value)
                        }
                        placeholder="(44) 99999-9999"
                        inputMode="tel"
                      />
                    </div>
                  </div>

                  <div className="form-group section-gap-sm">
                    <label className="label">Email (opcional)</label>
                    <input
                      value={novoCliente.email}
                      onChange={(e) => handleNovoClienteChange("email", e.target.value)}
                      placeholder="cliente@email.com"
                      inputMode="email"
                    />
                  </div>

                  <div className="form-actions section-gap-md">
                    <button
                      type="button"
                      onClick={criarNovoCliente}
                      disabled={savingCliente}
                      className="btn btn--solid"
                    >
                      {savingCliente ? "Salvando cliente..." : "Salvar cliente"}
                    </button>
                  </div>
                </div>
              </>
            ) : null}
          </div>

          <div className="card">
            <SectionTitle
              title="Veículo"
              subtitle="Informe os dados básicos do veículo."
            />

            <div className="grid-2">
              <div className="form-group">
                <label className="label">Modelo</label>
                <input
                  value={form.modelo}
                  onChange={(e) => handleFormChange("modelo", e.target.value)}
                  placeholder="Ex.: Gol, Uno, Civic..."
                />
              </div>

              <div className="form-group">
                <label className="label">Placa</label>
                <input
                  value={form.placa}
                  onChange={(e) => handleFormChange("placa", e.target.value)}
                  placeholder="ABC1D23"
                  maxLength={8}
                />
              </div>
            </div>
          </div>

          <div className="card">
            <SectionTitle
              title="Serviço"
              subtitle="Descreva o problema e informe os valores previstos."
            />

            <div className="form-group">
              <label className="label">Problema relatado</label>
              <textarea
                value={form.problema_relatado}
                onChange={(e) =>
                  handleFormChange("problema_relatado", e.target.value)
                }
                placeholder="Descreva o problema informado pelo cliente..."
                rows={5}
              />
            </div>

            <div className="grid-2 section-gap-sm">
              <div className="form-group">
                <label className="label">Mão de obra (R$)</label>
                <input
                  value={form.mao_obra}
                  onChange={(e) => handleFormChange("mao_obra", e.target.value)}
                  onBlur={() => handleMoneyBlur("mao_obra")}
                  inputMode="decimal"
                  placeholder="0,00"
                />
              </div>

              <div className="form-group">
                <label className="label">Peças (R$)</label>
                <input
                  value={form.valor_pecas}
                  onChange={(e) => handleFormChange("valor_pecas", e.target.value)}
                  onBlur={() => handleMoneyBlur("valor_pecas")}
                  inputMode="decimal"
                  placeholder="0,00"
                />
              </div>
            </div>
          </div>

          <div className="card">
            <SectionTitle
              title="Finalização"
              subtitle="Revise o total previsto e crie a ordem de serviço."
            />

            <div className="soft-box total-preview-box">
              <div className="label detail-label-tight">Total previsto</div>
              <div className="kpi kpi--dark kpi-compact">
                {money(totalPrevisto)}
              </div>
            </div>

            <div className="form-actions">
              <button type="submit" className="btn btn--solid" disabled={savingOS}>
                {savingOS ? "Criando..." : "Criar OS"}
              </button>
            </div>
          </div>
        </form>
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