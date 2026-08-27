const FFT_SIZE = 1024
const BAND_COUNT = 24
const MIN_HZ = 90
const MAX_HZ = 9000
const FRAME_SEC = 0.1
const LIVE_WINDOW = 16

const clamp = (v, min, max) => Math.max(min, Math.min(max, v))

function hann(i, n) {
  return 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))
}

function fftPower(input) {
  const n = FFT_SIZE
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  for (let i = 0; i < n; i += 1) re[i] = (input[i] || 0) * hann(i, n)

  let j = 0
  for (let i = 1; i < n; i += 1) {
    let bit = n >> 1
    while (j & bit) {
      j ^= bit
      bit >>= 1
    }
    j ^= bit
    if (i < j) {
      const tr = re[i]
      re[i] = re[j]
      re[j] = tr
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wlenR = Math.cos(ang)
    const wlenI = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let wr = 1
      let wi = 0
      const half = len >> 1
      for (let k = 0; k < half; k += 1) {
        const uR = re[i + k]
        const uI = im[i + k]
        const vR = re[i + k + half] * wr - im[i + k + half] * wi
        const vI = re[i + k + half] * wi + im[i + k + half] * wr
        re[i + k] = uR + vR
        im[i + k] = uI + vI
        re[i + k + half] = uR - vR
        im[i + k + half] = uI - vI
        const nextWr = wr * wlenR - wi * wlenI
        wi = wr * wlenI + wi * wlenR
        wr = nextWr
      }
    }
  }

  const power = new Float64Array(n >> 1)
  for (let i = 1; i < power.length; i += 1) power[i] = re[i] * re[i] + im[i] * im[i]
  return power
}

function normalizeVector(values) {
  let mean = 0
  for (let i = 0; i < values.length; i += 1) mean += values[i]
  mean /= Math.max(1, values.length)
  let variance = 0
  for (let i = 0; i < values.length; i += 1) {
    const d = values[i] - mean
    variance += d * d
  }
  const std = Math.sqrt(variance / Math.max(1, values.length)) || 1
  const out = new Float32Array(values.length)
  for (let i = 0; i < values.length; i += 1) out[i] = clamp((values[i] - mean) / std, -3, 3)
  return out
}

export function extractFeature(samples, sampleRate) {
  const power = fftPower(samples)
  const bands = new Float64Array(BAND_COUNT)
  const maxHz = Math.min(MAX_HZ, sampleRate * 0.45)
  const ratio = Math.pow(maxHz / MIN_HZ, 1 / BAND_COUNT)
  for (let b = 0; b < BAND_COUNT; b += 1) {
    const lo = MIN_HZ * Math.pow(ratio, b)
    const hi = MIN_HZ * Math.pow(ratio, b + 1)
    const loBin = Math.max(1, Math.floor((lo * FFT_SIZE) / sampleRate))
    const hiBin = Math.min(power.length - 1, Math.ceil((hi * FFT_SIZE) / sampleRate))
    let sum = 0
    let count = 0
    for (let k = loBin; k <= hiBin; k += 1) {
      sum += power[k]
      count += 1
    }
    bands[b] = Math.log1p(sum / Math.max(1, count))
  }
  return normalizeVector(bands)
}

function mixToMono(buffer) {
  const channels = buffer.numberOfChannels
  const length = buffer.length
  const mono = new Float32Array(length)
  for (let c = 0; c < channels; c += 1) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < length; i += 1) mono[i] += data[i] / channels
  }
  return mono
}

export async function buildReferenceFingerprint(blob, onProgress) {
  const Ctx = window.AudioContext || window.webkitAudioContext
  if (!Ctx) throw new Error('Web Audio API를 지원하지 않는 브라우저입니다.')
  const ctx = new Ctx()
  try {
    const arrayBuffer = await blob.arrayBuffer()
    const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0))
    const mono = mixToMono(decoded)
    const hop = Math.max(1, Math.round(decoded.sampleRate * FRAME_SEC))
    const frames = []
    for (let start = 0; start + FFT_SIZE <= mono.length; start += hop) {
      frames.push(extractFeature(mono.subarray(start, start + FFT_SIZE), decoded.sampleRate))
      if (onProgress && frames.length % 100 === 0) onProgress(Math.min(0.99, start / mono.length))
    }
    onProgress?.(1)
    if (frames.length < LIVE_WINDOW + 8) throw new Error('기준 음원이 너무 짧습니다.')
    return {
      frames,
      duration: decoded.duration,
      sampleRate: decoded.sampleRate,
      frameSec: FRAME_SEC,
      name: blob.name || 'reference audio',
    }
  } finally {
    await ctx.close().catch(() => {})
  }
}

function cosine(a, b) {
  let dot = 0
  let aa = 0
  let bb = 0
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i]
    aa += a[i] * a[i]
    bb += b[i] * b[i]
  }
  if (!aa || !bb) return -1
  return dot / Math.sqrt(aa * bb)
}

function windowScore(live, reference, endIndex) {
  const start = endIndex - live.length + 1
  if (start < 0 || endIndex >= reference.length) return -1
  let score = 0
  for (let i = 0; i < live.length; i += 1) score += cosine(live[i], reference[start + i])
  return score / live.length
}

function confidenceFromScore(score, margin) {
  const base = clamp((score - 0.28) / 0.55, 0, 1)
  const distinct = clamp((margin - 0.015) / 0.08, 0, 1)
  return Math.round(100 * (base * 0.78 + distinct * 0.22))
}

export class SyncMatcher {
  constructor(reference) {
    this.reference = reference
    this.live = []
    this.state = 'SEARCHING'
    this.lastIndex = null
    this.lastGoodAt = 0
    this.candidateCount = 0
    this.lockCount = 0
    this.frameCounter = 0
  }

  reset() {
    this.live = []
    this.state = 'SEARCHING'
    this.lastIndex = null
    this.lastGoodAt = 0
    this.candidateCount = 0
    this.lockCount = 0
    this.frameCounter = 0
  }

  push(feature) {
    this.frameCounter += 1
    this.live.push(feature)
    if (this.live.length > LIVE_WINDOW) this.live.shift()
    if (this.live.length < Math.min(10, LIVE_WINDOW)) {
      return { state: 'SEARCHING', confidence: 0, positionSec: null, score: 0, margin: 0 }
    }

    const ref = this.reference.frames
    const live = this.live
    const predicted = this.lastIndex == null ? null : this.lastIndex + 1
    const candidates = []

    if (predicted != null && this.state === 'LOCKED') {
      const radius = 12
      const from = Math.max(live.length - 1, predicted - radius)
      const to = Math.min(ref.length - 1, predicted + radius)
      for (let i = from; i <= to; i += 1) candidates.push(i)
    } else {
      const stride = this.frameCounter % 3 === 0 ? 1 : 2
      for (let i = live.length - 1; i < ref.length; i += stride) candidates.push(i)
    }

    let bestIndex = -1
    let best = -1
    let second = -1
    for (const i of candidates) {
      const s = windowScore(live, ref, i)
      if (s > best) {
        second = best
        best = s
        bestIndex = i
      } else if (s > second) {
        second = s
      }
    }

    const margin = best - second
    const confidence = confidenceFromScore(best, margin)
    const positionSec = bestIndex >= 0 ? bestIndex * this.reference.frameSec : null
    const continuityOk = this.lastIndex == null || Math.abs(bestIndex - (this.lastIndex + 1)) <= 5
    const good = confidence >= 82 && best >= 0.5
    const strong = confidence >= 90 && best >= 0.58

    if (good && continuityOk) {
      this.candidateCount += 1
      this.lastGoodAt = this.frameCounter
      this.lastIndex = bestIndex
      if (this.state === 'LOCKED') {
        this.lockCount += 1
      } else if (this.candidateCount >= 4 && strong) {
        this.state = 'LOCKED'
        this.lockCount = 1
      } else {
        this.state = 'CANDIDATE'
      }
    } else if (this.state === 'LOCKED') {
      if (this.frameCounter - this.lastGoodAt >= 8) {
        this.state = 'LOST'
        this.candidateCount = 0
        this.lastIndex = bestIndex >= 0 ? bestIndex : null
      }
    } else {
      this.candidateCount = Math.max(0, this.candidateCount - 1)
      if (this.state === 'LOST' && confidence < 72) this.state = 'SEARCHING'
      else if (this.candidateCount === 0) this.state = 'SEARCHING'
      if (bestIndex >= 0 && confidence >= 70) this.lastIndex = bestIndex
    }

    return {
      state: this.state,
      confidence,
      positionSec,
      score: best,
      margin,
      index: bestIndex,
      continuityOk,
      lockFrames: this.lockCount,
    }
  }
}

export function formatTime(value) {
  if (!Number.isFinite(value) || value < 0) return '--:--.---'
  const m = Math.floor(value / 60)
  const s = Math.floor(value % 60)
  const ms = Math.floor((value - Math.floor(value)) * 1000)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
}

export const SYNC_LIVE_CONSTANTS = {
  FFT_SIZE,
  FRAME_SEC,
  LIVE_WINDOW,
}
