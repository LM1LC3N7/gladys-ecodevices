// -----------------------------------------------------------------------------
// The app against the SDK's fake Gladys, a scripted Eco-Devices and a virtual
// clock that moves at every read (1 µs), so that a decision reading the clock
// twice is caught.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { EcoDevicesApp } from '../../src/app.js';
import { buildDevice, COUNTER_ORDER, TELEINFO_ORDER } from '../../src/devices.js';
import { EcoDevicesClient } from '../../src/ecodevices/client.js';
import { createMemoryStore } from '../../src/store.js';
import { ADDRESS, NOW, daily, indexes, json } from '../fixtures/ecodevices.js';
import { createFetch, timeoutError } from './fakeNet.js';
import { createFakeClock } from './fakeTimers.js';

export const SELECTOR = 'ecodevices';
export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const D = (input) => `ext:${SELECTOR}:ecodevices:${input}`;
export const F = (input, key) => `${D(input)}:${key}`;
export const CONFIG = { address: ADDRESS };
export const WATER_GAS = {
  address: ADDRESS,
  c1_type: 'water',
  c1_unit: 'liter',
  c2_type: 'gas',
  c2_unit: 'liter',
};

/**
 * The device of an input as the user created it (every feature of its
 * kind, or `keys`), the index Gladys holds when given (`{ value, at }`).
 */
export function created(input = 't1', { keys, index, kind } = {}) {
  const gladys = createFakeGladys({ selector: SELECTOR });
  const all = input.startsWith('t') ? TELEINFO_ORDER : COUNTER_ORDER;
  const device = buildDevice(gladys, input, new Set(keys ?? all), { address: ADDRESS, kind });
  if (index) {
    const key = input.startsWith('t') ? 'consumption_index' : 'index';
    const feature = device.features.find((f) => f.external_id === F(input, key));
    feature.last_value = index.value;
    feature.last_value_changed = new Date(index.at).toISOString();
  }
  return device;
}

/** The answers of a default Eco-Devices, by path (with its query). */
export const defaults = {
  '/api/xdevices.json?cmd=10': () => indexes(),
  '/api/xdevices.json?cmd=20': () => daily(),
};

/**
 * The Eco-Devices: `world(path, t, init)` -> an answer object | 'timeout' |
 * a Response | undefined (404). A promise is awaited (a slow answer).
 */
export function createDevice(world = (path) => defaults[path]?.()) {
  const dev = { world, clock: { now: NOW } };
  dev.net = createFetch(async ({ path, init }) => {
    const answer = await dev.world(path, dev.clock.now, init);
    if (answer === 'timeout') throw timeoutError();
    if (answer instanceof Response) return answer;
    if (answer === undefined) return new Response('not found', { status: 404 });
    return json(answer);
  });
  return dev;
}

export async function setup({
  devices: known = [],
  store,
  now = NOW,
  dev = createDevice(),
  config = CONFIG,
  random,
  wall = { offset: 0 },
  connect = true,
} = {}) {
  const gladys = createFakeGladys({ selector: SELECTOR, config, devices: known });
  if (connect) await gladys.connect();
  const { clock, timers, advance, pending } = createFakeClock(now);
  let drift = 0;
  dev.clock = clock;
  const lines = [];
  const log = (...args) => lines.push(args.map(String).join(' '));
  const kept = store ?? createMemoryStore();
  const app = new EcoDevicesApp({
    gladys,
    logger: { lines, info: log, warn: log, error: log, debug: log },
    now: () => clock.now + wall.offset,
    monotonic: () => clock.now + (drift += 0.001),
    timers,
    store: kept,
    clientFactory: (options) => new EcoDevicesClient({ ...options, fetchImpl: dev.net.fetch }),
    ...(random ? { random } : {}),
  });
  const start = async (cfg = config) => {
    await app.start(cfg);
    await advance(0);
    await app.idle();
  };
  const wait = async (ms) => {
    await advance(ms);
    await app.idle();
  };
  /** The requests made to the Eco-Devices, by page. */
  const count = (cmd) =>
    dev.net.calls.filter((c) => c.path === `/api/xdevices.json?cmd=${cmd}`).length;
  return { app, gladys, clock, store: kept, dev, start, wait, advance, pending, lines, count };
}
