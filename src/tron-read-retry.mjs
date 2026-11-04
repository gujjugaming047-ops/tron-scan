/**
 * @param {unknown} error
 */
export function isTronRateLimitError(error) {
  if (!error || typeof error !== "object") return false;
  const record = /** @type {{ status?: unknown, code?: unknown, message?: unknown, response?: { status?: unknown } }} */ (error);
  const status = record.response?.status ?? record.status ?? record.code;
  if (status === 429 || status === "429") return true;
  return typeof record.message === "string" && /(?:status(?: code)?\s*429|too many requests|rate.?limit)/i.test(record.message);
}

/**
 * Retry only read-only calls that fail specifically because the connected
 * wallet's current TRON node is rate-limiting requests.
 * @template T
 * @param {() => Promise<T>} read
 * @param {{ attempts?: number, baseDelayMs?: number, sleep?: (ms: number) => Promise<void> }} [options]
 * @returns {Promise<T>}
 */
export async function withTronReadBackoff(read, options = {}) {
  const attempts = Math.max(1, Math.min(4, Math.trunc(options.attempts ?? 3)));
  const baseDelayMs = Math.max(0, Math.min(2_000, Math.trunc(options.baseDelayMs ?? 300)));
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      lastError = error;
      if (!isTronRateLimitError(error) || attempt + 1 >= attempts) throw error;
      await sleep(baseDelayMs * (2 ** attempt));
    }
  }
  throw lastError;
}

/**
 * @param {unknown} error
 */
export function tronReadErrorMessage(error) {
  if (isTronRateLimitError(error)) {
    return "The connected wallet's TRON node is rate-limiting read-only calls (429). Wait 10 seconds, then retry. No transaction was requested.";
  }
  if (error instanceof Error && error.message) return error.message;
  return "The connected wallet's TRON node could not complete the read-only request.";
}
