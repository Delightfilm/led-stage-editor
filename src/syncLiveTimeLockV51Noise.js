import { SyncLiveTimeLockV5Noise as BaseNoiseMatcher, SYNC_LIVE_V5 as BASE_NOISE } from './syncLiveTimeLockV5Noise.js'

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const finite = (v) => Number.isFinite(v)

const WARMUP_FRAMES = 6
const RELEASE_FRAMES = 2
const SNR_GATE_DB = -2.5
const SNR_RECOVER_DB = 0.0

function meanAbs(values) {
  if (!values?.length) return 0
  let sum = 0
  for (let i = 0; i < values.length; i += 1) sum += Math.abs(Number(values[i] || 0))
  return sum / values.length
}

function snrProxyDb(feature, noiseMean, noiseDev) {
  const n = Math.min(feature?.length || 0, noiseMean?.length || 0, noiseDev?.length || 0)
  if (!n) return -60
  let signal = 0
  let noise = 0
  for (let i = 0; i < n; i += 1) {
    const residual = Math.max(0, Math.abs(Number(feature[i] || 0) - Number(noiseMean[i] || 0)) - Math.max(0.08, Number(noiseDev[i] || 0) * 0.55))
    signal += residual * residual
    const d = Math.max(0.08, Number(noiseDev[i] || 0))
    noise += d * d
  }
  return 10 * Math.log10((signal + 1e-7) / (noise + 1e-7))
}

export class SyncLiveTimeLockV51Noise extends BaseNoiseMatcher {
  constructor(reference) {
    super(reference)
    this.v51WarmupFrames = 0
    this.v51CleanStreak = 0
    this.v51GateStreak = 0
    this.v51SnrDb = -60
    this.v51SnrScore = 0
    this.v51NoiseFloorLevel = 0
    this.v51PersistenceRatio = 0
    this.v51GateReason = 'CALIBRATING'
  }

  resetSession(options = {}) {
    super.resetSession(options)
    this.v51WarmupFrames = 0
    this.v51CleanStreak = 0
    this.v51GateStreak = 0
    this.v51SnrDb = -60
    this.v51SnrScore = 0
    this.v51NoiseFloorLevel = 0
    this.v51PersistenceRatio = 0
    this.v51GateReason = 'CALIBRATING'
  }

  analyzeFieldNoise(feature, inputDb = null) {
    const mask = super.analyzeFieldNoise(feature, inputDb)
    this.v51WarmupFrames += 1

    const bands = Math.max(1, this.noiseMean?.length || 1)
    this.v51NoiseFloorLevel = meanAbs(this.noiseMean)
    this.v51SnrDb = snrProxyDb(feature, this.noiseMean, this.noiseDev)
    this.v51SnrScore = clamp((this.v51SnrDb + 6) / 18, 0, 1)
    this.v51PersistenceRatio = clamp((this.persistentBands || 0) / bands, 0, 1)

    const baseGate = !!this.noiseGate
    const warmup = this.v51WarmupFrames <= WARMUP_FRAMES
    const speechGate = Number(this.speechDominance || 0) >= 0.95
    const transientGate = (this.persistentBands || 0) < 2 && this.v51WarmupFrames > 2 && this.v51SnrDb > 1.5
    const weakGate = finite(this.lastInputDb) && this.lastInputDb < -72
    const snrGate = this.v51SnrDb < SNR_GATE_DB && Number(this.noiseQuality || 0) < 0.46

    let requestedGate = baseGate || warmup || speechGate || transientGate || weakGate || snrGate
    let reason = 'OK'
    if (warmup) reason = 'CALIBRATING'
    else if (speechGate) reason = 'SPEECH'
    else if (transientGate) reason = 'TRANSIENT'
    else if (weakGate) reason = 'WEAK INPUT'
    else if (snrGate) reason = 'LOW SNR'
    else if (baseGate) reason = 'NOISE'

    // Hysteresis: once a frame is gated, require two consecutive usable frames
    // and a slightly stronger SNR recovery before resuming verification.
    if (requestedGate) {
      this.v51GateStreak += 1
      this.v51CleanStreak = 0
    } else {
      this.v51CleanStreak += 1
      if (this.v51GateStreak > 0 && (this.v51CleanStreak < RELEASE_FRAMES || this.v51SnrDb < SNR_RECOVER_DB)) {
        requestedGate = true
        reason = 'RECOVERING'
      } else if (this.v51CleanStreak >= RELEASE_FRAMES) {
        this.v51GateStreak = 0
      }
    }

    this.noiseGate = requestedGate
    this.v51GateReason = reason
    this.noiseStatus = requestedGate
      ? (reason === 'CALIBRATING' ? 'CALIBRATING' : 'NO DECISION')
      : this.noiseQuality >= 0.70 ? 'CLEAN' : this.noiseQuality >= 0.46 ? 'USABLE' : 'NOISY'

    return mask
  }

  snapshot(now = performance.now(), evidence = null, extra = {}) {
    const base = super.snapshot(now, evidence, extra)
    return {
      ...base,
      noiseFloorLevel: Number(this.v51NoiseFloorLevel || 0).toFixed(3),
      snrDb: Number(this.v51SnrDb || -60).toFixed(1),
      snrScore: Math.round(clamp(this.v51SnrScore || 0, 0, 1) * 100),
      persistence: Math.round(clamp(this.v51PersistenceRatio || 0, 0, 1) * 100),
      gateReason: this.v51GateReason || 'CALIBRATING',
      fieldMatcherVersion: 'V5.1 NOISE RESISTANT',
    }
  }
}

export const SYNC_LIVE_V5 = {
  ...BASE_NOISE,
  version: 'V5.1 NOISE RESISTANT',
  adaptiveNoiseFloor: true,
  speechBandDownweight: true,
  transientPersistence: true,
  snrGating: true,
  snrGateDb: SNR_GATE_DB,
  snrRecoverDb: SNR_RECOVER_DB,
  warmupFrames: WARMUP_FRAMES,
  gateReleaseFrames: RELEASE_FRAMES,
}

export const __SYNC_LIVE_V51_TESTING__ = {
  meanAbs,
  snrProxyDb,
  WARMUP_FRAMES,
  RELEASE_FRAMES,
  SNR_GATE_DB,
  SNR_RECOVER_DB,
}
