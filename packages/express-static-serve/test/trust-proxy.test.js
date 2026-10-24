const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { parseTrustProxy, MAX_TRUSTED_HOPS } = require("../trust-proxy");

describe("parseTrustProxy", () => {
  test("trusts no proxy when the variable is unset or empty", () => {
    assert.strictEqual(parseTrustProxy(undefined), 0);
    assert.strictEqual(parseTrustProxy(""), 0);
  });

  test("returns a Number, never the string, for 0 through the cap", () => {
    assert.strictEqual(MAX_TRUSTED_HOPS, 10);
    for (let hops = 0; hops <= MAX_TRUSTED_HOPS; hops += 1) {
      assert.strictEqual(parseTrustProxy(String(hops)), hops);
    }
  });

  test("rejects every unsafe value and names TRUST_PROXY and the value", () => {
    const unsafe = [
      "true",
      "false",
      "loopback",
      "-1",
      "+1",
      "1.5",
      "01",
      "1e20",
      "0x1",
      "11",
      "100",
      " 1",
      "1 ",
      "1\r",
      "1,2",
    ];
    for (const value of unsafe) {
      assert.throws(
        () => parseTrustProxy(value),
        (error) =>
          error instanceof Error &&
          error.message.includes("TRUST_PROXY") &&
          error.message.includes(JSON.stringify(value)),
        `expected ${JSON.stringify(value)} to be rejected`
      );
    }
  });
});
