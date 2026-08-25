import { applySafetyReceiverV065 } from './managementSafetyV065.js'

const legacyStopPlayback = `void stopPlayback() {
  playing = false;
  lastElapsedMs = 0;
  allOff();
}`

const previewStopPlayback = `void stopPlayback() {
  playing = false;
  previewState = PREVIEW_OFF;
  lastElapsedMs = 0;
  allOff();
}`

const safetyStopPlayback = `void stopPlayback() {
  if (playing) {
    completedEpochValid = true;
    completedCueSeq = activeCueSeq;
    completedShowStartMasterMs = playbackStartMasterMs;
  }
  playing = false;
  aClockOwnsLive = false;
  lastElapsedMs = 0;
  allOff();
  loadStatusAck();
}`

const safetyPreviewStopPlayback = `void stopPlayback() {
  if (playing) {
    completedEpochValid = true;
    completedCueSeq = activeCueSeq;
    completedShowStartMasterMs = playbackStartMasterMs;
  }
  playing = false;
  aClockOwnsLive = false;
  previewState = PREVIEW_OFF;
  lastElapsedMs = 0;
  allOff();
  loadStatusAck();
}`

const structuralStopPlayback = /void\s+stopPlayback\s*\(\s*\)\s*\{\s*playing\s*=\s*false\s*;\s*(?:previewState\s*=\s*PREVIEW_OFF\s*;\s*)?lastElapsedMs\s*=\s*0\s*;\s*allOff\s*\(\s*\)\s*;\s*\}/m

export function normalizeSafetyReceiverInputV068(source) {
  if (source.includes(legacyStopPlayback)) return source
  if (source.includes(previewStopPlayback)) return source.replace(previewStopPlayback, legacyStopPlayback)
  if (!structuralStopPlayback.test(source)) {
    throw new Error('v0.6.8 receiver safety: structural stopPlayback anchor not found')
  }
  return source.replace(structuralStopPlayback, legacyStopPlayback)
}

export function restoreSafetyReceiverPreviewResetV068(source) {
  if (source.includes(safetyPreviewStopPlayback)) return source
  if (!source.includes(safetyStopPlayback)) {
    throw new Error('v0.6.8 receiver safety: v0.6.5 tombstone output not found')
  }
  return source.replace(safetyStopPlayback, safetyPreviewStopPlayback)
}

export function applySafetyReceiverV068Compat(source) {
  // v0.6.8 compatibility only: preserve the existing PREVIEW terminal reset while
  // applying the unchanged v0.6.5 completed-epoch tombstone safety behavior.
  const normalized = normalizeSafetyReceiverInputV068(source)
  return restoreSafetyReceiverPreviewResetV068(applySafetyReceiverV065(normalized))
}
