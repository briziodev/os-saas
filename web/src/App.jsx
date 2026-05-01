import { Routes, Route, Navigate } from "react-router-dom";
import { getToken, getUser } from "./api";

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

export default function App() {
  const rawUser = getUser();
const role = rawUser?.role;

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/ativar-conta" element={<AtivarConta />} />

      <Route
        path="/dashboard"
        element={
          <PrivateRoute>
            {role === "admin" || role === "atendimento" ? (
  <Dashboard />
) : (
  <Navigate to="/os" replace />
)}




          </PrivateRoute>
        }
      />

      <Route
        path="/os"
        element={
          <PrivateRoute>
            <OSList />
          </PrivateRoute>
        }
      />

      <Route
        path="/os/new"
        element={
          <PrivateRoute>
            <OSNew />
          </PrivateRoute>
        }
      />

      <Route
        path="/os/:id"
        element={
          <PrivateRoute>
            <OSDetail />
          </PrivateRoute>
        }
      />

      <Route
        path="/clientes"
        element={
          <PrivateRoute>
            {user?.role === "admin" || user?.role === "atendimento" ? (
              <Clientes />
            ) : (
              <Navigate to="/os" replace />
            )}
          </PrivateRoute>
        }
      />

      <Route
        path="/usuarios"
        element={
          <PrivateRoute>
            {user?.role === "admin" ? (
              <Usuarios />
            ) : (
              <Navigate to="/os" replace />
            )}
          </PrivateRoute>
        }
      />

      <Route
        path="/kanban"
        element={
          <PrivateRoute>
            <Kanban />
          </PrivateRoute>
        }
      />

      <Route path="/" element={<Navigate to="/os" replace />} />
      <Route path="*" element={<Navigate to="/os" replace />} />
    </Routes>
  );
}