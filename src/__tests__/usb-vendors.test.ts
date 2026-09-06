import { describe, it, expect } from 'vitest'
import { vendorName, deviceName, KNOWN_DEVICES } from '../transport/usb-vendors'
import { isFtdiDevice, FTDI_VENDOR_ID } from '../transport/ftdi'

describe('adapter identification', () => {
  it('recognises the Cummins INLINE vendor and device', () => {
    // Observed in the field: USB\VID_0AFE&PID_0004.
    expect(vendorName(0x0afe)).toMatch(/cummins/i)
    expect(deviceName(0x0afe, 0x0004)).toMatch(/INLINE/)
  })

  it('recognises FTDI bridges consistently across both paths', () => {
    expect(vendorName(FTDI_VENDOR_ID)).toMatch(/FTDI/)
    expect(isFtdiDevice({ vendorId: FTDI_VENDOR_ID } as USBDevice)).toBe(true)
    expect(isFtdiDevice({ vendorId: 0x0afe } as USBDevice)).toBe(false)
  })

  it('returns nothing for an unknown device rather than inventing a name', () => {
    expect(vendorName(0x9999)).toBeUndefined()
    expect(deviceName(0x9999, 0x0001)).toBeUndefined()
  })

  it('keys every known device as lowercase vid:pid', () => {
    for (const key of Object.keys(KNOWN_DEVICES)) {
      expect(key).toMatch(/^[0-9a-f]{4}:[0-9a-f]{4}$/)
    }
  })
})
