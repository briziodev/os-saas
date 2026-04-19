import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, setToken } from "../api";

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
      nav("/dashboard");


    } catch (err) {
      const msg = err?.message || "Erro de conexão. Tente novamente.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-shell">
        <section className="auth-hero">
          <div>
            <div className="auth-hero-eyebrow">OS SaaS • Oficina mecânica</div>

            <h1 className="auth-hero-title">Entre no sistema</h1>

            <p className="auth-hero-text">
              Controle ordens de serviço, clientes e andamento da oficina em um
              painel simples, organizado e profissional.
            </p>
          </div>

          <div className="auth-hero-list">
            <div className="auth-hero-item">
              <span className="auth-hero-bullet" />
              <div>Acompanhe ordens de serviço do início ao fechamento.</div>
            </div>

            <div className="auth-hero-item">
              <span className="auth-hero-bullet" />
              <div>Organize clientes e serviços em um só lugar.</div>
            </div>

            <div className="auth-hero-item">
              <span className="auth-hero-bullet" />
              <div>Tenha uma visão clara do andamento da oficina.</div>
            </div>
          </div>
        </section>

        <section className="auth-card">
          <div className="auth-card-head">
            <h2 className="auth-card-title">Acesse sua conta</h2>

            <p className="auth-card-text">
              Use seu email e senha para entrar no painel da oficina.
            </p>
          </div>

          <form onSubmit={onSubmit} className="auth-form" noValidate>
            <label className="form-group">
              <span className="label">Email</span>
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
            </label>

            <label className="form-group">
              <span className="label">Senha</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError("");
                }}
                placeholder="Digite sua senha"
              />
            </label>

            {error ? <div className="auth-error">Erro: {error}</div> : null}

            <button disabled={loading} className="btn btn--solid" type="submit">
              {loading ? "Entrando..." : "Entrar"}
            </button>
          </form>

          <div className="auth-note auth-footer">
            Seu acesso permanece ativo neste navegador para facilitar o uso
            diário.
          </div>
        </section>
      </div>
    </div>
  );
}