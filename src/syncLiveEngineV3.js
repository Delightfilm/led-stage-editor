const FFT_SIZE = 1024
const BAND_COUNT = 24
const MIN_HZ = 90
const MAX_HZ = 9000
const FRAME_SEC = 0.1
const LIVE_WINDOW = 18
const AMBIGUITY_EXCLUDE_FRAMES = 10

const PEAKS_PER_FRAME = 3
const PEAK_MIN = 0.28
const PEAK_PROMINENCE = 0.12
const HASH_DT_MIN = 3
const HASH_DT_MAX = 11
const MAX_HASH_OCCURRENCES = 48
const VOTE_WINDOW_FRAMES = 36
const VOTE_CLUSTER_RADIUS = 2
const LOCK_LOCAL_RADIUS = 12
const REACQUIRE_STREAK = 10

const clamp = (v, min, max) => Math.max(min, Math.min(max, v))
const hann = (i, n) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))

function fftPower(input) {
  const n = FFT_SIZE
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  for (let i = 0; i < n; i += 1) re[i] = (input[i] || 0) * hann(i, n)
  let j = 0
  for (let i = 1; i < n; i += 1) {
    let bit = n >> 1
    while (j & bit) { j ^= bit; bit >>= 1 }
    j ^= bit
    if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len
    const wlr = Math.cos(a), wli = Math.sin(a)
    for (let i = 0; i < n; i += len) {
      let wr = 1, wi = 0
      for (let k = 0; k < (len >> 1); k += 1) {
        const ar = re[i + k], ai = im[i + k]
        const br = re[i + k + (len >> 1)] * wr - im[i + k + (len >> 1)] * wi
        const bi = re[i + k + (len >> 1)] * wi + im[i + k + (len >> 1)] * wr
        re[i + k] = ar + br; im[i + k] = ai + bi
        re[i + k + (len >> 1)] = ar - br; im[i + k + (len >> 1)] = ai - bi
        const nwr = wr * wlr - wi * wli; wi = wr * wli + wi * wlr; wr = nwr
      }
    }
  }
  const p = new Float64Array(n >> 1)
  for (let i = 1; i < p.length; i += 1) p[i] = re[i] * re[i] + im[i] * im[i]
  return p
}

function normalize(values) {
  let mean = 0
  for (const v of values) mean += v
  mean /= Math.max(1, values.length)
  let variance = 0
  for (const v of values) variance += (v - mean) * (v - mean)
  const std = Math.sqrt(variance / Math.max(1, values.length)) || 1
  return Float32Array.from(values, (v) => clamp((v - mean) / std, -3, 3))
}

export function extractFeature(samples, sampleRate) {
  const power = fftPower(samples)
  const bands = new Float64Array(BAND_COUNT)
  const maxHz = Math.min(MAX_HZ, sampleRate * 0.45)
  const ratio = Math.pow(maxHz / MIN_HZ, 1 / BAND_COUNT)
  for (let b = 0; b < BAND_COUNT; b += 1) {
    const lo = MIN_HZ * Math.pow(ratio, b), hi = MIN_HZ * Math.pow(ratio, b + 1)
    const from = Math.max(1, Math.floor(lo * FFT_SIZE / sampleRate))
    const to = Math.min(power.length - 1, Math.ceil(hi * FFT_SIZE / sampleRate))
    let sum = 0, count = 0
    for (let k = from; k <= to; k += 1) { sum += power[k]; count += 1 }
    bands[b] = Math.log1p(sum / Math.max(1, count))
  }
  return normalize(bands)
}

function mixMono(buffer) {
  const mono = new Float32Array(buffer.length)
  for (let c = 0; c < buffer.numberOfChannels; c += 1) {
    const d = buffer.getChannelData(c)
    for (let i = 0; i < d.length; i += 1) mono[i] += d[i] / buffer.numberOfChannels
  }
  return mono
}

function framePeaks(feature) {
  const peaks = []
  for (let band = 1; band < feature.length - 1; band += 1) {
    const v = feature[band]
    const left = feature[band - 1], right = feature[band + 1]
    const prominence = v - (left + right) * 0.5
    if (v >= PEAK_MIN && prominence >= PEAK_PROMINENCE && v >= left && v >= right) peaks.push({ band, strength: v + prominence * 0.5 })
  }
  peaks.sort((a, b) => b.strength - a.strength)
  return peaks.slice(0, PEAKS_PER_FRAME)
}

function hashKey(aBand, bBand, dt) {
  return ((aBand * BAND_COUNT + bBand) << 4) | dt
}

function buildLandmarkIndex(frames) {
  const peaks = frames.map(framePeaks)
  const raw = new Map()
  let pairCount = 0
  for (let anchor = 0; anchor < peaks.length; anchor += 1) {
    const a = peaks[anchor]
    if (!a.length) continue
    for (let dt = HASH_DT_MIN; dt <= HASH_DT_MAX && anchor + dt < peaks.length; dt += 1) {
      const b = peaks[anchor + dt]
      for (const ap of a) for (const bp of b) {
        const key = hashKey(ap.band, bp.band, dt)
        let list = raw.get(key)
        if (!list) { list = []; raw.set(key, list) }
        list.push(anchor); pairCount += 1
      }
    }
  }

  const index = new Map()
  let retainedPairs = 0
  for (const [key, list] of raw) {
    if (list.length > MAX_HASH_OCCURRENCES) continue
    index.set(key, Int32Array.from(list))
    retainedPairs += list.length
  }
  return { index, peaks, hashCount: index.size, pairCount: retainedPairs, rawPairCount: pairCount }
}

export async function buildReferenceFingerprint(blob, onProgress) {
  const Ctx = window.AudioContext || window.webkitAudioContext
  if (!Ctx) throw new Error('Web Audio API 미지원 브라우저입니다.')
  const ctx = new Ctx()
  try {
    const decoded = await ctx.decodeAudioData((await blob.arrayBuffer()).slice(0))
    const mono = mixMono(decoded)
    const hop = Math.max(1, Math.round(decoded.sampleRate * FRAME_SEC))
    const frames = []
    for (let start = 0; start + FFT_SIZE <= mono.length; start += hop) {
      frames.push(extractFeature(mono.subarray(start, start + FFT_SIZE), decoded.sampleRate))
      if (frames.length % 100 === 0) onProgress?.(Math.min(.82, (start / mono.length) * .82))
    }
    if (frames.length < LIVE_WINDOW + 10) throw new Error('기준 음원이 너무 짧습니다.')
    onProgress?.(.86)
    const landmarks = buildLandmarkIndex(frames)
    onProgress?.(1)
    return {
      frames,
      duration: decoded.duration,
      sampleRate: decoded.sampleRate,
      frameSec: FRAME_SEC,
      name: blob.name || 'reference audio',
      landmarkIndex: landmarks.index,
      landmarkPeaks: landmarks.peaks,
      landmarkHashCount: landmarks.hashCount,
      landmarkPairCount: landmarks.pairCount,
    }
  } finally { await ctx.close().catch(() => {}) }
}

function cosine(a, b) {
  let dot = 0, aa = 0, bb = 0
  for (let i = 0; i < a.length; i += 1) { dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i] }
  return aa && bb ? dot / Math.sqrt(aa * bb) : -1
}

function windowScore(live, ref, end) {
  const start = end - live.length + 1
  if (start < 0 || end >= ref.length) return -1
  let score = 0
  for (let i = 0; i < live.length; i += 1) score += cosine(live[i], ref[start + i])
  return score / live.length
}

function bestLocalSpectral(live, ref, center, radius) {
  if (!Number.isFinite(center)) return { index: -1, score: -1, second: -1 }
  let bestIndex = -1, best = -1, second = -1
  const lo = Math.max(live.length - 1, Math.round(center) - radius)
  const hi = Math.min(ref.length - 1, Math.round(center) + radius)
  for (let i = lo; i <= hi; i += 1) {
    const s = windowScore(live, ref, i)
    if (s > best) { second = best; best = s; bestIndex = i }
    else if (s > second) second = s
  }
  return { index: bestIndex, score: best, second }
}

function remoteSpectralScore(live, ref, candidate, excludeRadius = 24) {
  if (!Number.isFinite(candidate) || live.length < 12) return -1
  let best = -1
  for (let i = live.length - 1; i < ref.length; i += 1) {
    if (Math.abs(i - candidate) <= excludeRadius) continue
    const score = windowScore(live, ref, i)
    if (score > best) best = score
  }
  return best
}

function spectralConfidence(score) {
  return clamp((score - .22) / .38, 0, 1)
}

function clusterVotes(votes) {
  if (!votes.length) return { offset: null, bestWeight: 0, secondWeight: 0, totalWeight: 0, hits: 0, consensus: 0 }
  const bins = new Map()
  let totalWeight = 0
  for (const vote of votes) {
    bins.set(vote.offset, (bins.get(vote.offset) || 0) + vote.weight)
    totalWeight += vote.weight
  }
  let bestOffset = null, bestWeight = -1
  for (const offset of bins.keys()) {
    let w = 0
    for (let d = -VOTE_CLUSTER_RADIUS; d <= VOTE_CLUSTER_RADIUS; d += 1) w += bins.get(offset + d) || 0
    if (w > bestWeight) { bestWeight = w; bestOffset = offset }
  }
  let secondWeight = 0
  for (const offset of bins.keys()) {
    if (Math.abs(offset - bestOffset) <= AMBIGUITY_EXCLUDE_FRAMES) continue
    let w = 0
    for (let d = -VOTE_CLUSTER_RADIUS; d <= VOTE_CLUSTER_RADIUS; d += 1) w += bins.get(offset + d) || 0
    if (w > secondWeight) secondWeight = w
  }
  let hits = 0
  for (const vote of votes) if (Math.abs(vote.offset - bestOffset) <= VOTE_CLUSTER_RADIUS) hits += 1
  const separation = bestWeight / Math.max(0.001, bestWeight + secondWeight)
  const density = bestWeight / Math.max(0.001, totalWeight)
  const consensus = clamp(separation * .68 + clamp(density / .28, 0, 1) * .32, 0, 1)
  return { offset: bestOffset, bestWeight, secondWeight, totalWeight, hits, consensus }
}

function landmarkConfidence(cluster) {
  const hitScore = clamp((cluster.hits - 3) / 12, 0, 1)
  const consensusScore = clamp((cluster.consensus - .42) / .42, 0, 1)
  const weightScore = clamp((cluster.bestWeight - 1.2) / 5.5, 0, 1)
  return hitScore * .34 + consensusScore * .44 + weightScore * .22
}

export class SyncMatcher {
  constructor(reference) {
    this.reference = reference
    if (!reference.landmarkIndex) {
      const landmarks = buildLandmarkIndex(reference.frames)
      reference.landmarkIndex = landmarks.index
      reference.landmarkPeaks = landmarks.peaks
      reference.landmarkHashCount = landmarks.hashCount
      reference.landmarkPairCount = landmarks.pairCount
    }
    this.reset()
  }

  reset() {
    this.live = []
    this.livePeaks = []
    this.votes = []
    this.state = 'SEARCHING'
    this.lastIndex = null
    this.frame = -1
    this.candidateStreak = 0
    this.candidateIndex = null
    this.lockFrames = 0
    this.weakFrames = 0
    this.lastGoodIndex = null
    this.lastCluster = null
  }

  addLandmarkVotes(currentFrame, currentPeaks) {
    const index = this.reference.landmarkIndex
    if (!currentPeaks.length || !index?.size) return
    for (let dt = HASH_DT_MIN; dt <= HASH_DT_MAX; dt += 1) {
      const anchorFrame = currentFrame - dt
      if (anchorFrame < 0) continue
      const anchorPeaks = this.livePeaks[anchorFrame]
      if (!anchorPeaks?.length) continue
      for (const ap of anchorPeaks) for (const bp of currentPeaks) {
        const refs = index.get(hashKey(ap.band, bp.band, dt))
        if (!refs?.length || refs.length > MAX_HASH_OCCURRENCES) continue
        const rarityWeight = 1 / refs.length
        const strengthWeight = clamp((ap.strength + bp.strength) / 4, .55, 1.25)
        const weight = rarityWeight * strengthWeight
        for (let i = 0; i < refs.length; i += 1) this.votes.push({ frame: currentFrame, offset: refs[i] - anchorFrame, weight })
      }
    }
    const minFrame = currentFrame - VOTE_WINDOW_FRAMES
    if (this.votes.length > 12000) this.votes = this.votes.filter((v) => v.frame >= minFrame)
    else while (this.votes.length && this.votes[0].frame < minFrame) this.votes.shift()
  }

  push(feature) {
    this.frame += 1
    this.live.push(feature)
    if (this.live.length > LIVE_WINDOW) this.live.shift()
    const peaks = framePeaks(feature)
    this.livePeaks[this.frame] = peaks
    this.addLandmarkVotes(this.frame, peaks)

    const cluster = clusterVotes(this.votes)
    this.lastCluster = cluster
    const landmarkCurrentIndex = cluster.offset == null ? null : this.frame + cluster.offset
    const landmarkScore = landmarkConfidence(cluster)

    if (this.live.length < 10) {
      return {
        state: this.state,
        confidence: 0,
        positionSec: null,
        score: 0,
        margin: 0,
        continuityOk: true,
        lockFrames: 0,
        landmarkHits: cluster.hits,
        consensus: Math.round(cluster.consensus * 100),
        stabilitySec: 0,
        mode: 'LANDMARK+SPECTRAL',
      }
    }

    const ref = this.reference.frames
    let chosenIndex = -1
    let spectral = { index: -1, score: -1, second: -1 }
    let continuityOk = true
    let uniquenessMargin = null
    const predicted = this.lastIndex == null ? null : this.lastIndex + 1

    if (this.state === 'LOCKED' && predicted != null) {
      let center = predicted
      if (landmarkCurrentIndex != null && Math.abs(landmarkCurrentIndex - predicted) <= LOCK_LOCAL_RADIUS) {
        center = Math.round(predicted * .45 + landmarkCurrentIndex * .55)
      }
      spectral = bestLocalSpectral(this.live, ref, center, LOCK_LOCAL_RADIUS)
      chosenIndex = spectral.index >= 0 ? spectral.index : Math.round(predicted)
      if (Math.abs(chosenIndex - predicted) > 5) chosenIndex = Math.round(predicted + clamp(chosenIndex - predicted, -5, 5))
      continuityOk = Math.abs(chosenIndex - predicted) <= 5

      const landmarkConsistent = landmarkCurrentIndex != null && Math.abs(landmarkCurrentIndex - predicted) <= LOCK_LOCAL_RADIUS && cluster.hits >= 4 && cluster.consensus >= .50
      const spectralGood = spectral.score >= .29
      if (spectralGood || landmarkConsistent) {
        this.weakFrames = 0
        this.lastIndex = chosenIndex
        this.lastGoodIndex = chosenIndex
        this.lockFrames += 1
      } else {
        this.weakFrames += 1
        this.lastIndex = Math.min(ref.length - 1, Math.round(predicted))
        chosenIndex = this.lastIndex
        this.lockFrames += 1
        if (this.weakFrames >= 18) {
          this.state = 'LOST'
          this.candidateStreak = 0
          this.lockFrames = 0
        }
      }
    } else {
      if (landmarkCurrentIndex != null) spectral = bestLocalSpectral(this.live, ref, landmarkCurrentIndex, 5)
      chosenIndex = spectral.index >= 0 ? spectral.index : (landmarkCurrentIndex == null ? -1 : Math.round(landmarkCurrentIndex))
      const previousExpected = this.candidateIndex == null ? null : this.candidateIndex + 1
      continuityOk = previousExpected == null || Math.abs(chosenIndex - previousExpected) <= 5
      const landmarkGood = cluster.hits >= 5 && cluster.consensus >= .36 && cluster.bestWeight >= 1.8
      const spectralGood = spectral.score >= .31
      const acceptable = chosenIndex >= 0 && continuityOk && landmarkGood && spectralGood
      const shouldCheckUniqueness = acceptable && this.candidateStreak >= 6
      const remoteScore = shouldCheckUniqueness ? remoteSpectralScore(this.live, ref, chosenIndex) : -1
      uniquenessMargin = remoteScore < -0.5 ? 1 : spectral.score - remoteScore
      const uniqueEnough = uniquenessMargin >= .035

      if (acceptable) {
        this.candidateStreak += 1
        this.candidateIndex = chosenIndex
        this.lastIndex = chosenIndex
        const strong = uniqueEnough && cluster.hits >= 8 && cluster.consensus >= .50 && spectral.score >= .35
        const mature = uniqueEnough && this.candidateStreak >= 18 && cluster.hits >= 7 && cluster.consensus >= .36 && spectral.score >= .33
        if ((strong && this.candidateStreak >= 10) || mature || (uniqueEnough && this.state === 'LOST' && this.candidateStreak >= REACQUIRE_STREAK && cluster.consensus >= .42)) {
          this.state = 'LOCKED'
          this.lockFrames = 1
          this.weakFrames = 0
          this.lastGoodIndex = chosenIndex
        } else this.state = 'CANDIDATE'
      } else {
        this.candidateStreak = Math.max(0, this.candidateStreak - 2)
        if (this.candidateStreak === 0) {
          this.candidateIndex = null
          if (this.state !== 'LOST') this.state = 'SEARCHING'
        }
      }
    }

    const spectralScore = spectral.score < -0.5 ? 0 : spectral.score
    const spectralPart = spectralConfidence(spectralScore)
    const continuityPart = continuityOk ? 1 : 0
    let confidenceValue = landmarkScore * .58 + spectralPart * .30 + continuityPart * .12
    if (this.state === 'LOCKED') {
      const hysteresis = clamp(1 - this.weakFrames / 18, 0, 1)
      const stableRamp = clamp(this.lockFrames / 8, 0, 1)
      const lockedFloor = (.78 + .14 * stableRamp + .06 * spectralPart + .02 * landmarkScore) * hysteresis
      confidenceValue = Math.max(confidenceValue, lockedFloor, .58 * hysteresis)
    }
    if (this.state === 'SEARCHING') confidenceValue *= .72
    const conf = Math.round(clamp(confidenceValue, 0, 1) * 100)
    const positionSec = chosenIndex >= 0 ? chosenIndex * this.reference.frameSec : null
    const margin = cluster.bestWeight - cluster.secondWeight

    return {
      state: this.state,
      confidence: conf,
      positionSec,
      score: spectralScore,
      margin,
      index: chosenIndex,
      continuityOk,
      lockFrames: this.lockFrames,
      landmarkHits: cluster.hits,
      consensus: Math.round(cluster.consensus * 100),
      stabilitySec: this.state === 'LOCKED' ? this.lockFrames * this.reference.frameSec : 0,
      landmarkOffsetFrames: cluster.offset,
      weakFrames: this.weakFrames,
      uniqueness: uniquenessMargin == null ? null : Math.round(clamp(uniquenessMargin / .12, 0, 1) * 100),
      mode: 'LANDMARK+SPECTRAL',
    }
  }
}

export function formatTime(value) {
  if (!Number.isFinite(value) || value < 0) return '--:--.---'
  const m = Math.floor(value / 60), s = Math.floor(value % 60), ms = Math.floor((value - Math.floor(value)) * 1000)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
}

export const SYNC_LIVE_CONSTANTS = {
  FFT_SIZE,
  FRAME_SEC,
  LIVE_WINDOW,
  AMBIGUITY_EXCLUDE_FRAMES,
  matcherVersion: 'V3 LANDMARK',
}

export const __SYNC_LIVE_TESTING__ = { framePeaks, buildLandmarkIndex, hashKey, clusterVotes, windowScore }
