import { useSession } from '../app/hooks'
import { Panel, Empty, Properties } from '../ui/primitives'
import { formatSignal } from '../model/signals'
import type { SignalKey, SignalFrame } from '../model/types'

/**
 * Trip and lifetime totals.
 *
 * Everything here is broadcast by the ECM on the standard PGNs (engine hours,
 * fuel consumption, vehicle distance); nothing is derived or estimated, so a
 * value the ECM does not broadcast is shown as unavailable rather than
 * computed from something else.
 */
export function TripInformationScreen() {
  const { signals } = useSession()

  const anyData = ['engineHours', 'totalFuelLitres', 'odometerKm', 'tripFuelLitres'].some(
    (key) => signals[key as SignalKey] !== undefined,
  )

  const economy = derivedEconomy(signals)

  return (
    <>
      <h1>Trip information</h1>
      <p className="lead">
        Totals reported by the engine controller. Trip counters are reset by the vehicle or by a
        service tool with the manufacturer’s proprietary command, which is not part of the open
        J1939 standard and is therefore not offered here.
      </p>

      {!anyData ? (
        <Panel title="Totals">
          <Empty>
            No totals decoded yet. The relevant PGNs are broadcast about once a second on a running
            engine.
          </Empty>
        </Panel>
      ) : (
        <div className="columns two">
          <Panel title="Lifetime totals">
            <Properties
              entries={[
                ['Total engine hours', value(signals, 'engineHours')],
                ['Total engine idle hours', value(signals, 'engineIdleHours')],
                ['Total vehicle distance', value(signals, 'odometerKm')],
                ['Total fuel used', value(signals, 'totalFuelLitres')],
                ['Average fuel economy', value(signals, 'avgFuelEconomyKmpl')],
              ]}
            />
          </Panel>
          <Panel title="Trip totals">
            <Properties
              entries={[
                ['Trip distance', value(signals, 'tripDistanceKm')],
                ['Trip fuel', value(signals, 'tripFuelLitres')],
                ['Instantaneous fuel economy', value(signals, 'instantFuelEconomyKmpl')],
                [
                  'Litres per 100 km (derived)',
                  economy === null ? undefined : `${economy.toFixed(2)} L/100km`,
                ],
              ]}
            />
          </Panel>
        </div>
      )}

      <Panel title="Current operating point">
        <Properties
          entries={[
            ['Engine speed', value(signals, 'engineSpeedRpm')],
            ['Vehicle speed', value(signals, 'vehicleSpeedKph')],
            ['Engine load', value(signals, 'engineLoadPct')],
            ['Fuel rate', value(signals, 'fuelRateLph')],
            ['Coolant temperature', value(signals, 'coolantTempC')],
            ['Oil pressure', value(signals, 'oilPressureKpa')],
          ]}
        />
      </Panel>
    </>
  )
}

function value(signals: SignalFrame, key: SignalKey): string | undefined {
  const sample = signals[key]
  return sample ? formatSignal(key, sample.value) : undefined
}

/** Convert broadcast km/L into the L/100km figure used in most of the world. */
function derivedEconomy(signals: SignalFrame): number | null {
  const kmPerLitre = signals.instantFuelEconomyKmpl?.value
  if (kmPerLitre === undefined || kmPerLitre <= 0.01) return null
  return 100 / kmPerLitre
}
