# Service Tool — engine diagnostics over WebUSB

A browser-based heavy-duty engine service tool, built to talk to a datalink
adapter such as a Cummins INLINE 7 over WebUSB. It reads fault codes, monitors
live engine parameters, watches raw datalink traffic, and ships with a bench
simulator so every screen works with no hardware attached.

Not affiliated with, endorsed by, or derived from any engine manufacturer's
software. It is an independent implementation of open SAE J1939 standards.

---

## Read this before you connect it to a truck

**The INLINE 7's USB wire protocol is proprietary and undocumented.** On
Windows, manufacturer service software reaches an INLINE adapter through a
closed-source RP1210 driver DLL. Nothing published describes how the adapter
wraps a CAN frame inside a USB transfer.

What that means in practice:

| Layer | Status |
| --- | --- |
| SAE J1939-21 (identifiers, transport protocol) | Implemented in full, to spec |
| SAE J1939-71 (parameter decoding) | Implemented for the common engine PGNs |
| SAE J1939-73 (DM1/DM2 faults, DM3/DM11 clear) | Implemented in full, to spec |
| slcan and gs_usb adapter protocols | Implemented exactly; works today |
| **INLINE 7 USB framing** | **Not documented — must be characterised per unit** |

So the application ships with a **configurable framing driver** and a **capture
analyser** that works out an unknown adapter's framing from live traffic. If
you have a CAN adapter speaking slcan or gs_usb (a CANable, USBtin, candleLight
or similar), everything works immediately with no reverse engineering at all.

### Safety

- Nothing here writes engine parameters or flashes calibrations. Those
  operations are proprietary, and getting them wrong damages an ECM.
- The only commands sent to a vehicle are standard J1939 requests plus DM3 and
  DM11 fault clears. A controller refuses DM11 while a fault condition is still
  present, which is correct behaviour, not an error.
- **Listen-only mode** is available on the connection screen and stops the tool
  transmitting anything at all. Use it if you only want to observe.

---

## Running it

```bash
npm install
npm run dev          # development server on http://localhost:5173
npm run build        # production build into dist/
npm run preview      # serve the production build
npm test             # unit and integration tests (72 tests)
npm run smoke        # browser smoke test — needs a preview server running
```

WebUSB and Web Serial only work on `https://` origins or on `localhost`, in a
Chromium-based browser (Chrome, Edge, Opera). Firefox and Safari do not
implement either API.

Start with **Connect → Bench simulator**. No hardware needed, and it exercises
exactly the same decode path as a real adapter.

---

## Hosting it

**The browser has to run on the laptop the adapter is plugged into.** WebUSB
reaches the USB device from the browser process, so there is no arrangement in
which the page runs on one machine and the adapter is on another. Hosting only
saves you installing Node on that laptop.

**The page must come from a secure context** — `https://` or `localhost`.
Serving the build over plain HTTP on the local network (`http://192.168.1.5:5173`)
loads the page fine but leaves WebUSB unavailable, which looks like the adapter
being broken. The connection screen detects this and says so.

### Option 1 — GitHub Pages (recommended)

The repository is public, so Pages is free, and `.github/workflows/deploy.yml`
already builds and publishes on every push.

**One manual step, once:** **Settings → Pages → Build and deployment → Source:
"GitHub Actions"**, then re-run the workflow.

This cannot be automated. Creating a Pages site needs admin rights, and the
token GitHub hands a workflow does not have them — `configure-pages` with
`enablement: true` fails with `Resource not accessible by integration`. The
workflow checks for this up front and tells you exactly what to do rather than
failing cryptically.

Once enabled, the tool is live at

```
https://krismsd.github.io/Onsite-test/
```

Open that on the laptop with the INLINE attached. Nothing to install there
beyond Chrome or Edge.

The build uses relative asset paths, so it works from the project subpath
without configuration.

### Option 2 — no hosting at all

If the laptop has Node, skip hosting entirely:

```bash
git clone https://github.com/krismsd/Onsite-test.git
cd Onsite-test && npm install && npm run dev
```

Then open `http://localhost:5173`. `localhost` counts as a secure context, so
WebUSB works with no TLS setup whatsoever. This is the fastest route if you are
iterating on the framing profile, since you can edit and reload immediately.

### Option 3 — drag and drop

Run `npm run build` and drag the `dist/` folder onto
[Netlify Drop](https://app.netlify.com/drop) or Cloudflare Pages. You get an
HTTPS URL in a few seconds with no repository access and no build configuration.
Useful if you want a throwaway URL, or if the repo becomes private later.

### Which to pick

| You want | Use |
| --- | --- |
| A stable URL, no install on the laptop | GitHub Pages |
| To edit the framing profile and reload fast | Run locally |
| A throwaway URL right now | Netlify Drop |
| To serve from another machine on the LAN | Not possible over HTTP — see below |

### If you must serve over LAN HTTP

Chrome can be told to trust one insecure origin. On the laptop with the adapter:

```bash
chrome --unsafely-treat-insecure-origin-as-secure=http://192.168.1.5:5173 \
       --user-data-dir=/tmp/chrome-usb
```

The separate profile directory is required — the flag is ignored without it.
This is a debugging aid, not something to rely on.

### A note on device permissions

WebUSB grants are remembered per origin. A stable HTTPS URL means you authorise
the adapter once; a dev server on a shifting port means re-authorising each
time. Another reason to prefer Pages once the framing is worked out.

---

## Connecting real hardware

### If your adapter speaks slcan or gs_usb

Select the protocol on the connection screen, choose 250 kbit/s (the J1939
standard rate), and connect. That is all.

### Characterising an INLINE 7, or any adapter with unknown framing

1. Connect with the **configurable binary framing** protocol.
2. Open **Datalink → Capture analyser** and record a few seconds of traffic with
   the adapter plugged into a running engine or a bench bus.
3. Press **Stop and analyse**.

The analyser searches the capture for J1939 identifiers. This works because
J1939 traffic is highly structured: identifiers are 29-bit values (so the top
three bits of a 32-bit field are always zero), source addresses come from a
small set, and a handful of PGNs repeat many times a second. Positions where a
four-byte window decodes to a recognised PGN are not coincidence, and their
spacing is the frame length.

It reports the identifier offset, byte order and frame size it found, along
with **how confident it is**. A candidate whose PGNs are not recognised is a
coincidence, and the analyser says so rather than dressing a guess up as a
finding. Apply a convincing candidate and reconnect; the rest of the
application starts decoding.

If the capture comes back empty, the adapter needs an initialisation command
before it streams anything — the one case this approach cannot solve on its own.

### Known adapter identifiers

Adapter vendors do not publish their USB identifiers. `src/transport/usb-vendors.ts`
records the ones seen in the field so the inspector can name a device instead of
showing bare hex; the connection flow never filters on them.

| Vendor | Product | Device |
| --- | --- | --- |
| `0x0AFE` | `0x0004` | Cummins INLINE 6 adapter (confirmed on hardware) |
| `0x0403` | various | FTDI USB-serial bridge |
| `0x1D50` | `0x606F` | candleLight / CANable in gs_usb firmware |

### Operating system setup

**Windows.** WebUSB can only claim an interface bound to WinUSB. If the vendor's
RP1210 driver owns the device, either use the Web Serial route (no driver change
needed) or rebind the interface to WinUSB with a tool such as Zadig. Rebinding
stops the vendor driver — and the official software — from using the adapter
until you restore it.

**Linux.** Add a udev rule granting your user access, then replug:

```
SUBSYSTEM=="usb", ATTR{idVendor}=="xxxx", ATTR{idProduct}=="yyyy", MODE="0666"
```

If a kernel driver has claimed the interface (`ftdi_sio` often does), unbind it
first.

**macOS.** Vendor-specific interfaces are generally claimable as-is. Interfaces
owned by a class driver are not — use Web Serial for those.

### If it will not connect

| Symptom | Cause |
| --- | --- |
| Serial port picker is empty | The adapter is not a serial device. A vendor-specific USB device never appears there — use the WebUSB option. |
| USB picker does not list the adapter | Most often **no driver is installed**: on Windows the device sits under "Other devices" with "drivers are not installed (Code 28)". Install the manufacturer's adapter drivers. A browser cannot open a device with nothing bound to it. |
| Driver installed, still not listed | Now consider the interface being held by a vendor driver — rebind to WinUSB. |
| "Access denied" | An OS driver holds the interface. Rebind it, or use Web Serial. |
| "Device unavailable" | Another application (often an RP1210 driver) has the device open. |
| Connects, but no frames | Wrong framing profile, or the adapter needs an init command. Use the capture analyser. |
| Frames arrive, nothing decodes | Framing is wrong — the datalink monitor will show "undecoded bytes". |
| Everything decodes but values look absurd | Byte order is probably reversed. Try the other endianness. |

---

## What each screen does

- **Connection** — transport, adapter protocol, bitrate, listen-only, and the
  hardware setup notes.
- **ECM information** — identification read from every controller on the bus via
  J1939 requests (component ID, software ID, VIN, address claim).
- **Fault codes** — active faults from DM1 and previously active from DM2, with
  a detail pane, lamp status, occurrence counts and troubleshooting steps.
  Clears inactive faults with DM3 and active faults with DM11.
- **Monitor** — gauges and a 60-second trend for any decoded parameter, with CSV
  export. A parameter the ECM is not broadcasting reads `- - -`; it is never
  estimated from something else.
- **Trip information** — engine hours, distance and fuel totals as broadcast.
- **Datalink monitor** — every frame crossing the adapter with its decode, bus
  load, and a transmit box for hand-built frames.
- **Capture analyser** — as described above.
- **USB devices** — descriptor tree for every authorised device: interfaces,
  their class codes and endpoints, plus which interface the tool would claim.
  The screen to reach for when an adapter will not connect at all.
- **Bench simulator** — drive the simulated engine and inject failures.
- **Audit trail** — every action taken this session, exportable.

---

## Fault code mapping

The ECM reports faults as an SPN (which parameter) and an FMI (how it failed).
Those are open standards and are decoded exactly.

Manufacturer fault code numbers are a different matter: the SPN/FMI-to-fault-code
table lives inside the manufacturer's service tool and the ECM calibration, and
is not published. `src/model/fault-codes.ts` carries the widely documented
mappings, each marked `high` or `medium` confidence. An unmapped pair is shown by
SPN and FMI alone — which is what the ECM actually reported — rather than being
given an invented code. Mappings marked `medium` are flagged in the UI with an
asterisk, because they vary between engine families.

Add your own with `importFaultCodeMappings()`; imported entries take precedence
over the built-in table.

---

## How it is put together

```
src/
  transport/     Byte-level links: WebUSB (with FTDI support), Web Serial
  protocol/      Adapter framing and the J1939 stack
    j1939/       Identifiers, transport protocol, PGN decoders, DM1/DM2
    slcan.ts     Lawicel ASCII protocol (exact)
    gsusb.ts     candleLight/gs_usb binary protocol (exact)
    framing.ts   Configurable framing for undocumented adapters
    analyser.ts  Recovers framing from a raw capture
  sim/           Engine model and simulated ECM
  model/         Signal registry, fault tables, domain types
  app/           Session, application state, React hooks
  screens/       One module per screen
  ui/            Gauges, strip chart, shared primitives
```

Everything above the transport works on opaque byte streams, so the simulator
and real hardware run through identical code. That is deliberate: the simulator
is not a mock, it produces genuine J1939 frames that go through framing,
transport protocol reassembly, PGN scaling and DM1 decoding exactly as a
vehicle's traffic does.

### Tests

`npm test` covers the protocol layer against known-good vectors (identifier
round-trips, published CRC check values, PGN scaling with not-available
handling), the adapter codecs, the capture analyser against synthetic framings,
the engine model's physical behaviour, and the full end-to-end path from
simulated bus traffic to decoded application state.

`npm run smoke` drives a real browser through every screen and asserts that
decoded data actually appears — a build passing is not evidence that a decoder
works.
