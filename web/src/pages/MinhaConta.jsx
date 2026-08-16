import { useEffect, useState } from "react";
import { AppIcon } from "../components/AppIcon";
import PageHeader from "../components/PageHeader";
import { appIcons } from "../config/icons";
import {
  apiFetch,
  getToken,
} from "../api";
import { useAuth } from "../auth/useAuth";
import {
  getNewPasswordError,
} from "../utils/passwordPolicy";
import "./MinhaConta.css";

function roleLabel(role) {
  const labels = {
    admin: "Administrador",
    atendimento: "Atendimento",
    tecnico: "Técnico",
  };

  return labels[role] || "Usuário";
}

export default function MinhaConta() {
  const {
    user,
    setSession,
    updateUser,
    logout,
  } = useAuth();

  const [profile, setProfile] = useState(
    () => user
  );

  const [loadingProfile, setLoadingProfile] =
    useState(true);

  const [submitting, setSubmitting] =
    useState(false);

  const [currentPassword, setCurrentPassword] =
    useState("");

  const [newPassword, setNewPassword] =
    useState("");

  const [confirmPassword, setConfirmPassword] =
    useState("");

  const [profileError, setProfileError] =
    useState("");

  const [error, setError] =
    useState("");

  const [notice, setNotice] =
    useState("");

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      try {
        setLoadingProfile(true);
        setProfileError("");

        const data = await apiFetch("/auth/me");

        if (!active) return;

        setProfile(data);
        updateUser(data);
      } catch (err) {
        if (!active) return;

        if (!getToken()) {
          logout();
          window.location.href = "/login";
          return;
        }

        setProfileError(
          err?.message ||
            "Não foi possível atualizar os dados da conta."
        );
      } finally {
        if (active) {
          setLoadingProfile(false);
        }
      }
    }

    loadProfile();

    return () => {
      active = false;
    };
  }, [logout, updateUser]);

  async function handleSubmit(event) {
    event.preventDefault();

    if (submitting) return;

    setError("");
    setNotice("");

    if (!currentPassword) {
      setError("Informe sua senha atual.");
      return;
    }

    const passwordError =
      getNewPasswordError(newPassword);

    if (passwordError) {
      setError(passwordError);
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("As senhas não coincidem.");
      return;
    }

    if (currentPassword === newPassword) {
      setError(
        "A nova senha deve ser diferente da senha atual."
      );
      return;
    }

    try {
      setSubmitting(true);

      const data = await apiFetch(
        "/auth/change-password",
        {
          method: "POST",
          body: JSON.stringify({
            currentPassword,
            newPassword,
            confirmPassword,
          }),
        }
      );

      if (!data?.token || !data?.user) {
        logout();
        window.location.href = "/login";
        return;
      }

      setSession({
        token: data.token,
        user: data.user,
      });
      setProfile(data.user);

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");

      setNotice(
        "Senha alterada com sucesso. As outras sessões foram encerradas."
      );

      window.scrollTo({
        top: 0,
        behavior: "smooth",
      });
    } catch (err) {
      setError(
        err?.message ||
          "Não foi possível alterar a senha."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="minha-conta-page">
      <PageHeader
        eyebrow="Segurança da conta"
        title="Minha conta"
        description="Consulte seus dados e altere sua senha de acesso."
      />

      {profileError ? (
        <div
          className="minha-conta-feedback is-warning"
          role="alert"
        >
          {profileError}
        </div>
      ) : null}

      {error ? (
        <div
          className="minha-conta-feedback is-error"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      {notice ? (
        <div
          className="minha-conta-feedback is-success"
          role="status"
          aria-live="polite"
        >
          {notice}
        </div>
      ) : null}

      <div className="minha-conta-grid">
        <section className="minha-conta-card">
          <div className="minha-conta-card-heading">
            <div className="minha-conta-icon">
              <AppIcon
                icon={appIcons.usuario}
                size={22}
              />
            </div>

            <div>
              <h2>Dados da conta</h2>
              <p>
                Informações vinculadas ao seu acesso.
              </p>
            </div>
          </div>

          {loadingProfile && !profile ? (
            <p className="minha-conta-loading">
              Carregando dados...
            </p>
          ) : (
            <dl className="minha-conta-details">
              <div>
                <dt>Nome</dt>
                <dd>
                  {profile?.name ||
                    "Não informado"}
                </dd>
              </div>

              <div>
                <dt>E-mail</dt>
                <dd>
                  {profile?.email ||
                    "Não informado"}
                </dd>
              </div>

              <div>
                <dt>Perfil</dt>
                <dd>
                  {roleLabel(profile?.role)}
                </dd>
              </div>
            </dl>
          )}

          <div className="minha-conta-security-note">
            <AppIcon
              icon={appIcons.seguranca}
              size={19}
            />

            <p>
              Nome, e-mail, perfil e empresa não podem
              ser alterados por esta tela.
            </p>
          </div>
        </section>

        <section className="minha-conta-card">
          <div className="minha-conta-card-heading">
            <div className="minha-conta-icon">
              <AppIcon
                icon={appIcons.senha}
                size={22}
              />
            </div>

            <div>
              <h2>Alterar senha</h2>
              <p>
                A alteração encerrará suas outras
                sessões abertas.
              </p>
            </div>
          </div>

          <form
            className="minha-conta-form"
            onSubmit={handleSubmit}
            noValidate
          >
            <div className="minha-conta-field">
              <label htmlFor="currentPassword">
                Senha atual
              </label>

              <input
                id="currentPassword"
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) =>
                  setCurrentPassword(
                    event.target.value
                  )
                }
                disabled={submitting}
                required
              />
            </div>

            <div className="minha-conta-field">
              <label htmlFor="newPassword">
                Nova senha
              </label>

              <input
                id="newPassword"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                placeholder="Mínimo de 10 caracteres"
                minLength={10}
                value={newPassword}
                onChange={(event) =>
                  setNewPassword(
                    event.target.value
                  )
                }
                disabled={submitting}
                required
              />

              <span>
                Use pelo menos 10 caracteres. O limite
                seguro é de 72 bytes.
              </span>
            </div>

            <div className="minha-conta-field">
              <label htmlFor="confirmPassword">
                Confirmar nova senha
              </label>

              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) =>
                  setConfirmPassword(
                    event.target.value
                  )
                }
                disabled={submitting}
                required
              />
            </div>

            <button
              type="submit"
              className="minha-conta-submit"
              disabled={submitting}
            >
              <AppIcon
                icon={appIcons.senha}
                size={19}
              />

              {submitting
                ? "Alterando..."
                : "Alterar senha"}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}