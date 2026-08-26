const test = require("node:test");
const assert = require("node:assert/strict");

const {
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  AuditLogError,
  MAX_METADATA_BYTES,
  insertAuditLog,
  normalizeAuditMetadata,
} = require("../services/auditLog");

test(
  "insertAuditLog grava evento parametrizado e controlado",
  async () => {
    let receivedSql = null;
    let receivedValues = null;

    const fakeDb = {
      async query(sql, values) {
        receivedSql = sql;
        receivedValues = values;

        return {
          rows: [
            {
              id: 1,
              company_id: 10,
              actor_user_id: 20,
              actor_role: "admin",
              action:
                AUDIT_ACTIONS.OS_DELETED,
              entity_type:
                AUDIT_ENTITY_TYPES.ORDEM_SERVICO,
              entity_id: 30,
              request_id: "req-123",
              ip: "127.0.0.1",
              metadata: {
                status_before: "triagem",
              },
              created_at:
                new Date().toISOString(),
            },
          ],
        };
      },
    };

    const row = await insertAuditLog(
      fakeDb,
      {
        companyId: 10,
        actorUserId: 20,
        actorRole: "admin",
        action:
          AUDIT_ACTIONS.OS_DELETED,
        entityType:
          AUDIT_ENTITY_TYPES.ORDEM_SERVICO,
        entityId: 30,
        requestId: "req-123",
        ip: "127.0.0.1",
        metadata: {
          status_before: "triagem",
        },
      }
    );

    assert.match(
      receivedSql,
      /INSERT INTO audit_logs/
    );

    assert.equal(
      receivedValues[0],
      10
    );

    assert.equal(
      receivedValues[1],
      20
    );

    assert.equal(
      receivedValues[3],
      "OS_DELETED"
    );

    assert.equal(
      receivedValues[4],
      "ordem_servico"
    );

    assert.equal(
      receivedValues[5],
      30
    );

    assert.equal(
      typeof receivedValues[8],
      "string"
    );

    assert.deepEqual(
      JSON.parse(receivedValues[8]),
      {
        status_before: "triagem",
      }
    );

    assert.equal(
      row.action,
      "OS_DELETED"
    );
  }
);

test(
  "normalizeAuditMetadata rejeita chaves sensíveis em qualquer profundidade",
  () => {
    assert.throws(
      () =>
        normalizeAuditMetadata({
          safe: {
            invite_token:
              "segredo",
          },
        }),
      (error) => {
        assert.ok(
          error instanceof AuditLogError
        );

        assert.equal(
          error.code,
          "SENSITIVE_AUDIT_METADATA_KEY"
        );

        return true;
      }
    );
  }
);

test(
  "normalizeAuditMetadata rejeita metadata acima de 8 KiB",
  () => {
    assert.throws(
      () =>
        normalizeAuditMetadata({
          value: "x".repeat(
            MAX_METADATA_BYTES + 100
          ),
        }),
      (error) => {
        assert.ok(
          error instanceof AuditLogError
        );

        assert.equal(
          error.code,
          "AUDIT_METADATA_TOO_LARGE"
        );

        return true;
      }
    );
  }
);

test(
  "insertAuditLog rejeita identidade multi-tenant inválida",
  async () => {
    const fakeDb = {
      async query() {
        throw new Error(
          "Não deveria consultar o banco."
        );
      },
    };

    await assert.rejects(
      () =>
        insertAuditLog(fakeDb, {
          companyId: 0,
          actorUserId: 1,
          actorRole: "admin",
          action:
            AUDIT_ACTIONS.PASSWORD_CHANGED,
          entityType:
            AUDIT_ENTITY_TYPES.USER,
          entityId: 1,
        }),
      (error) => {
        assert.ok(
          error instanceof AuditLogError
        );

        assert.equal(
          error.code,
          "INVALID_AUDIT_INTEGER"
        );

        return true;
      }
    );
  }
);

test(
  "insertAuditLog permite actor nulo para futura ação de sistema",
  async () => {
    const fakeDb = {
      async query(sql, values) {
        return {
          rows: [
            {
              id: 2,
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
            },
          ],
        };
      },
    };

    const row = await insertAuditLog(
      fakeDb,
      {
        companyId: 10,
        actorUserId: null,
        actorRole: null,
        action:
          "SYSTEM_TEST",
        entityType:
          "user",
        entityId: 20,
        metadata: {},
      }
    );

    assert.equal(
      row.actor_user_id,
      null
    );
  }
);
