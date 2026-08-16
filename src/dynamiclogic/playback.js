// ─── DYNAMIC LOGIC EVENT-DRIVEN PLAYBACK ───────────────────────────────────
// Auto-advances the existing evidence-prefix replay cursor. This is not an
// animation loop: each timer tick commits one real replay-step change, then the
// normal preview pipeline re-evaluates/render it. No event -> no visual motion.
import { clearReplayCursor, getReplayCursor, setReplayCursor } from './replay.js'

const sessions = new Map()
const DEFAULT_INTERVAL_MS = 900

export function isReplayPlaying(replayKey) {
  return sessions.has(replayKey)
}

export function stopReplayPlayback(replayKey) {
  const session = sessions.get(replayKey)
  if (session?.timer) clearTimeout(session.timer)
  sessions.delete(replayKey)
}

function visibleHistory(replayKey) {
  if (typeof document === 'undefined') return null
  return [...document.querySelectorAll('.dynamic-history')]
    .find(el => el.dataset.dlReplayKey === replayKey) || null
}

export function startReplayPlayback(replayKey, maxEvidenceCount, refresh, intervalMs = DEFAULT_INTERVAL_MS) {
  stopReplayPlayback(replayKey)
  if (!(maxEvidenceCount > 0)) return false

  let cursor = getReplayCursor(replayKey, maxEvidenceCount)
  // Play from the beginning when the view is currently at Live/latest.
  if (cursor >= maxEvidenceCount) cursor = 0
  setReplayCursor(replayKey, cursor, maxEvidenceCount)

  const session = {
    replayKey,
    maxEvidenceCount,
    intervalMs: Math.max(150, Number(intervalMs) || DEFAULT_INTERVAL_MS),
    timer: null,
  }
  sessions.set(replayKey, session)

  // Render the starting frame immediately, then advance by one evidence event
  // per timer tick. The full preview pipeline remains the single source of
  // projection truth (Dynamic Logic -> externalRefs -> AIMD-C -> KaTeX).
  refresh()

  const tick = () => {
    const active = sessions.get(replayKey)
    if (!active) return

    // File/tab switching can remove the History block while a timer is alive.
    // Stop silently instead of waking previewUpdate() in an unrelated document.
    const visible = visibleHistory(replayKey)
    if (typeof document !== 'undefined' && !visible) {
      stopReplayPlayback(replayKey)
      return
    }

    // Editing the source while playback is running may add/remove evidence.
    // A replay session is defined over one fixed event sequence: if the live DOM
    // reports a different max, stop rather than silently mixing two histories.
    if (visible) {
      const currentMax = Number(visible.dataset.dlMax || 0)
      if (currentMax !== active.maxEvidenceCount) {
        stopReplayPlayback(replayKey)
        return
      }
    }

    const current = getReplayCursor(replayKey, active.maxEvidenceCount)
    const next = Math.min(active.maxEvidenceCount, current + 1)
    setReplayCursor(replayKey, next, active.maxEvidenceCount)

    // Stop BEFORE the final refresh so the newly-rendered controls correctly
    // show Play rather than one stale Pause frame at the end of playback.
    if (next >= active.maxEvidenceCount) {
      sessions.delete(replayKey)
      refresh()
      return
    }

    refresh()
    active.timer = setTimeout(tick, active.intervalMs)
  }

  session.timer = setTimeout(tick, session.intervalMs)
  return true
}

export function toggleReplayPlayback(replayKey, maxEvidenceCount, refresh, intervalMs) {
  if (isReplayPlaying(replayKey)) {
    stopReplayPlayback(replayKey)
    refresh()
    return false
  }
  return startReplayPlayback(replayKey, maxEvidenceCount, refresh, intervalMs)
}

export function returnToLive(replayKey, refresh) {
  stopReplayPlayback(replayKey)
  clearReplayCursor(replayKey)
  refresh()
}
