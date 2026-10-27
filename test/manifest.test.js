// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COUNTER_TYPES, COUNTER_UNITS } from '../src/config.js';
import { ACTIONS, INPUTS } from '../src/constants.js';
import { COUNTER_ORDER, TELEINFO_ORDER, buildDevice } from '../src/devices.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const index = read('index.js');
const dockerfile = read('Dockerfile');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, item] of node.entries()) {
      yield* texts(item, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

const fakeGladys = {
  externalIds: (type, id) => ({
    device: `ext:x:${type}:${id}`,
    feature: (key) => `ext:x:${type}:${id}:${key}`,
  }),
};

test('the store basics; one semver version in 4 places, never pinned here', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-ecodevices:${manifest.version}`);
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(pkg.name, 'gladys-ecodevices');
  assert.equal(pkg.license, 'Apache-2.0');
  assert.deepEqual(manifest.categories, ['energy']);
  assert.deepEqual(manifest.transports, ['local']);
  assert.equal(manifest.gladys_version, '>=5.1.0');
  assert.ok(!('keywords' in manifest) && !('countries' in manifest), 'in TODO.md for later');
  assert.match(
    manifest.cover_image,
    /^https:\/\/raw\.githubusercontent\.com\/LM1LC3N7\/gladys-ecodevices\//,
  );
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    assert.ok(read(`docs/${lang}.md`).length >= 300, `docs/${lang}.md is too short for the store`);
  }
  assert.match(manifest.description.en, /Unofficial/);
  assert.match(manifest.description.fr, /Non officiel/);
});

test('the cover is an 800 x 534 PNG', () => {
  const png = readFileSync(new URL('../cover.png', import.meta.url));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 800);
  assert.equal(png.readUInt32BE(20), 534);
});

test('the docs say it was never tested with a real Eco-Devices', () => {
  assert.match(read('docs/fr.md'), /[Jj]amais\s+testé\s+avec\s+un\s+vrai\s+Eco-Devices/);
  assert.match(read('docs/en.md'), /[Nn]ever\s+tested\s+with\s+a\s+real\s+Eco-Devices/);
  assert.match(read('README.md'), /[Nn]ever\s+tested\s+with\s+a\s+real\s+Eco-Devices/);
});

test('distinct from gladys-teleinfo (LiXee USB): said in the manifest and both docs', () => {
  assert.match(manifest.config_schema[0].description.en, /gladys-teleinfo/);
  assert.match(manifest.config_schema[0].description.fr, /gladys-teleinfo/);
  assert.match(read('docs/fr.md'), /gladys-teleinfo/);
  assert.match(read('docs/en.md'), /gladys-teleinfo/);
});

test('every text is in English and French; placeholders too', () => {
  for (const [path, text] of texts(manifest)) {
    for (const lang of ['en', 'fr']) {
      assert.ok(text[lang]?.trim(), `${path} needs ${lang}`);
    }
  }
  for (const field of manifest.config_schema) {
    if ('placeholder' in field) {
      assert.equal(typeof field.placeholder, 'object', `${field.key}.placeholder`);
    }
  }
});

test('the configuration matches the code: address, optional login, two counters', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  assert.deepEqual(Object.keys(fields), [
    'intro',
    'address',
    'username',
    'password',
    'c1_type',
    'c1_unit',
    'c2_type',
    'c2_unit',
  ]);
  for (const key of Object.keys(fields)) {
    assert.ok(!key.startsWith('gladys_'), `${key}: never prefixed gladys_`);
  }
  assert.equal(fields.address.type, 'string');
  assert.equal(fields.address.required, true);
  assert.equal(fields.username.type, 'string');
  assert.equal(fields.username.required, false);
  assert.equal(fields.password.type, 'secret');
  assert.equal(fields.password.required, false);
  for (const field of manifest.config_schema.filter((f) => f.type === 'secret')) {
    assert.ok(!('default' in field), `${field.key}: never a default on a secret`);
  }
  assert.match(fields.password.description.en, /Kept by Gladys in its database, never shown again/);
  assert.match(fields.password.description.fr, /Gardé par Gladys dans sa base, jamais réaffiché/);
  for (const n of [1, 2]) {
    assert.deepEqual(
      fields[`c${n}_type`].options.map((o) => o.value),
      COUNTER_TYPES,
    );
    assert.equal(fields[`c${n}_type`].default, 'none');
    assert.deepEqual(
      fields[`c${n}_unit`].options.map((o) => o.value),
      COUNTER_UNITS,
    );
    assert.equal(fields[`c${n}_unit`].default, 'liter');
  }
  for (const link of fields.intro.links) {
    assert.match(link.url, /^https:\/\//);
  }
});

test('the actions of the manifest are the handlers of the code; read-only', () => {
  assert.deepEqual(
    manifest.actions.map((a) => a.key),
    Object.values(ACTIONS),
  );
  assert.ok(index.includes('onAction(ACTIONS.TEST'));
  assert.ok(index.includes('onAction(ACTIONS.ACCEPT_HELD'));
  assert.ok(index.includes('onDeviceCreated'));
  assert.ok(index.includes("on('connected'"));
  assert.match(
    index,
    /\.connected\(\(\) => gladys\.getConfig\(\)\)/,
    'getConfig retried by the app',
  );
  assert.ok(!index.includes('onSetValue'), 'no command: read-only');
  const client = read('src/ecodevices/client.js');
  const code = client.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const word of ["'POST'", "'PUT'", "'DELETE'", 'https://', 'User-Agent', 'logger']) {
    assert.ok(!code.includes(word), `never ${word}`);
  }
});

test('the devices: core units only, one energy index per teleinfo input, nothing writable', () => {
  const units = {
    'energy-sensor': ['volt-ampere', 'kilowatt-hour'],
    'volume-sensor': ['cubicmeter'],
    unknown: [undefined],
  };
  for (const input of INPUTS) {
    const keys = new Set(input.startsWith('t') ? TELEINFO_ORDER : COUNTER_ORDER);
    const device = buildDevice(fakeGladys, input, keys, { address: '1.2.3.4', kind: 'water' });
    assert.equal(device.features.length, keys.size);
    for (const feature of device.features) {
      assert.ok(units[feature.category].includes(feature.unit), feature.external_id);
      assert.equal(feature.read_only, true);
      assert.notEqual(feature.category, 'switch');
      for (const option of feature.supported_options ?? []) {
        assert.equal(typeof option.label, 'string', 'supported_options[].label is a string');
      }
    }
    const indexes = device.features.filter((f) => ['index', 'energy'].includes(f.type));
    assert.deepEqual(
      indexes.map((f) => f.external_id),
      input.startsWith('t') ? [`ext:x:ecodevices:${input}:consumption_index`] : [],
      'the tariff indexes, water and gas are never energy indexes',
    );
  }
});

test('the licenses ship in the image; no name in LICENSE', () => {
  assert.match(dockerfile, /COPY LICENSE THIRD_PARTY_NOTICES\.md/);
  const license = read('LICENSE');
  assert.match(license, /Apache License\s+Version 2\.0/);
  assert.match(license, /Copyright \[yyyy\] \[name of copyright owner\]/);
  const notices = read('THIRD_PARTY_NOTICES.md');
  assert.match(notices, /pyecodevices/);
  assert.match(notices, /MIT License/);
  assert.match(notices, /Copyright \(c\) 2020 Matthieu/);
  assert.match(notices, /Apache License/);
});

test('the code never feeds the energy consumption endpoint nor scene events', () => {
  for (const file of ['index.js', 'src/app.js', 'src/devices.js']) {
    assert.doesNotMatch(read(file), /publishEnergyConsumption\(/, file);
    assert.doesNotMatch(read(file), /publishSceneEvent\(/, file);
  }
});
