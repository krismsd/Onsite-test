/**
 * Browser smoke test.
 *
 * Builds are not enough for an application whose whole job is decoding a live
 * byte stream, so this drives a real browser: connect to the bench simulator,
 * inject faults, and check that each screen renders decoded data rather than
 * placeholders.
 *
 *   npm run build && npm run preview &
 *   node scripts/smoke.mjs [screenshot-directory]
 */
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const BASE_URL = process.env.SMOKE_URL ?? 'http://localhost:4173/'
const shots = process.argv[2] ?? null
if (shots) await mkdir(shots, { recursive: true })

const failures = []
function check(description, condition) {
  if (condition) console.log(`  ok   ${description}`)
  else {
    console.log(`  FAIL ${description}`)
    failures.push(description)
  }
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? undefined,
})
const page = await browser.newPage({ viewport: { width: 1440, height: 980 } })
const consoleErrors = []
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})
page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`))

async function screenshot(name) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` })
}

async function open(name) {
  await page.getByRole('button', { name, exact: true }).click()
  await page.waitForTimeout(600)
}

try {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' })
  check('page loads', (await page.title()).length > 0)

  await page.getByRole('button', { name: 'Connect', exact: true }).first().click()
  await page.waitForTimeout(1500)
  const status = await page.locator('.statusbar .cell').first().innerText()
  check('connects to the bench simulator', status.includes('Bench simulator'))

  await open('ECM information')
  const identification = await page.locator('dl.properties').first().innerText()
  check('reads ECM identification over a BAM response', identification.includes('79451235'))
  await screenshot('ecm-information')

  await open('Bench simulator')
  for (const label of ['Coolant temperature sensor open', 'Water in fuel', 'Low fuel delivery pressure']) {
    await page.locator('label', { hasText: label }).locator('input[type=checkbox]').check()
  }
  await screenshot('simulator')
  await page.waitForTimeout(2000)

  await open('Fault codes')
  // 'Active faults' also matches 'Previously active faults', so anchor on the header text.
  const activePanel = page.locator('.panel').filter({ has: page.getByText('Active faults', { exact: true }) })
  const faultRows = await activePanel.locator('tbody tr').count()
  check('decodes injected faults from DM1', faultRows >= 3)
  const faultText = await activePanel.innerText()
  check('maps SPN/FMI to a fault code', faultText.includes('418'))
  await activePanel.locator('tbody tr').first().click()
  await page.waitForTimeout(300)
  check('shows a fault detail pane', await page.locator('.panel', { hasText: 'Fault detail' }).isVisible())
  await screenshot('fault-codes')

  await open('Monitor')
  await page.waitForTimeout(2500)
  const rpmCell = await page
    .locator('table.grid tr', { hasText: 'Engine Speed' })
    .locator('td.num')
    .first()
    .innerText()
  check('decodes live engine speed', /\d/.test(rpmCell) && !rpmCell.includes('- - -'))
  await screenshot('monitor')

  await open('Datalink monitor')
  const frameRows = await page.locator('.panel', { hasText: 'Frames' }).locator('tbody tr').count()
  check('lists raw datalink frames', frameRows > 20)
  await screenshot('datalink')

  await open('Capture analyser')
  await page.getByRole('button', { name: 'Start recording' }).click()
  await page.waitForTimeout(2000)
  await page.getByRole('button', { name: 'Stop and analyse' }).click()
  await page.waitForTimeout(600)
  const findings = await page.locator('.panel', { hasText: 'Findings' }).innerText()
  check('analyser identifies the ASCII adapter protocol', /slcan/i.test(findings))
  await screenshot('analyser')

  await open('Trip information')

  await open('USB devices')
  const usbScreen = await page.locator('.content').innerText()
  check('USB inspector renders', usbScreen.includes('Grant access to a USB device'))

  await open('Audit trail')
  const audit = await page.locator('.panel', { hasText: 'Events' }).innerText()
  check('records the connection in the audit trail', audit.includes('Connected'))
  await screenshot('audit')

  check('no console errors', consoleErrors.length === 0)
  if (consoleErrors.length) console.log(consoleErrors)
} finally {
  await browser.close()
}

if (failures.length > 0) {
  console.error(`\n${failures.length} smoke check(s) failed`)
  process.exit(1)
}
console.log('\nAll smoke checks passed')
