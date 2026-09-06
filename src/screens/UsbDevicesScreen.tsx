import { useCallback, useEffect, useState } from 'react'
import { Panel, Note, Empty, Tag } from '../ui/primitives'
import {
  isWebUsbAvailable,
  requestUsbDevice,
  getAuthorisedDevices,
  selectEndpoints,
  describeUsbDevice,
  usbErrorHint,
} from '../transport/webusb'
import { isWebSerialAvailable, getAuthorisedPorts, requestSerialPort } from '../transport/webserial'
import { isFtdiDevice } from '../transport/ftdi'
import { vendorName, deviceName } from '../transport/usb-vendors'

/**
 * USB device inspector.
 *
 * When an adapter's framing is undocumented, the first question is what the
 * device actually exposes: which interfaces, of which class, with which
 * endpoints. This dumps the descriptor tree the browser can see and says which
 * interface the connection logic would claim, so a device that will not
 * connect can be diagnosed rather than guessed at.
 */

interface EndpointRow {
  number: number
  direction: string
  type: string
  packetSize: number
}

interface AlternateRow {
  alternateSetting: number
  interfaceClass: number
  interfaceSubclass: number
  interfaceProtocol: number
  endpoints: EndpointRow[]
}

interface InterfaceRow {
  interfaceNumber: number
  claimed: boolean
  alternates: AlternateRow[]
}

interface DeviceRow {
  device: USBDevice
  label: string
  vendorId: number
  productId: number
  manufacturer?: string
  product?: string
  serialNumber?: string
  usbVersion: string
  deviceClass: number
  interfaces: InterfaceRow[]
  /** Interface and endpoints the transport would auto-select. */
  selection: { interfaceNumber: number; endpointIn: number; endpointOut: number } | null
  selectionError: string | null
  ftdi: boolean
}

/** USB class codes worth naming, so a descriptor dump reads as English. */
const USB_CLASSES: Record<number, string> = {
  0x00: 'Per-interface',
  0x01: 'Audio',
  0x02: 'Communications (CDC)',
  0x03: 'Human interface (HID)',
  0x05: 'Physical',
  0x06: 'Image',
  0x07: 'Printer',
  0x08: 'Mass storage',
  0x09: 'Hub',
  0x0a: 'CDC data',
  0x0b: 'Smart card',
  0x0d: 'Content security',
  0x0e: 'Video',
  0x0f: 'Personal healthcare',
  0xdc: 'Diagnostic device',
  0xe0: 'Wireless controller',
  0xef: 'Miscellaneous',
  0xfe: 'Application specific',
  0xff: 'Vendor specific',
}

/**
 * Chrome refuses to let a page claim interfaces of these classes, so a device
 * that exposes only these cannot be driven from the browser at all.
 */
const PROTECTED_CLASSES = new Set([0x01, 0x03, 0x08, 0x0b, 0x0e])

function classLabel(code: number): string {
  const name = USB_CLASSES[code]
  return name ? `${name} (0x${hex2(code)})` : `0x${hex2(code)}`
}

function hex2(value: number): string {
  return value.toString(16).toUpperCase().padStart(2, '0')
}

function hex4(value: number): string {
  return value.toString(16).toUpperCase().padStart(4, '0')
}

function inspect(device: USBDevice): DeviceRow {
  const configuration = device.configuration ?? device.configurations[0]
  let selection: DeviceRow['selection'] = null
  let selectionError: string | null = null
  try {
    const chosen = selectEndpoints(device)
    selection = {
      interfaceNumber: chosen.interfaceNumber,
      endpointIn: chosen.endpointIn,
      endpointOut: chosen.endpointOut,
    }
  } catch (error) {
    selectionError = error instanceof Error ? error.message : String(error)
  }

  return {
    device,
    label: describeUsbDevice(device),
    vendorId: device.vendorId,
    productId: device.productId,
    manufacturer: device.manufacturerName ?? undefined,
    product: device.productName ?? undefined,
    serialNumber: device.serialNumber ?? undefined,
    usbVersion: `${device.usbVersionMajor}.${device.usbVersionMinor}`,
    deviceClass: device.deviceClass,
    ftdi: isFtdiDevice(device),
    selection,
    selectionError,
    interfaces: (configuration?.interfaces ?? []).map((iface) => ({
      interfaceNumber: iface.interfaceNumber,
      claimed: iface.claimed,
      alternates: iface.alternates.map((alternate) => ({
        alternateSetting: alternate.alternateSetting,
        interfaceClass: alternate.interfaceClass,
        interfaceSubclass: alternate.interfaceSubclass,
        interfaceProtocol: alternate.interfaceProtocol,
        endpoints: alternate.endpoints.map((endpoint) => ({
          number: endpoint.endpointNumber,
          direction: endpoint.direction,
          type: endpoint.type,
          packetSize: endpoint.packetSize,
        })),
      })),
    })),
  }
}

/** A plain-text dump, so a descriptor tree can be pasted into a bug report. */
function asText(row: DeviceRow): string {
  const lines: string[] = []
  lines.push(`Device: ${row.product ?? '(no product string)'}`)
  lines.push(`  Manufacturer:  ${row.manufacturer ?? '(none)'}`)
  lines.push(`  Vendor ID:     0x${hex4(row.vendorId)}`)
  lines.push(`  Product ID:    0x${hex4(row.productId)}`)
  lines.push(`  Serial number: ${row.serialNumber ?? '(none)'}`)
  lines.push(`  USB version:   ${row.usbVersion}`)
  lines.push(`  Device class:  ${classLabel(row.deviceClass)}`)
  for (const iface of row.interfaces) {
    lines.push(`  Interface ${iface.interfaceNumber}${iface.claimed ? ' (claimed)' : ''}`)
    for (const alternate of iface.alternates) {
      lines.push(
        `    Alt ${alternate.alternateSetting}: class ${classLabel(alternate.interfaceClass)}, subclass 0x${hex2(alternate.interfaceSubclass)}, protocol 0x${hex2(alternate.interfaceProtocol)}`,
      )
      if (alternate.endpoints.length === 0) lines.push('      (no endpoints)')
      for (const endpoint of alternate.endpoints) {
        lines.push(
          `      EP ${endpoint.number} ${endpoint.direction.toUpperCase()} ${endpoint.type}, ${endpoint.packetSize} byte packets`,
        )
      }
    }
  }
  lines.push(
    row.selection
      ? `  Auto-selected: interface ${row.selection.interfaceNumber}, IN endpoint ${row.selection.endpointIn}, OUT endpoint ${row.selection.endpointOut}`
      : `  Auto-selection failed: ${row.selectionError}`,
  )
  return lines.join('\n')
}

export function UsbDevicesScreen() {
  const [rows, setRows] = useState<DeviceRow[]>([])
  const [ports, setPorts] = useState<number>(0)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const refresh = useCallback(async () => {
    if (isWebUsbAvailable()) {
      const devices = await getAuthorisedDevices()
      setRows(devices.map(inspect))
    }
    if (isWebSerialAvailable()) {
      setPorts((await getAuthorisedPorts()).length)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function addDevice() {
    setError(null)
    try {
      await requestUsbDevice()
      await refresh()
    } catch (caught) {
      setError(usbErrorHint(caught))
    }
  }

  async function addPort() {
    setError(null)
    try {
      await requestSerialPort()
      await refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  function copyAll() {
    const text = rows.map(asText).join('\n\n')
    void navigator.clipboard?.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!isWebUsbAvailable()) {
    return (
      <>
        <h1>USB devices</h1>
        <Note kind="error" title="WebUSB is not available">
          <p>
            This browser does not implement WebUSB, or the page is not in a secure context. Use
            Chrome or Edge over HTTPS or on localhost.
          </p>
        </Note>
      </>
    )
  }

  return (
    <>
      <h1>USB devices</h1>
      <p className="lead">
        What the browser can see of each device you have granted access to. Use this when an adapter
        will not connect: it shows whether the device exposes a claimable interface, and which one
        the tool would use.
      </p>

      <div className="row" style={{ marginBottom: 10 }}>
        <button className="btn primary" onClick={() => void addDevice()}>
          Grant access to a USB device
        </button>
        <button className="btn" onClick={() => void refresh()}>
          Refresh
        </button>
        <button className="btn" onClick={copyAll} disabled={rows.length === 0}>
          {copied ? 'Copied' : 'Copy all as text'}
        </button>
        {isWebSerialAvailable() ? (
          <button className="btn" onClick={() => void addPort()}>
            Grant access to a serial port
          </button>
        ) : null}
      </div>

      {error ? (
        <Note kind="error" title="Could not add device">
          <p>{error}</p>
        </Note>
      ) : null}

      <Note title="An empty device picker is itself a clue">
        <p>
          The picker lists every USB device with no vendor filter, so if the adapter is not there,
          the operating system is not presenting it in a form the browser can offer. On Windows check
          Device Manager for the device and its driver; if a vendor driver such as Cummins’ RP1210
          owns it, rebind the interface to WinUSB. On Linux check <code className="mono">lsusb</code>{' '}
          and whether a kernel driver has claimed it.
        </p>
        <p>
          Serial ports are listed separately by the browser, and only devices that enumerate as a
          serial port appear there — {ports} port{ports === 1 ? '' : 's'} currently authorised. A
          vendor-specific device will never show in the serial picker, which is why an adapter can be
          plugged in and still find nothing.
        </p>
      </Note>

      {rows.length === 0 ? (
        <Panel title="Authorised devices">
          <Empty>
            No devices authorised yet. Press “Grant access to a USB device” and pick the adapter from
            the browser’s list.
          </Empty>
        </Panel>
      ) : (
        rows.map((row) => <DevicePanel key={`${row.vendorId}:${row.productId}:${row.serialNumber ?? ''}`} row={row} />)
      )}
    </>
  )
}

function DevicePanel({ row }: { row: DeviceRow }) {
  const onlyProtected =
    row.interfaces.length > 0 &&
    row.interfaces.every((iface) =>
      iface.alternates.every((alternate) => PROTECTED_CLASSES.has(alternate.interfaceClass)),
    )

  const recognised = deviceName(row.vendorId, row.productId)
  const vendor = vendorName(row.vendorId)

  return (
    <Panel
      title={row.product ?? recognised ?? row.label}
      hint={`0x${hex4(row.vendorId)}:0x${hex4(row.productId)}`}
    >
      <table className="grid" style={{ marginBottom: 8 }}>
        <tbody>
          {recognised ? (
            <tr>
              <th style={{ width: 170 }}>Recognised as</th>
              <td>{recognised}</td>
            </tr>
          ) : null}
          <tr>
            <th style={{ width: 170 }}>Vendor</th>
            <td>{vendor ?? <span className="dim">unrecognised vendor ID</span>}</td>
          </tr>
          <tr>
            <th>Manufacturer</th>
            <td>{row.manufacturer ?? <span className="dim">(none reported)</span>}</td>
          </tr>
          <tr>
            <th>Serial number</th>
            <td className="mono">{row.serialNumber ?? <span className="dim">(none)</span>}</td>
          </tr>
          <tr>
            <th>USB version</th>
            <td className="mono">{row.usbVersion}</td>
          </tr>
          <tr>
            <th>Device class</th>
            <td>{classLabel(row.deviceClass)}</td>
          </tr>
          <tr>
            <th>Auto-selected interface</th>
            <td>
              {row.selection ? (
                <span className="mono">
                  interface {row.selection.interfaceNumber}, IN endpoint {row.selection.endpointIn}, OUT
                  endpoint {row.selection.endpointOut}
                </span>
              ) : (
                <span style={{ color: 'var(--red)' }}>{row.selectionError}</span>
              )}
            </td>
          </tr>
        </tbody>
      </table>

      {row.ftdi ? (
        <Note title="FTDI bridge detected">
          <p>
            This device uses an FTDI USB-serial chip. Tick “Treat device as an FTDI bridge” on the
            connection screen so the chip is configured and its two status bytes per packet are
            stripped.
          </p>
        </Note>
      ) : null}

      {onlyProtected ? (
        <Note kind="warning" title="Every interface uses a protected class">
          <p>
            Browsers refuse to claim interfaces of these classes (audio, HID, mass storage, smart
            card, video), so this device cannot be driven over WebUSB as it currently enumerates.
          </p>
        </Note>
      ) : null}

      <h2>Interfaces</h2>
      <table className="grid">
        <thead>
          <tr>
            <th className="num" style={{ width: 70 }}>Interface</th>
            <th className="num" style={{ width: 50 }}>Alt</th>
            <th style={{ width: 190 }}>Class</th>
            <th className="num" style={{ width: 80 }}>Subclass</th>
            <th className="num" style={{ width: 80 }}>Protocol</th>
            <th>Endpoints</th>
          </tr>
        </thead>
        <tbody>
          {row.interfaces.flatMap((iface) =>
            iface.alternates.map((alternate) => {
              const usable = alternate.endpoints.some((e) => e.type === 'bulk' || e.type === 'interrupt')
              return (
                <tr key={`${iface.interfaceNumber}-${alternate.alternateSetting}`}>
                  <td className="num mono">
                    {iface.interfaceNumber}
                    {iface.claimed ? ' *' : ''}
                  </td>
                  <td className="num mono">{alternate.alternateSetting}</td>
                  <td>
                    {classLabel(alternate.interfaceClass)}{' '}
                    {alternate.interfaceClass === 0xff ? <Tag tone="green">claimable</Tag> : null}
                    {PROTECTED_CLASSES.has(alternate.interfaceClass) ? <Tag tone="red">protected</Tag> : null}
                  </td>
                  <td className="num mono">0x{hex2(alternate.interfaceSubclass)}</td>
                  <td className="num mono">0x{hex2(alternate.interfaceProtocol)}</td>
                  <td className="mono">
                    {alternate.endpoints.length === 0 ? (
                      <span className="dim">none</span>
                    ) : (
                      alternate.endpoints
                        .map((e) => `${e.number} ${e.direction.toUpperCase()} ${e.type} ${e.packetSize}B`)
                        .join('   ')
                    )}
                    {!usable && alternate.endpoints.length > 0 ? (
                      <span className="dim"> (no bulk/interrupt pair)</span>
                    ) : null}
                  </td>
                </tr>
              )
            }),
          )}
        </tbody>
      </table>
      {row.interfaces.some((iface) => iface.claimed) ? (
        <p className="dim">* interface is currently claimed by this page.</p>
      ) : null}
    </Panel>
  )
}
