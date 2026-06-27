import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppIcon } from "../components/AppIcon";
import { appIcons } from "../config/icons";
import { apiFetch, setToken } from "../api";
import "./Login.css";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateLoginForm(emailRaw, passwordRaw) {
  const email = String(emailRaw || "").trim();
  const password = String(passwordRaw || "");

  if (!email && !password) return "Email e senha obrigatórios";
  if (!email) return "Email obrigatório";
  if (!password) return "Senha obrigatória";
  if (!EMAIL_REGEX.test(email)) return "Email inválido";
  if (email.length > 120) return "Email inválido";
  if (password.length > 200) return "Senha inválida";

  return "";
}

export default function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    if (loading) return;

    const cleanEmail = String(email || "").trim();
    const rawPassword = String(password || "");

    const validationError = validateLoginForm(cleanEmail, rawPassword);
    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      setError("");
      setLoading(true);

      const data = await apiFetch(
        "/auth/login",
        {
          method: "POST",
          body: JSON.stringify({
            email: cleanEmail,
            password: rawPassword,
          }),
        },
        { auth: false }
      );

      setToken(data.token);
      localStorage.setItem("user", JSON.stringify(data.user));

      if (data.user.role === "tecnico") {
        nav("/os");
      } else {
        nav("/dashboard");
      }
    } catch (err) {
      const msg = err?.message || "Erro de conexão. Tente novamente.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page login-premium-page">
      <main className="login-premium-shell" aria-label="Login do OS SaaS">
        <section className="login-premium-hero" aria-label="Apresentação do sistema">
          <div className="login-premium-brand-row">
            <div className="login-premium-brand-main">
              <div className="login-premium-logo-mark" aria-hidden="true">
                OS
              </div>

              <div>
                <strong>OS SaaS</strong>
                <span>Oficina mecânica</span>
              </div>
            </div>

            <div className="login-premium-safe-pill">
              <AppIcon icon={appIcons.seguranca} size={18} />
              <span>Sistema seguro</span>
            </div>
          </div>

          <div className="login-premium-hero-content">
            <h1>
              Gestão completa para <span>sua oficina</span>
            </h1>

            <p>
              Organize ordens de serviço, clientes, veículos, peças e andamento
              da oficina em um só lugar.
            </p>

            <div className="login-premium-feature-list">
              <div className="login-premium-feature-item">
                <div className="login-premium-feature-icon" aria-hidden="true">
                  <AppIcon icon={appIcons.os} size={25} />
                </div>

                <div>
                  <strong>Ordens de serviço</strong>
                  <span>Acompanhe do início ao fechamento com status claros.</span>
                </div>
              </div>

              <div className="login-premium-feature-item">
                <div className="login-premium-feature-icon" aria-hidden="true">
                  <AppIcon icon={appIcons.clientes} size={25} />
                </div>

                <div>
                  <strong>Clientes e veículos</strong>
                  <span>Histórico organizado para melhorar o atendimento.</span>
                </div>
              </div>

              <div className="login-premium-feature-item">
                <div className="login-premium-feature-icon" aria-hidden="true">
                  <AppIcon icon={appIcons.financeiro} size={25} />
                </div>

                <div>
                  <strong>Controle financeiro</strong>
                  <span>Veja valores, orçamentos e resultados da oficina.</span>
                </div>
              </div>

              <div className="login-premium-feature-item">
                <div className="login-premium-feature-icon" aria-hidden="true">
                  <AppIcon icon={appIcons.indicadores} size={25} />
                </div>

                <div>
                  <strong>Relatórios e indicadores</strong>
                  <span>Tenha clareza do desempenho para tomar decisões.</span>
                </div>
              </div>
            </div>
          </div>

          <div className="login-premium-trust-card">
            <strong>Produto em validação real</strong>
            <span>Foco em organização, rastreabilidade e operação profissional.</span>
          </div>
        </section>

        <section className="login-premium-card" aria-label="Acesso à conta">
          <div className="login-premium-card-icon" aria-hidden="true">
            <AppIcon icon={appIcons.senha} size={30} />
          </div>

          <div className="login-premium-card-head">
            <h2>Acesse sua conta</h2>
            <p>Entre com seu email e senha para acessar o painel da oficina.</p>
          </div>

          <form onSubmit={onSubmit} className="login-premium-form" noValidate>
            <label className="login-premium-field">
              <span>Email</span>

              <div className="login-premium-input-wrap">
                <span className="login-premium-input-icon" aria-hidden="true">
                  <AppIcon icon={appIcons.email} size={21} />
                </span>

                <input
                  type="text"
                  inputMode="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (error) setError("");
                  }}
                  placeholder="Digite seu email"
                />
              </div>
            </label>

            <label className="login-premium-field">
              <span>Senha</span>

              <div className="login-premium-input-wrap">
                <span className="login-premium-input-icon" aria-hidden="true">
                  <AppIcon icon={appIcons.senha} size={21} />
                </span>

                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (error) setError("");
                  }}
                  placeholder="Digite sua senha"
                />

                <button
                  type="button"
                  className="login-premium-password-toggle"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                >
                  {showPassword ? (
                    <AppIcon icon={appIcons.esconder} size={20} />
                  ) : (
                    <AppIcon icon={appIcons.visualizar} size={20} />
                  )}
                </button>
              </div>
            </label>

            {error ? <div className="login-premium-error">Erro: {error}</div> : null}

            <button disabled={loading} className="login-premium-submit" type="submit">
              <span>{loading ? "Entrando..." : "Entrar"}</span>
              <strong aria-hidden="true">→</strong>
            </button>
          </form>

          <div className="login-premium-security-note">
            <div className="login-premium-security-icon" aria-hidden="true">
              <AppIcon icon={appIcons.seguranca} size={24} />
            </div>

            <div>
              <strong>Acesso protegido</strong>
              <span>Usuários entram por convite e permissões da oficina.</span>
            </div>
          </div>

          <div className="login-premium-footer">
            © 2026 OS SaaS. Uso restrito a oficinas autorizadas.
          </div>
        </section>
      </main>
    </div>
  );
}
