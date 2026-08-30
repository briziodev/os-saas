const express = require("express");
const router = express.Router();
const pool = require("../db");

const { authRequired, loadUser } = require("../middlewares/auth");
const { requireRole } = require("../middlewares/requireRole");
const validate = require("../middlewares/validate");
const { logger } = require("../utils/logger");
const {
  sensitiveActionLimiter,
} = require("../middlewares/rateLimiters");
const {
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  insertAuditLog,
} = require("../services/auditLog");
const {
  clienteIdParamSchema,
  clienteSchema,
  clienteArchiveSchema,
} = require("../validators/clienteSchemas");

router.use(authRequired, loadUser);

const TERMINAL_OS_STATUSES = Object.freeze([
  "cancelado",
  "encerrado",
  "finalizado",
]);

function logClientAction(
  req,
  event,
  message,
  clienteId,
  extra = {}
) {
  logger.info(event, message, {
    requestId: req.requestId,
    userId: req.user?.id,
    companyId: req.user?.company_id,
    role: req.user?.role,
    clienteId: Number(clienteId),
    ip: req.ip,
    ...extra,
  });
}

async function safeRollback(
  client,
  req,
  event,
  clienteId
) {
  try {
    await client.query("ROLLBACK");
  } catch (rollbackError) {
    logger.warn(
      event,
      "Falha ao reverter transação de cliente",
      {
        requestId: req.requestId,
        userId: req.user?.id,
        companyId: req.user?.company_id,
        role: req.user?.role,
        clienteId: Number(clienteId),
        error: rollbackError.message,
        ip: req.ip,
      }
    );
  }
}

// GET /clientes
// Padrão: somente clientes ativos.
// ?status=archived: somente Admin.
router.get(
  "/",
  requireRole("admin", "atendimento"),
  async (req, res, next) => {
    try {
      const status = String(
        req.query.status || "active"
      )
        .trim()
        .toLowerCase();

      if (
        status !== "active" &&
        status !== "archived"
      ) {
        return res.status(400).json({
          error:
            "Status inválido para consulta de clientes.",
          code:
            "INVALID_CLIENT_STATUS_FILTER",
          requestId:
            req.requestId,
        });
      }

      if (
        status === "archived" &&
        req.user.role !== "admin"
      ) {
        return res.status(403).json({
          error:
            "Somente administrador pode consultar clientes arquivados.",
          code:
            "CLIENT_ARCHIVED_LIST_FORBIDDEN",
          requestId:
            req.requestId,
        });
      }

      const archiveClause =
        status === "archived"
          ? "archived_at IS NOT NULL"
          : "archived_at IS NULL";

      const orderClause =
        status === "archived"
          ? "archived_at DESC, id DESC"
          : "id ASC";

      const result = await pool.query(
        `
        SELECT *
        FROM clientes
        WHERE company_id = $1
          AND ${archiveClause}
        ORDER BY ${orderClause}
        `,
        [req.user.company_id]
      );

      return res.json(result.rows);
    } catch (err) {
      return next(err);
    }
  }
);

// POST /clientes
router.post(
  "/",
  requireRole("admin", "atendimento"),
  validate(clienteSchema),
  async (req, res, next) => {
    try {
      const { nome, email, telefone } = req.body;

      const result = await pool.query(
        `
        INSERT INTO clientes
          (
            nome,
            email,
            telefone,
            user_id,
            company_id
          )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
        `,
        [
          nome,
          email,
          telefone,
          req.user.id,
          req.user.company_id,
        ]
      );

      return res.status(201).json(
        result.rows[0]
      );
    } catch (err) {
      return next(err);
    }
  }
);

// PUT /clientes/:id
// Cliente arquivado precisa ser reativado antes de edição.
router.put(
  "/:id",
  requireRole("admin", "atendimento"),
  validate(clienteIdParamSchema, "params"),
  validate(clienteSchema),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { nome, email, telefone } =
        req.body;

      const result = await pool.query(
        `
        UPDATE clientes
        SET
          nome = $1,
          email = $2,
          telefone = $3
        WHERE id = $4
          AND company_id = $5
          AND archived_at IS NULL
        RETURNING *
        `,
        [
          nome,
          email,
          telefone,
          id,
          req.user.company_id,
        ]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({
          error:
            "Cliente ativo não encontrado (ou não pertence à sua empresa).",
          requestId:
            req.requestId,
        });
      }

      return res.json(result.rows[0]);
    } catch (err) {
      return next(err);
    }
  }
);

// POST /clientes/:id/archive
router.post(
  "/:id/archive",
  sensitiveActionLimiter,
  requireRole("admin"),
  validate(clienteIdParamSchema, "params"),
  validate(clienteArchiveSchema),
  async (req, res, next) => {
    const { id } = req.params;
    const clienteId = Number(id);
    const motivo =
      String(req.body.motivo || "").trim();

    let client = null;
    let transactionOpen = false;

    try {
      client = await pool.connect();

      await client.query("BEGIN");
      transactionOpen = true;

      const current = await client.query(
        `
        SELECT
          id,
          archived_at
        FROM clientes
        WHERE id = $1
          AND company_id = $2
        FOR UPDATE
        `,
        [
          id,
          req.user.company_id,
        ]
      );

      if (current.rowCount === 0) {
        await client.query("ROLLBACK");
        transactionOpen = false;

        return res.status(404).json({
          error:
            "Cliente não encontrado (ou não pertence à sua empresa).",
          requestId:
            req.requestId,
        });
      }

      if (current.rows[0].archived_at) {
        await client.query("ROLLBACK");
        transactionOpen = false;

        return res.status(409).json({
          error:
            "Este cliente já está arquivado.",
          code:
            "CLIENT_ALREADY_ARCHIVED",
          requestId:
            req.requestId,
        });
      }

      const blockingOS =
        await client.query(
          `
          SELECT
            id,
            status
          FROM ordens_servico
          WHERE cliente_id = $1
            AND company_id = $2
            AND (
              status IS NULL
              OR NOT (
                status::text = ANY($3::text[])
              )
            )
          ORDER BY id ASC
          LIMIT 1
          `,
          [
            id,
            req.user.company_id,
            TERMINAL_OS_STATUSES,
          ]
        );

      if (blockingOS.rowCount > 0) {
        await client.query("ROLLBACK");
        transactionOpen = false;

        const os =
          blockingOS.rows[0];

        logger.warn(
          "CLIENT_ARCHIVE_BLOCKED_OPEN_OS",
          "Arquivamento de cliente bloqueado por OS operacional",
          {
            requestId:
              req.requestId,
            userId:
              req.user.id,
            companyId:
              req.user.company_id,
            role:
              req.user.role,
            clienteId,
            osId:
              Number(os.id),
            osStatus:
              os.status,
            ip:
              req.ip,
          }
        );

        return res.status(409).json({
          error:
            "Não é possível arquivar este cliente porque existe uma ordem de serviço em andamento.",
          code:
            "CLIENT_ARCHIVE_BLOCKED_OPEN_OS",
          blocking_os: {
            id: os.id,
            status: os.status,
          },
          requestId:
            req.requestId,
        });
      }

      const updated =
        await client.query(
          `
          UPDATE clientes
          SET
            archived_at = now(),
            archived_by = $3,
            archive_reason = $4
          WHERE id = $1
            AND company_id = $2
            AND archived_at IS NULL
          RETURNING *
          `,
          [
            id,
            req.user.company_id,
            req.user.id,
            motivo,
          ]
        );

      if (updated.rowCount !== 1) {
        throw new Error(
          "Cliente não foi arquivado após bloqueio transacional."
        );
      }

      const archivedClient =
        updated.rows[0];

      await insertAuditLog(
        client,
        {
          companyId:
            req.user.company_id,
          actorUserId:
            req.user.id,
          actorRole:
            req.user.role,
          action:
            AUDIT_ACTIONS.CLIENT_ARCHIVED,
          entityType:
            AUDIT_ENTITY_TYPES.CLIENTE,
          entityId:
            archivedClient.id,
          requestId:
            req.requestId,
          ip:
            req.ip,
          metadata: {
            reason:
              motivo,
            source:
              "client_archive",
          },
        }
      );

      await client.query("COMMIT");
      transactionOpen = false;

      logClientAction(
        req,
        "CLIENT_ARCHIVED",
        "Cliente arquivado",
        clienteId,
        {
          reasonLength:
            motivo.length,
        }
      );

      return res.json({
        message:
          "Cliente arquivado com sucesso.",
        cliente:
          archivedClient,
        requestId:
          req.requestId,
      });
    } catch (err) {
      if (
        transactionOpen &&
        client
      ) {
        await safeRollback(
          client,
          req,
          "CLIENT_ARCHIVE_ROLLBACK_FAILED",
          clienteId
        );
      }

      return next(err);
    } finally {
      client?.release();
    }
  }
);

// POST /clientes/:id/reactivate
router.post(
  "/:id/reactivate",
  sensitiveActionLimiter,
  requireRole("admin"),
  validate(clienteIdParamSchema, "params"),
  async (req, res, next) => {
    const { id } = req.params;
    const clienteId = Number(id);

    let client = null;
    let transactionOpen = false;

    try {
      client = await pool.connect();

      await client.query("BEGIN");
      transactionOpen = true;

      const current = await client.query(
        `
        SELECT
          id,
          archived_at
        FROM clientes
        WHERE id = $1
          AND company_id = $2
        FOR UPDATE
        `,
        [
          id,
          req.user.company_id,
        ]
      );

      if (current.rowCount === 0) {
        await client.query("ROLLBACK");
        transactionOpen = false;

        return res.status(404).json({
          error:
            "Cliente não encontrado (ou não pertence à sua empresa).",
          requestId:
            req.requestId,
        });
      }

      if (!current.rows[0].archived_at) {
        await client.query("ROLLBACK");
        transactionOpen = false;

        return res.status(409).json({
          error:
            "Este cliente já está ativo.",
          code:
            "CLIENT_ALREADY_ACTIVE",
          requestId:
            req.requestId,
        });
      }

      const previousArchivedAt =
        current.rows[0].archived_at;

      const previousArchivedAtIso =
        new Date(
          previousArchivedAt
        ).toISOString();

      const updated =
        await client.query(
          `
          UPDATE clientes
          SET
            archived_at = NULL,
            archived_by = NULL,
            archive_reason = NULL
          WHERE id = $1
            AND company_id = $2
            AND archived_at IS NOT NULL
          RETURNING *
          `,
          [
            id,
            req.user.company_id,
          ]
        );

      if (updated.rowCount !== 1) {
        throw new Error(
          "Cliente não foi reativado após bloqueio transacional."
        );
      }

      const reactivatedClient =
        updated.rows[0];

      await insertAuditLog(
        client,
        {
          companyId:
            req.user.company_id,
          actorUserId:
            req.user.id,
          actorRole:
            req.user.role,
          action:
            AUDIT_ACTIONS.CLIENT_REACTIVATED,
          entityType:
            AUDIT_ENTITY_TYPES.CLIENTE,
          entityId:
            reactivatedClient.id,
          requestId:
            req.requestId,
          ip:
            req.ip,
          metadata: {
            archived_at:
              previousArchivedAtIso,
            source:
              "client_reactivate",
          },
        }
      );

      await client.query("COMMIT");
      transactionOpen = false;

      logClientAction(
        req,
        "CLIENT_REACTIVATED",
        "Cliente reativado",
        clienteId
      );

      return res.json({
        message:
          "Cliente reativado com sucesso.",
        cliente:
          reactivatedClient,
        requestId:
          req.requestId,
      });
    } catch (err) {
      if (
        transactionOpen &&
        client
      ) {
        await safeRollback(
          client,
          req,
          "CLIENT_REACTIVATE_ROLLBACK_FAILED",
          clienteId
        );
      }

      return next(err);
    } finally {
      client?.release();
    }
  }
);

// DELETE /clientes/:id
// Hard delete desativado intencionalmente.
router.delete(
  "/:id",
  requireRole("admin"),
  validate(clienteIdParamSchema, "params"),
  (req, res) => {
    logger.warn(
      "CLIENT_DELETE_LEGACY_GONE",
      "Tentativa de uso do hard delete de cliente descontinuado",
      {
        requestId:
          req.requestId,
        userId:
          req.user.id,
        companyId:
          req.user.company_id,
        role:
          req.user.role,
        clienteId:
          Number(req.params.id),
        ip:
          req.ip,
      }
    );

    res.set(
      "Deprecation",
      "true"
    );

    res.set(
      "Cache-Control",
      "no-store"
    );

    return res.status(410).json({
      error:
        "Exclusão direta de cliente foi desativada. Utilize o arquivamento.",
      code:
        "CLIENT_DELETE_DEPRECATED",
      requestId:
        req.requestId,
    });
  }
);

module.exports = router;
