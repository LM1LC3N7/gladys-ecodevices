# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- First version: the GCE Electronics Eco-Devices read through its local JSON
  API (`cmd=10`, `cmd=20`), one device per input. Teleinfo 1 and 2: apparent
  power (VA), consumption index (kWh) for the energy monitoring, tariff
  indexes as plain sensors. Pulse counters 1 and 2 (water or gas): index and
  consumption of the day in m³. Index guard (never 0, jumps accepted in two
  clicks, drops never), optional login, test button. Read-only.
