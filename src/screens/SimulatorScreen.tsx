import { useReducer } from 'react'
import { useAppState, useTicker } from '../app/hooks'
import { Panel, Note, Empty, Tag } from '../ui/primitives'
import type { FaultInjection } from '../sim/engine-model'
import { describeFault } from '../model/fault-codes'

/**
 * Bench simulator controls.
 *
 * Drives the simulated engine and injects failures, so every diagnostic screen
 * can be exercised - including the fault paths - without a vehicle.
 */

const FAULT_SWITCHES: Array<{ key: keyof FaultInjection; label: string; note: string }> = [
  { key: 'oilPressureSensorHigh', label: 'Oil pressure sensor open circuit', note: 'SPN 100 FMI 3' },
  { key: 'oilPressureSensorLow', label: 'Oil pressure sensor shorted low', note: 'SPN 100 FMI 4' },
  { key: 'lowOilPressure', label: 'Genuinely low oil pressure', note: 'SPN 100 FMI 1' },
  { key: 'coolantSensorHigh', label: 'Coolant temperature sensor open', note: 'SPN 110 FMI 3' },
  { key: 'coolantSensorLow', label: 'Coolant temperature sensor shorted', note: 'SPN 110 FMI 4' },
  { key: 'overheat', label: 'Overheating', note: 'SPN 110 FMI 16 then FMI 0' },
  { key: 'lowCoolantLevel', label: 'Low coolant level', note: 'SPN 111 FMI 1' },
  { key: 'boostSensorLow', label: 'Boost pressure sensor shorted low', note: 'SPN 102 FMI 4' },
  { key: 'fuelPressureLow', label: 'Low fuel delivery pressure', note: 'SPN 94 FMI 1' },
  { key: 'waterInFuel', label: 'Water in fuel', note: 'SPN 97 FMI 15' },
  { key: 'chargingSystemFailure', label: 'Charging system failure', note: 'SPN 168 FMI 1' },
  { key: 'camSensorLoss', label: 'Loss of engine position signal', note: 'SPN 190 FMI 2 - engine stops' },
  { key: 'sensorSupplyLow', label: '+5V sensor supply shorted', note: 'SPN 620 FMI 4' },
  { key: 'ecmInternalFailure', label: 'ECM internal failure', note: 'SPN 629 FMI 12' },
  { key: 'dpfSootHigh', label: 'Particulate filter loading up', note: 'SPN 3719 FMI 16' },
  { key: 'defLow', label: 'DEF tank draining', note: 'SPN 1761 FMI 1' },
]

export function SimulatorScreen() {
  const { simulator } = useAppState()
  // The ticker keeps live readings fresh; user input repaints immediately so
  // switches and sliders never appear to lag behind the click.
  useTicker(250)
  const [, repaint] = useReducer((count: number) => count + 1, 0)

  if (!simulator) {
    return (
      <>
        <h1>Bench simulator</h1>
        <Panel title="Simulator">
          <Empty>Connect using the bench simulator interface to use these controls.</Empty>
        </Panel>
      </>
    )
  }

  const { ecm } = simulator
  const { state, inputs, faults } = ecm

  function setInput<K extends keyof typeof inputs>(key: K, value: (typeof inputs)[K]) {
    ecm.inputs = { ...ecm.inputs, [key]: value }
    repaint()
  }

  function setFault(key: keyof FaultInjection, value: boolean) {
    ecm.faults = { ...ecm.faults, [key]: value }
    repaint()
  }

  return (
    <>
      <h1>Bench simulator</h1>
      <p className="lead">
        The simulated ECM broadcasts genuine J1939 messages at production rates. Anything switched
        on here appears on the fault codes screen exactly as a real fault would, having gone through
        DM1 encoding, transport protocol reassembly and decoding.
      </p>

      <div className="columns two">
        <Panel title="Engine controls">
          <div className="stack">
            <div className="row">
              <button
                className="btn"
                onClick={() => {
                  if (state.running) ecm.stopEngine()
                  else ecm.startEngine()
                  repaint()
                }}
              >
                {state.running ? 'Stop engine' : 'Start engine'}
              </button>
              <Tag tone={state.running ? 'green' : 'grey'}>{state.running ? 'Running' : 'Stopped'}</Tag>
              <span className="mono dim">{state.engineSpeedRpm.toFixed(0)} rpm</span>
            </div>

            <Slider
              label="Accelerator pedal"
              value={inputs.throttlePct}
              max={100}
              unit="%"
              onChange={(value) => setInput('throttlePct', value)}
            />
            <Slider
              label="Engine load"
              value={inputs.loadDemand * 100}
              max={100}
              unit="%"
              onChange={(value) => setInput('loadDemand', value / 100)}
            />
            <Slider
              label="Ambient temperature"
              value={inputs.ambientTempC}
              min={-30}
              max={50}
              unit="°C"
              onChange={(value) => setInput('ambientTempC', value)}
            />
            <label className="inline">
              Model speed
              <select
                className="field"
                defaultValue="1"
                onChange={(event) => simulator.setTimeScale(Number(event.target.value))}
              >
                <option value="1">Real time</option>
                <option value="10">10x</option>
                <option value="60">60x (warm-up)</option>
                <option value="300">300x (accumulate hours)</option>
              </select>
            </label>

            <div>
              <strong>Cylinder cut-out</strong>
              <div className="row" style={{ marginTop: 4 }}>
                {[1, 2, 3, 4, 5, 6].map((cylinder) => {
                  const cut = inputs.cutCylinders.includes(cylinder)
                  return (
                    <button
                      key={cylinder}
                      className={cut ? 'btn small danger' : 'btn small'}
                      onClick={() =>
                        setInput(
                          'cutCylinders',
                          cut
                            ? inputs.cutCylinders.filter((c) => c !== cylinder)
                            : [...inputs.cutCylinders, cylinder],
                        )
                      }
                    >
                      #{cylinder}
                      {cut ? ' cut' : ''}
                    </button>
                  )
                })}
              </div>
              <p className="dim" style={{ margin: '4px 0 0' }}>
                Cutting a cylinder drops its contribution and pulls engine speed down, the way a
                cylinder performance test does.
              </p>
            </div>
          </div>
        </Panel>

        <Panel title="Fault injection">
          <div className="stack" style={{ gap: 3 }}>
            {FAULT_SWITCHES.map((entry) => (
              <label key={entry.key} className="inline" style={{ justifyContent: 'space-between' }}>
                <span>
                  <input
                    type="checkbox"
                    checked={faults[entry.key] as boolean}
                    onChange={(event) => setFault(entry.key, event.target.checked)}
                  />{' '}
                  {entry.label}
                </span>
                <span className="dim mono">{entry.note}</span>
              </label>
            ))}
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button
              className="btn"
              onClick={() => {
                ecm.faults = FAULT_SWITCHES.reduce(
                  (accumulator, entry) => ({ ...accumulator, [entry.key]: false }),
                  ecm.faults,
                )
                repaint()
              }}
            >
              Clear all injected faults
            </button>
          </div>
        </Panel>
      </div>

      <Panel title="Simulated ECM fault memory" flush>
        {ecm.activeFaults.length === 0 && ecm.inactiveFaults.length === 0 ? (
          <Empty>No faults stored.</Empty>
        ) : (
          <table className="grid">
            <thead>
              <tr>
                <th style={{ width: 80 }}>Status</th>
                <th className="num" style={{ width: 70 }}>SPN</th>
                <th className="num" style={{ width: 60 }}>FMI</th>
                <th className="num" style={{ width: 80 }}>Count</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {[...ecm.activeFaults, ...ecm.inactiveFaults].map((fault) => (
                <tr key={`${fault.spn}:${fault.fmi}`}>
                  <td>
                    {fault.active ? <Tag tone="red">Active</Tag> : <Tag tone="grey">Inactive</Tag>}
                  </td>
                  <td className="num mono">{fault.spn}</td>
                  <td className="num mono">{fault.fmi}</td>
                  <td className="num mono">{fault.occurrenceCount}</td>
                  <td>{describeFault(fault.spn, fault.fmi).description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Note title="This is a model, not a vehicle">
        <p>
          Values are produced by a simplified engine model for exercising the tool. They are
          representative, not calibration data, and must never be used as a reference for judging a
          real engine.
        </p>
      </Note>
    </>
  )
}

function Slider({
  label,
  value,
  min = 0,
  max,
  unit,
  onChange,
}: {
  label: string
  value: number
  min?: number
  max: number
  unit: string
  onChange: (value: number) => void
}) {
  return (
    <label style={{ display: 'block' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span>{label}</span>
        <span className="mono">
          {value.toFixed(0)} {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ width: '100%' }}
      />
    </label>
  )
}
