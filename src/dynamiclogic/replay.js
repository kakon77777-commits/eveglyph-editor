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
  const n = Math.max(0, Math.min(maxEvidenceCount, Math.trunc(Number(cursor) || 0)))
  cursors.set(claimId, n)
  return n
}

export function clearReplayCursor(claimId) {
  cursors.delete(claimId)
}

export function isReplaying(claimId, maxEvidenceCount) {
  return getReplayCursor(claimId, maxEvidenceCount) !== maxEvidenceCount
}
