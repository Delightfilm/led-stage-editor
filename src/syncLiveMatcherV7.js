import { SyncLiveMatcherV6 as BaseV6, SYNC_LIVE_V5 as BASE_V6 } from './syncLiveMatcherV6.js'
import { __SYNC_LIVE_TESTING__, SYNC_LIVE_CONSTANTS } from './syncLiveEngineV4.js'

const { windowScore } = __SYNC_LIVE_TESTING__
const FRAME_SEC = SYNC_LIVE_CONSTANTS.FRAME_SEC || 0.1
const SCAN_INTERVAL_FRAMES = 5
const MAX_TRACKS = 5
const MIN_SCAN_SCORE = 0.26
const MIN_TRACK_SUPPORT = 6
const MERGE_RADIUS_SEC = 0.55
const CANDIDATE_SEPARATION_SEC = 2.5
const AMBIGUITY_MARGIN = 0.045

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

function scoreConfidence(score) {
  return Math.round(clamp((score - 0.18) / 0.42, 0, 1) * 100)
}

function selectSeparated(candidates, maxCount = 8) {
  const sorted = candidates.slice().sort((a, b) => b.score - a.score)
  const out = []
  for (const item of sorted) {
    if (out.some((x) => Math.abs(x.positionSec - item.positionSec) < CANDIDATE_SEPARATION_SEC)) continue
    out.push(item)
    if (out.length >= maxCount) break
  }
  return out
}

export class SyncLiveMatcherV7 extends BaseV6 {
  constructor(reference) {
    super(reference)
    this.v7Tracks = []
    this.v7PushCount = 0
    this.v7Ambiguous = false
    this.v7Margin = 0
    this.v7AmbiguitySkipped = 0
    this.v7LastScanAt = 0
  }

  resetSession(options = {}) {
    super.resetSession(options)
    if (!this.v7Tracks) return
    this.v7Tracks = []
    this.v7PushCount = 0
    this.v7Ambiguous = false
    this.v7Margin = 0
    this.v7AmbiguitySkipped = 0
    this.v7LastScanAt = 0
  }

  scanReference(now) {
    const frames = this.reference?.frames || []
    if (this.live.length < 12 || frames.length < this.live.length) return
    const candidates = []
    const first = this.live.length - 1
    const win = this.currentWindow(now)
    const useWindow = !!(this.windowEnabled && win)
    const lo = useWindow ? Math.max(first, Math.floor(win.inSec / FRAME_SEC)) : first
    const hi = useWindow ? Math.min(frames.length - 1, Math.ceil(win.outSec / FRAME_SEC)) : frames.length - 1

    for (let i = lo; i <= hi; i += 1) {
      const sec = i * FRAME_SEC
      if (this.isRejected(sec)) continue
      const score = windowScore(this.live, frames, i)
      if (score >= MIN_SCAN_SCORE) candidates.push({ positionSec: sec, score })
    }

    const peaks = selectSeparated(candidates, 10)
    const previous = this.v7Tracks.map((t) => ({ ...t, matched: false }))
    const next = []

    for (const candidate of peaks) {
      let bestTrack = null
      let bestError = Infinity
      for (const track of previous) {
        if (track.matched) continue
        const predicted = track.positionSec + Math.max(0, (now - track.at) / 1000)
        const err = Math.abs(candidate.positionSec - predicted)
        if (err <= MERGE_RADIUS_SEC && err < bestError) {
          bestTrack = track
          bestError = err
        }
      }
      if (bestTrack) {
        bestTrack.matched = true
        next.push({
          id: bestTrack.id,
          positionSec: candidate.positionSec,
          at: now,
          score: bestTrack.score * 0.68 + candidate.score * 0.32,
          support: Math.min(300, bestTrack.support + 1),
          misses: 0,
        })
      } else {
        next.push({
          id: `${Math.round(candidate.positionSec * 10)}-${Math.round(now)}`,
          positionSec: candidate.positionSec,
          at: now,
          score: candidate.score,
          support: 1,
          misses: 0,
        })
      }
    }

    for (const track of previous) {
      if (track.matched) continue
      const misses = (track.misses || 0) + 1
      if (misses <= 4 && track.support >= 3) {
        next.push({ ...track, misses, score: track.score * 0.94 })
      }
    }

    next.sort((a, b) => this.trackRank(b) - this.trackRank(a))
    this.v7Tracks = next.slice(0, MAX_TRACKS)
    this.v7LastScanAt = now

    const top = this.v7Tracks[0]
    const second = this.v7Tracks[1]
    const topRank = top ? this.trackRank(top) : 0
    const secondRank = second ? this.trackRank(second) : 0
    this.v7Margin = top && second ? topRank - secondRank : top ? topRank : 0
    this.v7Ambiguous = !!(top && second && top.support >= 3 && second.support >= 3 && this.v7Margin < AMBIGUITY_MARGIN)
  }

  trackRank(track) {
    if (!track) return -1
    const supportBoost = Math.min(20, track.support || 0) * 0.006
    const missPenalty = Math.min(5, track.misses || 0) * 0.018
    return Number(track.score || 0) + supportBoost - missPenalty
  }

  pickEvidence(raw, now) {
    this.v7PushCount += 1
    const base = super.pickEvidence(raw, now)
    if (this.v7PushCount % SCAN_INTERVAL_FRAMES === 0) this.scanReference(now)

    const top = this.v7Tracks[0]
    if (!top || top.support < MIN_TRACK_SUPPORT) return base

    const predicted = top.positionSec + Math.max(0, (now - top.at) / 1000)
    const trackEvidence = {
      positionSec: predicted,
      confidence: scoreConfidence(top.score),
      score: top.score,
      source: 'MULTI-CANDIDATE',
    }

    if (this.v7Ambiguous && !this.windowEnabled) return null

    if (base && Math.abs(base.positionSec - trackEvidence.positionSec) <= 0.45) {
      return {
        positionSec: (base.positionSec + trackEvidence.positionSec) / 2,
        confidence: Math.min(100, Math.max(base.confidence, trackEvidence.confidence) + 5),
        score: Math.max(Number(base.score || 0), trackEvidence.score),
        source: 'MULTI+BASE',
      }
    }

    if (!base) return trackEvidence
    return trackEvidence.confidence >= base.confidence ? trackEvidence : base
  }

  updateVerification(evidence, now) {
    if (this.v7Ambiguous && !this.windowEnabled) {
      this.v7AmbiguitySkipped += 1
      return
    }
    super.updateVerification(evidence, now)
  }

  snapshot(now = performance.now(), evidence = null, extra = {}) {
    const base = super.snapshot(now, evidence, extra)
    return {
      ...base,
      candidateCount: this.v7Tracks?.length || 0,
      candidateMargin: Number(this.v7Margin || 0).toFixed(3),
      candidateAmbiguous: !!this.v7Ambiguous,
      ambiguitySkipped: this.v7AmbiguitySkipped || 0,
      topCandidates: (this.v7Tracks || []).map((t) => ({
        positionSec: t.positionSec + Math.max(0, (now - t.at) / 1000),
        score: Math.round(t.score * 100),
        support: t.support,
      })),
      fieldMatcherVersion: 'V7 MULTI CANDIDATE',
    }
  }
}

export const SYNC_LIVE_V5 = {
  ...BASE_V6,
  version: 'V7 MULTI CANDIDATE',
  multiCandidateTracking: true,
  maxCandidateTracks: MAX_TRACKS,
  scanIntervalFrames: SCAN_INTERVAL_FRAMES,
  ambiguityMargin: AMBIGUITY_MARGIN,
}

export const __SYNC_LIVE_V7_TESTING__ = {
  scoreConfidence,
  selectSeparated,
  SCAN_INTERVAL_FRAMES,
  MAX_TRACKS,
  MIN_TRACK_SUPPORT,
  AMBIGUITY_MARGIN,
}
