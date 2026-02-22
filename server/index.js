const express = require("express");
const { Pool } = require("pg");

const app = express();
app.use(express.json());

const pool = new Pool({
  host: "localhost",
  port: 5432,
  user: "os",
  password: "os123",
  database: "os_saas",
});

app.get("/health", async (req, res) => {
  try {
    const r = await pool.query("SELECT NOW() as now;");
    res.json({ status: "ok", db: r.rows[0].now });
  } catch (e) {
    res.status(500).json({ status: "error", error: String(e.message || e) });
  }
});

app.post("/clientes", async (req, res) => {
  const { nome, email, telefone } = req.body;

  try {
    const result = await pool.query(
      "INSERT INTO clientes (nome, email, telefone) VALUES ($1, $2, $3) RETURNING *",
      [nome, email, telefone]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/clientes", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM clientes ORDER BY id ASC");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ PASSO B — Update (PUT)
app.put("/clientes/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { nome, email, telefone } = req.body;

  try {
    const result = await pool.query(
      `UPDATE clientes
       SET nome = $1, email = $2, telefone = $3
       WHERE id = $4
       RETURNING *`,
      [nome, email, telefone, id]
    );

    if (result.rowCount === 0) return res.status(404).json({ error: "Cliente não encontrado" });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ PASSO B — Delete (DELETE)
app.delete("/clientes/:id", async (req, res) => {
  const id = Number(req.params.id);

  try {
    const result = await pool.query(
      "DELETE FROM clientes WHERE id = $1 RETURNING *",
      [id]
    );

    if (result.rowCount === 0) return res.status(404).json({ error: "Cliente não encontrado" });
    res.json({ deleted: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => console.log("API on http://localhost:3000"));