# TODO

## Before announcing

- [x] Review r2 (2026-10-27): APPROUVÉ, no blocker.
- [ ] Next patch — review r2 leftovers: when no tariff option key is
      recognised, the old "this time" note stays; "neither jump nor drop" is
      only true while the raw index does not change; tests for the
      `onDeviceDeleted` wiring in `index.js` and for `today` published without
      a fresh day page.
- [ ] Test on a real Gladys with a real Eco-Devices (teleinfo in base, in
      off-peak/peak and in Tempo; a water and a gas meter): test button,
      device creation, the consumption and cost the core derives from the
      index, the power against the contract.
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).
- [ ] Add the `gladys-assistant-integration` topic at publication only.

## To confirm on a real Eco-Devices (built without one)

- [ ] The `cmd=10` answer for each tariff option: the GCE wiki shows the
      base option only (`T1_BASE`); a Tempo answer shared by a Homey user
      shows `T1_BBRHCJB`... and no `T1_BASE`. Off-peak/peak (`T1_HCHC`,
      `T1_HCHP`) and EJP are assumed from the XML keys of pyecodevices.
      Does the answer also carry the keys of the other options at 0? (Read
      as "not this option": fine either way.)
- [ ] Numbers as JSON numbers (the wiki) or as strings with leading zeros
      (the XML pages): both are read.
- [ ] The unit of `INDEX_C1` / `INDEX_C2` and `Day_C1` / `Day_C2`: litres
      when 1 pulse = 1 litre? The XML `count0` is divided by 1000 for m³ by
      the Home Assistant integration; the JSON index may be in the unit the
      Eco-Devices shows. The unit is a configuration field for that reason.
- [ ] What an unplugged teleinfo cable gives: frozen values (handled: the
      power stops after 15 min), zeros, or "----" (no meter: nothing sent).
- [ ] Whether the secure access answers 401 to the JSON API without login,
      and whether a wrong login gives 401 (final) or a 200 HTML page (read
      as "not an Eco-Devices answer", retried with the backoff).
- [ ] Whether the small web server of the Eco-Devices copes with one request
      every 15 s along with its own web pages (HA polls every 5 s).
- [ ] The firmware version that brought the JSON API (an older one answers
      404: the status says to update).

## Decisions

- **Versions**: 0.1.0 set once by hand when leaving the template (package,
  lock file, manifest, image tag `ghcr.io/lm1lc3n7/gladys-ecodevices:0.1.0`);
  the Release workflow owns them from now on (the first patch release gives
  0.1.1).
- **SDK `^0.16.0`** (the latest on npm, 2026-10-27). `gladys_version: ">=5.1.0"`
  (rule of the lot fiche). `keywords` and `countries` (FR) wait until Gladys
  5.3 is widespread.
- **Sources**: the JSON API of the GCE Electronics wiki (the manufacturer's
  documentation, `cmd=10` and `cmd=20`) rather than the XML pages
  pyecodevices reads (`status.xml`, `protect/settings/teleinfo<N>.xml`, not
  documented by GCE). The teleinformation keys and the totals by option are
  ported from pyecodevices 1.7.0 (MIT) and ecodevices 5.5.0 (Apache-2.0),
  cloned read-only in `~/code/ref/lot17/`. The SDK stays the only runtime
  dependency. The guard (`src/guard.js`) comes from the approved shared file of
  gladys-iskra / gladys-p1-monitor but DIVERGES from it: the held value has
  `direction` and `threshold` lines, because a teleinfo index never has a
  drop accepted (a value back under an accepted jump is held as a jump, its
  threshold the lowest seen). `maxKw` / `slackKwh` are used as "units per
  hour" for water and gas. The store, the client, the pace,
  the login and the structure of `src/app.js` come from gladys-iskra. The
  template's demo files were removed with `git rm`.
- **External ids**: `ecodevices:t1`, `t2`, `c1`, `c2`, one device per input,
  one Eco-Devices per integration; the address is only a param (a new IP
  keeps the devices). The JSON API gives no serial number nor MAC: another
  meter on an input shows as a drop or a jump, held by the guard. The meter
  number (ADCO) of the XML pages is not read (personal data, not in the JSON
  API).
- **Teleinfo**: historic mode keys only (what the Eco-Devices reads). The
  option is the one whose indexes are above 0 in the answer; two options at
  once: no index (status note). A total only when every index of the option
  is a number; against the last total accepted (kept in `/data`), a tariff
  back to 0 or lower alone is a glitch (no total); every index that counted
  lower goes to the guard (a Tempo red index still at 0 does not block it).
  PAPP is `energy-sensor` / `power` in VA (the energy contracts divide VA by
  1000 against the subscribed kVA), with history. PTEC is never published
  (a text); the Tempo colours are an idea for later.
- **Index guard**: electricity 100 kW + 0.5 kWh, water 10 m³/h + 0.05 m³, gas
  16 m³/h + 0.05 m³. Jumps accepted in two clicks (3 s to 5 min, same
  session, same `from` and threshold, `to` within the margin since the
  listing: the mechanism of gladys-iskra). Review r1:
  - **pulse counters** are no built index: their drop is accepted in two
    clicks too (same `from`, `to` within the margin of the listed value); a
    change of the unit in the configuration converts the kept reference
    (and a held value), dated now, the old-unit value of Gladys ignored;
  - **a drop of a teleinfo total is never accepted** (rule of the fiche
    "baisse d'index construit jamais acceptée", kept by decision of the lot,
    review I3): it comes from a replaced meter or a change of tariff option
    that restarts the registers. The status says it plainly ("DROP held,
    never accepted"), the device badge is degraded (orange), the docs list
    the triggers and the cost of the only way out (delete and create the
    device: index, power, consumption and cost lost, the energy tree to set
    again, Gladys refusing a deletion beyond 5000 states). A way out that
    keeps the history (a new device beside the old) is not possible in this
    version: the external ids are one per input (see Ideas);
  - the index state in `/data` carries the id of its Gladys device: a device
    created again while the integration was away (no `device-created`
    event) starts from an empty reference; `onDeviceDeleted` clears it;
  - one log line per hold (direction and starting value), not per minute. The tariff indexes are published only with the total
    they make (accepted, or the last accepted while one is held), never 0.
- **Pulse counters**: off by default; water or gas (`volume-sensor`, m³);
  unit of the Eco-Devices index liter (default, divided by 1000) or m³.
  Electricity pulses are not offered (they would be a second energy index:
  an idea for later). The consumption of the day is a `volume-sensor` (0 is
  a value: a new day), published only on the read that fetched it.
- **Read-only**: only GET; no command, no protective action to guard.
- **Login**: optional, both fields or none (a password without a user is
  refused, no ":" in the user, no control byte), HTTP Basic as pyecodevices,
  only to the configured address, never after a redirect (not followed),
  kept in a private field of the client. Plain HTTP on the LAN: the
  Eco-Devices offers nothing else (documented). A 401/403 on `cmd=10` is
  final, kept in `/data` as `{ address, username, salt, tag }` (8 bits of
  SHA-256(salt, password)); a different address, user or password, or a
  success of the test button lifts it. On `cmd=20` it is never final.
- **Pace**: one timer, one read at a time, never two reads less than 15 s
  apart whatever asks; the time of the last read is written in `/data`
  before the request (at most once a minute). `cmd=20` every 5 min when a
  counter is set; its failure is retried after 5 min doubled up to 1 h and
  never holds the indexes.
- **Errors**: unreachable or wrong answer: retries 15 s doubled to 10 min (in
  memory). 429/5xx of `cmd=10`: pause in `/data` from Retry-After or 1 min
  doubled, bounded 1 min to 6 h, monotonic in memory.
- **Hostile answers**: 16 KiB read into one buffer allocated once, cut before
  the end; 10 s for the whole answer; no redirect followed; own keys only.
- **`/data`** (lesson of lot 17): a file that exists but cannot be read is not
  empty: never overwritten, no index published until it reads again (retried
  at each read), the power goes on. A save that fails holds the indexes of
  that read (Gladys never gets an index `/data` does not know).
- **getConfig** (lesson of lot 17, wave 1): in `connected`, a failure is
  retried without end (5 s doubled up to 5 min), the status says so; a
  disconnection or a save of the form ends the retries.
- **Freshness**: no time of reading in the API; a fingerprint (8 hex digits)
  of PAPP and the indexes of each teleinfo input and the wall time it last
  changed are kept in `/data`; identical for 15 min: no power published (an
  equal index still is: the guard does not date it again).
- **States**: `publishChangedStates` with a 10-minute heartbeat. No scene
  event. Every connection forgets the published states and publishes the
  status and Discovery again; values only at the next read.
- **Distinct modules**: not `gladys-teleinfo` (prohand, a LiXee USB key over
  ser2net), said in the manifest, the README and both docs; not the
  Eco-Devices RT2 (another API: `pyecodevices_rt2`).
- **Real-clock test**: `test/realclock.test.js` at ×20, with the real-clock
  helpers copied from `~/code/ref/gladys-testkit` into
  `test/helpers/realclock.js` (the GitHub CI does not have the kit).

## Ideas

- A way out of a teleinfo drop that keeps the history: a generation in the
  external id (`ecodevices:t1`, then `ecodevices:t1-2` offered beside the old
  device, the old one kept read-only), chosen by a two-click action.
- The Tempo colour of today and tomorrow (`PTEC`, `DEMAIN`) as an enum, an
  off-peak binary sensor.
- Electricity pulses on C1/C2 as a second energy index (guarded).
- The XML pages for IINST, ISOUSC and the phases (three-phase meters).

## Next patch

- Guard r3 m5: no test pins `this.held?.direction === 'up'` on the threshold line (`src/guard.js:163`). Play
  1000 → jump accepted at 6000 → 999, 1000.3, 9000, 999.5 and check that 999.5 is held as a drop, never
  acceptable.
