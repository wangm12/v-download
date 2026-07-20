import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { runPreflight, runRestore } from './dev-native-preflight.mjs'

const root = resolve(new URL('..', import.meta.url).pathname)
const electronViteCommand = resolve(root, 'node_modules/.bin/electron-vite')

export function getDevPlan() {
  return { command: electronViteCommand, args: ['dev'] }
}

function signalExitCode(signal) {
  return signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1
}

function signalChildTree(child, signal) {
  if (!child || child.pid === undefined) return
  try {
    if (process.platform === 'win32') child.kill(signal)
    else process.kill(-child.pid, signal)
  } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
}

async function runDev() {
  let child
  let childExitCode = 1
  let primaryError
  let restoreError
  let nativeMayHaveChanged = false
  let receivedSignal

  const forwardSignal = (signal) => {
    receivedSignal ||= signal
    if (child && child.exitCode === null) signalChildTree(child, signal)
  }
  process.on('SIGINT', forwardSignal)
  process.on('SIGTERM', forwardSignal)

  try {
    nativeMayHaveChanged = true
    runPreflight()
    const plan = getDevPlan()
    child = spawn(plan.command, plan.args, {
      cwd: root,
      detached: process.platform !== 'win32',
      stdio: 'inherit',
    })
    if (receivedSignal) signalChildTree(child, receivedSignal)
    const result = await new Promise((resolveResult, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => resolveResult({ code, signal }))
    })
    childExitCode = receivedSignal ? signalExitCode(receivedSignal) : result.signal ? signalExitCode(result.signal) : result.code ?? 1
  } catch (error) {
    primaryError = error
  } finally {
    if (child && child.exitCode !== null) signalChildTree(child, 'SIGTERM')
    if (nativeMayHaveChanged) {
      try {
        runRestore()
      } catch (error) {
        restoreError = error
      }
    }
    process.off('SIGINT', forwardSignal)
    process.off('SIGTERM', forwardSignal)
  }

  if (primaryError) console.error(`DEV WORKFLOW BLOCKED: ${primaryError.message}`)
  if (restoreError) console.error(`DEV RESTORE BLOCKED: ${restoreError.message}`)
  process.exitCode = restoreError || primaryError ? 1 : childExitCode
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) runDev()
