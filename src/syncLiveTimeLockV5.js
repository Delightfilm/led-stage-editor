import { __SYNC_LIVE_TESTING__, SYNC_LIVE_CONSTANTS } from './syncLiveEngineV4.js'

const { windowScore } = __SYNC_LIVE_TESTING__
const FRAME_SEC = SYNC_LIVE_CONSTANTS.FRAME_SEC || 0.1
const LIVE_WINDOW = SYNC_LIVE_CONSTANTS.LIVE_WINDOW || 18
const VERIFY_FRAMES = 20
const VERIFY_PASS_REQUIRED = 16
const VERIFY_CONFIDENCE = 85
const VERIFY_TOLERANCE_SEC = 0.25
const FAST_FRAMES = 8
const FAST_CONFIDENCE = 93
const DEFAULT_WINDOW_WIDTH_SEC = 2
const REJECT_RADIUS_SEC = 2.5

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const finite = (v) => Number.isFinite(v)

function spectralConfidence(score, separation = 0) {
  const base = clamp((score - 0.18) / 0.30, 0, 1)
  const unique = clamp(separation / 0.08, 0, 1)
  return Math.round(clamp(base * 0.86 + unique * 0.14, 0, 1) * 100)
}

export class SyncLiveTimeLockV5 {
  constructor(reference) {
    this.reference = reference
    this.windowBase = null
    this.windowAnchorAt = null
    this.windowEnabled = false
    this.rejected = []
    this.resetSession({ preserveWindow: true })
  }

  resetSession({ preserveWindow = true } = {}) {
    this.live = []
    this.verify = []
    this.provisional = null
    this.candidate = null
    this.timeLock = null
    this.lastEvidence = null
    this.lastResult = null
    if (!preserveWindow) {
      this.windowBase = null
      this.windowAnchorAt = null
      this.windowEnabled = false
      this.rejected = []
    }
  }

  setWindow(inSec, outSec, now = performance.now(), enabled = true) {
    const duration = Number(this.reference?.duration || 0)
    let a = clamp(Number(inSec) || 0, 0, duration || Number.MAX_SAFE_INTEGER)
    let b = clamp(Number(outSec) || 0, 0, duration || Number.MAX_SAFE_INTEGER)
    if (b < a) [a, b] = [b, a]
    if (b - a < 0.2) b = Math.min(duration || a + 0.2, a + 0.2)
    this.windowBase = { inSec: a, outSec: b }
    this.windowAnchorAt = now
    this.windowEnabled = enabled
    this.verify = []
    this.provisional = null
    return this.currentWindow(now)
  }

  disableWindow() {
    this.windowEnabled = false
  }

  enableWindow(now = performance.now()) {
    if (!this.windowBase) return null
    this.windowAnchorAt = now
    this.windowEnabled = true
    return this.currentWindow(now)
  }

  currentWindow(now = performance.now()) {
    if (!this.windowBase) return null
    const elapsed = this.windowEnabled && this.windowAnchorAt != null ? Math.max(0, (now - this.windowAnchorAt) / 1000) : 0
    const duration = Number(this.reference?.duration || 0)
    return {
      inSec: clamp(this.windowBase.inSec + elapsed, 0, duration || Number.MAX_SAFE_INTEGER),
      outSec: clamp(this.windowBase.outSec + elapsed, 0, duration || Number.MAX_SAFE_INTEGER),
      widthSec: this.windowBase.outSec - this.windowBase.inSec,
      elapsedSec: elapsed,
      enabled: this.windowEnabled,
    }
  }

  isRejected(sec) {
    return this.rejected.some((r) => sec >= r.inSec && sec <= r.outSec)
  }

  rejectCandidate(now = performance.now()) {
    const pos = this.candidateClock(now)
    if (finite(pos)) this.rejected.push({ inSec: Math.max(0, pos - REJECT_RADIUS_SEC), outSec: pos + REJECT_RADIUS_SEC })
    this.candidate = null
    this.provisional = null
    this.verify = []
    this.lastResult = null
    return this.snapshot(now, null)
  }

  unlock(now = performance.now()) {
    this.timeLock = null
    this.candidate = null
    this.provisional = null
    this.verify = []
    this.lastResult = null
    if (this.windowBase && this.windowEnabled) this.windowAnchorAt = now
    return this.snapshot(now, null)
  }

  candidateClock(now = performance.now()) {
    if (!this.candidate) return null
    return this.candidate.positionSec + Math.max(0, (now - this.candidate.at) / 1000)
  }

  lockedClock(now = performance.now()) {
    if (!this.timeLock) return null
    const duration = Number(this.reference?.duration || Number.MAX_SAFE_INTEGER)
    return clamp(this.timeLock.positionSec + Math.max(0, (now - this.timeLock.at) / 1000), 0, duration)
  }

  confirmCandidate(now = performance.now()) {
    const pos = this.candidateClock(now)
    if (!finite(pos)) return this.snapshot(now, null)
    this.timeLock = { positionSec: pos, at: now }
    this.candidate = null
    this.verify = []
    this.provisional = null

    if (!this.windowBase) {
      const half = DEFAULT_WINDOW_WIDTH_SEC / 2
      this.windowBase = { inSec: Math.max(0, pos - half), outSec: pos + half }
      this.windowAnchorAt = now
      this.windowEnabled = true
    }
    return this.snapshot(now, this.lastEvidence)
  }

  push(feature, raw, now = performance.now()) {
    this.live.push(feature)
    if (this.live.length > LIVE_WINDOW) this.live.shift()

    const evidence = this.pickEvidence(raw, now)
    this.lastEvidence = evidence

    if (this.timeLock) {
      const locked = this.lockedClock(now)
      const delta = evidence && finite(evidence.positionSec) ? evidence.positionSec - locked : null
      const verifyPass = !!evidence && evidence.confidence >= 70 && Math.abs(delta) <= 0.40
      const result = this.snapshot(now, evidence, {
        verifyPass,
        verifyDeltaMs: delta == null ? null : Math.round(delta * 1000),
      })
      this.lastResult = result
      return result
    }

    if (this.candidate) {
      const candidatePos = this.candidateClock(now)
      const delta = evidence && finite(evidence.positionSec) ? evidence.positionSec - candidatePos : null
      const result = this.snapshot(now, evidence, {
        verifyPass: !!evidence && evidence.confidence >= 70 && Math.abs(delta) <= 0.40,
        verifyDeltaMs: delta == null ? null : Math.round(delta * 1000),
      })
      this.lastResult = result
      return result
    }

    this.updateVerification(evidence, now)
    const result = this.snapshot(now, evidence)
    this.lastResult = result
    return result
  }

  pickEvidence(raw, now) {
    const win = this.currentWindow(now)
    let windowEvidence = null
    if (this.windowEnabled && win && this.live.length >= 10) windowEvidence = this.searchWindow(win)

    let rawEvidence = null
    if (raw && finite(raw.positionSec) && !this.isRejected(raw.positionSec) &&
        (raw.state === 'LOCKED' || raw.state === 'CANDIDATE')) {
      if (!this.windowEnabled || !win || (raw.positionSec >= win.inSec && raw.positionSec <= win.outSec)) {
        rawEvidence = {
          positionSec: raw.positionSec,
          confidence: Number(raw.confidence || 0),
          score: Number(raw.score || 0),
          source: 'LANDMARK',
        }
      }
    }

    if (windowEvidence && rawEvidence) {
      const agree = Math.abs(windowEvidence.positionSec - rawEvidence.positionSec) <= 0.35
      if (agree) {
        return {
          positionSec: (windowEvidence.positionSec + rawEvidence.positionSec) / 2,
          confidence: Math.round(clamp(Math.max(windowEvidence.confidence, rawEvidence.confidence) + 4, 0, 100)),
          score: Math.max(windowEvidence.score, rawEvidence.score),
          source: 'WINDOW+LANDMARK',
        }
      }
      return windowEvidence.confidence >= rawEvidence.confidence ? windowEvidence : rawEvidence
    }
    return windowEvidence || rawEvidence
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
      const score = windowScore(this.live, frames, i)
      if (score > best) {
        second = best
        best = score
        bestIndex = i
      } else if (score > second) second = score
    }
    if (bestIndex < 0 || best < 0.20) return null
    const separation = second < -0.5 ? 0.08 : Math.max(0, best - second)
    return {
      positionSec: bestIndex * FRAME_SEC,
      confidence: spectralConfidence(best, separation),
      score: best,
      source: 'ROLLING WINDOW',
    }
  }

  updateVerification(evidence, now) {
    if (!evidence || evidence.confidence < 72 || !finite(evidence.positionSec)) {
      this.verify.push({ pass: false, confidence: Number(evidence?.confidence || 0), at: now })
      if (this.verify.length > VERIFY_FRAMES) this.verify.shift()
      return
    }

    if (!this.provisional) {
      this.provisional = { positionSec: evidence.positionSec, at: now }
      this.verify = []
    }

    const expected = this.provisional.positionSec + Math.max(0, (now - this.provisional.at) / 1000)
    const delta = evidence.positionSec - expected
    const pass = evidence.confidence >= VERIFY_CONFIDENCE && Math.abs(delta) <= VERIFY_TOLERANCE_SEC
    this.verify.push({ pass, confidence: evidence.confidence, delta, at: now })
    if (this.verify.length > VERIFY_FRAMES) this.verify.shift()

    const recent8 = this.verify.slice(-FAST_FRAMES)
    const fast = recent8.length === FAST_FRAMES &&
      recent8.every((x) => x.pass && x.confidence >= FAST_CONFIDENCE)

    const passCount = this.verify.filter((x) => x.pass).length
    const avgConfidence = this.verify.length
      ? this.verify.reduce((s, x) => s + x.confidence, 0) / this.verify.length
      : 0
    const mature = this.verify.length === VERIFY_FRAMES &&
      passCount >= VERIFY_PASS_REQUIRED && avgConfidence >= VERIFY_CONFIDENCE

    if (fast || mature) {
      const stablePos = this.provisional.positionSec + Math.max(0, (now - this.provisional.at) / 1000)
      this.candidate = {
        positionSec: stablePos,
        at: now,
        confidence: Math.round(avgConfidence || evidence.confidence),
        passCount,
        total: this.verify.length,
        fast,
      }
      return
    }

    if (this.verify.length >= 8 && passCount <= 3 && evidence.confidence >= 88) {
      this.provisional = { positionSec: evidence.positionSec, at: now }
      this.verify = []
    }
  }

  snapshot(now = performance.now(), evidence = null, extra = {}) {
    const win = this.currentWindow(now)
    const passCount = this.verify.filter((x) => x.pass).length
    const avgConfidence = this.verify.length
      ? Math.round(this.verify.reduce((s, x) => s + x.confidence, 0) / this.verify.length)
      : 0

    let state = 'SEARCHING'
    let positionSec = evidence?.positionSec ?? null
    let confidence = evidence?.confidence ?? 0
    let candidateReady = false
    let timeLocked = false

    if (this.timeLock) {
      state = 'TIME_LOCKED'
      positionSec = this.lockedClock(now)
      confidence = evidence?.confidence ?? 0
      timeLocked = true
    } else if (this.candidate) {
      state = 'CANDIDATE_READY'
      positionSec = this.candidateClock(now)
      confidence = this.candidate.confidence
      candidateReady = true
    } else if (this.verify.length) {
      state = 'VERIFYING'
    }

    return {
      state,
      positionSec,
      confidence: Math.round(confidence || 0),
      candidateReady,
      timeLocked,
      passCount,
      verifyTotal: this.verify.length,
      avgConfidence,
      verifyPassRequired: VERIFY_PASS_REQUIRED,
      verifyFrames: VERIFY_FRAMES,
      evidenceSource: evidence?.source || 'NONE',
      evidencePositionSec: evidence?.positionSec ?? null,
      evidenceConfidence: evidence?.confidence ?? 0,
      window: win,
      rejectedCount: this.rejected.length,
      ...extra,
    }
  }
}

export const SYNC_LIVE_V5 = {
  verifyFrames: VERIFY_FRAMES,
  verifyPassRequired: VERIFY_PASS_REQUIRED,
  verifyConfidence: VERIFY_CONFIDENCE,
  verifyToleranceMs: VERIFY_TOLERANCE_SEC * 1000,
  fastFrames: FAST_FRAMES,
  fastConfidence: FAST_CONFIDENCE,
}
