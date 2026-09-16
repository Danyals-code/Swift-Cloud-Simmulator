import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

// Capture only: run the exported fixture and select its state in Simulator first.
// No boot, install, appearance change, or selection of an arbitrary device.
const [udid, state, output, textSize] = process.argv.slice(2)
const states = ['library', 'scrolled-library', 'details', 'settings', 'sheet', 'alert', 'menu']
if (!udid || !states.includes(state) || !output || !['large', 'accessibility3'].includes(textSize)) {
  throw new Error('Usage: node tooling/capture-ios27.mjs <simulator-UUID> <library|scrolled-library|details|settings|sheet|alert|menu> <output-directory> <large|accessibility3>\nSet the fixture screen and text size in Simulator before capturing. Text size is recorded as operator-declared.')
}
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', timeout: 30_000 }).trim()
const devices = JSON.parse(run('xcrun', ['simctl', 'list', 'devices', '--json'])).devices
const match = Object.entries(devices).flatMap(([runtime, entries]) => entries.map(d => ({ ...d, runtime }))).find(d => d.udid === udid)
if (!match || match.state !== 'Booted') throw new Error('The explicitly named simulator must already be booted.')
if (!/iOS-27(?:-|$)/.test(match.runtime)) throw new Error(`Expected an iOS 27 runtime, got ${match.runtime}`)
const sdk = run('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-version'])
if (!sdk.startsWith('27.')) throw new Error(`Expected SDK 27, got ${sdk}`)
const appearance = run('xcrun', ['simctl', 'ui', udid, 'appearance'])
const out = resolve(output)
mkdirSync(out, { recursive: true })
const image = `${state}-${Date.now()}.png`
run('xcrun', ['simctl', 'io', udid, 'screenshot', join(out, image)])
const bytes = readFileSync(join(out, image))
const fixture = readFileSync(new URL('../tests/fixtures/ios27-screens.swift', import.meta.url))
const hash = data => createHash('sha256').update(data).digest('hex')
const metadata = {
  profile: 'ios-27', status: 'captured-unmeasured', image, sha256: hash(bytes),
  fixtureSha256: hash(fixture), state, device: match.name, udid, runtime: match.runtime,
  sdk, xcode: run('xcodebuild', ['-version']), appearance, textSize, textSizeSource: 'operator-declared',
  pixels: { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }, capturedAt: new Date().toISOString(),
  measurements: null,
}
writeFileSync(join(out, image.replace('.png', '.json')), JSON.stringify(metadata, null, 2) + '\n')
console.log(`Saved ${join(out, image)} and capture metadata. Native calibration remains pending until measured and reviewed.`)
