
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const pool = require("./db");

const app = express();

// 1) middlewares primeiro
app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

// 2) routes depois
const authRoutes = require("./routes/auth");
const clientesRoutes = require("./routes/clientes");

app.use("/auth", authRoutes);
app.use("/clientes", clientesRoutes);

// 3) health
app.get("/health", async (req, res) => {
  try {
    const r = await pool.query("SELECT NOW() as now;");
    res.json({ status: "ok", db: r.rows[0].now });
  } catch (e) {
    res.status(500).json({ status: "error", error: String(e.message || e) });
  }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`API on http://localhost:${port}`));




/*
const authRoutes = require("./routes/auth");
const express = require("express");
const cors = require("cors");
//const { Pool } = require("pg");
const pool = require("./db");
require("dotenv").config();

const app = express();

// libera o frontend acessar a API

app.use("/auth", authRoutes);
app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

const clientesRoutes = require("./routes/clientes");
app.use("/clientes", clientesRoutes);



app.get("/health", async (req, res) => {
  try {
    const r = await pool.query("SELECT NOW() as now;");
    res.json({ status: "ok", db: r.rows[0].now });
  } catch (e) {
    res.status(500).json({ status: "error", error: String(e.message || e) });
  }
});
// pool com variáveis dofdfsfs .env
const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});


*/
/*app.get("/health", async (req, res) => {
  try {
    const r = await pool.query("SELECT NOW() as now;");
    res.json({ status: "ok", db: r.rows[0].now });
  } catch (e) {
    res.status(500).json({ status: "error", error: String(e.message || e) });
  }
});
*/





/*

// ✅ CREATE (email obrigatório)
app.post("/clientes", async (req, res) => {
  const { nome, email, telefone } = req.body;

  const nomeLimpo = String(nome || "").trim();
  const emailLimpo = String(email || "").trim();
  const telefoneLimpo = String(telefone || "").replace(/\D/g, "");

  // validação
  if (!nomeLimpo) return res.status(400).json({ error: "nome é obrigatório" });
  if (!emailLimpo) return res.status(400).json({ error: "email é obrigatório" });
  if (!emailLimpo.includes("@")) return res.status(400).json({ error: "email inválido" });

  // telefone é opcional, mas se vier tem que ter pelo menos 10 dígitos
  if (telefone && telefoneLimpo.length > 0 && telefoneLimpo.length < 10) {
    return res.status(400).json({ error: "telefone inválido" });
  }

  try {
    const result = await pool.query(
      "INSERT INTO clientes (nome, email, telefone) VALUES ($1, $2, $3) RETURNING *",
      [nomeLimpo, emailLimpo, telefoneLimpo || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});







// ✅ READ
app.get("/clientes", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM clientes ORDER BY id ASC");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ UPDATE (email obrigatório)
app.put("/clientes/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { nome, email, telefone } = req.body;

  const nomeLimpo = String(nome || "").trim();
  const emailLimpo = String(email || "").trim();
  const telefoneLimpo = String(telefone || "").replace(/\D/g, "");

  if (!Number.isFinite(id)) return res.status(400).json({ error: "id inválido" });
  if (!nomeLimpo) return res.status(400).json({ error: "nome é obrigatório" });
  if (!emailLimpo) return res.status(400).json({ error: "email é obrigatório" });
  if (!emailLimpo.includes("@")) return res.status(400).json({ error: "email inválido" });

  if (telefone && telefoneLimpo.length > 0 && telefoneLimpo.length < 10) {
    return res.status(400).json({ error: "telefone :(  inválido" });
  }

  try {
    const result = await pool.query(
      `UPDATE clientes
       SET nome = $1, email = $2, telefone = $3
       WHERE id = $4
       RETURNING *`,
      [nomeLimpo, emailLimpo, telefoneLimpo || null, id]
    );

    if (result.rowCount === 0) return res.status(404).json({ error: "Cliente não encontrado" });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ DELETE
app.delete("/clientes/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "id inválido" });

  try {
    const result = await pool.query("DELETE FROM clientes WHERE id = $1 RETURNING *", [id]);

    if (result.rowCount === 0) return res.status(404).json({ error: "Cliente não encontrado" });
    res.json({ deleted: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`API on http://localhost:${port}`));*/