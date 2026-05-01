require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const authRoutes = require("./routes/auth");
const clientesRoutes = require("./routes/clientes");
const osRoutes = require("./routes/os");
const dashboardRoutes = require("./routes/dashboard");
const usersRoutes = require("./routes/users");
const { apiLimiter } = require("./middlewares/rateLimiters");

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);

const allowedOrigin = process.env.CORS_ORIGIN;

const corsOptions = {
  origin: allowedOrigin,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: false,
}));

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

app.use(express.json({ limit: "1mb" }));

app.get("/health", (req, res) => {
  return res.json({ status: "ok", app: "running" });
});

app.use(apiLimiter);

app.use("/auth", authRoutes);
app.use("/users", usersRoutes);
app.use("/clientes", clientesRoutes);
app.use("/os", osRoutes);
app.use("/dashboard", dashboardRoutes);

app.use((req, res) => {
  return res.status(404).json({
    error: "Rota não encontrada.",
  });
});

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({
      error: "JSON inválido.",
    });
  }

  console.error("Erro não tratado:", {
    method: req.method,
    path: req.originalUrl,
    message: err.message,
  });

  return res.status(500).json({
    error: "Erro interno do servidor.",
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});