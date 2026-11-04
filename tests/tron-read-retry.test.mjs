import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isTronRateLimitError,
  tronReadErrorMessage,
  withTronReadBackoff,
} from "../src/tron-read-retry.mjs";

describe("TRON read-only retry policy", () => {
  it("recognizes common injected-provider 429 errors", () => {
    assert.equal(isTronRateLimitError(new Error("Request failed with status code 429")), true);
    assert.equal(isTronRateLimitError({ response: { status: 429 } }), true);
    assert.equal(isTronRateLimitError(new Error("execution reverted")), false);
    assert.match(tronReadErrorMessage({ response: { status: 429 } }), /Wait 10 seconds/);
  });

  it("uses bounded exponential backoff and eventually returns", async () => {
    let calls = 0;
    /** @type {number[]} */
    const delays = [];
    const result = await withTronReadBackoff(async () => {
      calls += 1;
      if (calls < 3) throw Object.assign(new Error("Too many requests"), { response: { status: 429 } });
      return "ok";
    }, {
      attempts: 3,
      baseDelayMs: 25,
      sleep: async (ms) => { delays.push(ms); },
    });
    assert.equal(result, "ok");
    assert.equal(calls, 3);
    assert.deepEqual(delays, [25, 50]);
  });

  it("does not retry non-rate-limit errors", async () => {
    let calls = 0;
    await assert.rejects(() => withTronReadBackoff(async () => {
      calls += 1;
      throw new Error("invalid address");
    }, { sleep: async () => {} }), /invalid address/);
    assert.equal(calls, 1);
  });
});
