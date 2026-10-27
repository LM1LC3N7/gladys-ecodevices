# Eco-Devices (GCE Electronics)

**Unofficial** integration, not affiliated with GCE Electronics. It reads an
**Eco-Devices** (the DIN-rail teleinformation module, **not the Eco-Devices
RT2**, which has another API) through its **local JSON API**, no cloud.
**Read-only**: it only sends read requests, the Eco-Devices receives no
command.

**Never tested with a real Eco-Devices**: built from the GCE Electronics
documentation (wiki, "API JSON" section) and the pyecodevices and ecodevices
(Home Assistant) projects.

## What you get

One device per input in use:

- **Teleinfo 1** and **Teleinfo 2** (an electricity meter in **historic**
  mode on the input: a Linky in historic mode or an electronic meter):
  - **Apparent power** (VA): the PAPP value of the meter, read every 15
    seconds; the energy contracts of Gladys compare it with your subscribed
    power;
  - **Consumption index** (kWh): the sum of the indexes of the tariff option
    of the meter (base; off-peak + peak; EJP; the six Tempo indexes), sent
    once a minute; the Gladys energy monitoring turns it into consumption and
    cost;
  - each **tariff index** (kWh) as a plain sensor, for information (never
    counted in the energy monitoring).
- **Counter 1** and **Counter 2** (the pulse inputs), only when you set them
  to **water** or **gas** in the configuration:
  - **Index** (m³): the total index of the meter;
  - **Consumption today** (m³): reset every day by the Eco-Devices, at the
    hour set in its configuration page.

Water and gas do not go through the Gladys energy monitoring (they are
volumes, not kWh).

This is **not** the `gladys-teleinfo` integration (a LiXee USB key): if your
meter is already read by another integration, keep only one, or the
consumption would be counted twice. Likewise, if Teleinfo 2 is a sub-meter of
Teleinfo 1, put it under the main meter in the Gladys energy monitoring.

## Setup

1. Find the IP address of the Eco-Devices (in your router or with GCE
   ScanDevice) and preferably give it a fixed address.
2. Check that the JSON API answers: open
   `http://<address>/api/xdevices.json?cmd=10` in a browser; you should see
   an answer starting with `{"product":"Eco-devices"`. Otherwise, update the
   firmware of the Eco-Devices.
3. In Gladys, install the integration and fill in:
   - **Eco-Devices address** (with a port only if it is not 80);
   - **User name** and **password**, only if the secure access of the
     Eco-Devices is on (System tab, Security block). The password is kept by
     Gladys in its database, never shown again, never logged, sent only to
     the Eco-Devices address (HTTP Basic authentication in plain HTTP on your
     network: what the Eco-Devices offers). A password without a user name is
     refused;
   - for each **pulse counter**: water, gas or "not used", and the **unit of
     its index** on the Eco-Devices (litres by default, the most common
     setting: 1 pulse = 1 litre; otherwise cubic metres). Compare the index
     Gladys shows with the one of the meter itself. Choose them **before**
     creating the device: changing the unit later makes the index jump or
     drop (see below).
4. Save, then create the devices from the **Discover** tab.

The **Test the connection** button reads the Eco-Devices once when a read is
due (never more than one every 15 seconds), otherwise tells the last read.

## Index guard

The energy monitoring counts every rise of an index in full. So that a wrong
index (a meter replaced, a read error) is held instead of billed:

- an index at 0 is never sent;
- a rise larger than what the home can consume since the last value (100 kW
  for electricity, 10 m³/h for water, 16 m³/h for gas) is a **jump**; a value
  lower than the last one is a **drop**;
- a jump or a drop is **held**: the last accepted value is sent again, the
  status of the integration shows it, and it is kept in `/data` across
  restarts. Neither time nor repetition confirms it;
- **a right jump** is taken in **two clicks** on "Accept the held index": the
  first click lists the jumps and takes nothing; the second, a few seconds to
  5 minutes later, takes the values listed (plus what the meter may measure
  meanwhile), only if they did not change otherwise. Saving the configuration
  accepts nothing;
- **a drop is never accepted**: if the meter was replaced, or if you set the
  pulse counter back to a lower value in the Eco-Devices, delete the device
  of that input and create it again from the Discover tab (its history
  starts over);
- for an electricity index with several tariffs, the total is built only
  when every index of the option is read; a tariff index back to 0 or
  dropping alone is a read error: no index that time.

## How it works

- One read every 15 seconds (`cmd=10`), never more often, even after a
  restart, a save of the configuration, a click or a reconnection (the time
  of the last read is kept in `/data`).
- The consumption of the day (`cmd=20`) is read every 5 minutes, only when a
  pulse counter is set; if it fails, the indexes go on and it is tried again
  after 5 minutes, then 10, up to 1 hour.
- One request at a time to the Eco-Devices.
- If the Eco-Devices does not answer: new try after 15 s, then doubled, up
  to 10 minutes. If it answers 429 or 5xx: a pause of 1 minute to 6 hours,
  kept across restarts.
- **Login refused** (401/403 on the page of the indexes): the reads stop,
  even after a restart, until you change the address, the user name or the
  password, or the "Test the connection" button succeeds. A refusal on the
  page of the day does not count as a refused login.
- If the power and every index of a teleinfo input stay the same for 15
  minutes (teleinfo cable out?), the power is no longer sent.
- If the configuration cannot be read from Gladys at a connection, it is
  asked again after 5 s, then doubled, up to 5 minutes, without end.
- If the state file in `/data` cannot be read (or written), no index is sent
  until it can (a held value may be in it); the power goes on. A file that
  cannot be read is not overwritten.

## Limits

- Eco-Devices RT2 not supported (another API).
- The **standard** teleinfo mode of the Linky is not read: switch the meter
  to historic mode (ask your supplier) or use another module.
- Pulse counters are read as water or gas only (no electricity pulses).
- The Tempo colour of today and tomorrow is not published.

## Troubleshooting

On the same network as the Eco-Devices:

```bash
curl -s "http://192.168.1.20/api/xdevices.json?cmd=10"; echo
curl -s "http://192.168.1.20/api/xdevices.json?cmd=20"; echo
# with the secure access:
curl -s -u admin "http://192.168.1.20/api/xdevices.json?cmd=10"; echo
```
