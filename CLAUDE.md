# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.

It reads a **GCE Electronics Eco-Devices** (not the RT2) through its local JSON
API (`GET /api/xdevices.json?cmd=10` for the indexes, `cmd=20` for the
consumption of the day of the pulse counters, as the GCE wiki documents them;
an optional login sent as HTTP Basic authentication, no cloud). The
teleinformation keys and the totals by tariff option come from
[pyecodevices](https://github.com/Aohzan/pyecodevices) (MIT) and
[ecodevices](https://github.com/Aohzan/ecodevices) (Apache-2.0), see
`THIRD_PARTY_NOTICES.md`. Unofficial: not affiliated with GCE Electronics.
**Read-only**: never `onSetValue`, only GET. Siblings: `gladys-iskra` (the
structure of `src/app.js`, the store, the pace, the login), `gladys-p1-monitor`
(the guard). Not `gladys-teleinfo` (a LiXee USB key).

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run audit                             # npm audit --omit=dev
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run cover                             # cover.png, 800 x 534, plain Node
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only: handlers registered before connect()
src/app.js                        EcoDevicesApp: getConfig retries, the pace, the indexes, login, pauses, /data, buttons
src/ecodevices/client.js          the only HTTP access (GET, bounded, HTTP Basic, our error codes)
src/ecodevices/model.js           the answers -> values, the total of the tariff indexes (pure)
src/guard.js                      plausibility of an index (approved shared file, pure)
src/store.js                      what /data keeps across restarts (unreadable is not empty)
src/devices.js                    the device of an input, feature keys, states (pure)
src/config.js                     the address, the login, the pulse counters, normalized
src/constants.js                  pages, pacing, limits, manifest keys
src/i18n.js                       runtime texts (en/fr)
scripts/cover.mjs                 the cover image
gladys-assistant-integration.json manifest: name, config_schema, actions, image...
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test, against the SDK's fake Gladys, a fake Eco-Devices, a virtual clock
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **Energy monitoring**: `consumption_index` (`energy-sensor` / `index`, kWh)
  is the only energy index of a teleinfo input: the sum of the indexes of ONE
  tariff option, built only when each of them is read (a tariff back to 0 or
  lower alone is a glitch: no total). It passes `IndexGuard` (`src/guard.js`,
  100 kW, 0.5 kWh), one guard per input: never 0, a drop and a jump never
  confirmed by repetition nor by time. A jump (and a drop of a pulse
  counter, which is no built index) is taken only by the
  `accept_held_index` action in two clicks (the first lists, the second
  takes only what was listed and has not changed since); a drop of a
  teleinfo total is never accepted (the device is created again). The index
  state in `/data` carries the id of its Gladys device (another id: an empty
  reference) and, for a counter, its unit (a change converts the reference);
  `onDeviceCreated` / `onDeviceDeleted` clear it. The tariff indexes are plain
  sensors, published with the total they make. Pulse counters (water 10
  m³/h, gas 16 m³/h) are `volume-sensor` m³ with the same guard, never in the
  energy monitoring. Never `publishEnergyConsumption`. Do not change
  `src/guard.js` without the same change in its siblings and a review.
- **Units**: only the core's (`DEVICE_FEATURE_UNITS_BY_CATEGORY`): VA, kWh
  for `energy-sensor`, m³ for `volume-sensor`, none for `unknown` (the unit
  is in the name). PAPP is apparent power: VA, never W.
- **Strict values**: a number is a non-negative integer within its bounds;
  `""`, null or a text is unknown, never 0; PTEC is a text and never a
  measurement; only own keys are read.
- **The pace**: never two reads less than 15 s apart, whatever asks; the time
  of the last read is in `/data` before the request. Never add a read path
  that skips `dueAt()`. One request at a time.
- **Secondary page**: `cmd=20` never holds the indexes back; its 401/403 is
  never a refused login.
- **Late answers**: every await in a read is followed by `gone()`; an old
  session (address or login) never publishes nor sets a status.
- **The login**: only in the `Authorization` header of requests to the
  configured address (private field of the client), never in a log, a
  status, an error or `/data`. A 401/403 on `cmd=10` is final (kept in
  `/data` with 8 bits of a salted hash of the password, never more): no
  automatic retry, only a new login or the test button (a success lifts it).
- **`/data`**: an unreadable file is not an empty state: never overwritten,
  no index published until it reads; a save that fails holds the indexes
  (Gladys never gets an index `/data` does not know).
- **getConfig** in `connected` is retried without end (5 s doubled to 5 min),
  with its status; a disconnection or a save ends the retries.
- **Freshness**: a teleinfo input whose power and indexes are identical for
  15 minutes (fingerprint and age in `/data`) gets no power published.
- **Never a free text of the device in a message**, never a URL in the logs.
- **External ids are forever**: `ecodevices:t1|t2|c1|c2`, the `FEATURE` keys
  of `src/devices.js`, the manifest keys and actions. Features only grow: a
  device published again keeps every feature it was created with.
- **The container rootfs is read-only.** Write only under `/data`:
  `src/store.js` keeps `/data/ecodevices-state.json`.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section, and it
  becomes the notes of the GitHub Release.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language. Never a
  `default` on a secret. `test/manifest.test.js` ties the manifest to the code.
- **User-facing text** is bilingual (English and French): runtime messages,
  manifest texts, and `docs/en.md` / `docs/fr.md`, kept in sync. Files are
  UTF-8 without BOM nor control bytes (`test/encoding.test.js`, sources
  included).
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network (the real-clock test uses a
  local server on 127.0.0.1).

## CI and pushes

- Group the commits and push **at most once a day**, unless the maintainer
  explicitly asks otherwise: the GitHub Actions quota is limited.
- If every CI job fails in under 2 seconds, the quota is exhausted: it is not
  a bug in the code.

## Checking an answer against a real Eco-Devices

On the same LAN (add `-u user` when the secure access is on):

```bash
curl -s "http://192.168.1.20/api/xdevices.json?cmd=10"; echo
curl -s "http://192.168.1.20/api/xdevices.json?cmd=20"; echo
```

Change the meter numbers before an answer becomes a fixture.
