require("dotenv").config();
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const clientesRoutes = require("./routes/clientes");
const osRoutes = require("./routes/os");
const dashboardRoutes = require("./routes/dashboard");

const app = express();

const allowedOrigin = process.env.CORS_ORIGIN;

const corsOptions = {
  origin: allowedOrigin,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "ok", app: "running" });
});

app.use("/auth", authRoutes);
app.use("/clientes", clientesRoutes);
app.use("/os", osRoutes);
app.use("/dashboard", dashboardRoutes);

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});