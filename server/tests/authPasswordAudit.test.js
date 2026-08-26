const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const dbPath = require.resolve("../db");
const bcryptPath = require.resolve("bcryptjs");
const authTokenPath =
  require.resolve("../utils/authToken");
const authMiddlewarePath =
  require.resolve("../middlewares/auth");
const authRoutePath =
  require.resolve("../routes/auth");

function installModuleMock(
  modulePath,
  exportsValue
) {
  const previous =
    require.cache[modulePath];

  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: exportsValue,
  };

  return () => {
    if (previous) {
      require.cache[modulePath] =
        previous;
    } else {
      delete require.cache[
        modulePath
      ];
    }
  };
}

function createFakePool() {
  const auditRows = [];

  const user = {
    id: 901,
    name: "Admin Auditoria",
    email:
      "admin.audit@example.test",
    password_hash:
      "hash:SenhaAtualA1",
    company_id: 77,
    role: "admin",
    is_active: true,
    session_version: 4,
  };

  async function query(
    text,
    values
  ) {
    const sql =
      String(text)
        .replace(/\s+/g, " ")
        .trim();

    if (
      sql === "BEGIN" ||
      sql === "COMMIT" ||
      sql === "ROLLBACK"
    ) {
      return {
        rows: [],
        rowCount: null,
      };
    }

    if (
      /^SELECT id, name, email, password_hash, company_id, role, is_active, session_version FROM users /i.test(
        sql
      )
    ) {
      return {
        rowCount: 1,
        rows: [
          {
            ...user,
          },
        ],
      };
    }

    if (
      /^UPDATE users SET password_hash = \$1, password_changed_at = NOW\(\), session_version = session_version \+ 1 /i.test(
        sql
      )
    ) {
      user.password_hash =
        values[0];

      user.session_version += 1;

      return {
        rowCount: 1,
        rows: [
          {
            id: user.id,
            name: user.name,
            email: user.email,
            company_id:
              user.company_id,
            role: user.role,
            is_active:
              user.is_active,
            session_version:
              user.session_version,
            password_changed_at:
              new Date().toISOString(),
          },
        ],
      };
    }

    if (
      /^UPDATE password_reset_tokens SET revoked_at = NOW\(\) /i.test(
        sql
      )
    ) {
      return {
        rowCount: 2,
        rows: [
          { id: 1 },
          { id: 2 },
        ],
      };
    }

    if (
      /^INSERT INTO audit_logs /i.test(
        sql
      )
    ) {
      const row = {
        id:
          auditRows.length + 1,
        company_id:
          values[0],
        actor_user_id:
          values[1],
        actor_role:
          values[2],
        action:
          values[3],
        entity_type:
          values[4],
        entity_id:
          values[5],
        request_id:
          values[6],
        ip:
          values[7],
        metadata:
          JSON.parse(
            values[8]
          ),
        created_at:
          new Date().toISOString(),
      };

      auditRows.push(row);

      return {
        rowCount: 1,
        rows: [row],
      };
    }

    throw new Error(
      `Query inesperada no teste: ${sql}`
    );
  }

  return {
    auditRows,

    async connect() {
      return {
        query,
        release() {},
      };
    },
  };
}

test(
  "POST /auth/change-password grava auditoria na mesma transação",
  async (t) => {
    const fakePool =
      createFakePool();

    const restoreDb =
      installModuleMock(
        dbPath,
        fakePool
      );

    const restoreBcrypt =
      installModuleMock(
        bcryptPath,
        {
          async compare(
            value
          ) {
            return (
              value ===
              "TesteSeguro#2026"
            );
          },

          async hash(
            value
          ) {
            return `hash:${value}`;
          },
        }
      );

    const restoreAuthToken =
      installModuleMock(
        authTokenPath,
        {
          signAuthToken() {
            return "novo-token";
          },
        }
      );

    const restoreAuthMiddleware =
      installModuleMock(
        authMiddlewarePath,
        {
          authRequired(
            req,
            res,
            next
          ) {
            req.user = {
              id: 901,
              company_id: 77,
              role: "admin",
              is_active: true,
              session_version: 4,
            };

            next();
          },

          loadUser(
            req,
            res,
            next
          ) {
            next();
          },
        }
      );

    delete require.cache[
      authRoutePath
    ];

    t.after(() => {
      delete require.cache[
        authRoutePath
      ];

      restoreAuthMiddleware();
      restoreAuthToken();
      restoreBcrypt();
      restoreDb();
    });

    const authRouter =
      require("../routes/auth");

    const app = express();
    app.use(express.json());
    app.use(
      "/auth",
      authRouter
    );

    const server =
      await new Promise(
        (resolve) => {
          const listener =
            app.listen(
              0,
              "127.0.0.1",
              () =>
                resolve(
                  listener
                )
            );
        }
      );

    t.after(
      () =>
        new Promise(
          (
            resolve,
            reject
          ) => {
            server.close(
              (error) => {
                if (error) {
                  reject(
                    error
                  );

                  return;
                }

                resolve();
              }
            );
          }
        )
    );

    const address =
      server.address();

    const response =
      await fetch(
        `http://127.0.0.1:${address.port}/auth/change-password`,
        {
          method: "POST",
          headers: {
            "content-type":
              "application/json",
          },
          body:
            JSON.stringify({
              currentPassword:
                "TesteSeguro#2026",
              newPassword:
                "NovaSenha#2027",
              confirmPassword:
                "NovaSenha#2027",
            }),
        }
      );

    const body =
      await response.json();

    assert.equal(
      response.status,
      200,
      JSON.stringify(body)
    );

    assert.equal(
      fakePool.auditRows.length,
      1
    );

    const audit =
      fakePool.auditRows[0];

    assert.equal(
      audit.action,
      "PASSWORD_CHANGED"
    );

    assert.equal(
      audit.entity_type,
      "user"
    );

    assert.equal(
      Number(
        audit.entity_id
      ),
      901
    );

    assert.deepEqual(
      audit.metadata,
      {
        previous_session_version:
          4,
        current_session_version:
          5,
        revoked_reset_tokens:
          2,
      }
    );
  }
);
