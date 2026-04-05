const express = require("express");
const cors = require("cors");
require("dotenv").config();

const pool = require("./db");

const app = express();

// 1) middlewares primeiro
app.use(
  cors({
    origin: (origin, callback) => {
      const allowed = process.env.CORS_ORIGIN
        ? process.env.CORS_ORIGIN.split(",")
        : ["http://localhost:5173"];

      if (!origin || allowed.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
  })
);

app.use(express.json());

// 2) routes depois
const authRoutes = require("./routes/auth");
const clientesRoutes = require("./routes/clientes");
const testRoutes = require("./routes/testRoutes");
const osRoutes = require("./routes/os");
const dashboardRoutes = require("./routes/dashboard");

app.use("/auth", authRoutes);
app.use("/clientes", clientesRoutes);
app.use("/", testRoutes);
app.use("/os", osRoutes);
app.use("/dashboard", dashboardRoutes);

// 3) health da aplicação
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", app: "running" });
});

// 4) health do banco
app.get("/health/db", async (req, res) => {
  try {
    const r = await pool.query("SELECT NOW() as now;");
    res.json({ status: "ok", db: r.rows[0].now });
  } catch (e) {
    console.error("DB health error:", e);

    let errors = null;

    if (Array.isArray(e && e.errors)) {
      errors = e.errors.map((err) => ({
        name: err && err.name ? err.name : null,
        message: err && err.message ? err.message : null,
        code: err && err.code ? err.code : null,
        address: err && err.address ? err.address : null,
        port: err && err.port ? err.port : null,
      }));
    }

    res.status(500).json({
      status: "error",
      name: e && e.name ? e.name : null,
      message: e && e.message ? e.message : null,
      code: e && e.code ? e.code : null,
      errors,
    });
  }
});

const port = Number(process.env.PORT || 3000);

app.listen(port, "0.0.0.0", () => {
  console.log(`API on port ${port}`);
});