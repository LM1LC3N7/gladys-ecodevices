// -----------------------------------------------------------------------------
// The integration itself: the Eco-Devices read through its local JSON API,
// one Gladys device per input (teleinfo 1 and 2, pulse counters 1 and 2), the
// index of each input checked by its own guard and published once a minute,
// the pauses and the refused login kept in /data, the test and accept
// buttons. index.js only wires the SDK handlers to it. Read-only: nothing is
// ever sent to the Eco-Devices but GET requests.
//
// One read = `cmd=10` (the indexes, the principal page: a login refused there
// is final), then, every 5 minutes and when a pulse counter is set, `cmd=20`
// (the consumption of the day): secondary, its failure never holds back the
// indexes, a 401/403 there is never a refused login.
//
// The pace is global and kept across restarts: never two reads less than an
// interval apart, whatever asks (a reconnection, a save of the form, the test
// button, the Discover tab, a device created, a restart of the container: the
// time of the last read is kept in /data before the request). Structure taken
// from gladys-iskra (approved).
//
// A read belongs to its session (the client of one address and login): when
// they change, a late answer of the old one publishes nothing and sets no
// status (checked after every await).
//
// /data: a file that exists but cannot be read is not an empty state: it is
// never overwritten, and no index is published (a held value or the
// reference could be in it) until it reads again; the live values go on. A
// save that fails holds the indexes back too: Gladys never gets an index
// /data does not know.
//
// Two clocks: `now` (wall clock) dates the indexes and what /data keeps;
// `monotonic` paces the reads, the pauses and the freshness, so that a wall
// clock set back or forward never stops nor hurries them. Each decision reads
// the monotonic clock once.
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
import { createLogger } from '@gladysassistant/integration-sdk';
import { isComplete, normalizeConfig } from './config.js';
import {
  ACCEPT_CONFIRM_AFTER,
  ACCEPT_CONFIRM_WITHIN,
  ATTEMPT_SAVE_EVERY,
  CONFIG_RETRY_MAX,
  CONFIG_RETRY_MIN,
  COUNTER_INPUTS,
  DAILY_INTERVAL,
  DAILY_RETRY_MAX,
  DAILY_RETRY_MIN,
  ELECTRICITY_LIMITS,
  FROZEN_AFTER,
  GAS_LIMITS,
  INDEX_INTERVAL,
  INPUTS,
  PAUSE_MAX,
  PAUSE_MIN,
  POLL_INTERVAL,
  RETRY_MAX,
  RETRY_MIN,
  STATE_HEARTBEAT,
  STOP_WAIT,
  TELEINFO_INPUTS,
  TEST_ANSWER_WITHIN,
  WATER_LIMITS,
} from './constants.js';
import {
  FEATURE,
  buildDevice,
  capabilitiesOfCounter,
  capabilitiesOfDevice,
  capabilitiesOfTeleinfo,
  counterIndexStates,
  ids,
  inputOfExternal,
  powerStates,
  round,
  teleinfoIndexStates,
  toCubicMeters,
  todayStates,
  union,
  validKeys,
} from './devices.js';
import { EcoDevicesClient } from './ecodevices/client.js';
import { totalOfTariffs } from './ecodevices/model.js';
import { IndexGuard } from './guard.js';
import { T } from './i18n.js';
import { createFileStore } from './store.js';

const defaultTimers = { setTimeout, clearTimeout };

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const isPlain = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const own = (object, key) =>
  isPlain(object) && Object.hasOwn(object, key) ? object[key] : undefined;

/**
 * The tag of a refused password: 8 bits of a salted hash, never more (a
 * short password must not be found back from /data by brute force). Two
 * passwords share it once in 256: the test button then tries anyway.
 */
export const tagOf = (salt, password) =>
  createHash('sha256').update(`${salt}\u0000${password}`, 'utf8').digest()[0];

/** The fingerprint of the values of a teleinfo input: 8 hex digits, nothing to read back. */
export const fingerprintOf = (reading) =>
  createHash('sha256')
    .update(JSON.stringify([reading.papp ?? null, reading.option ?? null, reading.tariffs ?? null]))
    .digest('hex')
    .slice(0, 8);

/** The index Gladys already holds for a feature of a created device, when it says so. */
function lastValueOf(device, featureId) {
  const feature = (device?.features ?? []).find((f) => f.external_id === featureId);
  const value = Number(feature?.last_value);
  const at = Date.parse(feature?.last_value_changed ?? '');
  return feature?.last_value !== null &&
    feature?.last_value !== undefined &&
    Number.isFinite(value) &&
    Number.isFinite(at)
    ? { value, at }
    : undefined;
}

/** A pause read back from /data; in memory it ends at a monotonic `due` (capped to PAUSE_MAX). */
function validPause(pause, now, mono) {
  if (
    !isPlain(pause) ||
    !finite(pause.until) ||
    !Number.isInteger(pause.count) ||
    pause.count < 1 ||
    (pause.code !== 'rate_limited' && pause.code !== 'server')
  ) {
    return undefined;
  }
  const left = Math.min(Math.max(0, pause.until - now), PAUSE_MAX);
  return {
    until: now + left,
    due: mono + left,
    count: Math.min(pause.count, 32),
    code: pause.code,
    status: Number.isInteger(pause.status) ? pause.status : null,
  };
}

/** The refused login read back from /data: `{ address, username, salt, tag }`. */
function validRefused(refused) {
  return isPlain(refused) &&
    typeof refused.address === 'string' &&
    typeof refused.username === 'string' &&
    typeof refused.salt === 'string' &&
    /^[0-9a-f]{32}$/.test(refused.salt) &&
    Number.isInteger(refused.tag) &&
    refused.tag >= 0 &&
    refused.tag < 256
    ? {
        address: refused.address,
        username: refused.username,
        salt: refused.salt,
        tag: refused.tag,
      }
    : undefined;
}

/** The tariff indexes of the last total accepted, read back from /data. */
function validTariffRef(ref) {
  if (!isPlain(ref) || typeof ref.option !== 'string' || !isPlain(ref.tariffs)) {
    return undefined;
  }
  const tariffs = {};
  for (const [name, value] of Object.entries(ref.tariffs)) {
    if (!/^[A-Z]{4,7}$/.test(name) || !Number.isSafeInteger(value) || value < 0) {
      return undefined;
    }
    tariffs[name] = value;
  }
  return { option: ref.option, tariffs };
}

/** The fingerprint of an input kept in /data, its age brought onto the monotonic clock. */
function validFingerprint(fp, now, mono) {
  if (!isPlain(fp) || typeof fp.fp !== 'string' || !/^[0-9a-f]{8}$/.test(fp.fp) || !finite(fp.at)) {
    return undefined;
  }
  const at = Math.min(fp.at, now);
  return { fp: fp.fp, at, mono: mono - (now - at) };
}

/** The limits of the guard of an input (units per hour), from what it measures. */
function limitsOf(input, counters) {
  if (TELEINFO_INPUTS.includes(input)) return ELECTRICITY_LIMITS;
  return counters[input]?.type === 'gas' ? GAS_LIMITS : WATER_LIMITS;
}

export class EcoDevicesApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'ecodevices' }),
    now = Date.now,
    monotonic = () => performance.now(),
    timers = defaultTimers,
    clientFactory = (options) => new EcoDevicesClient(options),
    store = createFileStore(),
    random = () => randomBytes(16).toString('hex'),
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.monotonic = monotonic;
    this.timers = timers;
    this.clientFactory = clientFactory;
    this.random = random;
    this.store = store;
    this.savedKey = undefined;
    /** The last save failed: no index published until one succeeds. */
    this.saveFailed = false;
    this.config = normalizeConfig();
    /** `{ client, discovered }` of the current address and login; replaced when they change. */
    this.session = undefined;
    this.running = false;
    this.timer = undefined;
    this.busy = undefined;
    this.loopRun = Promise.resolve();
    this.lifecycle = Promise.resolve();
    this.lastStatus = undefined;
    /** The first click of "Accept the held index": `{ at, listedAt, list, session }`, in memory. */
    this.pendingAccept = undefined;
    /** The connection to Gladys: a new one (or a save) ends the getConfig retries of the old. */
    this.connection = 0;
    this.configTimer = undefined;
    this.configFailures = 0;
    this.configRun = Promise.resolve();
    /** By input: the guard of its index. */
    this.guards = new Map();
    this.guardsKey = undefined;
    this.pause = undefined;
    this.refused = undefined;
    this.lastAttemptAt = undefined;
    this.savedAttemptAt = undefined;
    this.lastReadAt = undefined;
    /** By input: the feature keys seen (kept so that a restart offers the devices). */
    this.seen = new Map(INPUTS.map((input) => [input, new Set()]));
    /** By input: what /data keeps of its index (guard state, tariffs of the last total). */
    this.indexes = {};
    /** By input: `{ option, tariffs }` of the last total accepted (teleinfo). */
    this.tariffRefs = new Map();
    /** By teleinfo input: `{ fp, at (wall), mono }`, the values and when they last changed. */
    this.fingerprints = new Map();
    /** /data could not be read: `{ code }`; nothing written, no index published. */
    this.storeError = undefined;
    this.loadState();
    this.resetReads();
  }

  /** Reads /data; an unreadable file is kept as an error, never taken for an empty state. */
  loadState() {
    const result = this.store.load();
    if (!result?.ok) {
      if (!this.storeError) {
        this.logger.warn(
          `ecodevices: /data cannot be read (${result?.code ?? 'error'}): indexes held`,
        );
      }
      this.storeError = { code: result?.code ?? 'error' };
      return false;
    }
    const kept = result.data;
    const at = this.now();
    const mono = this.monotonic();
    this.storeError = undefined;
    this.pause ??= validPause(kept.pause, at, mono);
    this.refused ??= validRefused(kept.refused);
    for (const input of INPUTS) {
      this.seen.set(input, union(this.seen.get(input), validKeys(input, own(kept.inputs, input))));
    }
    const indexes = {};
    for (const input of INPUTS) {
      const value = own(kept.indexes, input);
      if (isPlain(value)) indexes[input] = value;
    }
    this.indexes = indexes;
    this.guards.clear();
    this.tariffRefs.clear();
    for (const input of TELEINFO_INPUTS) {
      const ref = validTariffRef(indexes[input]?.tariffs);
      if (ref) this.tariffRefs.set(input, ref);
      const fp = validFingerprint(own(kept.fingerprints, input), at, mono);
      if (fp && !this.fingerprints.has(input)) this.fingerprints.set(input, fp);
    }
    // The last read before a restart: the next one never comes sooner than
    // the interval (a date in the future, a clock set back, is brought to now).
    if (finite(kept.lastAttemptAt) && this.lastAttemptAt === undefined) {
      this.lastAttemptAt = Math.min(kept.lastAttemptAt, at);
      this.savedAttemptAt = this.lastAttemptAt;
      this.lastReadAt = mono - (at - this.lastAttemptAt);
    }
    this.savedKey = undefined;
    return true;
  }

  /** What belongs to one address: forgotten when it changes. */
  resetReads() {
    /** The last read: `{ at (monotonic), kind: 'reading' | 'error', ... }`. */
    this.outcome = undefined;
    this.failures = 0;
    this.nextTryAt = undefined;
    this.lastError = undefined;
    /** The page of the day: `{ data, nextAt, failures, code }`. */
    this.daily = { data: undefined, nextAt: undefined, failures: 0, code: undefined, fresh: false };
    /** Monotonic time the indexes were last published. */
    this.lastIndexAt = undefined;
    /** Teleinfo inputs whose tariff indexes gave no total at the last index time (a glitch). */
    this.noTotal = new Set();
  }

  // --- Connection to Gladys -------------------------------------------------------

  /**
   * A (re)connection to Gladys: its configuration, then a start. A
   * `getConfig()` that fails is tried again without end (5 s doubled up to
   * 5 min), the status saying so, until it answers or the connection ends.
   */
  connected(getConfig) {
    const token = ++this.connection;
    this.configFailures = 0;
    this.clearConfigTimer();
    this.configRun = this.tryConfig(getConfig, token);
    return this.configRun;
  }

  /** The connection to Gladys is lost: the retries of getConfig end, the reads stop. */
  disconnected() {
    this.connection += 1;
    this.clearConfigTimer();
    return this.stop();
  }

  /** The user saved the form: this configuration wins over a getConfig still being tried. */
  configUpdated(raw) {
    this.connection += 1;
    this.clearConfigTimer();
    return this.start(raw);
  }

  clearConfigTimer() {
    if (this.configTimer !== undefined) {
      this.timers.clearTimeout(this.configTimer);
      this.configTimer = undefined;
    }
  }

  async tryConfig(getConfig, token) {
    let raw;
    try {
      raw = await getConfig();
    } catch (err) {
      if (token !== this.connection) return;
      const wait = Math.min(CONFIG_RETRY_MIN * 2 ** this.configFailures, CONFIG_RETRY_MAX);
      this.configFailures += 1;
      this.logger.warn(`ecodevices: the configuration could not be read (${err?.name ?? 'Error'})`);
      this.lastStatus = undefined;
      await this.setStatus(false, T.configUnread(wait));
      if (token !== this.connection) return;
      this.configTimer = this.timers.setTimeout(() => {
        this.configTimer = undefined;
        this.configRun = this.tryConfig(getConfig, token);
        return this.configRun;
      }, wait);
      return;
    }
    if (token !== this.connection) return;
    this.configFailures = 0;
    await this.start(raw);
  }

  // --- Lifecycle -------------------------------------------------------------

  start(raw = {}) {
    return this.serialize(() => this.doStart(raw));
  }

  /**
   * Stops the reads, waits (bounded) for the one running, and writes /data:
   * the time of the last read and what was seen since the last save are
   * never lost by a clean stop.
   */
  stop() {
    return this.serialize(async () => {
      this.doStop();
      // Written first: Docker stops the container 10 s after asking.
      await this.saveState();
      if (this.busy) {
        let timer;
        await Promise.race([
          this.busy.catch(() => {}),
          new Promise((resolve) => {
            timer = this.timers.setTimeout(resolve, STOP_WAIT);
          }),
        ]);
        this.timers.clearTimeout(timer);
      }
      await this.saveState();
    });
  }

  /** Resolves once every queued start/stop and the read running are done (tests). */
  async idle() {
    await this.configRun;
    await this.lifecycle;
    await this.loopRun;
    await this.busy;
  }

  serialize(job) {
    const run = this.lifecycle.then(job, job);
    this.lifecycle = run.catch(() => {});
    return run;
  }

  /** The key of what a session is: the address and the login. */
  static sessionKey(config) {
    return JSON.stringify([
      config.address,
      config.invalidAddress,
      config.login?.username ?? null,
      config.login?.password ?? null,
      config.invalidLogin,
    ]);
  }

  async doStart(raw) {
    this.doStop();
    const config = normalizeConfig(raw);
    const first = this.session === undefined;
    const changed =
      first || EcoDevicesApp.sessionKey(config) !== EcoDevicesApp.sessionKey(this.config);
    const addressChanged = !first && config.address !== this.config.address;
    this.config = config;
    const guardsKey = JSON.stringify(config.counters);
    if (this.guardsKey !== guardsKey) {
      // Another kind of counter (water, gas, unit): the guards are built
      // again from /data with their limits (saved first).
      await this.saveState();
      this.guards.clear();
      this.guardsKey = guardsKey;
    }
    if (changed) {
      this.session = {
        client: isComplete(config)
          ? this.clientFactory({ address: config.address, login: config.login })
          : undefined,
        discovered: false,
      };
      // A list of the first click belongs to its session.
      this.pendingAccept = undefined;
      if (!first) {
        this.resetReads();
      }
      if (addressChanged && this.pause) {
        // Another address: a pause asked by the old one ends; the pace does not.
        this.pause = undefined;
        await this.saveState();
      }
    }
    // A login refused stands only for the same address, user and password.
    if (this.refused && !this.refusedApplies()) {
      this.refused = undefined;
      await this.saveState();
    }
    this.running = true;
    // The core keeps the connection status, the Discovery list and the last
    // values in memory: a restarted Gladys has lost them, so they are always
    // sent again (the values at the next read, never a value of before).
    this.lastStatus = undefined;
    this.lastIndexAt = undefined;
    this.daily.fresh = false;
    this.gladys.forgetPublishedStates?.();
    if (!this.session.client) {
      await this.updateStatus();
      return;
    }
    await this.discover();
    await this.updateStatus();
    this.schedule();
  }

  doStop() {
    this.running = false;
    if (this.timer !== undefined) {
      this.timers.clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /** Whether the login refused by the Eco-Devices is the one configured now. */
  refusedApplies() {
    const r = this.refused;
    const config = this.config;
    return Boolean(
      r &&
      r.address === config.address &&
      r.username === (config.login?.username ?? '') &&
      r.tag === tagOf(r.salt, config.login?.password ?? ''),
    );
  }

  // --- Pace ------------------------------------------------------------------

  /** The rest of the pause (ms, monotonic), capped to PAUSE_MAX at every use; 0 when none. */
  pauseLeft(mono) {
    if (!this.pause) {
      return 0;
    }
    return Math.min(Math.max(0, this.pause.due - mono), PAUSE_MAX);
  }

  /** The monotonic time from which the next read may start, from the caller's instant `mono`. */
  dueAt(mono) {
    let due = this.lastReadAt === undefined ? mono : this.lastReadAt + POLL_INTERVAL;
    if (this.nextTryAt !== undefined) {
      due = Math.max(due, this.nextTryAt);
    }
    return Math.max(due, mono + this.pauseLeft(mono));
  }

  /** One timer: the next read when it is due; none while the login is refused. */
  schedule() {
    if (this.timer !== undefined) {
      this.timers.clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (!this.running || !this.session?.client || this.refusedApplies()) {
      return;
    }
    const mono = this.monotonic();
    const wait = Math.max(0, this.dueAt(mono) - mono);
    this.timer = this.timers.setTimeout(() => {
      this.timer = undefined;
      this.loopRun = this.loop();
      return this.loopRun;
    }, wait);
  }

  async loop() {
    const session = this.session;
    try {
      await this.tick();
    } catch (err) {
      this.logger.error(`ecodevices: unexpected error (${err?.name ?? 'Error'})`);
    }
    if (session === this.session && this.running) {
      this.schedule();
    }
  }

  /** One read when it is due; a read running is never doubled. */
  tick({ evenRefused = false } = {}) {
    if (this.busy) {
      return this.busy;
    }
    this.busy = this.read({ evenRefused }).finally(() => {
      this.busy = undefined;
    });
    return this.busy;
  }

  async read({ evenRefused }) {
    const session = this.session;
    const client = session?.client;
    if (!client || !this.running) {
      return;
    }
    // A refused login is never tried again by itself: only the test button.
    if (!evenRefused && this.refusedApplies()) {
      return;
    }
    const mono = this.monotonic();
    if (mono < this.dueAt(mono)) {
      // A timer a little early (rounded to the ms): the next one comes when due.
      return;
    }
    await this.poll(session, client, mono);
  }

  /** The read itself, once it is due (`mono`: the instant of that decision). */
  async poll(session, client, mono) {
    /** Another address or login (or a stop) during an await: this read gives up, silently. */
    const gone = () => session !== this.session || !this.running;
    if (this.storeError) {
      // Tried again at each read: once /data reads, the indexes go on.
      this.loadState();
    }
    this.lastReadAt = mono;
    // Kept BEFORE the request: a restart during it never reads again sooner.
    await this.saveAttempt(this.now());
    if (gone()) return;
    let reading;
    try {
      reading = await client.indexes();
    } catch (err) {
      if (gone()) return;
      await this.failed(err, gone);
      return;
    }
    if (gone()) return;
    await this.readDaily(client, gone, mono);
    if (gone()) return;
    await this.succeeded(reading, mono, gone);
  }

  /** Whether a pulse counter is set (water or gas): only then is the page of the day read. */
  countersSet() {
    return COUNTER_INPUTS.some((input) => this.config.counters[input].type !== 'none');
  }

  /**
   * The page of the day (`cmd=20`), every DAILY_INTERVAL: secondary. Its
   * failure (a 401/403 too: never a refused login) only leaves the
   * consumption of the day unknown, tried again after 5 min doubled up to 1 h.
   */
  async readDaily(client, gone, mono) {
    this.daily.fresh = false;
    if (!this.countersSet() || (this.daily.nextAt !== undefined && mono < this.daily.nextAt)) {
      return;
    }
    try {
      const data = await client.daily();
      if (gone()) return;
      if (this.daily.code) {
        this.logger.info('ecodevices: the page of the day answers again');
      }
      this.daily = {
        data,
        nextAt: mono + DAILY_INTERVAL,
        failures: 0,
        code: undefined,
        fresh: true,
      };
    } catch (err) {
      if (gone()) return;
      const wait = Math.min(DAILY_RETRY_MIN * 2 ** this.daily.failures, DAILY_RETRY_MAX);
      if (!this.daily.code) {
        this.logger.warn(`ecodevices: the page of the day failed (${err?.code ?? 'error'})`);
      }
      this.daily = {
        data: undefined,
        nextAt: mono + wait,
        failures: Math.min(this.daily.failures + 1, 16),
        code: err?.code ?? 'error',
        fresh: false,
      };
    }
  }

  async saveAttempt(now) {
    this.lastAttemptAt = now;
    if (
      this.savedAttemptAt === undefined ||
      now < this.savedAttemptAt ||
      now - this.savedAttemptAt >= ATTEMPT_SAVE_EVERY
    ) {
      this.savedAttemptAt = now;
      await this.saveState();
    }
  }

  // --- Outcomes ----------------------------------------------------------------

  async succeeded(reading, mono, gone) {
    // An answer: a pause asked before, the retries and a refused login are over.
    this.pause = undefined;
    this.failures = 0;
    this.nextTryAt = undefined;
    this.lastError = undefined;
    if (this.refused) {
      this.refused = undefined;
      this.logger.info('ecodevices: the Eco-Devices accepts the login again');
    }
    const now = this.now();
    let grew = !this.session.discovered;
    const frozen = [];
    for (const input of TELEINFO_INPUTS) {
      const t = reading.teleinfo[input];
      if (t.connected && this.followFreshness(input, t, mono, now)) {
        frozen.push(input);
      }
      const keys = union(this.seen.get(input), capabilitiesOfTeleinfo(t));
      if (keys.size !== this.seen.get(input).size) grew = true;
      this.seen.set(input, keys);
    }
    for (const input of COUNTER_INPUTS) {
      if (this.config.counters[input].type === 'none') continue;
      const keys = union(this.seen.get(input), capabilitiesOfCounter(reading.counters[input]));
      if (keys.size !== this.seen.get(input).size) grew = true;
      this.seen.set(input, keys);
    }
    this.outcome = { at: mono, kind: 'reading', reading, frozen };
    if (grew) {
      this.session.discovered = true;
      await this.discover();
      if (gone()) return;
    }
    await this.publish(reading, mono, frozen, gone);
    if (gone()) return;
    await this.saveState();
    if (gone()) return;
    await this.updateStatus();
  }

  /**
   * The values of a teleinfo input identical for FROZEN_AFTER (fingerprint
   * and the time it last changed kept in /data): the Eco-Devices serves a
   * frozen copy (cable out). After a restart, the same fingerprint keeps its age.
   */
  followFreshness(input, t, mono, now) {
    const fp = fingerprintOf(t);
    const known = this.fingerprints.get(input);
    if (!known || known.fp !== fp) {
      this.fingerprints.set(input, { fp, at: now, mono });
      return false;
    }
    return mono - known.mono >= FROZEN_AFTER;
  }

  async failed(err, gone) {
    const code = err?.code ?? 'error';
    const now = this.now();
    // The pause and the next try count from the failure, not from the start of the read.
    const at = this.monotonic();
    // Our own words only (EcoDevicesError codes): never a text of the device.
    this.logger.warn(
      `ecodevices read failed: ${code}${Number.isInteger(err?.status) ? ` ${err.status}` : ''}`,
    );
    this.outcome = { at, kind: 'error', err };
    if (code === 'refused') {
      // The principal page refuses the login: final, kept in /data, never
      // tried again by itself (only a new login or the test button).
      if (!this.refusedApplies()) {
        const salt = this.random();
        this.refused = {
          address: this.config.address,
          username: this.config.login?.username ?? '',
          salt,
          tag: tagOf(salt, this.config.login?.password ?? ''),
        };
      }
      this.failures = 0;
      this.nextTryAt = undefined;
      this.lastError = undefined;
      await this.saveState();
      if (gone()) return;
      await this.updateStatus();
      return;
    }
    if (code === 'rate_limited' || code === 'server') {
      const count = (this.pause?.count ?? 0) + 1;
      const asked = finite(err.retryAfter) ? err.retryAfter : PAUSE_MIN * 2 ** (count - 1);
      const wait = Math.min(Math.max(asked, PAUSE_MIN), PAUSE_MAX);
      this.pause = {
        until: now + wait,
        due: at + wait,
        count: Math.min(count, 32),
        code,
        status: Number.isInteger(err.status) ? err.status : null,
      };
      await this.saveState();
      if (gone()) return;
      await this.updateStatus();
      return;
    }
    // Retries doubled (never faster than the interval).
    const wait = Math.min(RETRY_MIN * 2 ** this.failures, RETRY_MAX);
    this.failures = Math.min(this.failures + 1, 16);
    this.lastError = err;
    this.nextTryAt = at + wait;
    await this.saveState();
    if (gone()) return;
    await this.updateStatus();
  }

  // --- Status ------------------------------------------------------------------

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed (${err?.name ?? 'Error'})`));
  }

  async updateStatus() {
    const [connected, message] = this.currentStatus();
    await this.setStatus(connected, message);
  }

  /** Notes shown with every status: the indexes held back, /data. */
  standingNotes() {
    const notes = [];
    if (this.storeError) notes.push(T.notes.storeUnreadable(this.storeError.code));
    else if (this.saveFailed) notes.push(T.notes.saveFailed);
    const held = this.heldList();
    if (held.length > 0) notes.push(T.notes.held(held));
    return notes;
  }

  /** The status from what is known now: never a read. */
  currentStatus() {
    const address = this.config.address;
    if (!this.session?.client) {
      if (this.config.invalidAddress) return [false, T.badAddress];
      if (this.config.invalidLogin) return [false, T.badLogin];
      return [false, T.incomplete];
    }
    const mono = this.monotonic();
    const notes = this.standingNotes();
    if (this.refusedApplies()) {
      return [false, T.refused(address, Boolean(this.config.login), notes)];
    }
    const left = this.pauseLeft(mono);
    if (left > 0) {
      return [false, T.paused(address, this.pause, left, notes)];
    }
    if (this.lastError && this.failures > 0) {
      const wait = Math.max(0, (this.nextTryAt ?? 0) - mono);
      return [false, T.unreachable(address, this.lastError, wait, notes)];
    }
    if (this.outcome?.kind === 'reading') {
      const { reading, frozen } = this.outcome;
      const extra = [];
      const connected = TELEINFO_INPUTS.filter((i) => reading.teleinfo[i].connected);
      const counters = COUNTER_INPUTS.filter((i) => this.config.counters[i].type !== 'none');
      const missing = [...connected, ...counters].filter(
        (i) => this.seen.get(i).size > 0 && !this.createdDevice(i),
      );
      if (missing.length > 0) extra.push(T.notes.noDevice(missing));
      const ambiguous = TELEINFO_INPUTS.filter((i) => reading.teleinfo[i].ambiguous);
      if (ambiguous.length > 0) extra.push(T.notes.ambiguous(ambiguous));
      const noIndex = connected.filter(
        (i) =>
          !reading.teleinfo[i].ambiguous && (!reading.teleinfo[i].tariffs || this.noTotal.has(i)),
      );
      if (noIndex.length > 0) extra.push(T.notes.noIndex(noIndex));
      if (frozen.length > 0) extra.push(T.notes.frozen(frozen, FROZEN_AFTER));
      const unset = COUNTER_INPUTS.filter(
        (i) => this.config.counters[i].type === 'none' && reading.counters[i] !== undefined,
      );
      if (unset.length > 0) extra.push(T.notes.counterUnset(unset));
      const silent = counters.filter((i) => reading.counters[i] === undefined);
      if (silent.length > 0) extra.push(T.notes.counterSilent(silent));
      if (this.daily.code && counters.length > 0) extra.push(T.notes.dailyFailed(this.daily));
      return [true, T.ok(address, connected, counters, [...extra, ...notes])];
    }
    return [false, T.waiting(address, notes)];
  }

  /** The indexes held back: `{ input, direction, from, to, threshold, unit }`. */
  heldList() {
    const list = [];
    for (const input of INPUTS) {
      const held = this.currentGuard(input)?.held;
      if (held) {
        list.push({
          input,
          direction: held.direction,
          from: held.from,
          to: held.to,
          threshold: held.threshold,
          unit: TELEINFO_INPUTS.includes(input) ? 'kWh' : 'm³',
        });
      }
    }
    return list;
  }

  // --- /data -------------------------------------------------------------------------

  /** The index state of each input with a guard, into what /data keeps. */
  syncIndexes() {
    for (const [input, guard] of this.guards) {
      const ref = this.tariffRefs.get(input);
      this.indexes[input] = { ...guard.state(), ...(ref ? { tariffs: ref } : {}) };
    }
  }

  /**
   * Keeps the inputs seen, the pause, the refused login, the last read, the
   * guards and the fingerprints. Never writes over a /data it could not read.
   * @returns {Promise<boolean>} whether /data holds the state now.
   */
  async saveState() {
    if (this.storeError) {
      return false;
    }
    this.syncIndexes();
    const p = this.pause;
    const state = {
      inputs: Object.fromEntries(INPUTS.map((input) => [input, [...this.seen.get(input)]])),
      pause: p ? { until: p.until, count: p.count, code: p.code, status: p.status } : null,
      refused: this.refused ?? null,
      lastAttemptAt: this.lastAttemptAt ?? null,
      indexes: this.indexes,
      fingerprints: Object.fromEntries(
        [...this.fingerprints].map(([input, fp]) => [input, { fp: fp.fp, at: fp.at }]),
      ),
    };
    const key = JSON.stringify(state);
    if (key === this.savedKey) {
      return true;
    }
    try {
      await this.store.save(state);
      this.savedKey = key;
      if (this.saveFailed) {
        this.saveFailed = false;
        this.logger.info('ecodevices: /data is written again');
      }
      return true;
    } catch (err) {
      if (!this.saveFailed) {
        this.logger.warn(`ecodevices: saving /data failed (${err?.code ?? 'error'})`);
      }
      this.saveFailed = true;
      return false;
    }
  }

  // --- Devices -----------------------------------------------------------------------

  /** The created Gladys device of an input, undefined until the user creates it. */
  createdDevice(input) {
    const id = ids(this.gladys, input).device;
    return (this.gladys.devices ?? []).find((d) => d.external_id === id);
  }

  /** The inputs offered: what each showed (or kept in /data), with its created features. */
  async discover() {
    if (!this.session?.client) {
      return;
    }
    const devices = [];
    for (const input of INPUTS) {
      const counter = COUNTER_INPUTS.includes(input);
      const created = this.createdDevice(input);
      if (counter && this.config.counters[input].type === 'none' && !created) {
        continue;
      }
      const keys = union(this.seen.get(input), capabilitiesOfDevice(input, created));
      if (keys.size > 0) {
        devices.push(
          buildDevice(this.gladys, input, keys, {
            address: this.config.address,
            kind: counter ? this.config.counters[input].type : undefined,
          }),
        );
      }
    }
    await this.gladys
      .publishDiscoveredDevices(devices)
      .catch((err) => this.logger.warn(`Publishing the Eco-Devices inputs failed (${err?.name})`));
  }

  /** The Discover tab asks: the known inputs, never a read (the next one comes at its time). */
  async scan() {
    await this.discover();
  }

  async onDeviceCreated(device) {
    // A new device has no reference of its index yet (nor a state kept for a
    // deleted device of the same input): nothing can be counted twice.
    const input = inputOfExternal(this.gladys, device?.external_id);
    if (!input) {
      return;
    }
    this.guards.delete(input);
    this.tariffRefs.delete(input);
    delete this.indexes[input];
    this.pendingAccept = undefined;
    await this.saveState();
    this.lastIndexAt = undefined;
    await this.updateStatus();
  }

  async onDeviceUpdated(device) {
    if (inputOfExternal(this.gladys, device?.external_id)) {
      // New features (Update in Discovery): their indexes at the next read.
      this.lastIndexAt = undefined;
      await this.updateStatus();
    }
  }

  // --- Values ------------------------------------------------------------------------

  /** The feature external id of the guarded index of an input. */
  indexFeatureId(input) {
    const key = TELEINFO_INPUTS.includes(input) ? FEATURE.CONSUMPTION_INDEX : FEATURE.INDEX;
    return ids(this.gladys, input).feature(key);
  }

  /** The guard of the index of an input with a created device, from Gladys and /data. */
  currentGuard(input) {
    const created = this.createdDevice(input);
    if (!created || this.storeError) {
      return this.guards.get(input);
    }
    if (!this.guards.has(input)) {
      this.guards.set(
        input,
        new IndexGuard(
          lastValueOf(created, this.indexFeatureId(input)),
          this.indexes[input],
          this.now(),
          limitsOf(input, this.config.counters),
        ),
      );
    }
    return this.guards.get(input);
  }

  /**
   * The states of a read: the power and the consumption of the day every
   * time, the indexes once a minute. The guards are in /data BEFORE Gladys
   * gets an index: a save that fails (or a /data unreadable) sends none.
   */
  async publish(reading, mono, frozen, gone) {
    if (this.lastIndexAt !== undefined && mono < this.lastIndexAt) {
      this.lastIndexAt = undefined;
    }
    const indexDue = this.lastIndexAt === undefined || mono - this.lastIndexAt >= INDEX_INTERVAL;
    const live = [];
    const indexes = [];
    const now = this.now();
    for (const input of TELEINFO_INPUTS) {
      const created = this.createdDevice(input);
      const t = reading.teleinfo[input];
      if (!created || !t.connected) continue;
      const external = ids(this.gladys, input);
      // Frozen values (a cable out) are never sent as new, not even by the heartbeat.
      if (!frozen.includes(input)) live.push(...powerStates(external, t.papp));
      if (!indexDue || this.storeError) continue;
      const guard = this.currentGuard(input);
      const wh = totalOfTariffs(t, this.tariffRefs.get(input));
      if (wh === undefined) this.noTotal.add(input);
      else this.noTotal.delete(input);
      const kwh = wh === undefined ? undefined : round(wh / 1000, 3);
      const plausible = kwh !== undefined && guard.accept(kwh, now);
      if (plausible) {
        this.tariffRefs.set(input, { option: t.option, tariffs: { ...t.tariffs } });
      } else if (kwh !== undefined && guard.held) {
        this.logger.warn(
          `ecodevices ${input} index ${guard.held.direction === 'down' ? 'drop' : 'jump'} held back`,
        );
      }
      // While a value is held, the last accepted one (and its tariffs) is sent again.
      const ref = this.tariffRefs.get(input);
      const total = plausible ? kwh : guard.held ? guard.last?.value : undefined;
      const tariffs = plausible ? t.tariffs : guard.held ? ref?.tariffs : undefined;
      indexes.push(...this.only(created, teleinfoIndexStates(external, total, tariffs)));
    }
    for (const input of COUNTER_INPUTS) {
      const created = this.createdDevice(input);
      const { type, unit } = this.config.counters[input];
      if (!created || type === 'none') continue;
      const external = ids(this.gladys, input);
      if (this.daily.fresh) {
        live.push(...todayStates(external, toCubicMeters(this.daily.data?.[input], unit)));
      }
      if (!indexDue || this.storeError) continue;
      const guard = this.currentGuard(input);
      const m3 = toCubicMeters(reading.counters[input], unit);
      const plausible = m3 !== undefined && m3 > 0 && guard.accept(m3, now);
      if (m3 !== undefined && !plausible && guard.held) {
        this.logger.warn(
          `ecodevices ${input} index ${guard.held.direction === 'down' ? 'drop' : 'jump'} held back`,
        );
      }
      const value = plausible ? m3 : guard.held ? guard.last?.value : undefined;
      indexes.push(...this.only(created, counterIndexStates(external, value)));
    }
    let states = this.onlyCreated(live);
    if (indexDue) {
      this.lastIndexAt = mono;
      if (!this.storeError) {
        const saved = await this.saveState();
        if (gone()) return;
        if (saved) states = [...states, ...indexes];
      }
    }
    if (states.length === 0) {
      return;
    }
    await this.gladys
      .publishChangedStates(states, { heartbeat: STATE_HEARTBEAT })
      .catch((err) => this.logger.warn(`Publishing the Eco-Devices values failed (${err?.name})`));
  }

  /** Only the features the created device has (they are fixed at its creation). */
  only(created, states) {
    if (!created.features) return states;
    const features = new Set(created.features.map((f) => f.external_id));
    return states.filter((s) => features.has(s.device_feature_external_id));
  }

  onlyCreated(states) {
    return INPUTS.flatMap((input) => {
      const created = this.createdDevice(input);
      if (!created) return [];
      const prefix = `${ids(this.gladys, input).device}:`;
      return this.only(
        created,
        states.filter((s) => s.device_feature_external_id.startsWith(prefix)),
      );
    });
  }

  // --- Configuration screen buttons -------------------------------------------------

  /**
   * "Accept the held index", in two clicks (as gladys-iskra, approved): the
   * first lists every index held and accepts nothing; the second, 3 s to
   * 5 min later in the same session, accepts exactly the JUMPS the first
   * listed, each only when its held value still shows the same jump (same
   * starting value and threshold, the value shown or what the meter may have
   * measured since, src/guard.js). A DROP is never accepted (a meter
   * replaced or a counter set back: the device is created again, its history
   * starts over). A save of the form never accepts.
   */
  async acceptHeldIndex() {
    const list = this.heldList();
    const mono = this.monotonic();
    const now = this.now();
    const pending = this.pendingAccept;
    this.pendingAccept = undefined;
    const elapsed = pending ? mono - pending.at : undefined;
    const jumps = list.filter((h) => h.direction === 'up');
    const drops = list.filter((h) => h.direction === 'down');
    if (
      !pending ||
      pending.session !== this.session ||
      elapsed > ACCEPT_CONFIRM_WITHIN ||
      elapsed < ACCEPT_CONFIRM_AFTER
    ) {
      if (jumps.length === 0) {
        return drops.length > 0 ? T.accept.dropsOnly(drops) : T.accept.nothing;
      }
      this.pendingAccept = { at: mono, listedAt: now, list: jumps, session: this.session };
      return T.accept.confirm(jumps, drops, ACCEPT_CONFIRM_WITHIN);
    }
    const accepted = [];
    const changed = [];
    for (const entry of pending.list) {
      const guard = this.guards.get(entry.input);
      const held = guard?.held;
      const margin = guard ? guard.margin(pending.listedAt, now) : 0;
      const same =
        held &&
        held.direction === 'up' &&
        held.from === entry.from &&
        held.threshold === entry.threshold &&
        held.to >= entry.to &&
        held.to - entry.to <= margin;
      if (same && guard.acceptHeld()) {
        accepted.push({ ...entry, to: held.to });
        this.logger.info(`ecodevices ${entry.input} index jump accepted by the user`);
      } else if (held) {
        changed.push(entry);
      }
    }
    if (accepted.length === 0 && changed.length === 0) {
      return T.accept.nothing;
    }
    // Published at the next read (never a read sooner than the interval).
    this.lastIndexAt = undefined;
    return T.accept.done(accepted, changed, drops);
  }

  /**
   * The test button: never a read sooner than the pace allows. When a read
   * is due, this click makes it (even with a login refused before: only a
   * success lifts the refusal); otherwise it tells the last one.
   */
  async testConnection() {
    if (!this.session?.client) {
      return this.currentStatus()[1];
    }
    const mono = this.monotonic();
    if (this.pauseLeft(mono) > 0) {
      return this.currentStatus()[1];
    }
    if (this.busy || this.dueAt(mono) > mono) {
      return this.describeOutcome();
    }
    let timer;
    const late = new Promise((resolve) => {
      timer = this.timers.setTimeout(() => resolve(T.test.slow), TEST_ANSWER_WITHIN);
    });
    try {
      return await Promise.race([
        this.tick({ evenRefused: true }).then(() => this.describeOutcome(mono)),
        late,
      ]);
    } finally {
      this.timers.clearTimeout(timer);
      if (this.running) this.schedule();
    }
  }

  /**
   * The last read in words, and the time to the next one. `since`: when this
   * click started a read; a read from then on is told as "read now". An
   * index shown is the one sent to Gladys, or the value held back, said so.
   */
  describeOutcome(since) {
    const mono = this.monotonic();
    const refused = this.refusedApplies();
    const next = refused ? undefined : Math.max(0, this.dueAt(mono) - mono);
    const outcome = this.outcome;
    if (!outcome) {
      return refused ? this.currentStatus()[1] : T.test.notYet(next, POLL_INTERVAL);
    }
    const ago =
      since !== undefined && outcome.at >= since ? undefined : Math.max(0, mono - outcome.at);
    if (outcome.kind === 'reading') {
      const { reading, frozen } = outcome;
      const inputs = [];
      for (const input of TELEINFO_INPUTS) {
        const t = reading.teleinfo[input];
        if (!t.connected) continue;
        const held = this.guards.get(input)?.held;
        const wh = totalOfTariffs(t, undefined);
        inputs.push({
          input,
          power: frozen.includes(input) ? undefined : t.papp,
          index: held ? held.to : wh === undefined ? undefined : round(wh / 1000, 3),
          held: Boolean(held),
          unit: 'kWh',
        });
      }
      for (const input of COUNTER_INPUTS) {
        const { type, unit } = this.config.counters[input];
        if (type === 'none') continue;
        const held = this.guards.get(input)?.held;
        inputs.push({
          input,
          index: held ? held.to : toCubicMeters(reading.counters[input], unit),
          held: Boolean(held),
          unit: 'm³',
        });
      }
      return T.test.reading(inputs, ago, next);
    }
    return T.test.failed(this.config.address, outcome.err, ago, next);
  }
}
