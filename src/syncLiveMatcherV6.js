import { SyncLiveTimeLockV51Noise as BaseV51, SYNC_LIVE_V5 as BASE_V51 } from './syncLiveTimeLockV51Noise.js'

const PROFILE_ALPHA = 0.012
const MAX_BAND_CORRECTION = 0.65
const TELEMETRY_MAX = 600

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

function bandMean(frames, bands) {
  const out = new Float32Array(bands)
  if (!frames?.length) return out
  for (const frame of frames) {
    for (let i = 0; i < bands; i += 1) out[i] += Number(frame?.[i] || 0)
  }
  for (let i = 0; i < bands; i += 1) out[i] /= frames.length
  return out
}

function renormalize(values) {
  if (!values?.length) return new Float32Array(0)
  let mean = 0
  for (const v of values) mean += v
  mean /= values.length
  let variance = 0
  for (const v of values) variance += (v - mean) * (v - mean)
  const std = Math.sqrt(variance / values.length) || 1
  return Float32Array.from(values, (v) => clamp((v - mean) / std, -3, 3))
}

export class SyncLiveMatcherV6 extends BaseV51 {
  constructor(reference) {
    super(reference)
    const bands = reference?.frames?.[0]?.length || 24
    this.v6ReferenceMean = bandMean(reference?.frames || [], bands)
    this.v6LiveMean = new Float32Array(bands)
    this.v6LiveInitialized = false
    this.v6EqCorrectionRms = 0
    this.v6Telemetry = []
    this.v6FrameCount = 0
  }

  resetSession(options = {}) {
    super.resetSession(options)
    if (!this.v6LiveMean) return
    this.v6LiveMean.fill(0)
    this.v6LiveInitialized = false
    this.v6EqCorrectionRms = 0
    this.v6Telemetry = []
    this.v6FrameCount = 0
  }

  normalizeForRoom(feature) {
    const n = Math.min(feature?.length || 0, this.v6LiveMean.length)
    if (!n) return feature

    if (!this.v6LiveInitialized) {
      for (let i = 0; i < n; i += 1) this.v6LiveMean[i] = Number(feature[i] || 0)
      this.v6LiveInitialized = true
    } else {
      // Learn venue / microphone spectral coloration slowly. During a gated frame we
      // learn even more slowly so a nearby shout does not become the new room profile.
      const alpha = this.noiseGate ? PROFILE_ALPHA * 0.25 : PROFILE_ALPHA
      for (let i = 0; i < n; i += 1) {
        const v = Number(feature[i] || 0)
        this.v6LiveMean[i] += (v - this.v6LiveMean[i]) * alpha
      }
    }

    const corrected = new Float32Array(n)
    let correctionPower = 0
    for (let i = 0; i < n; i += 1) {
      const bias = clamp(this.v6LiveMean[i] - this.v6ReferenceMean[i], -MAX_BAND_CORRECTION, MAX_BAND_CORRECTION)
      // Lowest bands are slightly suppressed to reduce HVAC, footsteps and handling rumble.
      const rumbleWeight = i === 0 ? 0.68 : i === 1 ? 0.84 : 1
      corrected[i] = (Number(feature[i] || 0) - bias) * rumbleWeight
      correctionPower += bias * bias
    }
    this.v6EqCorrectionRms = Math.sqrt(correctionPower / n)
    return renormalize(corrected)
  }

  push(feature, raw, now = performance.now(), environment = {}) {
    this.v6FrameCount += 1
    const adjusted = this.normalizeForRoom(feature)
    const result = super.push(adjusted, raw, now, environment)
    this.v6Telemetry.push({
      at: now,
      state: result.state,
      positionSec: result.positionSec,
      confidence: result.confidence,
      snrDb: Number(result.snrDb || -60),
      noiseStatus: result.noiseStatus,
      gateReason: result.gateReason,
      speech: Number(result.speechDominance || 0),
      eqRms: Number(this.v6EqCorrectionRms.toFixed(3)),
    })
    if (this.v6Telemetry.length > TELEMETRY_MAX) this.v6Telemetry.splice(0, this.v6Telemetry.length - TELEMETRY_MAX)
    return { ...result, telemetryCount: this.v6Telemetry.length }
  }

  snapshot(now = performance.now(), evidence = null, extra = {}) {
    const base = super.snapshot(now, evidence, extra)
    return {
      ...base,
      eqCorrectionRms: Number(this.v6EqCorrectionRms || 0).toFixed(3),
      telemetryCount: this.v6Telemetry?.length || 0,
      fieldMatcherVersion: 'V6 FIELD NORMALIZED',
    }
  }

  getTelemetry() {
    return this.v6Telemetry.slice()
  }
}

export const SYNC_LIVE_V5 = {
  ...BASE_V51,
  version: 'V6 FIELD NORMALIZED',
  roomEqNormalization: true,
  rumbleSuppression: true,
  telemetry: true,
  profileAlpha: PROFILE_ALPHA,
  maxBandCorrection: MAX_BAND_CORRECTION,
  telemetryFrames: TELEMETRY_MAX,
}

export const __SYNC_LIVE_V6_TESTING__ = {
  bandMean,
  renormalize,
  PROFILE_ALPHA,
  MAX_BAND_CORRECTION,
}
