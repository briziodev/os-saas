import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { AppIcon } from "../components/AppIcon";
import { appIcons } from "../config/icons";
import { clearToken, getUser } from "../api";
import "./AppShell.css";

const PAGE_META = [
  {
    key: "dashboard",
    label: "Dashboard",
    description: "Indicadores e visão gerencial da oficina.",
    to: "/dashboard",
    icon: appIcons.dashboard,
    roles: ["admin", "atendimento"],
    match: (path) => path.startsWith("/dashboard"),
  },
  {
    key: "os",
    label: "OS",
    description: "Ordens de serviço e atendimento operacional.",
    to: "/os",
    icon: appIcons.os,
    roles: ["admin", "atendimento", "tecnico"],
    match: (path) => path === "/os" || path.startsWith("/os/"),
  },
  {
    key: "kanban",
    label: "Quadro de OS",
    description: "Acompanhamento visual do andamento da oficina.",
    to: "/kanban",
    icon: appIcons.kanban,
    roles: ["admin", "atendimento", "tecnico"],
    match: (path) => path.startsWith("/kanban"),
  },
  {
    key: "clientes",
    label: "Clientes",
    description: "Cadastro e consulta da base de clientes.",
    to: "/clientes",
    icon: appIcons.clientes,
    roles: ["admin", "atendimento"],
    match: (path) => path.startsWith("/clientes"),
  },
  {
    key: "usuarios",
    label: "Usuários",
    description: "Equipe, convites e permissões.",
    to: "/usuarios",
    icon: appIcons.usuarios,
    roles: ["admin"],
    match: (path) => path.startsWith("/usuarios"),
  },
];

function getInitials(value) {
  const clean = String(value || "U").trim();
  const parts = clean.split(/\s+/).filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }

  return clean.slice(0, 2).toUpperCase();
}

function roleLabel(role) {
  const labels = {
    admin: "Administrador",
    atendimento: "Atendimento",
    tecnico: "Técnico",
    member: "Member antigo",
  };

  return labels[role] || "Usuário";
}

function canSeeItem(item, role) {
  return item.roles.includes(role);
}

export default function AppShell({ children }) {
  const location = useLocation();
  const user = getUser();
  const role = user?.role || "";
  const path = location.pathname;
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);

  const navItems = PAGE_META.filter((item) => canSeeItem(item, role));
  const activeItem = navItems.find((item) => item.match(path)) || navItems[0];
  const canCreateOS = role === "admin" || role === "atendimento";
  const bottomItems = navItems.filter((item) => {
    if (role === "admin") {
      return ["dashboard", "os", "clientes"].includes(item.key);
    }

    if (role === "atendimento") {
      return ["dashboard", "os", "clientes"].includes(item.key);
    }

    return ["os", "kanban"].includes(item.key);
  });

  const mobileMoreItems =
    role === "admin"
      ? navItems.filter((item) => ["kanban", "usuarios"].includes(item.key))
      : role === "atendimento"
        ? navItems.filter((item) => ["kanban"].includes(item.key))
        : [];

  const mobileMoreActive =
    mobileMoreItems.length > 0 &&
    (mobileMoreOpen || mobileMoreItems.some((item) => item.match(path)));

  useEffect(() => {
    setMobileMoreOpen(false);
  }, [path]);

  function logout() {
    clearToken();
    window.location.href = "/login";
  }

  return (
    <div className="app-shell">
      <aside className="app-shell-sidebar" aria-label="Menu principal">
        <Link to={role === "tecnico" ? "/os" : "/dashboard"} className="app-shell-brand" aria-label="Ir para início">
          <div className="app-shell-logo">
            <AppIcon icon={appIcons.logo} size={24} />
          </div>
          <div>
            <strong>OS SaaS</strong>
            <span>Oficina mecânica</span>
          </div>
        </Link>

        <nav className="app-shell-menu" aria-label="Navegação principal">
          {navItems.map((item) => {
            const active = item.match(path);

            return (
              <Link key={item.key} to={item.to} className={`app-shell-menu-item ${active ? "is-active" : ""}`}>
                <AppIcon icon={item.icon} size={20} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="app-shell-sidebar-footer">
          <div className="app-shell-context-card">
            <AppIcon icon={appIcons.admin} size={18} />
            <div>
              <strong>{activeItem?.label || "Operação"}</strong>
              <span>{activeItem?.description || "Gestão da oficina"}</span>
            </div>
          </div>

          <div className="app-shell-user-card">
            <div className="app-shell-avatar">{getInitials(user?.name || user?.email || "Usuário")}</div>
            <div>
              <strong>{user?.name || user?.email || "Usuário logado"}</strong>
              <span>{roleLabel(role)}</span>
            </div>
          </div>

          <button type="button" className="app-shell-logout" onClick={logout}>
            <AppIcon icon={appIcons.sair} size={17} />
            <span>Sair</span>
          </button>
        </div>
      </aside>

      <main className="app-shell-main">
        <header className="app-shell-mobile-header">
          <Link to={role === "tecnico" ? "/os" : "/dashboard"} className="app-shell-mobile-brand" aria-label="Ir para início">
            <div className="app-shell-logo">
              <AppIcon icon={appIcons.logo} size={24} />
            </div>
            <div>
              <strong>OS SaaS</strong>
              <span>{activeItem?.label || "Operação"}</span>
            </div>
          </Link>

          {canCreateOS ? (
            <Link to="/os/new" className="app-shell-mobile-new-os">
              <AppIcon icon={appIcons.novaOS} size={18} />
              Nova OS
            </Link>
          ) : (
            <div className="app-shell-mobile-role-pill">
              <AppIcon icon={appIcons.tecnico} size={17} />
              Técnico
            </div>
          )}
        </header>

        <div className="app-shell-content">{children}</div>

        <nav className={`app-shell-bottom-nav ${canCreateOS ? "has-primary-action" : "has-secondary-action"}`} aria-label="Navega??o mobile">
          {(canCreateOS ? bottomItems.slice(0, 2) : bottomItems).map((item) => {
            const active = item.match(path);
            const label = item.label === "Quadro de OS" ? "Quadro" : item.label;

            return (
              <Link key={item.key} to={item.to} className={active ? "is-active" : ""}>
                <AppIcon icon={item.icon} size={21} />
                <span>{label}</span>
              </Link>
            );
          })}

          {canCreateOS ? (
            <Link to="/os/new" className={path === "/os/new" ? "app-shell-bottom-plus is-active" : "app-shell-bottom-plus"}>
              <AppIcon icon={appIcons.novaOS} size={23} />
              <span>Nova OS</span>
            </Link>
          ) : null}

          {canCreateOS ? bottomItems.slice(2).map((item) => {
            const active = item.match(path);
            const label = item.label === "Quadro de OS" ? "Quadro" : item.label;

            return (
              <Link key={item.key} to={item.to} className={active ? "is-active" : ""}>
                <AppIcon icon={item.icon} size={21} />
                <span>{label}</span>
              </Link>
            );
          }) : null}

          {mobileMoreItems.length > 0 ? (
            <button
              type="button"
              className={mobileMoreActive ? "app-shell-bottom-more-trigger is-active" : "app-shell-bottom-more-trigger"}
              onClick={() => setMobileMoreOpen((value) => !value)}
              aria-expanded={mobileMoreOpen}
              aria-label="Abrir menu Mais"
            >
              <AppIcon icon={appIcons.filtrosAvancados} size={21} />
              <span>Mais</span>
            </button>
          ) : null}
          {!canCreateOS ? (
            <button type="button" onClick={logout}>
              <AppIcon icon={appIcons.sair} size={21} />
              <span>Sair</span>
            </button>
          ) : null}
        </nav>

        {mobileMoreItems.length > 0 && mobileMoreOpen ? (
          <div className="app-shell-bottom-more-panel" role="menu" aria-label="Menu Mais">
            {mobileMoreItems.map((item) => {
              const active = item.match(path);

              return (
                <Link
                  key={item.key}
                  to={item.to}
                  className={active ? "is-active" : ""}
                  role="menuitem"
                  onClick={() => setMobileMoreOpen(false)}
                >
                  <AppIcon icon={item.icon} size={20} />
                  <span>{item.label}</span>
                </Link>
              );
            })}

            <button type="button" role="menuitem" onClick={logout}>
              <AppIcon icon={appIcons.sair} size={20} />
              <span>Sair</span>
            </button>
          </div>
        ) : null}
      </main>
    </div>
  );
}
