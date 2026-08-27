import { SyncLiveMatcherV9 as BaseV9, SYNC_LIVE_V5 as BASE_V9 } from './syncLiveMatcherV9.js'

const MAX_CONSENSUS_RECORDS = 160
const FAST_RECORDS = 50
const NORMAL_RECORDS = 80
const REPEATED_RECORDS = 120

const MAX_PHASE_ERROR_SEC = 0.30
const START_CONFIDENCE = 76
const PASS_CONFIDENCE = 82
const PASS_ENSEMBLE = 0.62
const PASS_VALIDATORS = 3

const FAST_PASS_RATIO = 0.96
const FAST_AVG_CONFIDENCE = 92
const FAST_AVG_ENSEMBLE = 0.88
const FAST_AVG_VALIDATORS = 4.0
const FAST_UNIQUENESS = 0.70
const FAST_MARGIN = 0.10
const FAST_CONTEXT_SEC = 5

const NORMAL_PASS_RATIO = 0.90
const NORMAL_AVG_CONFIDENCE = 86
const NORMAL_AVG_ENSEMBLE = 0.72
const NORMAL_AVG_VALIDATORS = 3.2
const NORMAL_MARGIN = 0.065
const NORMAL_CONTEXT_SEC = 8

const REPEATED_PASS_RATIO = 0.92
const REPEATED_AVG_CONFIDENCE = 88
const REPEATED_AVG_ENSEMBLE = 0.78
const REPEATED_AVG_VALIDATORS = 3.4
const REPEATED_MARGIN = 0.10
const REPEATED_CONTEXT_SEC = 12

const REANCHOR_STREAK = 12
const REANCHOR_CONFIDENCE = 88
const REANCHOR_ENSEMBLE = 0.75

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const finite = (v) => Number.isFinite(v)

function mean(records, key) {
  if (!records?.length) return 0
  let total = 0
  for (const record of records) total += Number(record?.[key] || 0)
  return total / records.length
}

function summarize(records) {
  const total = records?.length || 0
  const passCount = total ? records.filter((record) => record.pass).length : 0
  const phaseRecords = (records || []).filter((record) => record.reason !== 'NO MATCH' && finite(record.delta))
  return {
    total,
    passCount,
    passRatio: total ? passCount / total : 0,
    avgConfidence: mean(records, 'confidence'),
    avgEnsemble: mean(records, 'ensemble'),
    avgValidators: mean(records, 'validators'),
    avgAbsDeltaMs: phaseRecords.length
      ? phaseRecords.reduce((sum, record) => sum + Math.abs(Number(record.delta || 0)) * 1000, 0) / phaseRecords.length
      : 0,
  }
}

function consensusScore(summary, uniqueness, margin) {
  const ratio = clamp(summary.passRatio, 0, 1)
  const confidence = clamp((summary.avgConfidence - 70) / 30, 0, 1)
  const ensemble = clamp((summary.avgEnsemble - 0.50) / 0.45, 0, 1)
  const validators = clamp((summary.avgValidators - 2.5) / 2.5, 0, 1)
  const unique = clamp(Number(uniqueness || 0), 0, 1)
  const separation = clamp(Number(margin || 0) / 0.14, 0, 1)
  return clamp(ratio * 0.32 + confidence * 0.16 + ensemble * 0.22 + validators * 0.12 + unique * 0.08 + separation * 0.10, 0, 1)
}

export class SyncLiveMatcherV10 extends BaseV9 {
  constructor(reference) {
    super(reference)
    this.v10Skipped = 0
    this.v10NoMatchFailures = 0
    this.v10OutlierStreak = 0
    this.v10Consensus = null
    this.v10ConsensusScore = 0
    this.v10DecisionMode = 'WAITING'
    this.v10DecisionSec = 0
    this.v10RiskFlags = []
    this.v10Reanchors = 0
  }

  resetSession(options = {}) {
    super.resetSession(options)
    if (this.v10Skipped == null) return
    this.v10Skipped = 0
    this.v10NoMatchFailures = 0
    this.v10OutlierStreak = 0
    this.v10Consensus = null
    this.v10ConsensusScore = 0
    this.v10DecisionMode = 'WAITING'
    this.v10DecisionSec = 0
    this.v10RiskFlags = []
    this.v10Reanchors = 0
  }

  clearDecisionWindow() {
    this.v10OutlierStreak = 0
    this.v10Consensus = null
    this.v10ConsensusScore = 0
    this.v10DecisionMode = 'WAITING'
    this.v10DecisionSec = 0
    this.v10RiskFlags = []
  }

  setWindow(inSec, outSec, now = performance.now(), enabled = true) {
    const result = super.setWindow(inSec, outSec, now, enabled)
    this.clearDecisionWindow()
    return result
  }

  rejectCandidate(now = performance.now()) {
    super.rejectCandidate(now)
    this.clearDecisionWindow()
    return this.snapshot(now, null)
  }

  unlock(now = performance.now()) {
    super.unlock(now)
    this.clearDecisionWindow()
    return this.snapshot(now, null)
  }

  isDecisionHold() {
    return !!this.noiseGate || !!this.v7Ambiguous || !!this.v9RepeatedHold
  }

  currentEvidenceMetrics(evidence) {
    const ensemble = Number(this.v8Top?.ensemble || 0)
    const validators = Number(this.v8Top?.validators || 0)
    const uniqueness = clamp(Number(this.v9Uniqueness ?? 1), 0, 1)
    const margin = Number(this.v8EnsembleMargin || 0)
    const contextSec = Number(this.v9ContextSec || 0)
    return {
      confidence: Number(evidence?.confidence || 0),
      ensemble,
      validators,
      uniqueness,
      margin,
      contextSec,
    }
  }

  resetConsensusAt(evidence, now) {
    this.provisional = { positionSec: evidence.positionSec, at: now }
    this.verify = []
    this.v10OutlierStreak = 0
    this.v10Consensus = null
    this.v10ConsensusScore = 0
    this.v10DecisionMode = 'VERIFYING'
    this.v10DecisionSec = 0
  }

  updateConsensusSummary(metrics, now) {
    const summary = summarize(this.verify)
    this.v10Consensus = summary
    this.v10DecisionSec = this.provisional ? Math.max(0, (now - this.provisional.at) / 1000) : 0
    this.v10ConsensusScore = consensusScore(summary, metrics.uniqueness, metrics.margin)
    return summary
  }

  updateVerification(evidence, now) {
    // Noise/SNR gates, V7 multi-candidate ambiguity and V9 repeated-region hold are
    // intentionally neither PASS nor FAIL. We simply wait for better information.
    if (this.isDecisionHold()) {
      this.v10Skipped += 1
      return
    }

    const metrics = this.currentEvidenceMetrics(evidence)

    if (!evidence || !finite(evidence.positionSec)) {
      this.v10NoMatchFailures += 1
      if (this.provisional) {
        this.verify.push({
          pass: false,
          confidence: 0,
          ensemble: metrics.ensemble,
          validators: metrics.validators,
          delta: null,
          at: now,
          reason: 'NO MATCH',
        })
        if (this.verify.length > MAX_CONSENSUS_RECORDS) this.verify.shift()
        this.updateConsensusSummary(metrics, now)
      }
      return
    }

    if (!this.provisional) {
      if (metrics.confidence < START_CONFIDENCE || metrics.ensemble < PASS_ENSEMBLE || metrics.validators < PASS_VALIDATORS) return
      this.resetConsensusAt(evidence, now)
    }

    const expected = this.provisional.positionSec + Math.max(0, (now - this.provisional.at) / 1000)
    const delta = evidence.positionSec - expected
    const pass = metrics.confidence >= PASS_CONFIDENCE &&
      metrics.ensemble >= PASS_ENSEMBLE &&
      metrics.validators >= PASS_VALIDATORS &&
      Math.abs(delta) <= MAX_PHASE_ERROR_SEC

    this.verify.push({
      pass,
      confidence: metrics.confidence,
      ensemble: metrics.ensemble,
      validators: metrics.validators,
      uniqueness: metrics.uniqueness,
      margin: metrics.margin,
      delta,
      at: now,
      reason: pass ? 'PASS' : 'EVIDENCE FAIL',
    })
    if (this.verify.length > MAX_CONSENSUS_RECORDS) this.verify.shift()

    if (pass) {
      this.v10OutlierStreak = 0
    } else if (metrics.confidence >= REANCHOR_CONFIDENCE && metrics.ensemble >= REANCHOR_ENSEMBLE && Math.abs(delta) > MAX_PHASE_ERROR_SEC) {
      this.v10OutlierStreak += 1
    } else {
      this.v10OutlierStreak = Math.max(0, this.v10OutlierStreak - 1)
    }

    // If the matcher has strongly converged to a different 1x clock for >1.2s,
    // the old provisional was probably wrong. Re-anchor instead of poisoning the
    // long consensus window forever. Ambiguous/noisy evidence can never trigger this.
    if (this.v10OutlierStreak >= REANCHOR_STREAK) {
      this.v10Reanchors += 1
      this.resetConsensusAt(evidence, now)
      return
    }

    const summary = this.updateConsensusSummary(metrics, now)

    const repeated = metrics.uniqueness < 0.32
    const fastReady = !repeated &&
      summary.total >= FAST_RECORDS &&
      summary.passRatio >= FAST_PASS_RATIO &&
      summary.avgConfidence >= FAST_AVG_CONFIDENCE &&
      summary.avgEnsemble >= FAST_AVG_ENSEMBLE &&
      summary.avgValidators >= FAST_AVG_VALIDATORS &&
      metrics.uniqueness >= FAST_UNIQUENESS &&
      metrics.margin >= FAST_MARGIN &&
      metrics.contextSec >= FAST_CONTEXT_SEC

    const normalReady = !repeated &&
      summary.total >= NORMAL_RECORDS &&
      summary.passRatio >= NORMAL_PASS_RATIO &&
      summary.avgConfidence >= NORMAL_AVG_CONFIDENCE &&
      summary.avgEnsemble >= NORMAL_AVG_ENSEMBLE &&
      summary.avgValidators >= NORMAL_AVG_VALIDATORS &&
      metrics.margin >= NORMAL_MARGIN &&
      metrics.contextSec >= NORMAL_CONTEXT_SEC

    const repeatedReady = repeated &&
      summary.total >= REPEATED_RECORDS &&
      summary.passRatio >= REPEATED_PASS_RATIO &&
      summary.avgConfidence >= REPEATED_AVG_CONFIDENCE &&
      summary.avgEnsemble >= REPEATED_AVG_ENSEMBLE &&
      summary.avgValidators >= REPEATED_AVG_VALIDATORS &&
      metrics.margin >= REPEATED_MARGIN &&
      metrics.contextSec >= REPEATED_CONTEXT_SEC

    if (!(fastReady || normalReady || repeatedReady)) {
      this.v10DecisionMode = repeated ? 'REPEATED LONG VERIFY' : 'LONG VERIFY'
      return
    }

    const stablePos = this.provisional.positionSec + Math.max(0, (now - this.provisional.at) / 1000)
    const mode = fastReady ? 'FAST UNIQUE' : repeatedReady ? 'REPEATED VERIFIED' : 'NORMAL VERIFIED'
    this.candidate = {
      positionSec: stablePos,
      at: now,
      confidence: Math.round(summary.avgConfidence),
      passCount: summary.passCount,
      total: summary.total,
      fast: fastReady,
      consensusScore: Math.round(this.v10ConsensusScore * 100),
      decisionMode: mode,
      decisionSec: this.v10DecisionSec,
      avgEnsemble: summary.avgEnsemble,
      avgValidators: summary.avgValidators,
    }
    this.v10DecisionMode = mode
  }

  buildRiskFlags() {
    const flags = []
    if (this.noiseGate) flags.push(`NOISE:${this.gateReason || this.v51GateReason || 'GATE'}`)
    if (this.v7Ambiguous) flags.push('MULTI-CANDIDATE')
    if (this.v9RepeatedHold) flags.push('REPEATED-HOLD')
    if (Number(this.v9Uniqueness || 0) < 0.32) flags.push('LOW-UNIQUENESS')
    if (Number(this.v8EnsembleMargin || 0) < NORMAL_MARGIN) flags.push('LOW-MARGIN')
    if (Number(this.v8Top?.validators || 0) < PASS_VALIDATORS) flags.push('LOW-VALIDATOR-COUNT')
    if (Number(this.snrDb || this.v51SnrDb || -60) < -2.5) flags.push('LOW-SNR')
    return flags
  }

  snapshot(now = performance.now(), evidence = null, extra = {}) {
    const base = super.snapshot(now, evidence, extra)
    const summary = this.v10Consensus || summarize(this.verify || [])
    this.v10RiskFlags = this.buildRiskFlags()
    const candidateMeta = this.candidate || null
    return {
      ...base,
      consensusPass: summary.passCount,
      consensusTotal: summary.total,
      consensusRatio: Math.round(summary.passRatio * 100),
      consensusScore: candidateMeta?.consensusScore ?? Math.round((this.v10ConsensusScore || 0) * 100),
      consensusAvgConfidence: Math.round(summary.avgConfidence || 0),
      consensusAvgEnsemble: Math.round((summary.avgEnsemble || 0) * 100),
      consensusAvgValidators: Number(summary.avgValidators || 0).toFixed(1),
      consensusPhaseErrorMs: Math.round(summary.avgAbsDeltaMs || 0),
      decisionMode: candidateMeta?.decisionMode || this.v10DecisionMode || 'WAITING',
      decisionSec: Number(candidateMeta?.decisionSec ?? this.v10DecisionSec ?? 0).toFixed(1),
      riskFlags: this.v10RiskFlags,
      riskCount: this.v10RiskFlags.length,
      consensusSkipped: this.v10Skipped || 0,
      noMatchFailures: this.v10NoMatchFailures || 0,
      reanchors: this.v10Reanchors || 0,
      fieldMatcherVersion: 'V10 PRODUCTION CONSENSUS',
    }
  }
}

export const SYNC_LIVE_V5 = {
  ...BASE_V9,
  version: 'V10 PRODUCTION CONSENSUS',
  productionConsensus: true,
  maxConsensusRecords: MAX_CONSENSUS_RECORDS,
  fastRecords: FAST_RECORDS,
  normalRecords: NORMAL_RECORDS,
  repeatedRecords: REPEATED_RECORDS,
  maxPhaseErrorMs: MAX_PHASE_ERROR_SEC * 1000,
  wrongLockPriority: 'CONSERVATIVE',
}

export const __SYNC_LIVE_V10_TESTING__ = {
  mean,
  summarize,
  consensusScore,
  constants: {
    MAX_CONSENSUS_RECORDS,
    FAST_RECORDS,
    NORMAL_RECORDS,
    REPEATED_RECORDS,
    MAX_PHASE_ERROR_SEC,
    FAST_PASS_RATIO,
    NORMAL_PASS_RATIO,
    REPEATED_PASS_RATIO,
  },
}
