// -----------------------------------------------------------------------------
// The only network access: GET requests to the local JSON API of an
// Eco-Devices (`/api/xdevices.json?cmd=10` and `cmd=20`, GCE Electronics
// wiki), plain HTTP on the home network, no cloud. Read-only: only GET, the
// Eco-Devices is never commanded.
//
// The login, when set ("Accès sécurisé" of the Eco-Devices), goes as HTTP
// Basic authentication (`Authorization: Basic <base64>`, as pyecodevices
// sends it), to this address only. It is never logged, never in an error,
// never in a URL.
//
// Bounded: one request at a time (a small web server), 10 s for the whole
// answer (the body included), 16 KiB at most, read into one buffer allocated
// once, never a redirect followed. Node's own fetch: no User-Agent of ours,
// no imitation. Taken from gladys-iskra (approved).
//
// Errors carry our own codes, never a text of the device nor a URL.
// -----------------------------------------------------------------------------

import { HTTP_TIMEOUT, MAX_BODY_BYTES, PATHS } from '../constants.js';
import { parseDaily, parseIndexes } from './model.js';

export class EcoDevicesError extends Error {
  /**
   * @param {'timeout'|'unreachable'|'http'|'redirect'|'not_found'|'server'|'rate_limited'|
   *   'refused'|'too_large'|'not_json'|'unknown_answer'} code
   */
  constructor(code, { status, retryAfter } = {}) {
    super(code);
    this.name = 'EcoDevicesError';
    this.code = code;
    this.status = status;
    /** ms, from a Retry-After header (429, 503), when given. */
    this.retryAfter = retryAfter;
  }
}

/** A network failure (while connecting or while reading the body), in our words. */
function networkError(err) {
  if (err instanceof EcoDevicesError) {
    return err;
  }
  const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
  return new EcoDevicesError(timeout ? 'timeout' : 'unreachable');
}

/**
 * The body, up to `limit` bytes, copied into a single buffer allocated once:
 * a longer one is cut before it is read in full.
 */
export async function readBounded(response, limit) {
  if (!response.body) {
    return '';
  }
  const reader = response.body.getReader();
  const buffer = new Uint8Array(limit);
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (size + value.byteLength > limit) {
        throw new EcoDevicesError('too_large');
      }
      buffer.set(value, size);
      size += value.byteLength;
    }
  } catch (err) {
    await reader.cancel().catch(() => {});
    throw err;
  }
  return new TextDecoder('utf-8').decode(buffer.subarray(0, size));
}

/** The body of an answer we do not read: let go, never awaited (a cancel may never settle). */
const drop = async (response) => {
  try {
    response.body?.cancel?.().catch(() => {});
  } catch {
    // Nothing to do: the answer is refused anyway.
  }
};

/** Retry-After in seconds (or an HTTP date) -> ms, undefined when absent or odd. */
function retryAfterOf(response, now) {
  const raw = response.headers?.get?.('retry-after');
  if (typeof raw !== 'string' || raw.length > 64) {
    return undefined;
  }
  if (/^\d{1,9}$/.test(raw.trim())) {
    return Number(raw.trim()) * 1000;
  }
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - now()) : undefined;
}

/** The Basic authorization, from `{ username, password }`. */
export function basicAuth(login) {
  if (!login) {
    return undefined;
  }
  const token = Buffer.from(`${login.username}:${login.password}`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

export class EcoDevicesClient {
  /** The Authorization header: a private field, never enumerable, never logged. */
  #authorization;

  constructor({
    address,
    login = null,
    fetchImpl = (...args) => globalThis.fetch(...args),
    timeout = HTTP_TIMEOUT,
    now = Date.now,
  }) {
    this.address = address;
    this.fetch = fetchImpl;
    this.timeout = timeout;
    this.now = now;
    this.#authorization = basicAuth(login);
    /** Requests one after the other, never two at once (a small web server). */
    this.queue = Promise.resolve();
  }

  /** GET of a page: its JSON, bounded. */
  get(path) {
    const run = async () => {
      let text;
      try {
        const headers = { Accept: 'application/json' };
        if (this.#authorization) {
          headers.Authorization = this.#authorization;
        }
        const response = await this.fetch(`http://${this.address}${path}`, {
          method: 'GET',
          headers,
          // A redirect is never followed: the login stays on this address.
          redirect: 'manual',
          // The whole answer, the body included, within the timeout.
          signal: AbortSignal.timeout(this.timeout),
        });
        const status = response.status;
        if (status === 429 || status >= 500) {
          await drop(response);
          throw new EcoDevicesError(status === 429 ? 'rate_limited' : 'server', {
            status,
            retryAfter: retryAfterOf(response, this.now),
          });
        }
        if (status === 401 || status === 403) {
          await drop(response);
          throw new EcoDevicesError('refused', { status });
        }
        if (status === 404) {
          await drop(response);
          throw new EcoDevicesError('not_found', { status });
        }
        if (status >= 300 && status < 400) {
          await drop(response);
          throw new EcoDevicesError('redirect', { status });
        }
        if (status < 200 || status >= 300) {
          await drop(response);
          throw new EcoDevicesError('http', { status });
        }
        text = await readBounded(response, MAX_BODY_BYTES);
      } catch (err) {
        throw networkError(err);
      }
      try {
        return JSON.parse(text);
      } catch {
        throw new EcoDevicesError('not_json');
      }
    };
    const job = this.queue.then(run, run);
    this.queue = job.catch(() => {});
    return job;
  }

  /** Reads a page and parses it; `unknown_answer` when it is not what the page should be. */
  async read(path, parse) {
    const value = parse(await this.get(path));
    if (value === undefined) {
      throw new EcoDevicesError('unknown_answer');
    }
    return value;
  }

  /** The indexes (`cmd=10`, the main page). */
  indexes() {
    return this.read(PATHS.INDEXES, parseIndexes);
  }

  /** The consumption of the day of the pulse counters (`cmd=20`, secondary). */
  daily() {
    return this.read(PATHS.DAILY, parseDaily);
  }
}
