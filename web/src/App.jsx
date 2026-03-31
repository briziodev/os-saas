import { useEffect, useState } from "react";
import Login from "./pages/Login";
import Clientes from "./pages/Clientes";
import { getToken } from "./api";

export default function App() {
  const [logado, setLogado] = useState(false);

  useEffect(() => {
    setLogado(!!getToken());
  }, []);

  if (!logado) {
    return <Login onLogin={() => setLogado(true)} />;
  }

  return <Clientes onLogout={() => setLogado(false)} />;
}