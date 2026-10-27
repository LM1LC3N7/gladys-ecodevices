# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported from the projects below, distributed under their own
licenses. No code of theirs is shipped: the logic was rewritten in
JavaScript.

## GCE Electronics documentation

The JSON API (`/api/xdevices.json?cmd=10` for the indexes, `cmd=20` for the
consumption of the day of the pulse counters), its example answers and the
login in the request come from the Eco-Devices page of the GCE Electronics
wiki (<https://wiki.gce-electronics.com/index.php?title=EcoDevice>, section
"API JSON"). Facts of an interface, no code.

## pyecodevices (Aohzan/pyecodevices)

<https://github.com/Aohzan/pyecodevices>, by Matthieu (Aohzan), the library
the ecodevices integration of Home Assistant uses. Version 1.7.0 (`main` at
commit 05c915a).

Ported to JavaScript in `src/ecodevices/client.js` and
`src/ecodevices/model.js`: the teleinformation keys of the historic mode, by
input (`T1_`/`T2_` + `PTEC`, `PAPP`, `BASE`, `HCHC`, `HCHP`, `EJPHN`,
`EJPHPM`, `BBRHCJB` ... `BBRHPJR`), the login sent as HTTP Basic
authentication, a 401 read as a refused login, the 10-second timeout.
Changed here: the JSON API of the GCE wiki is read instead of the XML pages
(`status.xml`, `protect/settings/teleinfo<N>.xml`), values are read against
strict patterns and bounds, an empty or missing value is never 0.

Its license, reproduced as it appears in the repository:

```
MIT License

Copyright (c) 2020 Matthieu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## ecodevices (Aohzan/ecodevices)

<https://github.com/Aohzan/ecodevices>, by Matthieu (Aohzan), the custom
integration of Home Assistant for the Eco-Devices. Version 5.5.0 (`master` at
commit 5c1c2b0, 2026-10-21). Licensed under the Apache License 2.0, the
license of this integration (see `LICENSE`, same text; the repository has no
NOTICE file).

Ported to JavaScript in `src/ecodevices/model.js`, `src/devices.js` and
`src/app.js`: the total of a teleinformation input as the sum of the indexes
of its tariff option (base; off-peak + peak; the six Tempo indexes), the
apparent power in VA, a total at 0 or lower than the last one never taken,
the pulse counter index in litres turned into m³ (divided by 1000). Changed
here: the tariff option is read from the answer (not chosen by the user), a
total is built only when every index of the option is there, a drop or a jump
is held by the guard of `src/guard.js` (from gladys-p1-monitor), not only
skipped.
