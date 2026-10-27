// -----------------------------------------------------------------------------
// The Gladys devices of an Eco-Devices (one per input) and their states. Pure.
//
// External ids (forever): ecodevices:t1, ecodevices:t2 (teleinformation),
// ecodevices:c1, ecodevices:c2 (pulse counters). Feature keys (forever): see
// FEATURE below.
//
// Energy rules of the Gladys core (server/utils/constants.js, the energy
// monitoring and the energy contracts), as in gladys-p1-monitor and
// gladys-iskra:
// - `consumption_index` (the total of the tariff indexes of a teleinfo input,
//   Wh read, kWh published) is the ONLY energy-sensor / index feature of an
//   input: the core derives the consumption and its cost from its deltas. It
//   passes the guard of src/guard.js: never 0, a drop or a jump held;
// - the tariff indexes (BASE, HCHC, HCHP...) are plain sensors (kWh in the
//   name): as indexes they would be counted twice;
// - `power` (PAPP, apparent power, VA) is the only energy-sensor / power
//   feature: the energy contracts read it, VA divided by 1000 against the
//   subscribed kVA;
// - the pulse counters (water, gas) are `volume-sensor` in m³, never in the
//   energy monitoring: `index` (the meter total, guarded) and `today` (the
//   consumption of the day, reset by the Eco-Devices every day);
// - units: only the ones the core lists for the category
//   (DEVICE_FEATURE_UNITS_BY_CATEGORY): VA and kWh for energy-sensor, m³ for
//   volume-sensor, none for unknown (the unit is then in the name).
//
// The features follow what the input showed: the set only grows, and always
// holds the features of the created device, so a device published again
// never loses one (an "Update" in Discovery would drop its history).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import {
  COUNTER_INPUTS,
  COUNTER_MAX,
  EXTERNAL_ID_TYPE,
  INPUTS,
  PAPP_MAX,
  TARIFFS,
  TARIFF_MAX,
  TELEINFO_INPUTS,
} from './constants.js';

/** Feature keys (forever). */
export const FEATURE = {
  POWER: 'power',
  CONSUMPTION_INDEX: 'consumption_index',
  tariff: (name) => `index_${name.toLowerCase()}`,
  INDEX: 'index',
  TODAY: 'today',
};

/** Every feature key of a teleinfo input, in the order of the device. */
export const TELEINFO_ORDER = [
  FEATURE.POWER,
  FEATURE.CONSUMPTION_INDEX,
  ...TARIFFS.map(FEATURE.tariff),
];
/** Every feature key of a pulse counter. */
export const COUNTER_ORDER = [FEATURE.INDEX, FEATURE.TODAY];

const ORDER_OF = (input) => (TELEINFO_INPUTS.includes(input) ? TELEINFO_ORDER : COUNTER_ORDER);
const KNOWN = Object.fromEntries(INPUTS.map((input) => [input, new Set(ORDER_OF(input))]));

/** The external ids of an input. */
export const ids = (gladys, input) => gladys.externalIds(EXTERNAL_ID_TYPE, input);

/** The input of a device external id (its exact form only), or undefined. */
export function inputOfExternal(gladys, externalId) {
  return INPUTS.find((input) => ids(gladys, input).device === externalId);
}

const feature = (external, key, name, category, type, extra = {}) => ({
  name,
  external_id: external.feature(key),
  category,
  type,
  min: 0,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...extra,
});

/** Names of the tariff indexes, kWh in the name (plain sensors). */
const TARIFF_NAMES = {
  BASE: 'Index base (kWh)',
  HCHC: 'Index off-peak (kWh)',
  HCHP: 'Index peak (kWh)',
  EJPHN: 'Index EJP normal (kWh)',
  EJPHPM: 'Index EJP peak (kWh)',
  BBRHCJB: 'Index Tempo blue off-peak (kWh)',
  BBRHPJB: 'Index Tempo blue peak (kWh)',
  BBRHCJW: 'Index Tempo white off-peak (kWh)',
  BBRHPJW: 'Index Tempo white peak (kWh)',
  BBRHCJR: 'Index Tempo red off-peak (kWh)',
  BBRHPJR: 'Index Tempo red peak (kWh)',
};

const MAX_KWH = TARIFF_MAX * TARIFFS.length;

/** The definition of each feature key, by kind of input. */
const TELEINFO_DEFINITIONS = {
  [FEATURE.POWER]: (e) =>
    feature(e, FEATURE.POWER, 'Apparent power', C.ENERGY_SENSOR, T.ENERGY_SENSOR.POWER, {
      unit: U.VOLT_AMPERE,
      max: PAPP_MAX,
    }),
  [FEATURE.CONSUMPTION_INDEX]: (e) =>
    feature(
      e,
      FEATURE.CONSUMPTION_INDEX,
      'Consumption index',
      C.ENERGY_SENSOR,
      T.ENERGY_SENSOR.INDEX,
      { unit: U.KILOWATT_HOUR, max: MAX_KWH },
    ),
  ...Object.fromEntries(
    TARIFFS.map((name) => [
      FEATURE.tariff(name),
      (e) =>
        feature(e, FEATURE.tariff(name), TARIFF_NAMES[name], C.UNKNOWN, T.SENSOR.DECIMAL, {
          max: TARIFF_MAX / 1000,
        }),
    ]),
  ),
};

const COUNTER_DEFINITIONS = {
  [FEATURE.INDEX]: (e) =>
    feature(e, FEATURE.INDEX, 'Index', C.VOLUME_SENSOR, T.VOLUME_SENSOR.DECIMAL, {
      unit: U.CUBIC_METER,
      max: COUNTER_MAX,
    }),
  [FEATURE.TODAY]: (e) =>
    feature(e, FEATURE.TODAY, 'Consumption today', C.VOLUME_SENSOR, T.VOLUME_SENSOR.DECIMAL, {
      unit: U.CUBIC_METER,
      max: COUNTER_MAX,
    }),
};

const DEVICE_NAMES = {
  t1: 'Eco-Devices teleinfo 1',
  t2: 'Eco-Devices teleinfo 2',
  c1: 'Eco-Devices counter 1',
  c2: 'Eco-Devices counter 2',
};
const KIND_NAMES = { water: 'water', gas: 'gas' };

/**
 * The device of an input. `keys`: the feature keys to give it (a Set);
 * `kind`: for a counter, 'water' or 'gas' (in its name). The features are
 * fixed when the user creates it.
 */
export function buildDevice(gladys, input, keys, { address, kind } = {}) {
  const external = ids(gladys, input);
  const teleinfo = TELEINFO_INPUTS.includes(input);
  const definitions = teleinfo ? TELEINFO_DEFINITIONS : COUNTER_DEFINITIONS;
  const name = KIND_NAMES[kind]
    ? `${DEVICE_NAMES[input]} (${KIND_NAMES[kind]})`
    : DEVICE_NAMES[input];
  const params = [
    { name: 'address', value: address ?? '' },
    { name: 'input', value: input },
  ];
  if (!teleinfo && KIND_NAMES[kind]) {
    params.push({ name: 'kind', value: kind });
  }
  return {
    name,
    external_id: external.device,
    features: ORDER_OF(input)
      .filter((key) => keys.has(key))
      .map((key) => definitions[key](external)),
    params,
  };
}

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/** The feature keys a teleinfo reading shows (src/ecodevices/model.js teleinfoOf). */
export function capabilitiesOfTeleinfo(reading) {
  const keys = new Set();
  if (!reading?.connected) {
    return keys;
  }
  if (isNumber(reading.papp)) keys.add(FEATURE.POWER);
  if (reading.tariffs) {
    keys.add(FEATURE.CONSUMPTION_INDEX);
    for (const name of Object.keys(reading.tariffs)) {
      keys.add(FEATURE.tariff(name));
    }
  }
  return keys;
}

/** The feature keys of an enabled pulse counter: its index once it reads above 0. */
export function capabilitiesOfCounter(index) {
  return isNumber(index) && index > 0 ? new Set(COUNTER_ORDER) : new Set();
}

/** The feature keys a CREATED device carries: never fewer when it is published again. */
export function capabilitiesOfDevice(input, device) {
  return new Set(
    (device?.features ?? [])
      .map((f) => String(f.external_id).split(':').at(-1))
      .filter((key) => KNOWN[input]?.has(key)),
  );
}

/** Keys read back from /data: known keys of that input only. */
export const validKeys = (input, keys) =>
  new Set(Array.isArray(keys) ? keys.filter((key) => KNOWN[input]?.has(key)) : []);

export const union = (...sets) => new Set(sets.flatMap((s) => [...(s ?? [])]));

export const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

const state = (external, key, value, digits) =>
  isNumber(value)
    ? [{ device_feature_external_id: external.feature(key), state: round(value, digits) }]
    : [];

/** A lifetime counter: never 0 (nor below), whatever the device said. */
const counterState = (external, key, value) =>
  isNumber(value) && value > 0 ? state(external, key, value, 3) : [];

/** The apparent power of a teleinfo input, every read. */
export const powerStates = (external, papp) => state(external, FEATURE.POWER, papp, 0);

/**
 * The indexes of a teleinfo input, once a minute at most: `totalKwh` is the
 * value the guard let through (or the last accepted one while a value is
 * held), `tariffs` the indexes (Wh) of that same total. Never 0.
 */
export function teleinfoIndexStates(external, totalKwh, tariffs) {
  return [
    ...counterState(external, FEATURE.CONSUMPTION_INDEX, totalKwh),
    ...Object.entries(tariffs ?? {}).flatMap(([name, wh]) =>
      counterState(external, FEATURE.tariff(name), isNumber(wh) ? wh / 1000 : undefined),
    ),
  ];
}

/** The index of a pulse counter (m³, guarded): never 0. */
export const counterIndexStates = (external, m3) => counterState(external, FEATURE.INDEX, m3);

/** The consumption of the day of a pulse counter (m³): 0 is a value (a new day). */
export const todayStates = (external, m3) =>
  isNumber(m3) && m3 >= 0 ? state(external, FEATURE.TODAY, m3, 3) : [];

/** An index of a pulse counter in m³, from the unit of the Eco-Devices. */
export const toCubicMeters = (value, unit) =>
  isNumber(value) ? round(unit === 'cubic_meter' ? value : value / 1000, 3) : undefined;

export { COUNTER_INPUTS, TELEINFO_INPUTS };
