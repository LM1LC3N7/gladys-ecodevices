// -----------------------------------------------------------------------------
// Answers of the Eco-Devices JSON API, shaped after the examples of the GCE
// Electronics wiki ("API JSON") and the historic teleinformation keys
// (pyecodevices): built, never captured on a real Eco-Devices (none was at
// hand).
// -----------------------------------------------------------------------------

export const ADDRESS = '192.168.1.20';
export const NOW = Date.parse('2026-10-27T10:00:00Z');

/** The example of the wiki, verbatim. */
export const WIKI_INDEXES = {
  product: 'Eco-devices',
  T1_PTEC: 'TH..',
  T1_PAPP: 850,
  T1_BASE: 50670371,
  T2_PTEC: '----',
  T2_PAPP: 0,
  T2_BASE: 0,
  INDEX_C1: 70371,
  INDEX_C2: 21792980,
};
export const WIKI_DAILY = { product: 'Eco-devices', Day_C1: 135, Day_C2: 3960 };

/**
 * `cmd=10`: T1 in base option by default (`t1` keys override, `null`
 * removes), T2 unused, the two counters.
 */
export function indexes({
  papp = 850,
  base = 50_670_371,
  t1 = {},
  t2 = {},
  c1 = 70_371,
  c2 = 21_792_980,
} = {}) {
  const body = {
    product: 'Eco-devices',
    T1_PTEC: 'TH..',
    T1_PAPP: papp,
    T1_BASE: base,
    T2_PTEC: '----',
    T2_PAPP: 0,
    T2_BASE: 0,
    INDEX_C1: c1,
    INDEX_C2: c2,
  };
  for (const [prefix, extra] of [
    ['T1_', t1],
    ['T2_', t2],
  ]) {
    for (const [key, value] of Object.entries(extra)) {
      if (value === null) delete body[`${prefix}${key}`];
      else body[`${prefix}${key}`] = value;
    }
  }
  return body;
}

/** An off-peak/peak meter on T1 (no BASE key). */
export const hchp = ({ hc = 20_000_000, hp = 30_000_000, papp = 1200, ptec = 'HP..' } = {}) =>
  indexes({ papp, t1: { BASE: null, PTEC: ptec, HCHC: hc, HCHP: hp } });

/** A Tempo meter on T1 (as a Homey user shared it, values made up). */
export const tempo = (values = {}) =>
  indexes({
    papp: 160,
    t1: {
      BASE: null,
      PTEC: 'HPJB',
      BBRHCJB: 23_689_090,
      BBRHPJB: 1_083_914,
      BBRHCJW: 122_317,
      BBRHPJW: 266_143,
      BBRHCJR: 0,
      BBRHPJR: 0,
      DEMAIN: '----',
      ...values,
    },
  });

export const daily = ({ c1 = 135, c2 = 3960 } = {}) => ({
  product: 'Eco-devices',
  Day_C1: c1,
  Day_C2: c2,
});

export const json = (body, { status = 200, headers = {} } = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
