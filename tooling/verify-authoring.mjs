import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const contract = JSON.parse(readFileSync(join(root, 'docs', 'authoring', 'contract.json'), 'utf8'))
const args = process.argv.slice(2)
const option = key => { const at = args.indexOf(key); return at < 0 ? undefined : args[at + 1] }
const mode = args.includes('--native') ? 'native' : args.includes('--web') ? 'web' : 'environment'
const output = resolve(option('--output') ?? join(root, '.verification', 'authoring', new Date().toISOString().replace(/[:.]/g, '-')))
mkdirSync(output, { recursive: true })
const run = (command, arguments_, timeout = 30_000, env = {}) => spawnSync(command, arguments_, { cwd: root, encoding: 'utf8', timeout, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, ...env } })
const probe = (command, arguments_) => {
  const result = run(command, arguments_)
  return { command: [command, ...arguments_], exitCode: result.status, stdout: result.stdout?.trim(), stderr: result.stderr?.trim(), error: result.error?.message }
}
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex')
const report = {
  schemaVersion: 1, mode, startedAt: new Date().toISOString(), output,
  environment: {
    commit: probe('git', ['rev-parse', 'HEAD']), workingTree: probe('git', ['status', '--porcelain']),
    lockSHA256: hash(join(root, 'package-lock.json')), node: process.version,
    npm: probe('npm', ['--version']), platform: process.platform, arch: process.arch,
    macOS: probe('sw_vers', []), hardware: probe('sysctl', ['-n', 'hw.model']),
    xcode: probe('xcodebuild', ['-version']), swift: probe('xcrun', ['swift', '--version']),
    simulatorRuntimes: probe('xcrun', ['simctl', 'list', 'runtimes', '--json']),
    locale: Intl.DateTimeFormat().resolvedOptions(), playwright: JSON.parse(readFileSync(join(root, 'node_modules', '@playwright', 'test', 'package.json'), 'utf8')).version,
    fonts: probe('system_profiler', ['SPFontsDataType', '-json']),
  },
  checks: [],
}
const persist = () => writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2))
persist()
function check(name, command, arguments_, timeout = 300_000, env = {}) {
  const startedAt = new Date().toISOString()
  const result = run(command, arguments_, timeout, env)
  writeFileSync(join(output, `${name}.log`), `${result.stdout ?? ''}\n${result.stderr ?? ''}\n${result.error?.message ?? ''}`)
  report.checks.push({ name, command: [command, ...arguments_], startedAt, finishedAt: new Date().toISOString(), status: result.status === 0 ? 'pass' : 'fail', exitCode: result.status, signal: result.signal, log: `${name}.log` })
  persist()
  console.log(`${name}: ${result.status === 0 ? 'pass' : 'fail'}`)
  return result.status === 0
}
function blocked(name, reason) { report.checks.push({ name, status: 'blocked', reason }); persist(); console.error(`${name}: blocked (${reason})`) }

if (process.version !== `v${contract.node}` || report.environment.npm.stdout !== contract.npm) blocked('toolchain', `Use Node ${contract.node} and npm ${contract.npm} before comparing results.`)
else if (mode === 'web') {
  check('verify', 'npm', ['run', 'verify'])
  if (check('build', 'npm', ['run', 'build'])) {
    check('budget', 'npm', ['run', 'budget'])
    check('e2e', 'npm', ['run', 'e2e', '--', '--workers=2', '--max-failures=3'], 900_000)
    check('e2e-perf', 'npm', ['run', 'e2e:perf'], 600_000)
  } else blocked('e2e', 'A production build from these sources is required.')
} else if (mode === 'native') {
  const exported = join(output, 'export')
  if (check('export', 'npm', ['test', '--', 'tests/authoring-native.test.ts'], 120_000, { AUTHORING_EXPORT_DIR: exported })) {
    const project = join(exported, 'AuthoringReference', 'AuthoringReference.xcodeproj')
    const buildArgs = ['-project', project, '-scheme', 'AuthoringVerification', '-configuration', 'Debug', '-sdk', 'iphonesimulator', '-derivedDataPath', join(output, 'DerivedData'), 'CODE_SIGNING_ALLOWED=NO', `CLANG_MODULE_CACHE_PATH=${join(output, 'ModuleCache')}`]
    const built = check('native-build', 'xcodebuild', ['build-for-testing', ...buildArgs, '-destination', 'generic/platform=iOS Simulator'], 600_000)
    const device = option('--device')
    if (!built) blocked('native-ui', 'The native build must succeed before execution.')
    else if (!device) blocked('native-ui', 'Pass --device with a dedicated simulator UUID after confirming the frozen runtime and device profile.')
    else if (report.environment.simulatorRuntimes.exitCode !== 0) blocked('native-ui', 'CoreSimulator service is unavailable; see the environment evidence.')
    else {
      const result = join(output, 'Native.xcresult')
      check('native-ui', 'xcodebuild', ['test-without-building', ...buildArgs, '-destination', `platform=iOS Simulator,id=${device}`, '-resultBundlePath', result], 600_000)
      check('native-attachments', 'xcrun', ['xcresulttool', 'export', 'attachments', '--path', result, '--output-path', join(output, 'attachments')])
    }
  }
  if (contract.nativeReference.status !== 'verified') blocked('native-parity', 'The complete device/appearance/text-size matrix and calibrated image thresholds have not been verified.')
}
persist()
console.log(`Evidence: ${join(output, 'report.json')}`)
process.exitCode = report.checks.some(c => c.status !== 'pass') ? 1 : 0
