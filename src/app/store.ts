import { DatalinkSession, DEFAULT_SESSION_OPTIONS } from './session'
import type { SessionOptions } from './session'
import type { Transport } from '../transport/types'
import type { AdapterCodec, BinaryFramingProfile } from '../protocol/framing'
import { BinaryFramingCodec } from '../protocol/framing'
import { SlcanCodec } from '../protocol/slcan'
import { GsUsbCodec, setupGsUsb, stopGsUsb } from '../protocol/gsusb'
import { BUILT_IN_PROFILES, cloneProfile } from '../protocol/profiles'
import {
  WebUsbTransport,
  requestUsbDevice,
  getAuthorisedDevices,
  isWebUsbAvailable,
  describeUsbDevice,
  usbErrorHint,
} from '../transport/webusb'
import { WebSerialTransport, requestSerialPort, isWebSerialAvailable } from '../transport/webserial'
import { SimulatorTransport } from '../sim/simulator-transport'
import type { AuditEntry, AuditAction } from '../model/types'

/**
 * Application state: which transport and adapter protocol are selected, the
 * live session, and the audit trail of everything the technician did.
 */

export type ScreenId =
  | 'connection'
  | 'ecm-information'
  | 'fault-codes'
  | 'monitor'
  | 'trip-information'
  | 'datalink'
  | 'analyser'
  | 'usb-devices'
  | 'simulator'
  | 'audit'

export type TransportKind = 'webusb' | 'webserial' | 'simulator'

export type CodecId = 'slcan' | 'gs_usb' | 'binary'

export interface ConnectionSettings {
  transport: TransportKind
  codec: CodecId
  /** Framing profile used when the codec is the configurable binary one. */
  profile: BinaryFramingProfile
  /** CAN bitrate. J1939 is 250 kbit/s; some engines run the bus at 500. */
  bitrate: number
  listenOnly: boolean
  /** Serial/FTDI line rate between the host and the adapter. */
  baudRate: number
  /** Force FTDI handling even when the vendor ID is not FTDI's. */
  forceFtdi: boolean
  /** Restrict the USB interface claimed, when auto-detection picks wrongly. */
  interfaceNumber: number | null
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface AppState {
  screen: ScreenId
  status: ConnectionStatus
  statusMessage: string
  settings: ConnectionSettings
  session: DatalinkSession | null
  /** Set when the active session is the bench simulator. */
  simulator: SimulatorTransport | null
  deviceLabel: string | null
  audit: AuditEntry[]
  /** Devices this origin has already been granted access to. */
  knownDevices: { label: string; vendorId: number; productId: number }[]
}

const SETTINGS_KEY = 'service-tool.connection-settings'

function loadSettings(): ConnectionSettings {
  const defaults: ConnectionSettings = {
    transport: 'simulator',
    codec: 'slcan',
    profile: cloneProfile(BUILT_IN_PROFILES[0]),
    bitrate: 250000,
    listenOnly: false,
    baudRate: 500000,
    forceFtdi: false,
    interfaceNumber: null,
  }
  try {
    const stored = localStorage.getItem(SETTINGS_KEY)
    if (!stored) return defaults
    return { ...defaults, ...(JSON.parse(stored) as Partial<ConnectionSettings>) }
  } catch {
    return defaults
  }
}

function saveSettings(settings: ConnectionSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // Storage may be unavailable (private browsing); settings just do not persist.
  }
}

export class AppStore {
  private state: AppState = {
    screen: 'connection',
    status: 'disconnected',
    statusMessage: 'Not connected',
    settings: loadSettings(),
    session: null,
    simulator: null,
    deviceLabel: null,
    audit: [],
    knownDevices: [],
  }

  private listeners = new Set<() => void>()
  private sessionUnsubscribe: (() => void) | null = null
  /** Kept so the gs_usb bus can be stopped cleanly on disconnect. */
  private gsUsbCleanup: (() => Promise<void>) | null = null

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getState = (): AppState => this.state

  private set(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }

  setScreen(screen: ScreenId): void {
    this.set({ screen })
  }

  updateSettings(patch: Partial<ConnectionSettings>): void {
    const settings = { ...this.state.settings, ...patch }
    saveSettings(settings)
    this.set({ settings })
  }

  audit(action: AuditAction, summary: string, detail?: string): void {
    const entry: AuditEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      action,
      summary,
      detail,
      user: 'Local user',
    }
    this.set({ audit: [entry, ...this.state.audit].slice(0, 500) })
  }

  async refreshKnownDevices(): Promise<void> {
    if (!isWebUsbAvailable()) return
    const devices = await getAuthorisedDevices()
    this.set({
      knownDevices: devices.map((device) => ({
        label: describeUsbDevice(device),
        vendorId: device.vendorId,
        productId: device.productId,
      })),
    })
  }

  private makeCodec(): AdapterCodec {
    switch (this.state.settings.codec) {
      case 'slcan':
        return new SlcanCodec()
      case 'gs_usb':
        return new GsUsbCodec()
      case 'binary':
        return new BinaryFramingCodec(this.state.settings.profile)
    }
  }

  private sessionOptions(): SessionOptions {
    return {
      ...DEFAULT_SESSION_OPTIONS,
      bitrate: this.state.settings.bitrate,
      listenOnly: this.state.settings.listenOnly,
    }
  }

  /** Prompt for a USB device and connect to it. */
  async connectUsb(): Promise<void> {
    if (!isWebUsbAvailable()) {
      this.set({
        status: 'error',
        statusMessage:
          'WebUSB is not available. Use Chrome, Edge or another Chromium browser, served over HTTPS or from localhost.',
      })
      return
    }
    this.set({ status: 'connecting', statusMessage: 'Selecting USB device...' })
    try {
      const { settings } = this.state
      const device = await requestUsbDevice()
      const transport = new WebUsbTransport(device, {
        ftdi: settings.forceFtdi || undefined,
        baudRate: settings.baudRate,
        interfaceNumber: settings.interfaceNumber ?? undefined,
      })
      await this.startSession(transport, describeUsbDevice(device), async () => {
        if (settings.codec === 'gs_usb') {
          const interfaceNumber = transport.info.interfaceNumber ?? 0
          await setupGsUsb(device, interfaceNumber, {
            bitrate: settings.bitrate,
            listenOnly: settings.listenOnly,
          })
          this.gsUsbCleanup = () => stopGsUsb(device, interfaceNumber)
        }
      })
      void this.refreshKnownDevices()
    } catch (error) {
      this.set({ status: 'error', statusMessage: usbErrorHint(error) })
    }
  }

  /** Prompt for a serial port and connect to it. */
  async connectSerial(): Promise<void> {
    if (!isWebSerialAvailable()) {
      this.set({ status: 'error', statusMessage: 'Web Serial is not available in this browser.' })
      return
    }
    this.set({ status: 'connecting', statusMessage: 'Selecting serial port...' })
    try {
      const port = await requestSerialPort()
      const transport = new WebSerialTransport(port, { baudRate: this.state.settings.baudRate })
      await this.startSession(transport, 'Serial port')
    } catch (error) {
      this.set({
        status: 'error',
        statusMessage: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /** Connect to the built-in bench simulator. */
  async connectSimulator(): Promise<void> {
    this.set({ status: 'connecting', statusMessage: 'Starting bench simulator...' })
    const transport = new SimulatorTransport(() => this.makeCodec(), { tickMs: 20 })
    transport.ecm.startEngine()
    await this.startSession(transport, 'Bench simulator')
    this.set({ simulator: transport })
  }

  private async startSession(
    transport: Transport,
    label: string,
    afterOpen?: () => Promise<void>,
  ): Promise<void> {
    await this.disconnect(false)
    const session = new DatalinkSession(transport, this.makeCodec(), this.sessionOptions())
    try {
      await session.start()
      if (afterOpen) await afterOpen()
    } catch (error) {
      this.set({ status: 'error', statusMessage: usbErrorHint(error) })
      return
    }
    this.sessionUnsubscribe = session.subscribe(() => {
      for (const listener of this.listeners) listener()
    })
    this.set({
      session,
      status: 'connected',
      statusMessage: `Connected to ${label}`,
      deviceLabel: label,
      screen: this.state.screen === 'connection' ? 'ecm-information' : this.state.screen,
    })
    this.audit('connect', `Connected to ${label}`, `Adapter protocol: ${session.codec.name}, ${this.state.settings.bitrate / 1000} kbit/s`)

    // Ask the bus who is out there and what faults are stored.
    if (!this.state.settings.listenOnly) {
      await session.requestIdentification().catch(() => undefined)
      await session.requestInactiveFaults().catch(() => undefined)
    }
  }

  async disconnect(record = true): Promise<void> {
    const { session } = this.state
    if (this.gsUsbCleanup) {
      await this.gsUsbCleanup().catch(() => undefined)
      this.gsUsbCleanup = null
    }
    if (session) {
      await session.stop().catch(() => undefined)
      if (record) this.audit('disconnect', `Disconnected from ${this.state.deviceLabel ?? 'adapter'}`)
    }
    this.sessionUnsubscribe?.()
    this.sessionUnsubscribe = null
    this.set({
      session: null,
      simulator: null,
      status: 'disconnected',
      statusMessage: 'Not connected',
      deviceLabel: null,
    })
  }
}

export const appStore = new AppStore()
