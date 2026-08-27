import { SyncLiveMatcherV8 as BaseV8, SYNC_LIVE_V5 as BASE_V8 } from './syncLiveMatcherV8.js'
import { SYNC_LIVE_CONSTANTS } from './syncLiveEngineV4.js'

const FRAME_SEC = SYNC_LIVE_CONSTANTS.FRAME_SEC || 0.1
const REMOTE_EXCLUDE_SEC = 8
const REPEATED_UNIQUENESS = 0.32
const REPEATED_CONTEXT_SEC = 8
const REPEATED_MARGIN = 0.09

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

function normalizeVector(values) {
  let norm = 0
  for (const v of values) norm += v * v
  norm = Math.sqrt(norm) || 1
  return Float32Array.from(values, (v) => v / norm)
}

function segmentVector(frames, center, radius = 6) {
  if (!frames?.length) return new Float32Array(0)
  const lo = Math.max(0, center - radius)
  const hi = Math.min(frames.length - 1, center + radius)
  const bands = frames[0]?.length || 0
  const mean = new Float32Array(bands)
  const variance = new Float32Array(bands)
  const count = Math.max(1, hi - lo + 1)

  for (let i = lo; i <= hi; i += 1) {
    for (let b = 0; b < bands; b += 1) mean[b] += Number(frames[i]?.[b] || 0)
  }
  for (let b = 0; b < bands; b += 1) mean[b] /= count
  for (let i = lo; i <= hi; i += 1) {
    for (let b = 0; b < bands; b += 1) {
      const d = Number(frames[i]?.[b] || 0) - mean[b]
      variance[b] += d * d
    }
  }
  for (let b = 0; b < bands; b += 1) variance[b] = Math.sqrt(variance[b] / count)
  return normalizeVector([...mean, ...variance])
}

function buildUniquenessMap(frames) {
  if (!frames?.length) return { stepFrames: 10, points: [] }
  // Cap analysis to roughly 360 sample points so long songs do not block the UI.
  const stepFrames = Math.max(10, Math.ceil(frames.length / 360))
  const points = []
  for (let frame = 0; frame < frames.length; frame += stepFrames) {
    points.push({ frame, vector: segmentVector(frames, frame), uniqueness: 1, remoteSimilarity: 0 })
  }
  const excludeFrames = Math.round(REMOTE_EXCLUDE_SEC / FRAME_SEC)
  for (let i = 0; i < points.length; i += 1) {
    let bestRemote = -1
    for (let j = 0; j < points.length; j += 1) {
      if (i === j || Math.abs(points[i].frame - points[j].frame) < excludeFrames) continue
      bestRemote = Math.max(bestRemote, cosine(points[i].vector, points[j].vector))
    }
    if (bestRemote < -0.5) bestRemote = 0
    points[i].remoteSimilarity = bestRemote
    // 0.98 similarity -> very ambiguous, 0.80 or lower -> effectively unique.
    points[i].uniqueness = clamp((0.98 - bestRemote) / 0.18, 0, 1)
  }
  return { stepFrames, points }
}

export class SyncLiveMatcherV9 extends BaseV8 {
  constructor(reference) {
    super(reference)
    const map = buildUniquenessMap(reference?.frames || [])
    this.v9UniquenessStep = map.stepFrames
    this.v9UniquenessPoints = map.points
    this.v9Uniqueness = 1
    this.v9RemoteSimilarity = 0
    this.v9RepeatedHold = false
    this.v9RepeatedSkipped = 0
    this.v9ContextSec = 0
  }

  resetSession(options = {}) {
    super.resetSession(options)
    if (!this.v9UniquenessPoints) return
    this.v9Uniqueness = 1
    this.v9RemoteSimilarity = 0
    this.v9RepeatedHold = false
    this.v9RepeatedSkipped = 0
    this.v9ContextSec = 0
  }

  uniquenessAt(positionSec) {
    if (!Number.isFinite(positionSec) || !this.v9UniquenessPoints?.length) return { uniqueness: 1, remoteSimilarity: 0 }
    const targetFrame = Math.round(positionSec / FRAME_SEC)
    const index = clamp(Math.round(targetFrame / this.v9UniquenessStep), 0, this.v9UniquenessPoints.length - 1)
    return this.v9UniquenessPoints[index] || { uniqueness: 1, remoteSimilarity: 0 }
  }

  updateRepeatedRegionPolicy(now) {
    const top = this.v8Top
    if (!top) {
      this.v9Uniqueness = 1
      this.v9RemoteSimilarity = 0
      this.v9RepeatedHold = false
      this.v9ContextSec = 0
      return
    }
    const region = this.uniquenessAt(top.positionSec)
    this.v9Uniqueness = region.uniqueness
    this.v9RemoteSimilarity = region.remoteSimilarity
    this.v9ContextSec = Math.max(0, Number(top.support || 0) * 0.5)

    const repeated = this.v9Uniqueness < REPEATED_UNIQUENESS
    const enoughContext = this.v9ContextSec >= (this.windowEnabled ? 4 : REPEATED_CONTEXT_SEC)
    const enoughMargin = Number(this.v8EnsembleMargin || 0) >= REPEATED_MARGIN || this.windowEnabled
    this.v9RepeatedHold = repeated && !(enoughContext && enoughMargin)
  }

  pickEvidence(raw, now) {
    const evidence = super.pickEvidence(raw, now)
    this.updateRepeatedRegionPolicy(now)
    if (this.v9RepeatedHold) return null
    return evidence
  }

  updateVerification(evidence, now) {
    if (this.v9RepeatedHold) {
      this.v9RepeatedSkipped += 1
      return
    }
    super.updateVerification(evidence, now)
  }

  snapshot(now = performance.now(), evidence = null, extra = {}) {
    const base = super.snapshot(now, evidence, extra)
    return {
      ...base,
      uniqueness: Math.round(clamp(this.v9Uniqueness || 0, 0, 1) * 100),
      remoteSimilarity: Math.round(clamp(this.v9RemoteSimilarity || 0, 0, 1) * 100),
      segmentClass: this.v9Uniqueness < REPEATED_UNIQUENESS ? 'REPEATED / AMBIGUOUS' : 'UNIQUE',
      repeatedHold: !!this.v9RepeatedHold,
      repeatedSkipped: this.v9RepeatedSkipped || 0,
      contextSec: Number(this.v9ContextSec || 0).toFixed(1),
      uniquenessSamples: this.v9UniquenessPoints?.length || 0,
      fieldMatcherVersion: 'V9 SEGMENT AWARE',
    }
  }
}

export const SYNC_LIVE_V5 = {
  ...BASE_V8,
  version: 'V9 SEGMENT AWARE',
  segmentUniqueness: true,
  repeatedRegionHold: true,
  repeatedUniquenessThreshold: REPEATED_UNIQUENESS,
  repeatedContextSec: REPEATED_CONTEXT_SEC,
  repeatedMargin: REPEATED_MARGIN,
}

export const __SYNC_LIVE_V9_TESTING__ = {
  cosine,
  normalizeVector,
  segmentVector,
  buildUniquenessMap,
  REPEATED_UNIQUENESS,
  REPEATED_CONTEXT_SEC,
  REPEATED_MARGIN,
}
