// -----------------------------------------------------------------------------
// Constants shared by the integration. Every key stored by Gladys (actions,
// manifest keys, feature keys in src/devices.js, input ids) is forever: never
// rename one.
// -----------------------------------------------------------------------------

export const ACTIONS = { TEST: 'test_connection', ACCEPT_HELD: 'accept_held_index' };

/**
 * The external id of a device: `ecodevices:<input>`, one device per input of
 * the Eco-Devices (`t1`, `t2`: the teleinformation inputs; `c1`, `c2`: the
 * pulse counters). One Eco-Devices per integration: a new IP address keeps
 * the devices and their history; another meter on an input is held by the
 * index guard (a drop or a jump), never counted.
 */
export const EXTERNAL_ID_TYPE = 'ecodevices';
export const TELEINFO_INPUTS = ['t1', 't2'];
export const COUNTER_INPUTS = ['c1', 'c2'];
export const INPUTS = [...TELEINFO_INPUTS, ...COUNTER_INPUTS];

// --- The local JSON API of the Eco-Devices (GCE Electronics wiki, "API JSON") -------
export const PATHS = {
  /** The indexes: teleinfo T1/T2 (PTEC, PAPP, tariff indexes) and INDEX_C1/INDEX_C2. */
  INDEXES: '/api/xdevices.json?cmd=10',
  /** The consumption of the day of the pulse counters: Day_C1, Day_C2 (secondary). */
  DAILY: '/api/xdevices.json?cmd=20',
};

/**
 * The tariff indexes of a teleinformation input (historic mode, Wh), by
 * tariff option: the JSON gives the ones of the option of the meter. The
 * total is built only when every index of ONE option is there.
 */
export const TARIFF_GROUPS = {
  base: ['BASE'],
  hc: ['HCHC', 'HCHP'],
  ejp: ['EJPHN', 'EJPHPM'],
  tempo: ['BBRHCJB', 'BBRHPJB', 'BBRHCJW', 'BBRHPJW', 'BBRHCJR', 'BBRHPJR'],
};
export const TARIFFS = Object.values(TARIFF_GROUPS).flat();

/** 10 s for the whole answer (the body included), as pyecodevices. */
export const HTTP_TIMEOUT = 10_000;
/** An answer is a few hundred bytes: more than this is not an Eco-Devices answer. */
export const MAX_BODY_BYTES = 16 * 1024;

// --- Schedule ------------------------------------------------------------------------
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
/** One read of the indexes every 15 s, never faster, whatever asks for it. */
export const POLL_INTERVAL = 15 * SECOND;
/** The indexes are published (and their guards kept in /data) once a minute at most. */
export const INDEX_INTERVAL = MINUTE;
/** The consumption of the day (cmd=20): read every 5 minutes, after the indexes. */
export const DAILY_INTERVAL = 5 * MINUTE;
/** The page of the day failing: tried again after 5 min, doubled up to 1 h; never blocking. */
export const DAILY_RETRY_MIN = 5 * MINUTE;
export const DAILY_RETRY_MAX = HOUR;
/** An unreachable Eco-Devices or a wrong answer: tries after 15 s, doubled up to 10 minutes. */
export const RETRY_MIN = 15 * SECOND;
export const RETRY_MAX = 10 * MINUTE;
/** HTTP 429 or 5xx of the main page: a pause from 1 min to 6 h, kept in /data. */
export const PAUSE_MIN = MINUTE;
export const PAUSE_MAX = 6 * HOUR;
/** The time of the last read is written in /data at most once per this delay. */
export const ATTEMPT_SAVE_EVERY = MINUTE;
/** Unchanged values are sent again after this delay (publishChangedStates heartbeat). */
export const STATE_HEARTBEAT = 10 * MINUTE;
/** The test button answers within this delay (the manifest gives it 30 s). */
export const TEST_ANSWER_WITHIN = 25 * SECOND;
/** `getConfig()` failing at a connection: tried again after 5 s, doubled up to 5 min, without end. */
export const CONFIG_RETRY_MIN = 5 * SECOND;
export const CONFIG_RETRY_MAX = 5 * MINUTE;
/**
 * The values of a teleinfo input identical for this long (apparent power AND
 * every tariff index): the Eco-Devices serves a frozen copy (cable out), its
 * power is no longer published. Measured on the monotonic clock, kept in /data.
 */
export const FROZEN_AFTER = 15 * MINUTE;
/** "Accept the held index": the second click comes 3 s to 5 min after the first. */
export const ACCEPT_CONFIRM_AFTER = 3 * SECOND;
export const ACCEPT_CONFIRM_WITHIN = 5 * MINUTE;
/** A stop saves /data, then waits for the read running at most this long and saves again. */
export const STOP_WAIT = 5 * SECOND;

// --- Bounds of the values --------------------------------------------------------------
/** PAPP: 5 digits in teleinformation (VA). */
export const PAPP_MAX = 99_999;
/** A tariff index: 9 digits in teleinformation (Wh). */
export const TARIFF_MAX = 999_999_999;
/** A pulse counter index (in its own unit). */
export const COUNTER_MAX = 999_999_999_999;

// --- Plausibility of the indexes (src/guard.js, units per hour) --------------------
/** Electricity (kWh): a home never draws more than 100 kW on average, 0.5 kWh slack. */
export const ELECTRICITY_LIMITS = { maxKw: 100, slackKwh: 0.5 };
/** Water (m³): 10 m³/h at most (a home meter gives 2.5 to 4), 0.05 m³ slack. */
export const WATER_LIMITS = { maxKw: 10, slackKwh: 0.05 };
/** Gas (m³): 16 m³/h at most (a G4 meter gives 6, a G10 16), 0.05 m³ slack. */
export const GAS_LIMITS = { maxKw: 16, slackKwh: 0.05 };
