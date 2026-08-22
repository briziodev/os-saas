const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const dbPath = require.resolve("../db");
const bcryptPath = require.resolve("bcryptjs");
const authRoutePath = require.resolve("../routes/auth");

function createFakePool() {
  const token = "invite-token-atomic-test-123456";
  const expiresAt = new Date(Date.now() + 60_000).toISOString();

  const state = {
    id: 501,
    name: "Usuario Convite",
    email: "convite.atomic@example.test",
    company_id: 77,
    role: "atendimento",
    is_active: false,
    invite_token: token,
    invite_expires_at: expiresAt,
    activated_at: null,
  };

  let selectCount = 0;
  let releaseSelects;

  const bothSelectsReady = new Promise((resolve) => {
    releaseSelects = resolve;
  });

  function userSnapshot() {
    return {
      id: state.id,
      name: state.name,
      email: state.email,
      company_id: state.company_id,
      role: state.role,
      is_active: state.is_active,
      invite_expires_at: state.invite_expires_at,
    };
  }

  return {
    token,

    async query(text, values) {
      const sql = String(text).replace(/\s+/g, " ").trim();

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
          rows: [userSnapshot()],
        };
      }

      if (/^UPDATE users SET /i.test(sql)) {
        const hasTokenGuard =
          /invite_token\s*=\s*\$3/i.test(sql);

        const hasInactiveGuard =
          /is_active\s*=\s*false/i.test(sql);

        const hasExpiryGuard =
          /invite_expires_at\s*>\s*now\(\)/i.test(sql);

        const isAtomicGuard =
          hasTokenGuard &&
          hasInactiveGuard &&
          hasExpiryGuard;

        if (isAtomicGuard) {
          const suppliedToken = values[2];

          const canConsume =
            state.invite_token === suppliedToken &&
            state.is_active === false &&
            new Date(state.invite_expires_at) > new Date();

          if (!canConsume) {
            return {
              rowCount: 0,
              rows: [],
            };
          }
        }

        state.is_active = true;
        state.invite_token = null;
        state.invite_expires_at = null;
        state.activated_at = new Date().toISOString();

        return {
          rowCount: 1,
          rows: [
            {
              id: state.id,
              name: state.name,
              email: state.email,
              company_id: state.company_id,
              role: state.role,
              is_active: state.is_active,
              activated_at: state.activated_at,
            },
          ],
        };
      }

      throw new Error(`Query inesperada no teste: ${sql}`);
    },
  };
}

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

test(
  "POST /auth/activate consome o mesmo invite_token apenas uma vez sob concorrencia",
  async (t) => {
    const fakePool = createFakePool();

    const restoreDb = installModuleMock(
      dbPath,
      fakePool
    );

    const restoreBcrypt = installModuleMock(
      bcryptPath,
      {
        compare: async () => true,
        hash: async (password) => `hash:${password}`,
      }
    );

    delete require.cache[authRoutePath];

    t.after(() => {
      delete require.cache[authRoutePath];
      restoreBcrypt();
      restoreDb();
    });

    const authRouter = require("../routes/auth");

    const app = express();
    app.use(express.json());
    app.use("/auth", authRouter);

    const server = await new Promise((resolve) => {
      const listener = app.listen(
        0,
        "127.0.0.1",
        () => resolve(listener)
      );
    });

    t.after(
      () =>
        new Promise((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }

            resolve();
          });
        })
    );

    const address = server.address();
    const url =
      `http://127.0.0.1:${address.port}/auth/activate`;

    const makeRequest = (password) =>
      fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          token: fakePool.token,
          password,
          confirmPassword: password,
        }),
      });

    const [responseA, responseB] = await Promise.all([
      makeRequest("SenhaConcorrenteA1"),
      makeRequest("SenhaConcorrenteB2"),
    ]);

    const results = await Promise.all([
      responseA.json(),
      responseB.json(),
    ]);

    const statusCodes = [
      responseA.status,
      responseB.status,
    ].sort((a, b) => a - b);

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
      responseA.status === 409 ? 0 : 1;

    assert.equal(
      results[conflictIndex].code,
      "INVITE_ALREADY_CONSUMED"
    );
  }
);