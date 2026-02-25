import { useEffect, useState } from "react";

export default function App() {
  const [clientes, setClientes] = useState([]);
  const [erro, setErro] = useState("");
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    nome: "",
    email: "",
    telefone: "",
  });

  function carregarClientes() {
    setErro("");
    return fetch("http://localhost:3000/clientes")
      .then((res) => res.json())
      .then((data) => setClientes(data))
      .catch((e) => setErro(String(e)));
  }

  useEffect(() => {
    carregarClientes();
  }, []);

  function handleChange(e) {
    setForm((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    setErro("");

    const nome = form.nome.trim();
    const email = form.email.trim();
    const telefoneRaw = form.telefone.trim();
    const telefone = telefoneRaw.replace(/\D/g, ""); // só números

    // ✅ validação
    if (!nome) {
      alert("Nome é obrigatório");
      return;
    }

    if (!email) {
      alert("Email é obrigatório");
      return;
    }

    if (!email.includes("@")) {
      alert("Email inválido");
      return;
    }

    if (telefoneRaw && telefone.length < 10) {
      alert("Telefone inválido (mínimo 10 dígitos)");
      return;
    }

    setLoading(true);

    fetch("http://localhost:3000/clientes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome, email, telefone }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Erro ao cadastrar");
        return data;
      })
      .then(() => {
        setForm({ nome: "", email: "", telefone: "" });
        return carregarClientes();
      })
      .catch((e) => setErro(String(e.message || e)))
      .finally(() => setLoading(false));
  }

  const podeCadastrar = form.nome.trim() && form.email.trim();

  return (
    <div style={{ padding: 20, fontFamily: "Arial" }}>
      <h1>Clientes</h1>

      {erro && <p style={{ color: "red" }}>Erro: {erro}</p>}

      <form onSubmit={handleSubmit} style={{ marginBottom: 20 }}>
        <input
          name="nome"
          placeholder="Nome (obrigatório)"
          value={form.nome}
          onChange={handleChange}
        />
        <input
          name="email"
          placeholder="Email (obrigatório)"
          value={form.email}
          onChange={handleChange}
        />
        <input
          name="telefone"
          placeholder="Telefone (opcional)"
          value={form.telefone}
          onChange={handleChange}
        />

        <button type="submit" disabled={!podeCadastrar || loading}>
          {loading ? "Salvando..." : "Cadastrar"}
        </button>
      </form>

      <ul>
        {clientes.map((c) => (
          <li key={c.id}>
            <strong>{c.nome}</strong> — {c.email} — {c.telefone}
          </li>
        ))}
      </ul>
    </div>
  );
}