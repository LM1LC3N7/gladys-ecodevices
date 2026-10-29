# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.2] - 2026-10-29

### Fixed

- The counter guard keeps the value you accepted as a floor: after an
  accepted drop of a pulse counter (a teleinfo drop is never accepted), a
  reading lower still is held (never counted without a new click) and the
  real value that follows is taken instead of being held as a jump; a
  reading back under an accepted jump is now held too, as a jump when it is
  above the last value published, and needs a new click.

## [0.1.1] - 2026-10-27

### Added

- First version: the GCE Electronics Eco-Devices read through its local JSON
  API (`cmd=10`, `cmd=20`), one device per input. Teleinfo 1 and 2: apparent
  power (VA), consumption index (kWh) for the energy monitoring, tariff
  indexes as plain sensors. Pulse counters 1 and 2 (water or gas): index and
  consumption of the day in m³. Index guard (never 0, jumps and counter drops
  accepted in two clicks, teleinfo drops never, the state tied to the Gladys
  device, a unit change converted), orange badge while an index is held,
  optional login, test button. Read-only.

[Unreleased]: https://github.com/LM1LC3N7/gladys-ecodevices/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/LM1LC3N7/gladys-ecodevices/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/LM1LC3N7/gladys-ecodevices/releases/tag/v0.1.1
