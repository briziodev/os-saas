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
const requestLogger = require("./middlewares/requestLogger");
const errorHandler = require("./middlewares/errorHandler");
const { logger } = require("./utils/logger");

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);

const allowedOrigins = String(process.env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error("Origem não permitida pelo CORS."));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: false,
}));

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

app.use(requestLogger);

app.use(express.json({ limit: "1mb" }));

app.get("/health", (req, res) => {
  return res.json({
    status: "ok",
    app: "running",
    requestId: req.requestId,
  });
});

app.use(apiLimiter);

app.use("/auth", authRoutes);
app.use("/users", usersRoutes);
app.use("/clientes", clientesRoutes);
app.use("/os", osRoutes);
app.use("/dashboard", dashboardRoutes);

app.use((req, res) => {
  logger.warn("ROUTE_NOT_FOUND", "Rota não encontrada", {
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl,
    ip: req.ip,
    userId: req.user?.id,
    companyId: req.user?.company_id,
    role: req.user?.role,
  });

  return res.status(404).json({
    error: "Rota não encontrada.",
    requestId: req.requestId,
  });
});

app.use(errorHandler);

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  logger.info("SERVER_STARTED", "Servidor iniciado", {
    port: PORT,
    env: process.env.NODE_ENV || "development",
  });
});