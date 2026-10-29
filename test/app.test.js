// -----------------------------------------------------------------------------
// The app against the SDK's fake Gladys, a scripted Eco-Devices and a virtual
// clock that moves at every read: discovery, the pace, the guarded indexes,
// the accept button, the login, pauses, /data, freshness, late answers and the
// connection to Gladys.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { EcoDevicesApp } from '../src/app.js';
import { EcoDevicesClient } from '../src/ecodevices/client.js';
import { POLL_INTERVAL } from '../src/constants.js';
import { createMemoryStore } from '../src/store.js';
import { ADDRESS, NOW, daily, hchp, indexes, json, tempo } from './fixtures/ecodevices.js';
import {
  CONFIG,
  D,
  F,
  HOUR,
  MINUTE,
  SECOND,
  SELECTOR,
  WATER_GAS,
  createDevice,
  created,
  defaults,
  setup,
} from './helpers/app.js';
import { createFakeClock } from './helpers/fakeTimers.js';

const status = (gladys) => gladys.fake.connectionStatus;
const text = (gladys) => JSON.stringify(status(gladys).message ?? '');
const statesOf = (gladys, id) =>
  gladys.fake.states.filter((s) => s.device_feature_external_id === id);
const last = (gladys, id) => gladys.fake.lastState(id);

/** An Eco-Devices whose cmd=10 answer is `current()` (changed by the test). */
function scripted(initial = indexes()) {
  const box = { body: initial, dailyBody: daily() };
  const dev = createDevice((path) => {
    if (path.endsWith('cmd=10')) return typeof box.body === 'function' ? box.body() : box.body;
    if (path.endsWith('cmd=20'))
      return typeof box.dailyBody === 'function' ? box.dailyBody() : box.dailyBody;
    return undefined;
  });
  return { dev, box };
}

test('first read: discovery of the connected inputs only, status asks to create them', async () => {
  const { gladys, start, count } = await setup();
  await start();
  assert.equal(count(10), 1);
  assert.equal(count(20), 0, 'no counter set: the page of the day is never read');
  const devices = gladys.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((d) => d.external_id),
    [D('t1')],
  );
  assert.deepEqual(
    devices[0].features.map((f) => f.external_id),
    [F('t1', 'power'), F('t1', 'consumption_index'), F('t1', 'index_base')],
  );
  assert.equal(status(gladys).connected, true);
  assert.match(text(gladys), /Create the device of teleinfo 1/);
  assert.equal(gladys.fake.states.length, 0, 'nothing published before the device is created');
});

test('created teleinfo device: power in VA, index in kWh, tariff index; T2 never 0', async () => {
  const { gladys, start } = await setup({ devices: [created('t1')] });
  await start();
  assert.equal(last(gladys, F('t1', 'power')), 850);
  assert.equal(last(gladys, F('t1', 'consumption_index')), 50_670.371);
  assert.equal(last(gladys, F('t1', 'index_base')), 50_670.371);
  assert.ok(!gladys.fake.states.some((s) => s.device_feature_external_id.includes(':t2:')));
  assert.ok(!gladys.fake.states.some((s) => s.state === 0));
  assert.doesNotMatch(text(gladys), /Create the device/);
});

test('pace: one read every 15 s, never sooner, whatever asks (start, scan, created, test)', async () => {
  const { app, gladys, start, wait, count } = await setup({ devices: [created('t1')] });
  await start();
  assert.equal(count(10), 1);
  await start();
  await gladys.fake.scanRequest();
  await app.onDeviceUpdated({ external_id: D('t1') });
  await app.testConnection();
  await wait(5 * SECOND);
  assert.equal(count(10), 1, 'a start, a scan, the test button never read sooner');
  await wait(10 * SECOND);
  assert.equal(count(10), 2);
  await wait(POLL_INTERVAL);
  assert.equal(count(10), 3);
});

test('pace across a restart: the time of the last read is in /data before the request', async () => {
  const store = createMemoryStore();
  const first = await setup({ store, devices: [created('t1')] });
  await first.start();
  assert.equal(first.count(10), 1);
  assert.ok(Number.isFinite(store.data.lastAttemptAt));
  // A new container 5 s later, same /data.
  const dev = createDevice();
  const again = await setup({ store, dev, now: NOW + 5 * SECOND, devices: [created('t1')] });
  await again.start();
  assert.equal(again.count(10), 0, 'not before the interval');
  await again.wait(10 * SECOND);
  assert.equal(again.count(10), 1);
});

test('indexes once a minute, power at every read', async () => {
  const { box, dev } = scripted();
  let base = 50_670_371;
  let papp = 800;
  box.body = () => indexes({ base: (base += 10), papp: (papp += 10) });
  const { gladys, start, wait } = await setup({ dev, devices: [created('t1')] });
  await start();
  await wait(POLL_INTERVAL);
  await wait(POLL_INTERVAL);
  assert.equal(statesOf(gladys, F('t1', 'power')).length, 3);
  assert.equal(statesOf(gladys, F('t1', 'consumption_index')).length, 1);
  await wait(POLL_INTERVAL);
  await wait(POLL_INTERVAL);
  assert.equal(statesOf(gladys, F('t1', 'consumption_index')).length, 2);
});

test('a drop is held, never accepted: the last value is sent again, the status says how out', async () => {
  const { box, dev } = scripted();
  const { app, gladys, start, wait, store } = await setup({ dev, devices: [created('t1')] });
  await start();
  box.body = indexes({ base: 1_000 });
  await wait(MINUTE);
  assert.equal(last(gladys, F('t1', 'consumption_index')), 50_670.371);
  assert.ok(!gladys.fake.states.some((s) => s.state === 1));
  assert.match(text(gladys), /Consumption index DROP held, never accepted/);
  assert.match(text(gladys), /teleinfo 1 dropped from 50670.371 to 1 kWh/);
  assert.match(text(gladys), /change of tariff option/);
  assert.match(text(gladys), /more than 5000 states/);
  assert.match(JSON.stringify(status(gladys).message.fr), /BAISSE d’index de consommation retenue/);
  assert.equal(store.data.indexes.t1.held.direction, 'down');
  const badge = gladys.fake.transports.at(-1);
  assert.equal(badge.degraded, true);
  assert.match(badge.message.en, /never accepted/);
  const first = await app.acceptHeldIndex();
  assert.match(first.en, /Only teleinfo drops are held/);
  await wait(5 * SECOND);
  const second = await app.acceptHeldIndex();
  assert.match(second.en, /Only teleinfo drops are held/);
  await wait(MINUTE);
  assert.equal(last(gladys, F('t1', 'consumption_index')), 50_670.371, 'never taken');
});

test('a jump is held; two clicks take it, bounded to what the first listed', async () => {
  const { box, dev } = scripted();
  const { app, gladys, start, wait } = await setup({ dev, devices: [created('t1')] });
  await start();
  box.body = indexes({ base: 60_670_371 });
  await wait(MINUTE);
  assert.equal(last(gladys, F('t1', 'consumption_index')), 50_670.371);
  assert.match(text(gladys), /jumped from 50670.371 to 60670.371 kWh/);
  const first = await app.acceptHeldIndex();
  assert.match(first.en, /A second click accepts these values/);
  await wait(1 * SECOND);
  const tooSoon = await app.acceptHeldIndex();
  assert.match(tooSoon.en, /A second click/, 'a double click lists again, takes nothing');
  await wait(5 * SECOND);
  const done = await app.acceptHeldIndex();
  assert.match(done.en, /Accepted: teleinfo 1, index 60670.371 kWh/);
  await wait(MINUTE);
  assert.equal(last(gladys, F('t1', 'consumption_index')), 60_670.371);
  assert.doesNotMatch(text(gladys), /held back/);
});

test('a jump accepted, then the index back near the reference: held as a jump, two clicks take it', async () => {
  const { box, dev } = scripted();
  const { app, gladys, start, wait, store } = await setup({ dev, devices: [created('t1')] });
  await start();
  box.body = indexes({ base: 60_670_371 });
  await wait(MINUTE);
  await app.acceptHeldIndex();
  await wait(5 * SECOND);
  const done = await app.acceptHeldIndex();
  assert.match(done.en, /Accepted: teleinfo 1, index 60670.371 kWh/);
  // Back before the next read, just above the reference: never a drop, never published.
  box.body = indexes({ base: 50_670_500 });
  await wait(MINUTE);
  assert.equal(last(gladys, F('t1', 'consumption_index')), 50_670.371);
  assert.equal(store.data.indexes.t1.held.direction, 'up');
  assert.match(text(gladys), /jumped from 50670.371 to 50670.5 kWh/);
  assert.doesNotMatch(text(gladys), /DROP/);
  const first = await app.acceptHeldIndex();
  assert.match(first.en, /A second click accepts these values/);
  await wait(5 * SECOND);
  const again = await app.acceptHeldIndex();
  assert.match(again.en, /Accepted: teleinfo 1, index 50670.5 kWh/);
  await wait(MINUTE);
  assert.equal(last(gladys, F('t1', 'consumption_index')), 50_670.5);
  assert.doesNotMatch(text(gladys), /held back/);
});

test('a jump held back under an accepted jump: the index moving between the two clicks does not refuse the second', async () => {
  const { box, dev } = scripted();
  const { app, start, wait } = await setup({ dev, devices: [created('t1')] });
  await start();
  box.body = indexes({ base: 60_670_371 });
  await wait(MINUTE);
  await app.acceptHeldIndex();
  await wait(5 * SECOND);
  await app.acceptHeldIndex();
  box.body = indexes({ base: 50_670_500 });
  await wait(MINUTE);
  const first = await app.acceptHeldIndex();
  assert.match(first.en, /A second click accepts these values/);
  // The household draws: the index moves at every minute, still under the accepted jump.
  box.body = indexes({ base: 50_670_508 });
  await wait(MINUTE);
  box.body = indexes({ base: 50_670_516 });
  await wait(2 * MINUTE);
  await wait(80 * SECOND);
  const again = await app.acceptHeldIndex();
  assert.match(again.en, /Accepted: teleinfo 1, index 50670.516 kWh/);
});

test('a jump that grows beyond the margin after the first click is not taken', async () => {
  const { box, dev } = scripted();
  const { app, gladys, start, wait } = await setup({ dev, devices: [created('t1')] });
  await start();
  box.body = indexes({ base: 60_670_371 });
  await wait(MINUTE);
  await app.acceptHeldIndex();
  box.body = indexes({ base: 90_670_371 });
  await wait(MINUTE);
  const done = await app.acceptHeldIndex();
  assert.doesNotMatch(done.en, /Accepted/);
  await wait(MINUTE);
  assert.equal(last(gladys, F('t1', 'consumption_index')), 50_670.371);
});

test('a save of the form never accepts a held index', async () => {
  const { box, dev } = scripted();
  const { gladys, start, wait } = await setup({ dev, devices: [created('t1')] });
  await start();
  box.body = indexes({ base: 60_670_371 });
  await wait(MINUTE);
  await gladys.fake.configUpdated(CONFIG);
  await wait(MINUTE);
  await wait(MINUTE);
  assert.equal(last(gladys, F('t1', 'consumption_index')), 50_670.371);
});

test('a held value survives a restart (kept in /data)', async () => {
  const store = createMemoryStore();
  const { box, dev } = scripted();
  const a = await setup({ store, dev, devices: [created('t1')] });
  await a.start();
  box.body = indexes({ base: 1_000 });
  await a.wait(MINUTE);
  await a.app.stop();
  const b = await setup({ store, dev, now: NOW + 2 * HOUR, devices: [created('t1')] });
  await b.start();
  await b.wait(MINUTE);
  assert.ok(!b.gladys.fake.states.some((s) => s.state === 1));
  assert.match(text(b.gladys), /dropped/);
});

test('off-peak/peak: a glitch of one index sends no total; the tariffs follow the total', async () => {
  const { box, dev } = scripted(hchp());
  const { gladys, start, wait } = await setup({ dev, devices: [created('t1')] });
  await start();
  assert.equal(last(gladys, F('t1', 'consumption_index')), 50_000);
  assert.equal(last(gladys, F('t1', 'index_hchc')), 20_000);
  assert.equal(last(gladys, F('t1', 'index_hchp')), 30_000);
  box.body = hchp({ hc: 0, hp: 30_000_500 });
  await wait(MINUTE);
  assert.equal(statesOf(gladys, F('t1', 'consumption_index')).length, 1, 'no total this time');
  assert.match(text(gladys), /no complete tariff index/);
  assert.ok(!gladys.fake.states.some((s) => s.state === 0));
  box.body = hchp({ hc: 20_000_100, hp: 30_000_500 });
  await wait(MINUTE);
  assert.equal(last(gladys, F('t1', 'consumption_index')), 50_000.6);
});

test('Tempo: six indexes, a red one at 0 is never published', async () => {
  const { dev } = scripted(tempo());
  const { gladys, start } = await setup({ dev, devices: [created('t1')] });
  await start();
  assert.equal(last(gladys, F('t1', 'consumption_index')), 25_161.464);
  assert.equal(last(gladys, F('t1', 'index_bbrhcjb')), 23_689.09);
  assert.equal(statesOf(gladys, F('t1', 'index_bbrhcjr')).length, 0);
});

test('two options at once: no index, a note; the power goes on', async () => {
  const { dev } = scripted(indexes({ t1: { HCHC: 5 } }));
  const { gladys, start } = await setup({ dev, devices: [created('t1')] });
  await start();
  assert.equal(statesOf(gladys, F('t1', 'consumption_index')).length, 0);
  assert.equal(last(gladys, F('t1', 'power')), 850);
  assert.match(text(gladys), /two tariff options/);
});

test('pulse counters: water in litres, gas in m³; index and today in m³', async () => {
  const devices = [created('c1', { kind: 'water' }), created('c2', { kind: 'gas' })];
  const config = { ...WATER_GAS, c2_unit: 'cubic_meter' };
  const { gladys, start, count } = await setup({ devices, config });
  await start(config);
  assert.equal(count(20), 1);
  assert.equal(last(gladys, F('c1', 'index')), 70.371);
  assert.equal(last(gladys, F('c1', 'today')), 0.135);
  assert.equal(last(gladys, F('c2', 'index')), 21_792_980);
  assert.equal(last(gladys, F('c2', 'today')), 3960);
  const names = gladys.fake.discoveredDevices.map((d) => d.name);
  assert.ok(names.includes('Eco-Devices counter 1 (water)'));
  assert.ok(names.includes('Eco-Devices counter 2 (gas)'));
});

test('a counter not set is never offered; its index shows a note', async () => {
  const { gladys, start } = await setup();
  await start();
  assert.ok(!gladys.fake.discoveredDevices.some((d) => d.external_id === D('c1')));
  assert.match(text(gladys), /counter 1, counter 2 counts pulses but is not set/);
});

test('the page of the day failing (500, 401, timeout) never holds the indexes, never refuses', async () => {
  for (const failure of [
    () => json('', { status: 500 }),
    () => json('', { status: 401 }),
    () => 'timeout',
  ]) {
    const { box, dev } = scripted();
    box.dailyBody = failure;
    const devices = [created('t1'), created('c1', { kind: 'water' })];
    const { gladys, start, wait, count } = await setup({ dev, devices, config: WATER_GAS });
    await start(WATER_GAS);
    assert.equal(last(gladys, F('t1', 'consumption_index')), 50_670.371);
    assert.equal(last(gladys, F('c1', 'index')), 70.371);
    assert.equal(statesOf(gladys, F('c1', 'today')).length, 0);
    assert.equal(status(gladys).connected, true);
    assert.match(text(gladys), /consumption of the day could not be read/);
    assert.doesNotMatch(text(gladys), /refuses/);
    await wait(4 * MINUTE);
    assert.equal(count(20), 1, 'tried again after 5 min');
    await wait(2 * MINUTE);
    assert.equal(count(20), 2);
    await wait(8 * MINUTE);
    assert.equal(count(20), 2, 'then after 10 min');
    await wait(3 * MINUTE);
    assert.equal(count(20), 3);
    assert.ok(count(10) > 40, 'the indexes go on');
  }
});

test('a login refused on cmd=10 is final: kept in /data, no retry, a restart keeps it', async () => {
  const store = createMemoryStore();
  const dev = createDevice(() => json('', { status: 401 }));
  const config = { ...CONFIG, username: 'admin', password: 'eco-secret-pw' };
  const a = await setup({ store, dev, config });
  await a.start(config);
  assert.equal(status(a.gladys).connected, false);
  assert.match(text(a.gladys), /refuses this login: reads stopped/);
  await a.wait(HOUR);
  assert.equal(a.count(10), 1);
  await a.start(config);
  await a.wait(HOUR);
  assert.equal(a.count(10), 1, 'a save of the same login does not try again');
  assert.ok(!JSON.stringify(store.data).includes('eco-secret-pw'));
  const b = await setup({ store, dev, config, now: NOW + 3 * HOUR });
  await b.start(config);
  await b.wait(HOUR);
  assert.equal(b.count(10), 1, 'a restart does not try again');
  // Another password: tried at once.
  dev.world = (path) => defaults[path]?.();
  await b.start({ ...config, password: 'other' });
  assert.equal(b.count(10), 2);
  assert.equal(status(b.gladys).connected, true);
});

test('the test button tries a refused login once; a success lifts it', async () => {
  const dev = createDevice(() => json('', { status: 403 }));
  const config = { ...CONFIG, username: 'admin', password: 'pw' };
  const { app, gladys, start, wait, count } = await setup({ dev, config });
  await start(config);
  await wait(MINUTE);
  dev.world = (path) => defaults[path]?.();
  const answer = await app.testConnection();
  assert.match(answer.en, /Read now/);
  assert.equal(count(10), 2);
  await wait(POLL_INTERVAL);
  assert.equal(count(10), 3);
  assert.equal(status(gladys).connected, true);
});

test('429/5xx of cmd=10: a pause kept in /data, across a restart', async () => {
  const store = createMemoryStore();
  const dev = createDevice(() => json('', { status: 503, headers: { 'retry-after': '600' } }));
  const a = await setup({ store, dev });
  await a.start();
  assert.match(text(a.gladys), /asks to wait/);
  await a.wait(5 * MINUTE);
  assert.equal(a.count(10), 1);
  await a.app.stop();
  const b = await setup({ store, dev, now: NOW + 5 * MINUTE });
  await b.start();
  await b.wait(4 * MINUTE);
  assert.equal(b.count(10), 1, 'the pause survives the restart');
  await b.wait(2 * MINUTE);
  assert.equal(b.count(10), 2);
});

test('unreachable: retries doubled from 15 s, status says so', async () => {
  const dev = createDevice(() => 'timeout');
  const { gladys, start, wait, count } = await setup({ dev });
  await start();
  assert.match(text(gladys), /could not be read \(no answer\): new try in 15 s/);
  await wait(15 * SECOND);
  assert.equal(count(10), 2);
  await wait(29 * SECOND);
  assert.equal(count(10), 2);
  await wait(1 * SECOND);
  assert.equal(count(10), 3);
});

test('getConfig failing in connected: tried again without end, status exact, then reads', async () => {
  const dev = createDevice();
  const gladys = createFakeGladys({ selector: SELECTOR, config: CONFIG });
  await gladys.connect();
  const { clock, timers, advance } = createFakeClock(NOW);
  let drift = 0;
  dev.clock = clock;
  const app = new EcoDevicesApp({
    gladys,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    now: () => clock.now,
    // Moves at every read, as a real clock.
    monotonic: () => clock.now + (drift += 0.001),
    timers,
    store: createMemoryStore(),
    clientFactory: (o) => new EcoDevicesClient({ ...o, fetchImpl: dev.net.fetch }),
  });
  let fails = 2;
  const getConfig = async () => {
    if (fails > 0) {
      fails -= 1;
      throw new Error('socket closed');
    }
    return CONFIG;
  };
  await app.connected(getConfig);
  assert.equal(status(gladys).connected, false);
  assert.match(
    text(gladys),
    /configuration of the integration could not be read from Gladys: new try in 5 s/,
  );
  await advance(5 * SECOND);
  await app.idle();
  assert.match(text(gladys), /new try in 10 s/);
  assert.equal(dev.net.calls.length, 0);
  await advance(10 * SECOND);
  await app.idle();
  await advance(0);
  await app.idle();
  assert.equal(dev.net.calls.length, 1);
  assert.equal(status(gladys).connected, true);
});

test('getConfig failing: a disconnection ends the retries', async () => {
  const { app, advance, pending } = await setup({ connect: true });
  let calls = 0;
  await app.connected(async () => {
    calls += 1;
    throw new Error('down');
  });
  await app.disconnected();
  await advance(HOUR);
  assert.equal(calls, 1);
  assert.equal(pending.size, 0);
});

test('/data unreadable: never overwritten, no index published, the power goes on', async () => {
  const store = createMemoryStore({ marker: 'kept' });
  store.broken = true;
  const { gladys, start, wait, lines } = await setup({ store, devices: [created('t1')] });
  await start();
  assert.equal(last(gladys, F('t1', 'power')), 850);
  assert.equal(statesOf(gladys, F('t1', 'consumption_index')).length, 0);
  assert.equal(store.saves, 0);
  assert.match(text(gladys), /state file in \/data cannot be read/);
  assert.ok(lines.some((l) => /cannot be read/.test(l)));
  store.broken = false;
  await wait(MINUTE);
  assert.equal(last(gladys, F('t1', 'consumption_index')), 50_670.371);
  assert.ok(store.saves > 0);
});

test('a save that fails sends no index (Gladys never gets an index /data does not know)', async () => {
  const store = createMemoryStore();
  store.failSave = true;
  const { gladys, start, wait } = await setup({ store, devices: [created('t1')] });
  await start();
  assert.equal(statesOf(gladys, F('t1', 'consumption_index')).length, 0);
  assert.equal(last(gladys, F('t1', 'power')), 850);
  assert.match(text(gladys), /cannot be written/);
  store.failSave = false;
  await wait(MINUTE);
  assert.equal(last(gladys, F('t1', 'consumption_index')), 50_670.371);
});

test('frozen values (cable out) for 15 min: the power is no longer sent, even after a restart', async () => {
  const store = createMemoryStore();
  const a = await setup({ store, devices: [created('t1')] });
  await a.start();
  await a.wait(14 * MINUTE);
  const before = statesOf(a.gladys, F('t1', 'power')).length;
  await a.wait(2 * MINUTE);
  assert.match(text(a.gladys), /have not changed for 15 min/);
  const after = statesOf(a.gladys, F('t1', 'power')).length;
  await a.wait(30 * MINUTE);
  assert.equal(statesOf(a.gladys, F('t1', 'power')).length, after);
  assert.ok(before > 0);
  await a.app.stop();
  const b = await setup({ store, now: a.clock.now + MINUTE, devices: [created('t1')] });
  await b.start();
  assert.equal(statesOf(b.gladys, F('t1', 'power')).length, 0, 'the age survives a restart');
});

test('a late answer of an old address publishes nothing and sets no status', async () => {
  let release;
  const dev = createDevice((path) => {
    if (path.endsWith('cmd=10') && !release) {
      return new Promise((resolve) => {
        release = () => resolve(indexes({ papp: 4242 }));
      });
    }
    return defaults[path]?.();
  });
  const { app, gladys, advance } = await setup({ dev, devices: [created('t1')] });
  await app.start(CONFIG);
  const running = advance(0);
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  await app.start({ address: '192.168.1.21' });
  const statuses = gladys.fake.connectionStatuses.length;
  release();
  await running;
  await app.idle();
  assert.ok(!gladys.fake.states.some((s) => s.state === 4242));
  assert.equal(gladys.fake.connectionStatuses.length, statuses, 'no status from the old read');
});

test('a device created clears the index state of its input (no history counted twice)', async () => {
  const { box, dev } = scripted();
  const { app, gladys, start, wait, store } = await setup({ dev, devices: [created('t1')] });
  await start();
  box.body = indexes({ base: 1_000 });
  await wait(MINUTE);
  assert.ok(store.data.indexes.t1.held);
  gladys.fake.devices = [created('t1')];
  await app.onDeviceCreated({ external_id: D('t1') });
  assert.equal(store.data.indexes.t1, undefined);
  await wait(MINUTE);
  assert.equal(last(gladys, F('t1', 'consumption_index')), 1);
});

test('the secret never reaches the logs, /data, statuses nor states', async () => {
  const config = { ...CONFIG, username: 'admin', password: 'eco-secret-pw' };
  const dev = createDevice((path, t, init) =>
    init.headers.Authorization ? defaults[path]?.() : json('', { status: 401 }),
  );
  const { app, gladys, start, wait, store, lines } = await setup({
    dev,
    config,
    devices: [created('t1')],
  });
  await start(config);
  await wait(MINUTE);
  await app.testConnection();
  const seen = JSON.stringify([
    lines,
    store.data,
    gladys.fake.connectionStatuses,
    gladys.fake.states,
  ]);
  assert.ok(!seen.includes('eco-secret-pw'));
  assert.ok(!seen.includes(Buffer.from('admin:eco-secret-pw').toString('base64')));
});

test('a reconnection: status and discovery again, no value of before republished as new', async () => {
  const { app, gladys, start, wait } = await setup({ devices: [created('t1')] });
  await start();
  const states = gladys.fake.states.length;
  await wait(2 * SECOND);
  await app.connected(async () => CONFIG);
  await app.idle();
  assert.equal(gladys.fake.states.length, states, 'nothing published until the next read');
  await wait(POLL_INTERVAL);
  assert.ok(gladys.fake.states.length > states);
});

test('the test button: tells the last read with the index sent or held', async () => {
  const devices = [created('t1'), created('c1', { kind: 'water' })];
  const { app, start } = await setup({ devices, config: WATER_GAS });
  await start(WATER_GAS);
  const answer = await app.testConnection();
  assert.match(answer.en, /Last read .* ago: Eco-Devices, teleinfo 1 850 VA, index 50670.371 kWh/);
  assert.match(answer.fr, /compteur 1 index 70.371 m³/);
  assert.match(answer.en, /Next read in/);
});

test('a counter drop (index corrected on the Eco-Devices) is taken in two clicks, bounded', async () => {
  const { box, dev } = scripted();
  const devices = [created('c1', { kind: 'water' })];
  const { app, gladys, start, wait, lines } = await setup({ dev, devices, config: WATER_GAS });
  await start(WATER_GAS);
  box.body = indexes({ c1: 60_000 });
  await wait(MINUTE);
  assert.equal(last(gladys, F('c1', 'index')), 70.371);
  assert.match(text(gladys), /counter 1 dropped from 70.371 to 60 m³/);
  assert.doesNotMatch(text(gladys), /would be counted/);
  await wait(10 * MINUTE);
  assert.equal(lines.filter((l) => /c1 index drop held back/.test(l)).length, 1, 'one log line');
  assert.match((await app.acceptHeldIndex()).en, /A second click accepts these values/);
  await wait(5 * SECOND);
  assert.match((await app.acceptHeldIndex()).en, /Accepted: counter 1, index 60 m³/);
  await wait(MINUTE);
  assert.equal(last(gladys, F('c1', 'index')), 60);
});

test('a counter drop that moves on beyond the margin after the first click is not taken', async () => {
  const { box, dev } = scripted();
  const devices = [created('c1', { kind: 'water' })];
  const { app, gladys, start, wait } = await setup({ dev, devices, config: WATER_GAS });
  await start(WATER_GAS);
  box.body = indexes({ c1: 60_000 });
  await wait(MINUTE);
  await app.acceptHeldIndex();
  box.body = indexes({ c1: 30_000 });
  await wait(MINUTE);
  assert.doesNotMatch((await app.acceptHeldIndex()).en, /Accepted/);
  await wait(MINUTE);
  assert.equal(last(gladys, F('c1', 'index')), 70.371);
});

test('the unit of a counter corrected (m³ to litres, and back): the reference follows', async () => {
  const { box, dev } = scripted();
  box.body = indexes({ c1: 123_456 });
  const devices = [created('c1', { kind: 'water' })];
  const m3 = { ...WATER_GAS, c1_unit: 'cubic_meter' };
  const { gladys, start, wait, app } = await setup({ dev, devices, config: m3 });
  await start(m3);
  assert.equal(last(gladys, F('c1', 'index')), 123_456);
  await app.configUpdated(WATER_GAS);
  await wait(MINUTE);
  assert.equal(last(gladys, F('c1', 'index')), 123.456, 'no drop held');
  assert.doesNotMatch(text(gladys), /held/);
  box.body = indexes({ c1: 123_500 });
  await wait(MINUTE);
  assert.equal(last(gladys, F('c1', 'index')), 123.5);
  // Back to m³ (the same raw index read in m³ again): no jump held either.
  await app.configUpdated(m3);
  await wait(MINUTE);
  assert.equal(last(gladys, F('c1', 'index')), 123_500);
  assert.doesNotMatch(text(gladys), /held/);
});

test('the guard limits follow the kind of counter: water 10 m³/h, gas 16 m³/h', async () => {
  const { box, dev } = scripted(indexes({ c1: 1_000_000, c2: 1_000_000 }));
  const devices = [created('c1', { kind: 'water' }), created('c2', { kind: 'gas' })];
  const { gladys, start, wait } = await setup({ dev, devices, config: WATER_GAS });
  await start(WATER_GAS);
  // 0.3 m³ in a minute: 18 m³/h, too much for water (10), too much for gas (16)?
  // Gas: 16/60 + 0.05 = 0.317 m³; water: 10/60 + 0.05 = 0.217 m³; electricity limits would take 2.17.
  box.body = indexes({ c1: 1_000_300, c2: 1_000_300 });
  await wait(MINUTE);
  assert.equal(last(gladys, F('c1', 'index')), 1000, 'water: held');
  assert.equal(last(gladys, F('c2', 'index')), 1000.3, 'gas: taken');
});

test('the second click refuses a jump whose threshold changed, even back near the listed value', async () => {
  const { box, dev } = scripted();
  const { app, gladys, start, wait } = await setup({ dev, devices: [created('t1')] });
  await start();
  box.body = indexes({ base: 60_670_371 });
  await wait(MINUTE);
  await app.acceptHeldIndex();
  box.body = indexes({ base: 55_670_371 });
  await wait(MINUTE);
  box.body = indexes({ base: 60_670_400 });
  await wait(MINUTE);
  const done = await app.acceptHeldIndex();
  assert.doesNotMatch(done.en, /Accepted/);
  await wait(MINUTE);
  assert.equal(last(gladys, F('t1', 'consumption_index')), 50_670.371);
});

test('a device created again while the integration was away starts from an empty reference', async () => {
  const store = createMemoryStore();
  const { box, dev } = scripted();
  const a = await setup({ store, dev, devices: [created('t1')] });
  await a.start();
  box.body = indexes({ base: 1_000 });
  await a.wait(MINUTE);
  assert.equal(store.data.indexes.t1.device, 'device-t1-1');
  // (C) deleted and created again during a disconnection: no event reached the app.
  await a.app.disconnected();
  await a.gladys.disconnect();
  a.gladys.fake.devices = [created('t1', { id: 'device-t1-2' })];
  // The SDK reads the devices again at the reconnection (no device-created event).
  await a.gladys.connect();
  await a.app.connected(async () => CONFIG);
  await a.wait(MINUTE);
  assert.equal(last(a.gladys, F('t1', 'consumption_index')), 1);
  assert.doesNotMatch(text(a.gladys), /DROP/);
  await a.app.stop();
  // (D) the same across a restart of the container.
  box.body = indexes({ base: 50_670_371 });
  const store2 = createMemoryStore();
  const b1 = await setup({ store: store2, dev, devices: [created('t1')] });
  await b1.start();
  box.body = indexes({ base: 1_000 });
  await b1.wait(MINUTE);
  await b1.app.stop();
  const b2 = await setup({
    store: store2,
    dev,
    now: b1.clock.now + HOUR,
    devices: [created('t1', { id: 'device-t1-9' })],
  });
  await b2.start();
  assert.equal(last(b2.gladys, F('t1', 'consumption_index')), 1);
});

test('a device deleted: the index state of its input goes with it', async () => {
  const { box, dev } = scripted();
  const { app, gladys, start, wait, store } = await setup({ dev, devices: [created('t1')] });
  await start();
  box.body = indexes({ base: 1_000 });
  await wait(MINUTE);
  gladys.fake.devices = [];
  await app.onDeviceDeleted({ external_id: D('t1') });
  assert.equal(store.data.indexes.t1, undefined);
  assert.doesNotMatch(text(gladys), /DROP/);
});

test('a key of the option missing from the answer: its own note with the key names, no index', async () => {
  const { dev } = scripted(hchp());
  dev.world = (path) =>
    path.endsWith('cmd=10') ? indexes({ t1: { BASE: null, HCHC: 20_000_000 } }) : daily();
  const { gladys, start, lines } = await setup({ dev });
  await start();
  assert.match(text(gladys), /teleinfo 1: the answer gives no HCHP/);
  assert.doesNotMatch(text(gladys), /this time/);
  assert.ok(lines.some((l) => /gives no HCHP/.test(l)));
  const [device] = gladys.fake.discoveredDevices;
  assert.ok(!device.features.some((f) => f.external_id === F('t1', 'consumption_index')));
});

test('"----" with an index still there: the power is unknown, never 0 VA', async () => {
  const { dev } = scripted(indexes({ papp: 0, t1: { PTEC: '----' } }));
  const { gladys, start } = await setup({ dev, devices: [created('t1')] });
  await start();
  assert.equal(statesOf(gladys, F('t1', 'power')).length, 0);
  assert.equal(last(gladys, F('t1', 'consumption_index')), 50_670.371);
});

test('a slow page of the day never delays the indexes', async () => {
  let release;
  const { box, dev } = scripted();
  box.dailyBody = () =>
    new Promise((resolve) => {
      release = () => resolve(daily());
    });
  const devices = [created('t1'), created('c1', { kind: 'water' })];
  const { app, gladys, advance } = await setup({ dev, devices, config: WATER_GAS });
  await app.start(WATER_GAS);
  const running = advance(0);
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(last(gladys, F('t1', 'consumption_index')), 50_670.371);
  assert.equal(last(gladys, F('c1', 'index')), 70.371);
  release();
  await running;
  await app.idle();
  assert.equal(last(gladys, F('c1', 'today')), 0.135);
});

test('a water jump beyond 10 m³/h is held', async () => {
  const { box, dev } = scripted();
  const devices = [created('c1', { kind: 'water' })];
  const { gladys, start, wait } = await setup({ dev, devices, config: WATER_GAS });
  await start(WATER_GAS);
  box.body = indexes({ c1: 70_371 + 1_000_000 });
  await wait(MINUTE);
  assert.equal(last(gladys, F('c1', 'index')), 70.371);
  assert.match(text(gladys), /counter 1 jumped/);
  box.body = indexes({ c1: 70_371 + 100 });
  await wait(MINUTE);
  assert.equal(last(gladys, F('c1', 'index')), 70.471, 'back to a plausible value');
});

test('scene on many slow reads never doubles a read (one request in flight)', async () => {
  let inflight = 0;
  let peak = 0;
  const dev = createDevice(async (path) => {
    inflight += 1;
    peak = Math.max(peak, inflight);
    await new Promise((resolve) => setImmediate(resolve));
    inflight -= 1;
    return defaults[path]?.();
  });
  const { app, start, wait } = await setup({ dev, config: WATER_GAS, devices: [created('t1')] });
  await start(WATER_GAS);
  await Promise.all([app.testConnection(), app.scan(), app.testConnection()]);
  await wait(MINUTE);
  assert.equal(peak, 1);
});

test('the address of the Eco-Devices is only a param: another address keeps the devices', async () => {
  const { app, gladys, start } = await setup({ devices: [created('t1')] });
  await start();
  await app.start({ address: '192.168.1.99' });
  await app.idle();
  const [device] = gladys.fake.discoveredDevices;
  assert.equal(device.external_id, D('t1'));
  assert.deepEqual(device.params.find((p) => p.name === 'address').value, '192.168.1.99');
  assert.ok(ADDRESS);
});
