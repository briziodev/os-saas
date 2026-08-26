const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const dbPath = require.resolve("../db");
const bcryptPath = require.resolve("bcryptjs");
const authRoutePath = require.resolve("../routes/auth");

function createFakePool() {
  const token =
    "invite-token-atomic-test-123456";

  const expiresAt =
    new Date(
      Date.now() + 60_000
    ).toISOString();

  const state = {
    id: 501,
    name: "Usuario Convite",
    email:
      "convite.atomic@example.test",
    company_id: 77,
    role: "atendimento",
    is_active: false,
    invite_token: token,
    invite_expires_at:
      expiresAt,
    activated_at: null,
  };

  const auditRows = [];

  let selectCount = 0;
  let releaseSelects;

  const bothSelectsReady =
    new Promise((resolve) => {
      releaseSelects = resolve;
    });

  function userSnapshot() {
    return {
      id: state.id,
      name: state.name,
      email: state.email,
      company_id:
        state.company_id,
      role: state.role,
      is_active:
        state.is_active,
      invite_expires_at:
        state.invite_expires_at,
    };
  }

  async function executeQuery(
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
        rowCount: null,
        rows: [],
      };
    }

    if (
      /^SELECT id, email, is_active, invite_expires_at, company_id, role FROM users WHERE invite_token = \$1$/i.test(
        sql
      )
    ) {
      selectCount += 1;

      if (selectCount === 2) {
        releaseSelects();
      }

      await bothSelectsReady;

      return {
        rowCount: 1,
        rows: [
          userSnapshot(),
        ],
      };
    }

    if (
      /^UPDATE users SET /i.test(
        sql
      )
    ) {
      const hasTokenGuard =
        /invite_token\s*=\s*\$3/i.test(
          sql
        );

      const hasInactiveGuard =
        /is_active\s*=\s*false/i.test(
          sql
        );

      const hasExpiryGuard =
        /invite_expires_at\s*>\s*now\(\)/i.test(
          sql
        );

      const isAtomicGuard =
        hasTokenGuard &&
        hasInactiveGuard &&
        hasExpiryGuard;

      if (isAtomicGuard) {
        const suppliedToken =
          values[2];

        const canConsume =
          state.invite_token ===
            suppliedToken &&
          state.is_active ===
            false &&
          new Date(
            state.invite_expires_at
          ) > new Date();

        if (!canConsume) {
          return {
            rowCount: 0,
            rows: [],
          };
        }
      }

      state.is_active = true;
      state.invite_token = null;
      state.invite_expires_at =
        null;
      state.activated_at =
        new Date().toISOString();

      return {
        rowCount: 1,
        rows: [
          {
            id: state.id,
            name: state.name,
            email: state.email,
            company_id:
              state.company_id,
            role: state.role,
            is_active:
              state.is_active,
            activated_at:
              state.activated_at,
          },
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
        company_id: values[0],
        actor_user_id: values[1],
        actor_role: values[2],
        action: values[3],
        entity_type: values[4],
        entity_id: values[5],
        request_id: values[6],
        ip: values[7],
        metadata:
          JSON.parse(values[8]),
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
    token,
    auditRows,

    query:
      executeQuery,

    async connect() {
      return {
        query:
          executeQuery,
        release() {},
      };
    },
  };
}

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

test(
  "POST /auth/activate consome o mesmo invite_token apenas uma vez e audita somente o sucesso",
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
          compare:
            async () => true,
          hash:
            async (password) =>
              `hash:${password}`,
        }
      );

    delete require.cache[
      authRoutePath
    ];

    t.after(() => {
      delete require.cache[
        authRoutePath
      ];

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

    const url =
      `http://127.0.0.1:${address.port}/auth/activate`;

    const makeRequest =
      (password) =>
        fetch(url, {
          method: "POST",
          headers: {
            "content-type":
              "application/json",
          },
          body:
            JSON.stringify({
              token:
                fakePool.token,
              password,
              confirmPassword:
                password,
            }),
        });

    const [
      responseA,
      responseB,
    ] =
      await Promise.all([
        makeRequest(
          "SenhaConcorrenteA1"
        ),
        makeRequest(
          "SenhaConcorrenteB2"
        ),
      ]);

    const results =
      await Promise.all([
        responseA.json(),
        responseB.json(),
      ]);

    const statusCodes = [
      responseA.status,
      responseB.status,
    ].sort(
      (a, b) => a - b
    );

    assert.deepEqual(
      statusCodes,
      [200, 409],
      [
        "O mesmo convite deve produzir exatamente uma ativacao bem-sucedida.",
        `Status recebidos: ${statusCodes.join(", ")}`,
        `Respostas: ${JSON.stringify(results)}`,
      ].join(" ")
    );

    const conflictIndex =
      responseA.status === 409
        ? 0
        : 1;

    assert.equal(
      results[conflictIndex].code,
      "INVITE_ALREADY_CONSUMED"
    );

    assert.equal(
      fakePool.auditRows.length,
      1,
      "Somente a ativação confirmada deve gerar auditoria."
    );

    assert.equal(
      fakePool.auditRows[0]
        .action,
      "ACCOUNT_ACTIVATED"
    );

    assert.equal(
      fakePool.auditRows[0]
        .entity_type,
      "user"
    );

    assert.equal(
      Number(
        fakePool.auditRows[0]
          .entity_id
      ),
      501
    );

    assert.deepEqual(
      fakePool.auditRows[0]
        .metadata,
      {
        activation_method:
          "invite",
      }
    );
  }
);
