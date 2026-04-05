const express = require("express");
const cors = require("cors");
require("dotenv").config();

const pool = require("./db");

const app = express();

// 1) middlewares primeiro
app.use(cors({
  origin: (origin, callback) => {
    const allowed = process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(",")
      : ["http://localhost:5173"];

    if (!origin || allowed.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  }
}));

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

// 3) health
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", app: "running" });
});

app.get("/health/db", async (req, res) => {
  try {
    const r = await pool.query("SELECT NOW() as now;");
    res.json({ status: "ok", db: r.rows[0].now });
  } catch (e) {
    res.status(500).json({ status: "error", error: String(e.message || e) });
  }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, "0.0.0.0", () => {
  console.log(`API on port ${port}`);
});