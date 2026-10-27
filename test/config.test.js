import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isComplete, normalizeConfig, parseAddress } from '../src/config.js';

test('addresses: IP, host, port, pasted URL; refused forms', () => {
  assert.deepEqual(parseAddress('192.168.1.20'), { address: '192.168.1.20' });
  assert.deepEqual(parseAddress(' http://192.168.1.20:80/index.htm '), { address: '192.168.1.20' });
  assert.deepEqual(parseAddress('ecodevices.lan:8080'), { address: 'ecodevices.lan:8080' });
  assert.deepEqual(parseAddress('fe80::1'), { address: '[fe80::1]' });
  assert.deepEqual(parseAddress(''), { address: '' });
  for (const bad of [
    'admin:pw@192.168.1.20',
    'a b',
    'host:0',
    'host:70000',
    'bad_host',
    'x\r\ny',
  ]) {
    assert.deepEqual(parseAddress(bad), { error: 'invalid' }, bad);
  }
});

test('login: both or none; a password without a user is refused; no ":" nor control bytes', () => {
  assert.equal(normalizeConfig({ address: 'a' }).login, null);
  assert.deepEqual(normalizeConfig({ address: 'a', username: ' admin ', password: 'pw' }).login, {
    username: 'admin',
    password: 'pw',
  });
  for (const raw of [
    { password: 'pw' },
    { username: 'admin' },
    { username: 'ad:min', password: 'pw' },
    { username: 'admin', password: 'p\r\nw' },
    { username: 'admin', password: 'x'.repeat(65) },
  ]) {
    const config = normalizeConfig({ address: 'a', ...raw });
    assert.equal(config.invalidLogin, true, JSON.stringify(raw));
    assert.equal(config.login, null);
    assert.equal(isComplete(config), false);
  }
});

test('counters: water, gas or none, litres or m³; anything else is none / litres', () => {
  const config = normalizeConfig({
    address: 'a',
    c1_type: 'water',
    c1_unit: 'cubic_meter',
    c2_type: 'electricity',
    c2_unit: 'gallon',
  });
  assert.deepEqual(config.counters, {
    c1: { type: 'water', unit: 'cubic_meter' },
    c2: { type: 'none', unit: 'liter' },
  });
  assert.deepEqual(normalizeConfig().counters.c1, { type: 'none', unit: 'liter' });
});

test('a key prefixed gladys_ is never read', () => {
  assert.equal(normalizeConfig({ gladys_address: '192.168.1.20' }).address, '');
});

test('an address too long is refused before parsing', () => {
  const config = normalizeConfig({ address: 'a'.repeat(301) });
  assert.equal(config.address, '');
  assert.equal(config.invalidAddress, true);
});
