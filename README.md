# gladys-ecodevices

Unofficial [Gladys Assistant](https://gladysassistant.com) integration for the
**GCE Electronics Eco-Devices** (not the RT2), read through its local JSON
API, no cloud. Not affiliated with GCE Electronics.

**Never tested with a real Eco-Devices**: built from the JSON API documented
on the GCE Electronics wiki and the teleinformation logic of
[pyecodevices](https://github.com/Aohzan/pyecodevices) (MIT) and
[ecodevices](https://github.com/Aohzan/ecodevices) (Apache-2.0, Home
Assistant), ported to JavaScript.

- One device per input in use: teleinfo 1 and 2, pulse counters 1 and 2.
- Teleinfo (historic mode): apparent power (VA) and the consumption index
  (kWh, the sum of the tariff indexes: base, off-peak/peak, EJP, Tempo) for
  the Gladys energy monitoring, each tariff index as a plain sensor.
- Pulse counters set to water or gas: index and consumption of the day, in
  m³ (never in the energy monitoring).
- Every index checked by a guard: never 0, a jump (or a drop of a water or
  gas counter) held until the user accepts it in two clicks; a drop of a
  teleinfo consumption index is never accepted (the device is created again,
  its history lost: see the docs). The state is tied to the Gladys device.
- Optional login (HTTP Basic), never logged; a refused login stops the reads
  until it changes or the test button succeeds.
- Read-only. Not the `gladys-teleinfo` integration (LiXee USB key): one of
  them per meter.

User guides: [English](docs/en.md), [français](docs/fr.md).

## Development

```bash
npm install
npm run format:check
npm run lint
npm test
npm run audit
npm run cover        # cover.png, 800 x 534, plain Node
npx github:GladysAssistant/integration-store .
```

Architecture and rules: [CLAUDE.md](CLAUDE.md). Decisions and open points:
[TODO.md](TODO.md). Releases: Actions → Release (see
[CHANGELOG.md](CHANGELOG.md)).

## License

Apache-2.0 (see [LICENSE](LICENSE)); the ported logic of pyecodevices is
under MIT, see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
