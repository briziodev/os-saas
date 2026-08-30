const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const dbPath = require.resolve("../db");
const authPath = require.resolve("../middlewares/auth");
const requireRolePath = require.resolve("../middlewares/requireRole");
const validatePath = require.resolve("../middlewares/validate");
const clientesRoutePath = require.resolve("../routes/clientes");
const errorHandlerPath = require.resolve("../middlewares/errorHandler");

const SECRET_DB_MESSAGE =
  'postgres-internal-detail: relation "clientes_private" failed';

function installModuleMock(modulePath, exportsValue) {
  const previous = require.cache[modulePath];

  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: exportsValue,
  };

  return () => {
    if (previous) {
      require.cache[modulePath] = previous;
    } else {
      delete require.cache[modulePath];
    }
  };
}

function createFakePool() {
  let nextErrorCode = "XX000";

  function createDbError() {
    const error =
      new Error(SECRET_DB_MESSAGE);

    error.code = nextErrorCode;

    return error;
  }

  return {
    setNextErrorCode(code) {
      nextErrorCode = code;
    },

    async query() {
      throw createDbError();
    },

    async connect() {
      return {
        async query() {
          throw createDbError();
        },

        release() {},
      };
    },
  };
}

async function startTestServer(fakePool) {
  const restoreDb =
    installModuleMock(
      dbPath,
      fakePool
    );

  const restoreAuth =
    installModuleMock(
      authPath,
      {
        authRequired(req, res, next) {
          req.user = {
            id: 101,
            company_id: 77,
            role: "admin",
            is_active: true,
          };

          return next();
        },

        loadUser(req, res, next) {
          return next();
        },
      }
    );

  const restoreRequireRole =
    installModuleMock(
      requireRolePath,
      {
        requireRole() {
          return (
            req,
            res,
            next
          ) => next();
        },
      }
    );

  const restoreValidate =
    installModuleMock(
      validatePath,
      () =>
        (
          req,
          res,
          next
        ) => next()
    );

  delete require.cache[
    clientesRoutePath
  ];

  delete require.cache[
    errorHandlerPath
  ];

  const clientesRouter =
    require("../routes/clientes");

  const errorHandler =
    require("../middlewares/errorHandler");

  const app = express();

  app.use(express.json());

  app.use(
    (req, res, next) => {
      req.requestId =
        "clientes-error-disclosure-test";

      return next();
    }
  );

  app.use(
    "/clientes",
    clientesRouter
  );

  app.use(errorHandler);

  const server =
    await new Promise(
      (resolve) => {
        const listener =
          app.listen(
            0,
            "127.0.0.1",
            () =>
              resolve(listener)
          );
      }
    );

  const address =
    server.address();

  const baseUrl =
    `http://127.0.0.1:${address.port}`;

  async function close() {
    await new Promise(
      (resolve, reject) => {
        server.close(
          (error) => {
            if (error) {
              reject(error);
              return;
            }

            resolve();
          }
        );
      }
    );

    delete require.cache[
      clientesRoutePath
    ];

    delete require.cache[
      errorHandlerPath
    ];

    restoreValidate();
    restoreRequireRole();
    restoreAuth();
    restoreDb();
  }

  return {
    baseUrl,
    close,
  };
}

test(
  "clientes nao expoe mensagem interna do banco em erros 500",
  async () => {
    const fakePool =
      createFakePool();

    const testServer =
      await startTestServer(
        fakePool
      );

    try {
      const cases = [
        {
          method: "GET",
          path: "/clientes",
        },
        {
          method: "POST",
          path: "/clientes",
          body: {
            nome:
              "Cliente Teste",
            email:
              "cliente@example.test",
            telefone:
              "41999999999",
          },
        },
        {
          method: "PUT",
          path:
            "/clientes/123",
          body: {
            nome:
              "Cliente Teste",
            email:
              "cliente@example.test",
            telefone:
              "41999999999",
          },
        },
        {
          method: "POST",
          path:
            "/clientes/123/archive",
          body: {
            motivo:
              "Teste controlado",
          },
        },
        {
          method: "POST",
          path:
            "/clientes/123/reactivate",
        },
      ];

      for (
        const currentCase
        of cases
      ) {
        fakePool.setNextErrorCode(
          "XX000"
        );

        const options = {
          method:
            currentCase.method,
          headers: {
            "content-type":
              "application/json",
          },
        };

        if (currentCase.body) {
          options.body =
            JSON.stringify(
              currentCase.body
            );
        }

        const response =
          await fetch(
            `${testServer.baseUrl}${currentCase.path}`,
            options
          );

        const body =
          await response.json();

        assert.equal(
          response.status,
          500,
          `${currentCase.method} ${currentCase.path} deve retornar HTTP 500`
        );

        assert.equal(
          body.error,
          "Erro interno do servidor.",
          `${currentCase.method} ${currentCase.path} nao deve expor err.message`
        );

        assert.equal(
          JSON.stringify(
            body
          ).includes(
            SECRET_DB_MESSAGE
          ),
          false,
          `${currentCase.method} ${currentCase.path} vazou detalhe interno do banco`
        );

        assert.equal(
          body.requestId,
          "clientes-error-disclosure-test"
        );
      }
    } finally {
      await testServer.close();
    }
  }
);

test(
  "DELETE /clientes responde 410 e nao preserva hard delete legado",
  async () => {
    const fakePool =
      createFakePool();

    const testServer =
      await startTestServer(
        fakePool
      );

    try {
      const response =
        await fetch(
          `${testServer.baseUrl}/clientes/123`,
          {
            method: "DELETE",
          }
        );

      const body =
        await response.json();

      assert.equal(
        response.status,
        410
      );

      assert.equal(
        body.code,
        "CLIENT_DELETE_DEPRECATED"
      );

      assert.equal(
        body.error,
        "Exclusão direta de cliente foi desativada. Utilize o arquivamento."
      );

      assert.equal(
        JSON.stringify(
          body
        ).includes(
          SECRET_DB_MESSAGE
        ),
        false
      );
    } finally {
      await testServer.close();
    }
  }
);
