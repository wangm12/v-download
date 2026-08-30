import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { buildTranscodeArgs, createTranscodeOutputPath, type TranscodePresetId } from './transcodeModel'
import * as settings from './settings'

export interface TranscodeProgress {
  percent: number
  phase: 'transcoding' | 'complete'
}

export interface TranscodeFileOptions {
  inputPath: string
  preset: TranscodePresetId
  durationSec?: number | null
  onProgress?: (progress: TranscodeProgress) => void
}

export interface TranscodeFileResult {
  inputPath: string
  outputPath: string
  bytes: number
}

function getUniqueOutputPath(inputPath: string, preset: TranscodePresetId): string {
  const existingPaths = new Set<string>()
  let outputPath = createTranscodeOutputPath(inputPath, preset, existingPaths)
  while (existsSync(outputPath)) {
    existingPaths.add(outputPath)
    outputPath = createTranscodeOutputPath(inputPath, preset, existingPaths)
  }
  return outputPath
}

export async function transcodeFile(options: TranscodeFileOptions): Promise<TranscodeFileResult> {
  const inputPath = options.inputPath.trim()
  if (!inputPath || !existsSync(inputPath) || !statSync(inputPath).isFile()) {
    throw new Error('The completed file is no longer available')
  }

  const ffmpegPath = settings.get('ffmpegPath')
  if (!ffmpegPath) throw new Error('FFmpeg is not configured. Open Preferences to configure it.')

  const outputPath = getUniqueOutputPath(inputPath, options.preset)
  const args = buildTranscodeArgs(inputPath, outputPath, options.preset)
  const onProgress = options.onProgress ?? (() => {})
  onProgress({ percent: 0, phase: 'transcoding' })

  const result = await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: process.env,
    })
    let stderr = ''
    let settled = false
    const finish = (value: { code: number | null; stderr: string }) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-12_000)
    })
    proc.once('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
    proc.once('close', (code) => finish({ code, stderr }))
  }).catch((error) => {
    throw new Error(`FFmpeg could not start: ${error instanceof Error ? error.message : String(error)}`)
  })

  if (result.code !== 0 || !existsSync(outputPath)) {
    await unlink(outputPath).catch(() => {})
    const detail = result.stderr.trim().split('\n').filter(Boolean).slice(-1)[0]
    throw new Error(detail ? `FFmpeg failed: ${detail}` : `FFmpeg exited with code ${result.code ?? 'unknown'}`)
  }

  const bytes = statSync(outputPath).size
  onProgress({ percent: 100, phase: 'complete' })
  return { inputPath, outputPath, bytes }
}
