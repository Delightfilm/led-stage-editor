import { SyncLiveMatcherV7 as BaseV7, SYNC_LIVE_V5 as BASE_V7 } from './syncLiveMatcherV7.js'
import { SYNC_LIVE_CONSTANTS } from './syncLiveEngineV4.js'

const FRAME_SEC = SYNC_LIVE_CONSTANTS.FRAME_SEC || 0.1
const ENSEMBLE_MARGIN = 0.07
const MIN_VALIDATORS = 3
const MIN_ENSEMBLE = 0.62

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

function cosine(a, b) {
  const n = Math.min(a?.length || 0, b?.length || 0)
  if (!n) return -1
  let dot = 0, aa = 0, bb = 0
  for (let i = 0; i < n; i += 1) {
    const av = Number(a[i] || 0), bv = Number(b[i] || 0)
    dot += av * bv; aa += av * av; bb += bv * bv
  }
  return aa > 1e-9 && bb > 1e-9 ? dot / Math.sqrt(aa * bb) : -1
}

function tonalSignature(frame) {
  const bins = new Float32Array(12)
  for (let i = 0; i < (frame?.length || 0); i += 1) {
    bins[i % 12] += Math.max(0, Number(frame[i] || 0) + 2.5)
  }
  let norm = 0
  for (const v of bins) norm += v * v
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < bins.length; i += 1) bins[i] /= norm
  return bins
}

function spectralFlux(prev, current) {
  if (!prev || !current) return 0
  const n = Math.min(prev.length, current.length)
  if (!n) return 0
  let sum = 0
  for (let i = 0; i < n; i += 1) sum += Math.max(0, Number(current[i] || 0) - Number(prev[i] || 0))
  return sum / n
}

function correlation(a, b) {
  const n = Math.min(a?.length || 0, b?.length || 0)
  if (n < 4) return 0
  let ma = 0, mb = 0
  for (let i = 0; i < n; i += 1) { ma += a[i]; mb += b[i] }
  ma /= n; mb /= n
  let num = 0, aa = 0, bb = 0
  for (let i = 0; i < n; i += 1) {
    const da = a[i] - ma, db = b[i] - mb
    num += da * db; aa += da * da; bb += db * db
  }
  return aa > 1e-9 && bb > 1e-9 ? clamp(num / Math.sqrt(aa * bb), -1, 1) : 0
}

function score01(value, lo, hi) {
  return clamp((Number(value || 0) - lo) / Math.max(1e-6, hi - lo), 0, 1)
}

export class SyncLiveMatcherV8 extends BaseV7 {
  constructor(reference) {
    super(reference)
    this.v8ReferenceTonal = (reference?.frames || []).map(tonalSignature)
    this.v8ReferenceFlux = new Float32Array(reference?.frames?.length || 0)
    for (let i = 1; i < this.v8ReferenceFlux.length; i += 1) {
      this.v8ReferenceFlux[i] = spectralFlux(reference.frames[i - 1], reference.frames[i])
    }
    this.v8Metrics = []
    this.v8Top = null
    this.v8EnsembleMargin = 0
    this.v8LastRaw = null
  }

  resetSession(options = {}) {
    super.resetSession(options)
    if (!this.v8Metrics) return
    this.v8Metrics = []
    this.v8Top = null
    this.v8EnsembleMargin = 0
    this.v8LastRaw = null
  }

  evaluateTrack(track, raw, now) {
    const frames = this.reference?.frames || []
    const predicted = track.positionSec + Math.max(0, (now - track.at) / 1000)
    const end = Math.round(predicted / FRAME_SEC)
    const liveCount = Math.min(14, this.live.length)
    if (liveCount < 8 || end < liveCount - 1 || end >= frames.length) return null

    const liveStart = this.live.length - liveCount
    const refStart = end - liveCount + 1

    let tonalSum = 0, tonalUsed = 0
    for (let j = 0; j < liveCount; j += 1) {
      const s = cosine(tonalSignature(this.live[liveStart + j]), this.v8ReferenceTonal[refStart + j])
      if (s > -0.5) { tonalSum += Math.max(0, s); tonalUsed += 1 }
    }
    const tonal = tonalUsed ? tonalSum / tonalUsed : 0

    const liveFlux = []
    const refFlux = []
    for (let j = 1; j < liveCount; j += 1) {
      liveFlux.push(spectralFlux(this.live[liveStart + j - 1], this.live[liveStart + j]))
      refFlux.push(this.v8ReferenceFlux[refStart + j])
    }
    const onset = score01(correlation(liveFlux, refFlux), -0.05, 0.75)
    const spectral = score01(track.score, 0.18, 0.55)
    const temporal = clamp((track.support || 0) / 16, 0, 1)
    const landmarkAgree = raw && Number.isFinite(raw.positionSec) && Math.abs(raw.positionSec - predicted) <= 0.5
    const landmark = landmarkAgree ? clamp(Number(raw.confidence || 0) / 100, 0, 1) : 0

    const validators = [
      spectral >= 0.55,
      tonal >= 0.72,
      onset >= 0.48,
      temporal >= 0.38,
      landmark >= 0.60,
    ].filter(Boolean).length

    const ensemble = spectral * 0.28 + tonal * 0.18 + onset * 0.20 + temporal * 0.20 + landmark * 0.14
    return {
      id: track.id,
      positionSec: predicted,
      ensemble,
      validators,
      spectral,
      tonal,
      onset,
      temporal,
      landmark,
      support: track.support || 0,
    }
  }

  evaluateEnsemble(raw, now) {
    const metrics = []
    for (const track of this.v7Tracks || []) {
      const m = this.evaluateTrack(track, raw, now)
      if (m) metrics.push(m)
    }
    metrics.sort((a, b) => b.ensemble - a.ensemble)
    this.v8Metrics = metrics
    this.v8Top = metrics[0] || null
    this.v8EnsembleMargin = metrics.length > 1 ? metrics[0].ensemble - metrics[1].ensemble : metrics.length ? metrics[0].ensemble : 0

    // Clear stale ambiguity once the candidate bank has actually converged to one track.
    if (metrics.length <= 1) {
      this.v7Ambiguous = false
      this.v7Margin = this.v8EnsembleMargin
    } else if (metrics[0].support >= 3 && metrics[1].support >= 3) {
      this.v7Ambiguous = this.v8EnsembleMargin < ENSEMBLE_MARGIN
      this.v7Margin = this.v8EnsembleMargin
    }
  }

  pickEvidence(raw, now) {
    this.v8LastRaw = raw
    const base = super.pickEvidence(raw, now)
    this.evaluateEnsemble(raw, now)
    const top = this.v8Top
    if (!top || top.validators < MIN_VALIDATORS || top.ensemble < MIN_ENSEMBLE) return base
    if (this.v7Ambiguous && !this.windowEnabled) return null

    const ensembleEvidence = {
      positionSec: top.positionSec,
      confidence: Math.round(clamp(top.ensemble, 0, 1) * 100),
      score: top.ensemble,
      source: `ENSEMBLE ${top.validators}/5`,
    }

    if (base && Math.abs(base.positionSec - ensembleEvidence.positionSec) <= 0.45) {
      return {
        positionSec: (base.positionSec + ensembleEvidence.positionSec) / 2,
        confidence: Math.min(100, Math.max(base.confidence, ensembleEvidence.confidence) + 4),
        score: Math.max(Number(base.score || 0), ensembleEvidence.score),
        source: `ENSEMBLE+BASE ${top.validators}/5`,
      }
    }
    return ensembleEvidence.confidence >= Number(base?.confidence || 0) ? ensembleEvidence : base
  }

  snapshot(now = performance.now(), evidence = null, extra = {}) {
    const base = super.snapshot(now, evidence, extra)
    const top = this.v8Top
    return {
      ...base,
      ensembleScore: top ? Math.round(top.ensemble * 100) : 0,
      ensembleValidators: top?.validators || 0,
      ensembleMargin: Number(this.v8EnsembleMargin || 0).toFixed(3),
      spectralVote: top ? Math.round(top.spectral * 100) : 0,
      tonalVote: top ? Math.round(top.tonal * 100) : 0,
      onsetVote: top ? Math.round(top.onset * 100) : 0,
      temporalVote: top ? Math.round(top.temporal * 100) : 0,
      landmarkVote: top ? Math.round(top.landmark * 100) : 0,
      fieldMatcherVersion: 'V8 ENSEMBLE',
    }
  }
}

export const SYNC_LIVE_V5 = {
  ...BASE_V7,
  version: 'V8 ENSEMBLE',
  ensemble: true,
  validators: ['spectral', 'tonal', 'onset', 'temporal', 'landmark'],
  minValidators: MIN_VALIDATORS,
  minEnsemble: MIN_ENSEMBLE,
  ensembleMargin: ENSEMBLE_MARGIN,
}

export const __SYNC_LIVE_V8_TESTING__ = {
  cosine,
  tonalSignature,
  spectralFlux,
  correlation,
  score01,
  MIN_VALIDATORS,
  MIN_ENSEMBLE,
}
