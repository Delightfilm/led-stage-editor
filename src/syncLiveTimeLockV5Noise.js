import { SyncLiveTimeLockV5, SYNC_LIVE_V5 as BASE_V5 } from './syncLiveTimeLockV5.js'
import { SYNC_LIVE_CONSTANTS } from './syncLiveEngineV4.js'

const FRAME_SEC = SYNC_LIVE_CONSTANTS.FRAME_SEC || 0.1
const LIVE_WINDOW = SYNC_LIVE_CONSTANTS.LIVE_WINDOW || 18
const MIN_HZ = 90
const MAX_HZ = 9000

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const finite = (v) => Number.isFinite(v)

function bandCenter(index, count) {
  const ratio = Math.pow(MAX_HZ / MIN_HZ, 1 / count)
  return MIN_HZ * Math.pow(ratio, index + 0.5)
}

function fieldBandWeight(hz) {
  if (hz < 150) return 0.72       // HVAC / handling rumble
  if (hz < 300) return 1.00       // kick / bass fundamentals
  if (hz < 4000) return 0.62      // speech-heavy range: deliberately downweighted
  if (hz < 7600) return 1.14      // cymbal / transient detail that survives crowds well
  return 0.92
}

function weightedCosine(a, b, persistenceMask, staticWeights) {
  let dot = 0, aa = 0, bb = 0, weightSum = 0
  const n = Math.min(a?.length || 0, b?.length || 0, staticWeights.length)
  for (let i = 0; i < n; i += 1) {
    const persistence = persistenceMask?.[i] ?? 0.55
    const w = staticWeights[i] * persistence
    if (w <= 0.02) continue
    const av = Number(a[i] || 0)
    const bv = Number(b[i] || 0)
    dot += av * bv * w
    aa += av * av * w
    bb += bv * bv * w
    weightSum += w
  }
  if (weightSum < 0.5 || aa <= 1e-9 || bb <= 1e-9) return -1
  return dot / Math.sqrt(aa * bb)
}

function robustWindowScore(live, ref, end, maskHistory, staticWeights) {
  const start = end - live.length + 1
  if (start < 0 || end >= ref.length) return -1
  let sum = 0, used = 0
  for (let i = 0; i < live.length; i += 1) {
    const score = weightedCosine(live[i], ref[start + i], maskHistory?.[i], staticWeights)
    if (score <= -0.99) continue
    sum += score
    used += 1
  }
  return used >= Math.max(6, Math.floor(live.length * 0.55)) ? sum / used : -1
}

function robustConfidence(score, separation = 0, quality = 1) {
  const base = clamp((score - 0.16) / 0.32, 0, 1)
  const unique = clamp(separation / 0.075, 0, 1)
  const qualityFloor = 0.78 + 0.22 * clamp(quality, 0, 1)
  return Math.round(clamp((base * 0.84 + unique * 0.16) * qualityFloor, 0, 1) * 100)
}

export class SyncLiveTimeLockV5Noise extends SyncLiveTimeLockV5 {
  constructor(reference) {
    super(reference)
    const bands = reference?.frames?.[0]?.length || 24
    this.staticWeights = Float32Array.from({ length: bands }, (_, i) => fieldBandWeight(bandCenter(i, bands)))
    this.noiseMean = new Float32Array(bands)
    this.noiseDev = new Float32Array(bands)
    this.persistence = new Uint8Array(bands)
    this.maskHistory = []
    this.noiseInitialized = false
    this.noiseQuality = 0
    this.noiseGate = true
    this.noiseStatus = 'CALIBRATING'
    this.speechDominance = 0
    this.persistentBands = 0
    this.noiseFramesSkipped = 0
    this.lastInputDb = null
  }

  resetSession(options = {}) {
    super.resetSession(options)
    if (!this.noiseMean) return
    this.noiseMean.fill(0)
    this.noiseDev.fill(0)
    this.persistence.fill(0)
    this.maskHistory = []
    this.noiseInitialized = false
    this.noiseQuality = 0
    this.noiseGate = true
    this.noiseStatus = 'CALIBRATING'
    this.speechDominance = 0
    this.persistentBands = 0
    this.noiseFramesSkipped = 0
    this.lastInputDb = null
  }

  analyzeFieldNoise(feature, inputDb = null) {
    const n = Math.min(feature?.length || 0, this.noiseMean.length)
    const mask = new Float32Array(n)
    this.lastInputDb = finite(inputDb) ? inputDb : this.lastInputDb

    if (!this.noiseInitialized) {
      for (let i = 0; i < n; i += 1) {
        this.noiseMean[i] = Number(feature[i] || 0)
        this.noiseDev[i] = 0.28
        mask[i] = 0.35
      }
      this.noiseInitialized = true
      this.noiseQuality = 0.38
      this.noiseGate = false
      this.noiseStatus = 'CALIBRATING'
      return mask
    }

    let salienceEnergy = 0
    let speechEnergy = 0
    let instantPositiveEnergy = 0
    let instantSpeechPositiveEnergy = 0
    let persistentBands = 0
    let nonSpeechPersistent = 0

    for (let i = 0; i < n; i += 1) {
      const value = Number(feature[i] || 0)
      const mean = this.noiseMean[i]
      const dev = Math.max(0.12, this.noiseDev[i])
      const delta = value - mean
      const threshold = Math.max(0.20, dev * 1.15)
      const active = delta > threshold

      if (active) this.persistence[i] = Math.min(6, this.persistence[i] + 1)
      else this.persistence[i] = Math.max(0, this.persistence[i] - 1)

      const persist = this.persistence[i]
      const persistenceWeight = persist >= 3 ? 1 : persist === 2 ? 0.78 : persist === 1 ? 0.38 : 0.16
      mask[i] = persistenceWeight

      const salience = Math.max(0, delta - threshold)
      const hz = bandCenter(i, n)
      const energy = salience * salience
      const positiveEnergy = Math.max(0, value) ** 2
      salienceEnergy += energy
      instantPositiveEnergy += positiveEnergy
      if (hz >= 300 && hz < 4000) {
        speechEnergy += energy
        instantSpeechPositiveEnergy += positiveEnergy
      }
      if (persist >= 2 && salience > 0.08) {
        persistentBands += 1
        if (hz < 300 || hz >= 4000) nonSpeechPersistent += 1
      }

      // Noise floor learns slowly upward so sustained music is not immediately
      // classified as room noise, but follows downward changes more quickly.
      const meanAlpha = delta > 0 ? 0.006 : 0.035
      this.noiseMean[i] = mean + delta * meanAlpha
      const absResidual = Math.abs(value - this.noiseMean[i])
      this.noiseDev[i] = dev + (absResidual - dev) * 0.028
    }

    const salienceSpeechDominance = salienceEnergy > 1e-7 ? speechEnergy / salienceEnergy : 0
    const instantSpeechDominance = instantPositiveEnergy > 1e-7 ? instantSpeechPositiveEnergy / instantPositiveEnergy : 0
    const speechDominance = Math.max(salienceSpeechDominance, instantSpeechDominance * 0.96)
    const bandScore = clamp((persistentBands - 1) / 5, 0, 1)
    const energyScore = clamp(Math.sqrt(salienceEnergy) / 2.0, 0, 1)
    const levelScore = finite(this.lastInputDb) ? clamp((this.lastInputDb + 68) / 28, 0, 1) : 0.65
    const speechPenalty = clamp((speechDominance - 0.72) / 0.28, 0, 1) * 0.28
    const quality = clamp((bandScore * 0.42 + energyScore * 0.38 + levelScore * 0.20) * (1 - speechPenalty), 0, 1)

    // Near-pure speech is intentionally not trusted: audience speech and a vocal-only
    // section are acoustically too similar to distinguish safely from a room mic.
    const speechOnly = instantSpeechDominance > 0.965
    // A one-frame clap / impact can be broad and loud but has not persisted long enough
    // to be useful music evidence. Skip it rather than recording a verification failure.
    const transientOnly = persistentBands < 2 && salienceEnergy > 0.55
    const tooWeak = finite(this.lastInputDb) && this.lastInputDb < -72
    const gate = quality < 0.24 || speechOnly || transientOnly || tooWeak

    this.noiseQuality = quality
    this.noiseGate = gate
    this.speechDominance = speechDominance
    this.persistentBands = persistentBands
    this.noiseStatus = gate ? 'NO DECISION' : quality >= 0.70 ? 'CLEAN' : quality >= 0.46 ? 'USABLE' : 'NOISY'
    return mask
  }

  push(feature, raw, now = performance.now(), environment = {}) {
    const mask = this.analyzeFieldNoise(feature, environment?.inputDb)
    this.maskHistory.push(mask)
    if (this.maskHistory.length > LIVE_WINDOW) this.maskHistory.shift()

    let adjustedRaw = raw
    if (raw && finite(raw.confidence)) {
      const qualityScale = 0.82 + 0.18 * this.noiseQuality
      adjustedRaw = { ...raw, confidence: Math.round(clamp(raw.confidence * qualityScale, 0, 100)) }
    }
    return super.push(feature, adjustedRaw, now)
  }

  pickEvidence(raw, now) {
    if (this.noiseGate) return null
    return super.pickEvidence(raw, now)
  }

  updateVerification(evidence, now) {
    if (this.noiseGate) {
      this.noiseFramesSkipped += 1
      return
    }
    super.updateVerification(evidence, now)
  }

  searchWindow(win) {
    const frames = this.reference?.frames || []
    if (!frames.length || this.live.length < 10) return null
    const lo = Math.max(this.live.length - 1, Math.ceil(win.inSec / FRAME_SEC))
    const hi = Math.min(frames.length - 1, Math.floor(win.outSec / FRAME_SEC))
    if (hi < lo) return null

    let best = -1, second = -1, bestIndex = -1
    for (let i = lo; i <= hi; i += 1) {
      const sec = i * FRAME_SEC
      if (this.isRejected(sec)) continue
      const score = robustWindowScore(this.live, frames, i, this.maskHistory, this.staticWeights)
      if (score > best) {
        second = best
        best = score
        bestIndex = i
      } else if (score > second) second = score
    }
    if (bestIndex < 0 || best < 0.18) return null
    const separation = second < -0.5 ? 0.08 : Math.max(0, best - second)
    return {
      positionSec: bestIndex * FRAME_SEC,
      confidence: robustConfidence(best, separation, this.noiseQuality),
      score: best,
      source: 'NOISE-RESISTANT WINDOW',
    }
  }

  snapshot(now = performance.now(), evidence = null, extra = {}) {
    const base = super.snapshot(now, evidence, extra)
    return {
      ...base,
      noiseStatus: this.noiseStatus || 'CALIBRATING',
      noiseQuality: Math.round(clamp(this.noiseQuality || 0, 0, 1) * 100),
      snrGate: !!this.noiseGate,
      speechDominance: Math.round(clamp(this.speechDominance || 0, 0, 1) * 100),
      persistentBands: this.persistentBands || 0,
      noiseFramesSkipped: this.noiseFramesSkipped || 0,
      fieldMatcherVersion: 'V5.0 NOISE RESISTANT',
    }
  }
}

export const SYNC_LIVE_V5 = {
  ...BASE_V5,
  version: 'V5.0 NOISE RESISTANT',
  speechBandHz: [300, 4000],
  snrGateMode: 'SKIP_NOT_FAIL',
}

export const __SYNC_LIVE_NOISE_TESTING__ = {
  bandCenter,
  fieldBandWeight,
  weightedCosine,
  robustWindowScore,
}
