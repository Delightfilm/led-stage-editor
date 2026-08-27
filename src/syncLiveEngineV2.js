const FFT_SIZE = 1024
const BAND_COUNT = 24
const MIN_HZ = 90
const MAX_HZ = 9000
const FRAME_SEC = 0.1
const LIVE_WINDOW = 18
const AMBIGUITY_EXCLUDE_FRAMES = 8

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
      if (frames.length % 100 === 0) onProgress?.(Math.min(.99, start / mono.length))
    }
    onProgress?.(1)
    if (frames.length < LIVE_WINDOW + 10) throw new Error('기준 음원이 너무 짧습니다.')
    return { frames, duration: decoded.duration, sampleRate: decoded.sampleRate, frameSec: FRAME_SEC, name: blob.name || 'reference audio' }
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

function confidence(best, remoteSecond) {
  const spectral = clamp((best - .34) / .34, 0, 1)
  const margin = best - remoteSecond
  const unique = clamp((margin - .025) / .12, 0, 1)
  return Math.round(100 * (spectral * .86 + unique * .14))
}

export class SyncMatcher {
  constructor(reference) { this.reference = reference; this.reset() }
  reset() { this.live = []; this.state = 'SEARCHING'; this.lastIndex = null; this.frame = 0; this.goodFrames = 0; this.lockFrames = 0; this.lastGoodFrame = 0 }

  push(feature) {
    this.frame += 1
    this.live.push(feature)
    if (this.live.length > LIVE_WINDOW) this.live.shift()
    if (this.live.length < 12) return { state: 'SEARCHING', confidence: 0, positionSec: null, score: 0, margin: 0, continuityOk: true, lockFrames: 0 }

    const ref = this.reference.frames
    const predicted = this.lastIndex == null ? null : this.lastIndex + 1
    const candidates = []
    if (this.state === 'LOCKED' && predicted != null) {
      for (let i = Math.max(this.live.length - 1, predicted - 14); i <= Math.min(ref.length - 1, predicted + 14); i += 1) candidates.push(i)
    } else {
      for (let i = this.live.length - 1; i < ref.length; i += 1) candidates.push(i)
    }

    let bestIndex = -1, best = -1
    const scored = []
    for (const i of candidates) {
      const s = windowScore(this.live, ref, i)
      scored.push([i, s])
      if (s > best) { best = s; bestIndex = i }
    }
    let remoteSecond = -1
    for (const [i, s] of scored) if (Math.abs(i - bestIndex) > AMBIGUITY_EXCLUDE_FRAMES && s > remoteSecond) remoteSecond = s
    if (remoteSecond < -0.5) remoteSecond = Math.min(best, .25)

    const conf = confidence(best, remoteSecond)
    const positionSec = bestIndex >= 0 ? bestIndex * this.reference.frameSec : null
    const continuityOk = this.lastIndex == null || Math.abs(bestIndex - (this.lastIndex + 1)) <= 6
    const good = best >= .47 && conf >= 78 && continuityOk
    const strong = best >= .53 && conf >= 88 && continuityOk

    if (good) {
      this.goodFrames += 1; this.lastGoodFrame = this.frame; this.lastIndex = bestIndex
      if (this.state === 'LOCKED') this.lockFrames += 1
      else if (strong && this.goodFrames >= 4) { this.state = 'LOCKED'; this.lockFrames = 1 }
      else this.state = 'CANDIDATE'
    } else if (this.state === 'LOCKED') {
      if (this.frame - this.lastGoodFrame >= 8) { this.state = 'LOST'; this.goodFrames = 0; this.lockFrames = 0 }
    } else {
      this.goodFrames = Math.max(0, this.goodFrames - 1)
      if (this.goodFrames === 0) this.state = this.state === 'LOST' && conf >= 65 ? 'LOST' : 'SEARCHING'
      if (bestIndex >= 0 && conf >= 65) this.lastIndex = bestIndex
    }

    return { state: this.state, confidence: conf, positionSec, score: best, margin: best - remoteSecond, index: bestIndex, continuityOk, lockFrames: this.lockFrames }
  }
}

export function formatTime(value) {
  if (!Number.isFinite(value) || value < 0) return '--:--.---'
  const m = Math.floor(value / 60), s = Math.floor(value % 60), ms = Math.floor((value - Math.floor(value)) * 1000)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
}

export const SYNC_LIVE_CONSTANTS = { FFT_SIZE, FRAME_SEC, LIVE_WINDOW, AMBIGUITY_EXCLUDE_FRAMES }
