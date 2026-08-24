const test = require("node:test");
const assert = require("node:assert/strict");

const { ipKeyGenerator } = require("express-rate-limit");
const {
  sensitiveActionKeyGenerator,
} = require("../middlewares/rateLimiters");

test(
  "sensitiveActionKeyGenerator isola usuarios da mesma empresa",
  () => {
    const first = sensitiveActionKeyGenerator({
      user: { id: 10, company_id: 5 },
      ip: "203.0.113.10",
    });

    const second = sensitiveActionKeyGenerator({
      user: { id: 11, company_id: 5 },
      ip: "203.0.113.10",
    });

    assert.equal(first, "company:5:user:10");
    assert.equal(second, "company:5:user:11");
    assert.notEqual(first, second);
  }
);

test(
  "sensitiveActionKeyGenerator isola o mesmo user id entre empresas",
  () => {
    const first = sensitiveActionKeyGenerator({
      user: { id: 10, company_id: 5 },
      ip: "203.0.113.10",
    });

    const second = sensitiveActionKeyGenerator({
      user: { id: 10, company_id: 6 },
      ip: "203.0.113.10",
    });

    assert.equal(first, "company:5:user:10");
    assert.equal(second, "company:6:user:10");
    assert.notEqual(first, second);
  }
);

test(
  "sensitiveActionKeyGenerator nao compartilha contador por IP quando autenticado",
  () => {
    const first = sensitiveActionKeyGenerator({
      user: { id: 20, company_id: 7 },
      ip: "198.51.100.30",
    });

    const second = sensitiveActionKeyGenerator({
      user: { id: 21, company_id: 7 },
      ip: "198.51.100.30",
    });

    assert.notEqual(first, second);
  }
);

test(
  "sensitiveActionKeyGenerator usa IP normalizado sem identidade autenticada",
  () => {
    const ip = "203.0.113.50";

    const result = sensitiveActionKeyGenerator({
      user: null,
      ip,
    });

    assert.equal(result, "ip:" + ipKeyGenerator(ip));
  }
);

test(
  "sensitiveActionKeyGenerator usa IP para identidade incompleta",
  () => {
    const ip = "2001:db8::1234";

    const result = sensitiveActionKeyGenerator({
      user: { id: 10 },
      ip,
    });

    assert.equal(result, "ip:" + ipKeyGenerator(ip));
  }
);
