// -----------------------------------------------------------------------------
// The answers of the JSON API of the Eco-Devices -> values. Pure.
//
// `cmd=10` (GCE Electronics wiki, "API JSON", "récupération des index"):
//   {"product":"Eco-devices","T1_PTEC":"TH..","T1_PAPP":850,"T1_BASE":50670371,
//    "T2_PTEC":"----","T2_PAPP":0,"T2_BASE":0,"INDEX_C1":70371,"INDEX_C2":21792980}
// The teleinformation keys are those of the historic mode (Enedis, as the
// pyecodevices library and the ecodevices integration read them): PTEC (the
// current tariff period, text), PAPP (apparent power, VA), and the indexes
// of the tariff option of the meter, in Wh: BASE; HCHC + HCHP; EJPHN + EJPHPM;
// BBRHCJB ... BBRHPJR (Tempo). An unused input reads "----" and zeros.
// `cmd=20` ("récupération des index journaliers"):
//   {"product":"Eco-devices","Day_C1":135,"Day_C2":3960}
//
// Strict: only own keys of a plain object are read (no prototype key), a
// number is a non-negative integer within its bounds (a JSON number, or a
// string of digits as the XML pages give them); "" or null is unknown, never
// 0. A text (PTEC) is never a measurement.
// -----------------------------------------------------------------------------

import {
  COUNTER_INPUTS,
  COUNTER_MAX,
  PAPP_MAX,
  TARIFF_GROUPS,
  TARIFF_MAX,
  TELEINFO_INPUTS,
} from '../constants.js';

const isPlain = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const own = (object, key) => (Object.hasOwn(object, key) ? object[key] : undefined);

/** A non-negative integer up to `max`, or undefined. */
export function integer(value, max) {
  let number;
  if (typeof value === 'number') {
    number = value;
  } else if (typeof value === 'string' && /^\d{1,15}$/.test(value)) {
    number = Number(value);
  } else {
    return undefined;
  }
  return Number.isSafeInteger(number) && number >= 0 && number <= max ? number : undefined;
}

/** The product of an answer: an Eco-Devices (not the RT2, which has another API). */
const isEcoDevices = (json) =>
  isPlain(json) &&
  typeof json.product === 'string' &&
  Object.hasOwn(json, 'product') &&
  /^eco-?devices$/i.test(json.product.trim());

/** PTEC: a short text of letters, dots, dashes; "----" (or all dashes) is "no meter". */
function periodOf(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9.\- ]{1,8}$/.test(value)) {
    return undefined;
  }
  const text = value.trim();
  return text === '' || /^-+$/.test(text) ? undefined : text;
}

/**
 * One teleinformation input: `{ period, papp, option, tariffs, ambiguous }`.
 * `option`: the tariff option whose indexes the answer gives (one with a
 * value above 0); `tariffs`: `{ KEY: Wh | undefined }` of that option only.
 * Two options with values: `ambiguous`, no option (no index).
 * `connected`: the input shows a meter (a period or an index above 0).
 */
function teleinfoOf(json, n) {
  const key = (name) => `T${n}_${name}`;
  const period = periodOf(own(json, key('PTEC')));
  const rawPapp = own(json, key('PAPP'));
  const papp = integer(rawPapp, PAPP_MAX);
  const active = [];
  for (const [option, names] of Object.entries(TARIFF_GROUPS)) {
    const values = names.map((name) => integer(own(json, key(name)), TARIFF_MAX));
    if (values.some((v) => v !== undefined && v > 0)) {
      active.push({
        option,
        tariffs: Object.fromEntries(names.map((name, i) => [name, values[i]])),
      });
    }
  }
  const ambiguous = active.length > 1;
  const chosen = active.length === 1 ? active[0] : undefined;
  const connected = period !== undefined || active.length > 0;
  return {
    connected,
    period,
    // A power out of bounds or not a number is unknown; 0 on an unused input says nothing.
    papp: connected ? papp : undefined,
    pappInvalid: connected && rawPapp !== undefined && papp === undefined,
    option: chosen?.option,
    tariffs: chosen?.tariffs,
    ambiguous,
  };
}

/**
 * The answer of `cmd=10`: `{ teleinfo: { t1, t2 }, counters: { c1, c2 } }`,
 * or undefined when it is not an Eco-Devices answer. A counter is its index
 * (0 is "no index": never a value).
 */
export function parseIndexes(json) {
  if (!isEcoDevices(json)) {
    return undefined;
  }
  const teleinfo = {};
  TELEINFO_INPUTS.forEach((input, i) => {
    teleinfo[input] = teleinfoOf(json, i + 1);
  });
  const counters = {};
  COUNTER_INPUTS.forEach((input, i) => {
    const value = integer(own(json, `INDEX_C${i + 1}`), COUNTER_MAX);
    counters[input] = value === undefined || value === 0 ? undefined : value;
  });
  return { teleinfo, counters };
}

/** The answer of `cmd=20`: `{ c1, c2 }` (the consumption of the day, 0 is a value), or undefined. */
export function parseDaily(json) {
  if (!isEcoDevices(json)) {
    return undefined;
  }
  const daily = {};
  COUNTER_INPUTS.forEach((input, i) => {
    daily[input] = integer(own(json, `Day_C${i + 1}`), COUNTER_MAX);
  });
  return daily;
}

/**
 * The total of the tariff indexes of an input (Wh), or undefined when it
 * must not reach the guard at all (src/guard.js, after gladys-p1-monitor
 * `indexOfTariffs`, extended to N tariffs):
 * - an index of the option missing or not a number; the sum at 0;
 * - against `previous` (the indexes of the last total accepted, same
 *   option): every index that was above 0 lower is a real drop (another
 *   meter): the sum goes
 *   to the guard, which holds it. Otherwise an index that was above 0 and
 *   reads 0, or some lower while others are not, is one register glitching:
 *   no total for that read.
 * Another option than the previous one: the sum goes to the guard.
 */
export function totalOfTariffs(reading, previous) {
  const tariffs = reading?.tariffs;
  if (!tariffs) {
    return undefined;
  }
  const names = Object.keys(tariffs);
  const values = names.map((name) => tariffs[name]);
  if (values.some((v) => v === undefined)) {
    return undefined;
  }
  const sum = values.reduce((a, b) => a + b, 0);
  if (!(sum > 0) || !Number.isSafeInteger(sum)) {
    return undefined;
  }
  const same =
    previous &&
    previous.option === reading.option &&
    names.every((name) => Number.isFinite(previous.tariffs?.[name]));
  if (same) {
    const lower = names.filter((name) => tariffs[name] < previous.tariffs[name]);
    const counted = names.filter((name) => previous.tariffs[name] > 0);
    if (counted.length > 0 && counted.every((name) => lower.includes(name))) {
      // Every index that counted went down (a Tempo red index may still be 0).
      return sum;
    }
    if (names.some((name) => previous.tariffs[name] > 0 && tariffs[name] === 0)) {
      return undefined;
    }
    if (lower.length > 0) {
      return undefined;
    }
  }
  return sum;
}
