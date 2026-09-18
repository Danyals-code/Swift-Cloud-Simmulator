import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PNG } from 'pngjs'

const geometryKeys = ['x', 'y', 'width', 'height']
const identityKeys = ['sourceSHA256', 'profile', 'device', 'appearance', 'textSize', 'scenario']
export function compareMeasurements(reference, actual, contract) {
  const failures = []
  if (!contract || contract.approved !== true) return ['Native comparison thresholds have not been calibrated and approved.']
  if (!Number.isFinite(contract.geometryTolerancePoints) || contract.geometryTolerancePoints < 0 || contract.geometryTolerancePoints > 1) return ['Geometry tolerance must be between zero and one logical point.']
  for (const key of identityKeys) if (typeof reference[key] !== 'string' || reference[key] !== actual[key]) failures.push(`Capture identity differs: ${key}`)
  if (!reference.state || !actual.state || Object.keys(reference.state).length === 0) failures.push('State evidence is missing.')
  else for (const [key, value] of Object.entries(reference.state)) if (actual.state[key] !== value) failures.push(`State differs: ${key}`)
  if (!reference.nodes || !actual.nodes || Object.keys(reference.nodes).length === 0) failures.push('Geometry evidence is missing.')
  else for (const [name, expected] of Object.entries(reference.nodes)) {
    const received = actual.nodes[name]
    if (!received) { failures.push(`Missing node: ${name}`); continue }
    for (const key of geometryKeys) if (!Number.isFinite(expected[key]) || !Number.isFinite(received[key]) || Math.abs(expected[key] - received[key]) > contract.geometryTolerancePoints) failures.push(`Geometry differs: ${name}.${key}`)
    if (!Number.isInteger(expected.lineCount) || expected.lineCount !== received.lineCount) failures.push(`Line count differs: ${name}`)
  }
  return failures
}

function loadImage(path, expectedHash) {
  const bytes = readFileSync(path)
  const hash = createHash('sha256').update(bytes).digest('hex')
  if (expectedHash && expectedHash !== hash) throw new Error(`Image hash does not match capture evidence: ${path}`)
  return PNG.sync.read(bytes, { checkCRC: true })
}

export function regionDifference(reference, actual, region, channelDelta = 0) {
  if (reference.width !== actual.width || reference.height !== actual.height) throw new Error('Images must have matching dimensions and display scale; retain original native captures.')
  if (!Number.isInteger(channelDelta) || channelDelta < 0 || channelDelta > 255) throw new Error('Invalid channel threshold')
  const { x, y, width, height } = region
  if (![x, y, width, height].every(Number.isInteger) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > reference.width || y + height > reference.height) throw new Error('Invalid comparison region')
  let different = 0
  let maxChannelDelta = 0
  for (let row = y; row < y + height; row++) for (let col = x; col < x + width; col++) {
    const pixel = (row * reference.width + col) * 4
    let delta = 0
    for (let channel = 0; channel < 4; channel++) delta = Math.max(delta, Math.abs(reference.data[pixel + channel] - actual.data[pixel + channel]))
    maxChannelDelta = Math.max(maxChannelDelta, delta)
    if (delta > channelDelta) different++
  }
  return { differentPixels: different, differentPixelRatio: different / (width * height), maxChannelDelta }
}

/** Calibration measures noise. It never approves a production comparison threshold. */
export function calibrateImages(images, regions) {
  if (images.length < 5) throw new Error('At least five repeat captures are required.')
  if (!regions.length) throw new Error('Named comparison regions are required.')
  return { approved: false, repeatCaptures: images.length, regions: regions.map(region => {
    const results = images.slice(1).map(image => regionDifference(images[0], image, region))
    return { name: region.name, maxChannelDelta: Math.max(...results.map(r => r.maxChannelDelta)), maxDifferentPixelRatio: Math.max(...results.map(r => r.differentPixelRatio)) }
  }) }
}

export function compareCaptures(reference, actual, contract, images) {
  const failures = compareMeasurements(reference, actual, contract)
  if (failures.length) return failures
  if (!contract.regions?.length) return ['Image regions have not been calibrated.']
  if (!Number.isFinite(reference.displayScale) || reference.displayScale <= 0 || reference.displayScale !== actual.displayScale) return ['Capture display scales differ or are missing.']
  for (const region of contract.regions) {
    if (!Number.isFinite(region.maxDifferentPixelRatio) || region.maxDifferentPixelRatio < 0 || region.maxDifferentPixelRatio > 1) { failures.push(`Invalid image threshold: ${region.name}`); continue }
    const result = regionDifference(images.reference, images.actual, region, region.channelDelta)
    if (result.differentPixelRatio > region.maxDifferentPixelRatio) failures.push(`Image region differs: ${region.name}`)
  }
  return failures
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, ...paths] = process.argv.slice(2)
  const json = path => JSON.parse(readFileSync(path, 'utf8'))
  try {
    if (mode === 'calibrate') {
      const [regions, ...captures] = paths
      console.log(JSON.stringify(calibrateImages(captures.map(path => loadImage(path)), json(regions)), null, 2))
    } else if (mode === 'compare' && paths.length === 5) {
      const [expectedPath, actualPath, contractPath, expectedImage, actualImage] = paths
      const expected = json(expectedPath), actual = json(actualPath)
      if (!expected.imageSHA256 || !actual.imageSHA256) throw new Error('Capture image hashes are required.')
      const failures = compareCaptures(expected, actual, json(contractPath), { reference: loadImage(expectedImage, expected.imageSHA256), actual: loadImage(actualImage, actual.imageSHA256) })
      console.log(JSON.stringify({ status: failures.length ? 'fail' : 'pass', failures }, null, 2))
      process.exitCode = failures.length ? 1 : 0
    } else throw new Error('Use calibrate regions.json repeat1.png ... repeat5.png, or compare native.json browser.json contract.json native.png browser.png.')
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
