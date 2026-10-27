// -----------------------------------------------------------------------------
// The only network access: GET requests to the Eco-Devices, bounded, our error
// codes, the login only as HTTP Basic authentication.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EcoDevicesClient, basicAuth } from '../src/ecodevices/client.js';
import { daily, indexes, json } from './fixtures/ecodevices.js';
import { createFetch, refusedError, streamOf, timeoutError } from './helpers/fakeNet.js';

const client = (handler, login = null) => {
  const net = createFetch(handler);
  return {
    net,
    client: new EcoDevicesClient({ address: '192.168.1.20:8080', login, fetchImpl: net.fetch }),
  };
};

const codeOf = async (promise) => {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  assert.fail('expected an error');
};

test('GET of both pages of the JSON API, no redirect followed, a timeout, no login', async () => {
  const pages = {
    '/api/xdevices.json?cmd=10': indexes(),
    '/api/xdevices.json?cmd=20': daily(),
  };
  const { net, client: c } = client(({ path }) => json(pages[path]));
  assert.equal((await c.indexes()).teleinfo.t1.papp, 850);
  assert.equal((await c.daily()).c1, 135);
  assert.deepEqual(
    net.calls.map((call) => call.path),
    Object.keys(pages),
  );
  for (const call of net.calls) {
    assert.equal(call.host, '192.168.1.20:8080');
    assert.equal(call.init.method, 'GET');
    assert.equal(call.init.redirect, 'manual');
    assert.equal(call.init.headers.Accept, 'application/json');
    assert.ok(call.init.signal instanceof AbortSignal);
    assert.equal(call.init.headers['User-Agent'], undefined);
    assert.equal(call.init.headers.Authorization, undefined, 'no login, no header');
  }
});

test('the login: HTTP Basic, and nowhere in the client object nor the URL', async () => {
  const login = { username: 'admin', password: 'eco-secret-pw' };
  assert.equal(basicAuth(login), `Basic ${Buffer.from('admin:eco-secret-pw').toString('base64')}`);
  const { net, client: c } = client(() => json(indexes()), login);
  await c.indexes();
  assert.equal(net.calls[0].init.headers.Authorization, basicAuth(login));
  assert.equal(net.calls[0].host, '192.168.1.20:8080', 'never user:password@ in the URL');
  const shown = JSON.stringify(c) + Object.keys(c).join() + String(c);
  assert.ok(!shown.includes('eco-secret-pw'));
  assert.ok(!shown.includes(Buffer.from('admin:eco-secret-pw').toString('base64')));
});

test('our error codes, never a text of the device', async () => {
  const cases = [
    [() => json('nope', { status: 404 }), 'not_found'],
    [() => json('secret text', { status: 403 }), 'refused'],
    [() => json('secret text', { status: 401 }), 'refused'],
    [() => json('', { status: 302, headers: { location: 'http://elsewhere/' } }), 'redirect'],
    [() => json('', { status: 418 }), 'http'],
    [() => json('', { status: 500 }), 'server'],
    [() => json('', { status: 429, headers: { 'retry-after': '120' } }), 'rate_limited'],
    [() => new Response('<html>secret</html>'), 'not_json'],
    [() => json({ hello: 'world' }), 'unknown_answer'],
    [() => json({ product: 'EcoDevices RT2' }), 'unknown_answer'],
    [
      () => {
        throw timeoutError();
      },
      'timeout',
    ],
    [
      () => {
        throw refusedError();
      },
      'unreachable',
    ],
  ];
  for (const [handler, code] of cases) {
    const err = await codeOf(client(handler).client.indexes());
    assert.equal(err.code, code);
    assert.ok(!/secret|html|elsewhere|192\.168/.test(err.message), err.message);
  }
  const limited = await codeOf(
    client(() => json('', { status: 429, headers: { 'retry-after': '120' } })).client.indexes(),
  );
  assert.equal(limited.retryAfter, 120_000);
});

test('a hostile answer is cut at 16 KiB, before it is read in full', async () => {
  let pulled = 0;
  const body = streamOf(10_000, 1024);
  const reader = body.getReader();
  const counted = new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) return controller.close();
      pulled += 1;
      controller.enqueue(value);
    },
  });
  const err = await codeOf(client(() => new Response(counted, { status: 200 })).client.indexes());
  assert.equal(err.code, 'too_large');
  assert.ok(pulled < 40, `${pulled} chunks read`);
});

test('one request at a time', async () => {
  const { net, client: c } = client(() => json(indexes()));
  net.hold = true;
  const a = c.indexes();
  const b = c.daily();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(net.calls.length, 1);
  net.hold = false;
  net.release();
  await a;
  await b.catch(() => {});
  assert.equal(net.calls.length, 2);
});
