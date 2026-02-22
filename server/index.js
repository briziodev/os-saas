const express = require("express");
const { Client } = require("pg");

const app = express();

app.get("/health", async (req, res) => {
  const client = new Client({
    host: "localhost",
    port: 5432,
    user: "os",
    password: "os123",
    database: "os_saas",
  });

  try {
    await client.connect();
    const r = await client.query("SELECT NOW() as now;");
    res.json({ status: "ok", db: r.rows[0].now });
  } catch (e) {
    res.status(500).json({ status: "error", error: String(e.message || e) });
  } finally {
    try { await client.end(); } catch {}
  }
});

app.listen(3000, () => console.log("API on http://localhost:3000"));
