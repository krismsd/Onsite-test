import { useEffect } from 'react'
import { appStore } from '../app/store'
import type { CodecId, TransportKind } from '../app/store'
import { useAppState } from '../app/hooks'
import { Panel, Note } from '../ui/primitives'
import { isWebUsbAvailable } from '../transport/webusb'
import { isWebSerialAvailable } from '../transport/webserial'
import { BUILT_IN_PROFILES } from '../protocol/profiles'

const BITRATES = [125000, 250000, 500000, 1000000]
const BAUD_RATES = [115200, 230400, 460800, 500000, 921600, 1000000, 3000000]

export function ConnectionScreen() {
  const { settings, status, statusMessage, knownDevices } = useAppState()
  const webUsb = isWebUsbAvailable()
  const webSerial = isWebSerialAvailable()
  const secure = typeof window !== 'undefined' && window.isSecureContext

  useEffect(() => {
    void appStore.refreshKnownDevices()
  }, [])

  return (
    <>
      <h1>Connect to a vehicle</h1>
      <p className="lead">
        Choose how this tool reaches the engine datalink. The bench simulator needs no hardware and
        exercises exactly the same decode path as a real adapter.
      </p>

      {!secure ? (
        <Note kind="error" title="Insecure context">
          <p>
            WebUSB and Web Serial are only available on <code>https://</code> origins or on{' '}
            <code>localhost</code>. Serve this application over HTTPS to connect to hardware.
          </p>
        </Note>
      ) : null}

      {status === 'error' ? (
        <Note kind="error" title="Connection failed">
          <p>{statusMessage}</p>
        </Note>
      ) : null}

      <div className="columns two">
        <Panel title="Interface">
          <div className="stack">
            <Choice
              label="Bench simulator"
              description="A simulated engine ECM broadcasting real J1939 messages. No hardware required."
              selected={settings.transport === 'simulator'}
              onSelect={() => appStore.updateSettings({ transport: 'simulator' })}
            />
            <Choice
              label="USB adapter (WebUSB)"
              description={
                webUsb
                  ? 'Claims the adapter’s USB interface directly. The interface must not be held by an operating system driver.'
                  : 'Not available in this browser. Use Chrome, Edge or another Chromium-based browser.'
              }
              disabled={!webUsb}
              selected={settings.transport === 'webusb'}
              onSelect={() => appStore.updateSettings({ transport: 'webusb' })}
            />
            <Choice
              label="Serial port (Web Serial)"
              description={
                webSerial
                  ? 'For adapters that enumerate as a serial port. Often the easier route on Windows, as it needs no driver change.'
                  : 'Not available in this browser.'
              }
              disabled={!webSerial}
              selected={settings.transport === 'webserial'}
              onSelect={() => appStore.updateSettings({ transport: 'webserial' })}
            />
          </div>

          <div className="row" style={{ marginTop: 12 }}>
            <button
              className="btn primary"
              disabled={status === 'connecting'}
              onClick={() => {
                if (settings.transport === 'simulator') void appStore.connectSimulator()
                else if (settings.transport === 'webusb') void appStore.connectUsb()
                else void appStore.connectSerial()
              }}
            >
              {status === 'connecting' ? 'Connecting...' : 'Connect'}
            </button>
            <button className="btn" disabled={status !== 'connected'} onClick={() => void appStore.disconnect()}>
              Disconnect
            </button>
          </div>

          {knownDevices.length > 0 ? (
            <>
              <h2>Previously authorised devices</h2>
              <ul className="dim" style={{ margin: 0, paddingLeft: 18 }}>
                {knownDevices.map((device) => (
                  <li key={`${device.vendorId}:${device.productId}`} className="mono">
                    {device.label}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </Panel>

        <Panel title="Adapter protocol">
          <div className="stack">
            <label className="inline">
              Protocol
              <select
                className="field"
                value={settings.codec}
                onChange={(event) => appStore.updateSettings({ codec: event.target.value as CodecId })}
              >
                <option value="slcan">slcan / Lawicel ASCII</option>
                <option value="gs_usb">gs_usb (candleLight, CANable)</option>
                <option value="binary">Configurable binary framing</option>
              </select>
            </label>

            {settings.codec === 'binary' ? (
              <label className="inline">
                Framing profile
                <select
                  className="field"
                  value={settings.profile.id}
                  onChange={(event) => {
                    const profile = BUILT_IN_PROFILES.find((p) => p.id === event.target.value)
                    if (profile) appStore.updateSettings({ profile })
                  }}
                >
                  {BUILT_IN_PROFILES.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                  {BUILT_IN_PROFILES.every((p) => p.id !== settings.profile.id) ? (
                    <option value={settings.profile.id}>{settings.profile.name}</option>
                  ) : null}
                </select>
              </label>
            ) : null}

            <label className="inline">
              CAN bitrate
              <select
                className="field"
                value={settings.bitrate}
                onChange={(event) => appStore.updateSettings({ bitrate: Number(event.target.value) })}
              >
                {BITRATES.map((rate) => (
                  <option key={rate} value={rate}>
                    {rate / 1000} kbit/s{rate === 250000 ? ' (J1939 standard)' : ''}
                  </option>
                ))}
              </select>
            </label>

            <label className="inline">
              Host link rate
              <select
                className="field"
                value={settings.baudRate}
                onChange={(event) => appStore.updateSettings({ baudRate: Number(event.target.value) })}
              >
                {BAUD_RATES.map((rate) => (
                  <option key={rate} value={rate}>
                    {rate} baud
                  </option>
                ))}
              </select>
            </label>

            <label className="inline">
              <input
                type="checkbox"
                checked={settings.listenOnly}
                onChange={(event) => appStore.updateSettings({ listenOnly: event.target.checked })}
              />
              Listen only (never transmit onto the vehicle bus)
            </label>

            <label className="inline">
              <input
                type="checkbox"
                checked={settings.forceFtdi}
                onChange={(event) => appStore.updateSettings({ forceFtdi: event.target.checked })}
              />
              Treat device as an FTDI bridge
            </label>

            <label className="inline">
              USB interface
              <input
                className="field"
                style={{ width: 70 }}
                type="number"
                min={0}
                placeholder="auto"
                value={settings.interfaceNumber ?? ''}
                onChange={(event) =>
                  appStore.updateSettings({
                    interfaceNumber: event.target.value === '' ? null : Number(event.target.value),
                  })
                }
              />
            </label>
          </div>
        </Panel>
      </div>

      <Panel title="Connecting an INLINE 7">
        <Note kind="warning" title="The INLINE 7 USB framing is not publicly documented">
          <p>
            On Windows, service software reaches an INLINE adapter through Cummins’ closed-source
            RP1210 driver. The J1939 layers above the adapter are open SAE standards and are
            implemented here in full, but the USB wrapper the adapter puts around each CAN frame has
            to be characterised against your specific unit. Work through it like this:
          </p>
          <ol>
            <li>
              Connect with the <strong>configurable binary framing</strong> protocol and open the{' '}
              <strong>Capture Analyser</strong> screen.
            </li>
            <li>
              With the adapter plugged into a running engine or a bench bus, record a few seconds of
              raw traffic.
            </li>
            <li>
              The analyser searches the capture for J1939 identifiers and reports the frame length,
              identifier offset and byte order it finds. Apply the derived profile and the rest of
              the application starts decoding.
            </li>
          </ol>
          <p>
            If the adapter needs an initialisation command before it streams anything, the capture
            will be empty — that is the case the analyser cannot solve on its own.
          </p>
        </Note>

        <h2>Operating system setup</h2>
        <Note title="Windows">
          <p>
            WebUSB can only claim an interface bound to WinUSB. If the Cummins RP1210 driver owns
            the device, either use the Web Serial route instead, or rebind the interface to WinUSB
            with a tool such as Zadig. Rebinding stops the vendor driver — and therefore the
            official software — from using the adapter until you restore it.
          </p>
        </Note>
        <Note title="Linux">
          <p>
            Add a udev rule granting your user access to the device, for example{' '}
            <code className="mono">
              SUBSYSTEM=="usb", ATTR&#123;idVendor&#125;=="xxxx", MODE="0666"
            </code>
            , then replug the adapter. If a kernel driver has claimed the interface, unbind it first.
          </p>
        </Note>
        <Note title="macOS">
          <p>
            Vendor-specific interfaces are generally claimable without extra setup. Interfaces
            claimed by a class driver (such as a CDC serial interface) are not, so use Web Serial for
            those.
          </p>
        </Note>
      </Panel>
    </>
  )
}

function Choice({
  label,
  description,
  selected,
  disabled,
  onSelect,
}: {
  label: string
  description: string
  selected: boolean
  disabled?: boolean
  onSelect: () => void
}) {
  return (
    <label
      className="inline"
      style={{
        alignItems: 'flex-start',
        gap: 8,
        padding: 8,
        border: `1px solid ${selected ? 'var(--accent-light)' : 'var(--grid)'}`,
        background: selected ? '#eef2fb' : 'var(--field)',
        borderRadius: 3,
        opacity: disabled ? 0.55 : 1,
        whiteSpace: 'normal',
      }}
    >
      <input
        type="radio"
        name="transport"
        checked={selected}
        disabled={disabled}
        onChange={onSelect}
        style={{ marginTop: 2 }}
      />
      <span>
        <strong>{label}</strong>
        <br />
        <span className="dim">{description}</span>
      </span>
    </label>
  )
}

export type { TransportKind }
