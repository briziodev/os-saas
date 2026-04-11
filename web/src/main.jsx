import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import "./index.css";

import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import OSList from "./pages/OSList.jsx";
import OSNew from "./pages/OSNew.jsx";
import OSDetail from "./pages/OSDetail.jsx";
import Kanban from "./pages/Kanban.jsx";
import Clientes from "./pages/Clientes.jsx";
import AtivarConta from "./pages/AtivarConta.jsx";

function PrivateRoute({ children }) {
  const token = localStorage.getItem("token");
  return token ? children : <Navigate to="/login" replace />;
}

function RootRedirect() {
  const token = localStorage.getItem("token");
  return <Navigate to={token ? "/dashboard" : "/login"} replace />;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/login" element={<Login />} />
        <Route path="/ativar-conta" element={<AtivarConta />} />

        <Route
          path="/dashboard"
          element={
            <PrivateRoute>
              <Dashboard />
            </PrivateRoute>
          }
        />

        <Route
          path="/clientes"
          element={
            <PrivateRoute>
              <Clientes />
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
          path="/kanban"
          element={
            <PrivateRoute>
              <Kanban />
            </PrivateRoute>
          }
        />

        <Route path="*" element={<RootRedirect />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);