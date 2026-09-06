/**
 * USB identifiers seen on heavy-duty datalink adapters.
 *
 * These are observations, not an official registry: adapter vendors do not
 * publish their USB identifiers, and the entries here come from devices seen
 * in the field. An unrecognised device is not a problem - the connection flow
 * never filters on vendor ID, it lists everything and lets you choose.
 */

export const KNOWN_VENDORS: Record<number, string> = {
  0x0403: 'FTDI — USB-serial bridge chip',
  0x0afe: 'Cummins INLINE adapter family',
  0x1cbe: 'Texas Instruments (used by some adapters)',
  0x16d0: 'MCS Electronics (shared vendor ID, various adapters)',
  0x1d50: 'OpenMoko (candleLight, CANable and other open CAN adapters)',
  0xad50: 'Nexiq (observed)',
}

/** Specific devices, where the model is known. */
export const KNOWN_DEVICES: Record<string, string> = {
  '0afe:0004': 'Cummins INLINE 6 datalink adapter',
  '1d50:606f': 'candleLight / CANable in gs_usb firmware',
  '1d50:60c4': 'CANable 2.0',
}

export function vendorName(vendorId: number): string | undefined {
  return KNOWN_VENDORS[vendorId]
}

export function deviceName(vendorId: number, productId: number): string | undefined {
  const key = `${vendorId.toString(16).padStart(4, '0')}:${productId.toString(16).padStart(4, '0')}`
  return KNOWN_DEVICES[key]
}
