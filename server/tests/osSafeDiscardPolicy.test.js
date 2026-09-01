const test = require("node:test");
const assert = require("node:assert/strict");

const {
  canDiscardOS,
  shouldLockDiscardOnUpdate,
} = require("../services/osDiscardPolicy");

test(
  "Admin pode descartar OS nova em triagem sem evidência operacional",
  () => {
    assert.equal(
      canDiscardOS({
        role: "admin",
        status: "triagem",
        discardLockedAt: null,
        hasParts: false,
        hasBlockingEvents: false,
      }),
      true
    );
  }
);

test(
  "Atendimento pode descartar OS cancelada diretamente quando ainda está desbloqueada",
  () => {
    assert.equal(
      canDiscardOS({
        role: "atendimento",
        status: "cancelado",
        discardLockedAt: null,
        hasParts: false,
        hasBlockingEvents: false,
      }),
      true
    );
  }
);

test(
  "Técnico nunca pode descartar OS",
  () => {
    assert.equal(
      canDiscardOS({
        role: "tecnico",
        status: "triagem",
        discardLockedAt: null,
      }),
      false
    );
  }
);

test(
  "lock permanente bloqueia descarte mesmo em triagem",
  () => {
    assert.equal(
      canDiscardOS({
        role: "admin",
        status: "triagem",
        discardLockedAt:
          "2026-08-30T12:00:00.000Z",
      }),
      false
    );
  }
);

test(
  "peças ou eventos operacionais bloqueiam descarte por defesa em profundidade",
  () => {
    assert.equal(
      canDiscardOS({
        role: "admin",
        status: "triagem",
        discardLockedAt: null,
        hasParts: true,
      }),
      false
    );

    assert.equal(
      canDiscardOS({
        role: "admin",
        status: "cancelado",
        discardLockedAt: null,
        hasBlockingEvents: true,
      }),
      false
    );
  }
);

test(
  "canDiscardOS falha fechado quando marcador ou evidencias nao sao informados",
  () => {
    assert.equal(
      canDiscardOS({
        role: "admin",
        status: "triagem",
        hasParts: false,
        hasBlockingEvents: false,
      }),
      false
    );

    assert.equal(
      canDiscardOS({
        role: "admin",
        status: "triagem",
        discardLockedAt: null,
      }),
      false
    );
  }
);
test(
  "triagem para cancelado por Admin não ativa lock por si só",
  () => {
    assert.equal(
      shouldLockDiscardOnUpdate({
        role: "admin",
        current: {
          status: "triagem",
          mao_obra: 0,
          problema_relatado:
            "Cliente informou ruído.",
          discard_locked_at: null,
        },
        next: {
          status: "cancelado",
        },
      }),
      false
    );
  }
);

test(
  "avanço de triagem para status operacional ativa lock",
  () => {
    assert.equal(
      shouldLockDiscardOnUpdate({
        role: "atendimento",
        current: {
          status: "triagem",
          mao_obra: 0,
          discard_locked_at: null,
        },
        next: {
          status: "em_analise",
        },
      }),
      true
    );
  }
);

test(
  "alteração financeira posterior ativa lock",
  () => {
    assert.equal(
      shouldLockDiscardOnUpdate({
        role: "admin",
        current: {
          status: "triagem",
          mao_obra: 0,
          discard_locked_at: null,
        },
        next: {
          mao_obra: 150,
        },
      }),
      true
    );
  }
);

test(
  "correção administrativa de descrição não ativa lock",
  () => {
    assert.equal(
      shouldLockDiscardOnUpdate({
        role: "atendimento",
        current: {
          status: "triagem",
          mao_obra: 0,
          problema_relatado:
            "Barulho na roda.",
          discard_locked_at: null,
        },
        next: {
          problema_relatado:
            "Barulho na roda dianteira.",
        },
      }),
      false
    );
  }
);

test(
  "alteração técnica real ativa lock mesmo mantendo triagem",
  () => {
    assert.equal(
      shouldLockDiscardOnUpdate({
        role: "tecnico",
        current: {
          status: "triagem",
          problema_relatado:
            "Ruído informado pelo cliente.",
          discard_locked_at: null,
        },
        next: {
          problema_relatado:
            "Ruído confirmado no rolamento.",
        },
      }),
      true
    );
  }
);
