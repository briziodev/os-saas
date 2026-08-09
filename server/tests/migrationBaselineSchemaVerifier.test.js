const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  CANONICAL_BASELINE_CHECKSUM,
  CANONICAL_SCHEMA_SEMANTIC_CHECKSUM,
  DEFAULT_BASELINE_FILE_PATH,
  EMPTY_SCHEMA_SNAPSHOT_SQL,
  BaselineSchemaVerifierError,
  calculateSha256,
  createBaselineSchemaVerifier,
  evaluateEmptySchemaSnapshot,
  normalizeSchemaDump,
  normalizeSemanticSchemaDump,
  verifyCanonicalBaselineFile,
  verifyEmptySchema,
  verifySchemaDumpAgainstCanonical,
} = require(
  "../database/baselineSchemaVerifier"
);

test(
  "normalizeSchemaDump replica a normalizacao historica dos pg_dump",
  () => {
    const raw = [
      "-- PostgreSQL database dump",
      "\\restrict abc123",
      "",
      "CREATE TABLE public.example (   ",
      "    id integer NOT NULL   ",
      ");",
      "",
      "",
      "\\unrestrict abc123",
      "-- PostgreSQL database dump complete",
      "",
    ].join("\r\n");

    assert.equal(
      normalizeSchemaDump(raw),
      [
        "CREATE TABLE public.example (",
        "    id integer NOT NULL",
        ");",
        "",
      ].join("\n")
    );
  }
);

test(
  "normalizeSemanticSchemaDump remove somente o comentario padrao do schema public",
  () => {
    const raw = [
      "CREATE SCHEMA public;",
      "",
      "COMMENT ON SCHEMA public IS 'standard public schema';",
      "",
      "COMMENT ON TABLE public.example IS 'comentario funcional';",
      "",
    ].join("\n");

    const normalized =
      normalizeSemanticSchemaDump(
        raw
      );

    assert.equal(
      normalized.includes(
        "standard public schema"
      ),
      false
    );

    assert.equal(
      normalized.includes(
        "COMMENT ON TABLE public.example IS 'comentario funcional';"
      ),
      true
    );
  }
);

test(
  "constantes canonicas preservam os fingerprints aprovados",
  () => {
    assert.equal(
      CANONICAL_BASELINE_CHECKSUM,
      "E9CA6FFC8A7289289D4E8C80FB1A2C8BC9C54CF7B0281C8F2BD98423D363EAFE"
    );

    assert.equal(
      CANONICAL_SCHEMA_SEMANTIC_CHECKSUM,
      "CC880BD139AC2452669A1847E9363F20F8F976B6AA49D0F10B829EA909CF03F7"
    );
  }
);

test(
  "verifyCanonicalBaselineFile aprova a baseline real do repositorio",
  async () => {
    const result =
      await verifyCanonicalBaselineFile();

    assert.equal(
      result.filename,
      path.basename(
        DEFAULT_BASELINE_FILE_PATH
      )
    );

    assert.equal(
      result.checksum,
      CANONICAL_BASELINE_CHECKSUM
        .toLowerCase()
    );
  }
);

test(
  "verifyCanonicalBaselineFile rejeita baseline alterada",
  async (context) => {
    const directory =
      await fs.mkdtemp(
        path.join(
          os.tmpdir(),
          "os-saas-baseline-verifier-"
        )
      );

    context.after(async () => {
      await fs.rm(
        directory,
        {
          recursive: true,
          force: true,
        }
      );
    });

    const filePath =
      path.join(
        directory,
        "baseline.sql"
      );

    await fs.writeFile(
      filePath,
      "ALTERADO_SUPER_SECRET",
      "utf8"
    );

    await assert.rejects(
      () =>
        verifyCanonicalBaselineFile({
          filePath,
        }),
      (error) => {
        assert.ok(
          error instanceof
            BaselineSchemaVerifierError
        );

        assert.equal(
          error.code,
          "BASELINE_FILE_CHECKSUM_MISMATCH"
        );

        assert.equal(
          JSON.stringify(
            error.details
          ).includes(
            "ALTERADO_SUPER_SECRET"
          ),
          false
        );

        return true;
      }
    );
  }
);

test(
  "verifySchemaDumpAgainstCanonical aprova dump semanticamente equivalente",
  () => {
    const raw = [
      "-- cabecalho",
      "\\restrict token",
      "CREATE TABLE public.example (",
      "    id integer NOT NULL",
      ");",
      "",
      "COMMENT ON SCHEMA public IS 'standard public schema';",
      "\\unrestrict token",
      "",
    ].join("\n");

    const expected =
      calculateSha256(
        normalizeSemanticSchemaDump(
          raw
        )
      );

    const result =
      verifySchemaDumpAgainstCanonical(
        raw,
        {
          expectedSemanticChecksum:
            expected,
        }
      );

    assert.equal(
      result.semanticChecksum,
      expected
    );
  }
);

test(
  "verifySchemaDumpAgainstCanonical rejeita divergencia sem expor o dump",
  () => {
    const raw =
      "CREATE TABLE public.SUPER_SECRET (id integer);\n";

    assert.throws(
      () =>
        verifySchemaDumpAgainstCanonical(
          raw,
          {
            expectedSemanticChecksum:
              "f".repeat(64),
          }
        ),
      (error) => {
        assert.ok(
          error instanceof
            BaselineSchemaVerifierError
        );

        assert.equal(
          error.code,
          "BASELINE_SCHEMA_MISMATCH"
        );

        const visible =
          [
            error.message,
            JSON.stringify(
              error.details
            ),
          ].join(" ");

        assert.equal(
          visible.includes(
            "SUPER_SECRET"
          ),
          false
        );

        return true;
      }
    );
  }
);

test(
  "createBaselineSchemaVerifier valida banco existente por provedor de dump",
  async () => {
    const raw = [
      "-- dump",
      "CREATE TABLE public.example (",
      "    id integer NOT NULL",
      ");",
      "",
    ].join("\n");

    const expected =
      calculateSha256(
        normalizeSemanticSchemaDump(
          raw
        )
      );

    let dumpCalls = 0;

    const verifier =
      createBaselineSchemaVerifier({
        expectedSemanticChecksum:
          expected,

        async dumpSchema() {
          dumpCalls += 1;

          return raw;
        },
      });

    const result =
      await verifier
        .verifyExistingSchema();

    assert.equal(
      dumpCalls,
      1
    );

    assert.equal(
      result.baseline.checksum,
      CANONICAL_BASELINE_CHECKSUM
        .toLowerCase()
    );

    assert.equal(
      result.schema
        .semanticChecksum,
      expected
    );
  }
);

test(
  "verifyExistingSchema exige provedor de dump",
  async () => {
    const verifier =
      createBaselineSchemaVerifier();

    await assert.rejects(
      () =>
        verifier
          .verifyExistingSchema(),
      (error) => {
        assert.ok(
          error instanceof
            BaselineSchemaVerifierError
        );

        assert.equal(
          error.code,
          "SCHEMA_DUMP_PROVIDER_REQUIRED"
        );

        return true;
      }
    );
  }
);

test(
  "evaluateEmptySchemaSnapshot aprova vazio e identifica objetos",
  () => {
    const empty =
      evaluateEmptySchemaSnapshot({
        relations: [],
        types: [],
        routines: [],
      });

    assert.equal(
      empty.empty,
      true
    );

    const occupied =
      evaluateEmptySchemaSnapshot({
        relations: [
          {
            name: "users",
            kind: "r",
          },
        ],
        types: [
          {
            name: "os_status",
            kind: "e",
          },
        ],
        routines: [
          {
            name: "example_fn",
            kind: "f",
          },
        ],
      });

    assert.equal(
      occupied.empty,
      false
    );

    assert.deepEqual(
      occupied.counts,
      {
        relations: 1,
        types: 1,
        routines: 1,
      }
    );
  }
);

test(
  "verifyEmptySchema consulta snapshot e bloqueia schema public ocupado",
  async () => {
    let queryCalls = 0;

    const client = {
      async query(sql) {
        queryCalls += 1;

        assert.equal(
          sql,
          EMPTY_SCHEMA_SNAPSHOT_SQL
        );

        return {
          rows: [
            {
              schema_snapshot: {
                relations: [
                  {
                    name:
                      "companies",
                    kind: "r",
                  },
                ],
                types: [],
                routines: [],
              },
            },
          ],
        };
      },
    };

    await assert.rejects(
      () =>
        verifyEmptySchema(
          client
        ),
      (error) => {
        assert.equal(
          error.code,
          "DATABASE_NOT_EMPTY"
        );

        assert.deepEqual(
          error.details.counts,
          {
            relations: 1,
            types: 0,
            routines: 0,
          }
        );

        return true;
      }
    );

    assert.equal(
      queryCalls,
      1
    );
  }
);

test(
  "verifyEmptySchema falha fechado para snapshot malformado",
  async () => {
    const client = {
      async query() {
        return {
          rows: [
            {
              schema_snapshot: {
                relations: null,
                types: [],
                routines: [],
              },
            },
          ],
        };
      },
    };

    await assert.rejects(
      () =>
        verifyEmptySchema(
          client
        ),
      (error) => {
        assert.equal(
          error.code,
          "INVALID_EMPTY_SCHEMA_SNAPSHOT"
        );

        return true;
      }
    );
  }
);