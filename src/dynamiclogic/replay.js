// ─── DYNAMIC LOGIC REPLAY CURSOR ───────────────────────────────────────────
// UI-local replay position only. This is deliberately NOT canonical judgment
// state and never writes back to Markdown or disk. A cursor means "project the
// first N evidence events"; clearing it returns to the live/latest projection.

const cursors = new Map()

export function getReplayCursor(claimId, maxEvidenceCount) {
  if (!cursors.has(claimId)) return maxEvidenceCount
  const raw = Number(cursors.get(claimId))
  if (!Number.isFinite(raw)) return maxEvidenceCount
  return Math.max(0, Math.min(maxEvidenceCount, Math.trunc(raw)))
}

export function setReplayCursor(claimId, cursor, maxEvidenceCount) {
  const max = Math.max(0, Math.trunc(Number(maxEvidenceCount) || 0))
  const n = Math.max(0, Math.min(max, Math.trunc(Number(cursor) || 0)))

  // `cursor === max` is semantically Live/latest, not a frozen replay frame.
  // Delete rather than store the old max so a later source edit that appends a
  // new evidence event automatically follows the new latest state instead of
  // becoming an accidental stale replay at the former end of history.
  if (n >= max) cursors.delete(claimId)
  else cursors.set(claimId, n)
  return n
}

export function clearReplayCursor(claimId) {
  cursors.delete(claimId)
}

export function isReplaying(claimId, maxEvidenceCount) {
  return cursors.has(claimId) && getReplayCursor(claimId, maxEvidenceCount) !== maxEvidenceCount
}
