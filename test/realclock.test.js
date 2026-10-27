// -----------------------------------------------------------------------------
// The app on a REAL moving clock (performance.now, Date.now, setTimeout) and a
// real local HTTP server playing the Eco-Devices: the
// reads really start, at 0, the interval and twice the interval, with a
// bounded number of timers; the period is measured on the method that
// decides. Time sped up 20 times (15 s are 0.75 s), but the real clock: it
// moves between any two reads of it.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { createServer } from 'node:http';
import { EcoDevicesApp } from '../src/app.js';
import { POLL_INTERVAL } from '../src/constants.js';
import { createMemoryStore } from '../src/store.js';
import { daily, indexes } from './fixtures/ecodevices.js';
import { measurePeriod, realClock, spyOn } from './helpers/realclock.js';

const SPEED = 20;

test('real clock x20: reads at 0, the interval and twice the interval; timers bounded', async () => {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(req.url);
    const body = req.url.endsWith('cmd=20') ? daily() : indexes();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = `127.0.0.1:${server.address().port}`;
  const clock = realClock({ speed: SPEED });
  const gladys = createFakeGladys({ selector: 'ecodevices', config: {} });
  await gladys.connect();
  const quiet = () => {};
  const app = new EcoDevicesApp({
    gladys,
    logger: { info: quiet, warn: quiet, error: quiet, debug: quiet },
    now: clock.now,
    monotonic: clock.monotonic,
    timers: clock.timers,
    store: createMemoryStore(),
  });
  const spy = spyOn(app, 'poll', clock);
  try {
    await app.start({ address, c1_type: 'water' });
    await measurePeriod(spy, { count: 3, period: POLL_INTERVAL });
    await app.stop();
  } finally {
    clock.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  const reads = requests.filter((url) => url.endsWith('cmd=10')).length;
  assert.ok(reads >= 3 && reads <= 4, `${reads} reads`);
  assert.equal(requests.filter((url) => url.endsWith('cmd=20')).length, 1);
  assert.ok(clock.timersSet <= 12, `${clock.timersSet} timers`);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});
