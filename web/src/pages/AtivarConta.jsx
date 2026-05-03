import { useEffect, useState } from "react";
import { apiFetch, clearToken } from "../api";

function formatarDataHora(valor) {
  if (!valor) return "Não informado";

  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return valor;

  return data.toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export default function AtivarConta() {
  const [token, setToken] = useState("");
  const [invite, setInvite] = useState(null);
  const [inviteStatus, setInviteStatus] = useState("loading");
  const [submitting, setSubmitting] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenFromUrl = String(params.get("token") || "").trim();

    setToken(tokenFromUrl);
    clearToken();

    if (!tokenFromUrl) {
      setInviteStatus("invalid");
      setError("Link de ativação inválido. Peça um novo convite para a oficina.");
      return;
    }

    let ativo = true;

    async function validarConvite() {
      try {
        setError("");
        setInviteStatus("loading");

        const data = await apiFetch(
          `/auth/invite/${tokenFromUrl}`,
          { method: "GET" },
          { auth: false }
        );

        if (!ativo) return;

        setInvite(data);
        setInviteStatus("valid");
      } catch (err) {
        if (!ativo) return;

        setInvite(null);
        setInviteStatus("invalid");
        setError(err.message || "Não foi possível validar o convite.");
      }
    }

    validarConvite();

    return () => {
      ativo = false;
    };
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();

    if (inviteStatus !== "valid") {
      setError("Este convite não está válido para ativação.");
      return;
    }

    if (!token) {
      setError("Token obrigatório.");
      return;
    }

    if (!password || password.length < 6) {
      setError("A senha precisa ter no mínimo 6 caracteres.");
      return;
    }

    if (password !== confirmPassword) {
      setError("As senhas não coincidem.");
      return;
    }

    try {
      setSubmitting(true);
      setError("");

      const data = await apiFetch(
        "/auth/activate",
        {
          method: "POST",
          body: JSON.stringify({
            token,
            password,
            confirmPassword,
          }),
        },
        { auth: false }
      );

      setSuccess(data.message || "Conta ativada com sucesso.");
      setInviteStatus("activated");
      setPassword("");
      setConfirmPassword("");
      clearToken();
    } catch (err) {
      setError(err.message || "Não foi possível ativar a conta.");
    } finally {
      setSubmitting(false);
    }
  }

  function irParaLogin() {
    clearToken();
    window.location.href = "/";
  }

  return (
    <div className="auth-page">
      <div className="auth-shell">
        <section className="auth-hero">
          <div>
            <div className="auth-hero-eyebrow">Ativação de acesso</div>
            <h1 className="auth-hero-title">Ative sua conta</h1>
            <p className="auth-hero-text">
              Defina sua senha para começar a usar o sistema da oficina com
              segurança.
            </p>
          </div>

          <div className="auth-hero-list">
            <div className="auth-hero-item">
              <span className="auth-hero-bullet" />
              <div>
                Seu acesso só é liberado depois da ativação do convite.
              </div>
            </div>

            <div className="auth-hero-item">
              <span className="auth-hero-bullet" />
              <div>
                Depois de ativar, você entra normalmente pela tela de login.
              </div>
            </div>

            <div className="auth-hero-item">
              <span className="auth-hero-bullet" />
              <div>
                Use uma senha simples de lembrar, mas que não seja fácil para
                outras pessoas adivinharem.
              </div>
            </div>
          </div>
        </section>

        <section className="auth-card">
          {inviteStatus === "loading" ? (
            <>
              <div className="auth-card-head">
                <h2 className="auth-card-title">Validando convite</h2>
                <p className="auth-card-text">
                  Aguarde enquanto verificamos seu link de ativação.
                </p>
              </div>
            </>
          ) : inviteStatus === "activated" || success ? (
            <>
              <div className="auth-card-head">
                <h2 className="auth-card-title">Conta ativada</h2>
                <p className="auth-card-text">
                  Seu acesso foi liberado com sucesso. Agora você já pode entrar
                  no sistema.
                </p>
              </div>

              <div className="soft-box">
                <strong>{invite?.user?.name || "Usuário"}</strong>
                <p className="section-gap-sm muted">
                  {invite?.user?.email || "Email não informado"}
                </p>
              </div>

              <div className="section-gap-md">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={irParaLogin}
                >
                  Ir para o login
                </button>
              </div>
            </>
          ) : inviteStatus === "invalid" ? (
            <>
              <div className="auth-card-head">
                <h2 className="auth-card-title">Convite inválido ou expirado</h2>
                <p className="auth-card-text">
                  Este link não pode ser usado para ativar uma conta.
                </p>
              </div>

              {error ? (
                <div className="auth-error section-gap-md">{error}</div>
              ) : null}

              <div className="auth-footer auth-note section-gap-md">
                Peça para o administrador da oficina reenviar um novo convite.
              </div>

              <div className="section-gap-md">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={irParaLogin}
                >
                  Ir para o login
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="auth-card-head">
                <h2 className="auth-card-title">Definir senha</h2>
                <p className="auth-card-text">
                  Confira seus dados e escolha a senha para ativar sua conta.
                </p>
              </div>

              {invite?.user ? (
                <div className="soft-box section-gap-sm">
                  <div className="stack">
                    <div>
                      <strong>Nome</strong>
                      <p className="section-gap-sm muted">{invite.user.name}</p>
                    </div>

                    <div>
                      <strong>Email</strong>
                      <p className="section-gap-sm muted">{invite.user.email}</p>
                    </div>

                    <div>
                      <strong>Perfil</strong>
                      <p className="section-gap-sm muted">
                        {formatRoleLabel(invite.user.role)}
                      </p>
                    </div>

                    <div>
                      <strong>Validade do convite</strong>
                      <p className="section-gap-sm muted">
                        {formatarDataHora(invite.expires_at)}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}

              {error ? (
                <div className="auth-error section-gap-md">{error}</div>
              ) : null}

              <form className="auth-form section-gap-md" onSubmit={handleSubmit}>
                <div className="form-group">
                  <label htmlFor="password">Nova senha</label>
                  <input
                    id="password"
                    type="password"
                    placeholder="Mínimo de 6 caracteres"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={submitting}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="confirmPassword">Confirmar senha</label>
                  <input
                    id="confirmPassword"
                    type="password"
                    placeholder="Repita a senha"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={submitting}
                  />
                </div>

                <button
                  type="submit"
                  className="btn btn--primary"
                  disabled={submitting}
                >
                  {submitting ? "Ativando..." : "Ativar conta"}
                </button>
              </form>

              <div className="auth-footer auth-note">
                Se este link expirou, peça um novo convite para a oficina.
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function formatRoleLabel(role) {
  if (role === "admin") return "Admin";
  if (role === "atendimento") return "Atendimento";
  if (role === "tecnico") return "Técnico";
  return role || "-";
}