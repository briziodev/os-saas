import { Routes, Route, Navigate } from "react-router-dom";
import { getToken, getUser } from "./api";
import AppShell from "./layouts/AppShell";

import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import OSList from "./pages/OSList";
import OSDetail from "./pages/OSDetail";
import OSNew from "./pages/OSNew";
import Clientes from "./pages/Clientes";
import Usuarios from "./pages/Usuarios";
import AtivarConta from "./pages/AtivarConta";
import Kanban from "./pages/Kanban";

function PrivateRoute({ children }) {
  const token = getToken();

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

function PrivateShell({ children }) {
  return (
    <PrivateRoute>
      <AppShell>{children}</AppShell>
    </PrivateRoute>
  );
}

export default function App() {
  const user = getUser();
  const role = user?.role;
  const canAccessDashboard = role === "admin" || role === "atendimento";
  const canAccessClientes = role === "admin" || role === "atendimento";
  const canAccessUsuarios = role === "admin";
  const canCreateOS = role === "admin" || role === "atendimento";

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/ativar-conta" element={<AtivarConta />} />

      <Route
        path="/dashboard"
        element={
          canAccessDashboard ? (
            <PrivateShell>
              <Dashboard />
            </PrivateShell>
          ) : (
            <PrivateRoute>
              <Navigate to="/os" replace />
            </PrivateRoute>
          )
        }
      />

      <Route
        path="/os"
        element={
          <PrivateShell>
            <OSList />
          </PrivateShell>
        }
      />

      <Route
        path="/os/new"
        element={
          canCreateOS ? (
            <PrivateShell>
              <OSNew />
            </PrivateShell>
          ) : (
            <PrivateRoute>
              <Navigate to="/os" replace />
            </PrivateRoute>
          )
        }
      />

      <Route
        path="/os/:id"
        element={
          <PrivateShell>
            <OSDetail />
          </PrivateShell>
        }
      />

      <Route
        path="/clientes"
        element={
          canAccessClientes ? (
            <PrivateShell>
              <Clientes />
            </PrivateShell>
          ) : (
            <PrivateRoute>
              <Navigate to="/os" replace />
            </PrivateRoute>
          )
        }
      />

      <Route
        path="/usuarios"
        element={
          canAccessUsuarios ? (
            <PrivateShell>
              <Usuarios />
            </PrivateShell>
          ) : (
            <PrivateRoute>
              <Navigate to="/os" replace />
            </PrivateRoute>
          )
        }
      />

      <Route
        path="/kanban"
        element={
          <PrivateShell>
            <Kanban />
          </PrivateShell>
        }
      />

      <Route path="/" element={<Navigate to="/os" replace />} />
      <Route path="*" element={<Navigate to="/os" replace />} />
    </Routes>
  );
}
