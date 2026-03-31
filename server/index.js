
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
const testRoutes = require("./routes/testRoutes");
const osRoutes = require("./routes/os");
const dashboardRoutes = require("./routes/dashboard");




app.use("/auth", authRoutes);
app.use("/clientes", clientesRoutes);
app.use("/", testRoutes);
app.use("/os", osRoutes);
app.use("/dashboard", dashboardRoutes);



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


