// ─── VALIDATOR ────────────────────────────────────────────────────
// Whitepaper compilableworld_studio_mssp_rdr_visual_world_ide_v0.1.md §8
// (static validator). Deliberately pure and rendering-agnostic: every
// function here takes a parsed doc and returns a plain array of
// { severity: 'error'|'warning', code, message, path? } objects -- no DOM,
// no HTML strings. Two consumers read this same output: smview.js/
// entityview.js render it as HTML for a human via diagnostics.js, and it's
// just as readable as JSON for an agent reading this file directly (Neo:
// "又不只是我人類在看的，AI其實也會看") -- `code` is the stable, English,
// programmatic handle; `message` is the human-facing (zh-Hant) prose.
//
// v0.1 scope is intra-document only (per whitepaper §8.1/§8.3, the subset
// that doesn't require scanning the whole workspace) -- cross-file reference
// checks (§8.2) aren't meaningful yet because no current IR type actually
// references another file's IDs (see the Workspace Overview panel's own
// limitations note for the same reason).

function issue(severity, code, message, path) {
  return path ? { severity, code, message, path } : { severity, code, message }
}

// ── State machine (whitepaper §8.3) ────────────────────────────────
export function validateStateMachine(doc) {
  const issues = []
  if (!doc || typeof doc !== 'object') return [issue('error', 'not_a_mapping', 'document is not a mapping')]

  const transitions = Array.isArray(doc.transitions) ? doc.transitions : []
  const declared = new Set(Array.isArray(doc.states) ? doc.states : [])
  const allStates = new Set(declared)
  for (const t of transitions) {
    if (t.from) allStates.add(t.from)
    if (t.to) allStates.add(t.to)
  }

  if (!doc.initial) {
    issues.push(issue('error', 'no_initial_state', '無初始狀態 (no initial state declared)', 'initial'))
  } else if (!allStates.has(doc.initial)) {
    issues.push(issue('error', 'initial_state_undefined', `初始狀態 "${doc.initial}" 不在任何 transition 或 states 清單中`, 'initial'))
  }

  transitions.forEach((t, i) => {
    if (!t.from || !allStates.has(t.from)) issues.push(issue('error', 'transition_from_undefined', `transition[${i}]: from "${t.from}" 未定義`, `transitions[${i}].from`))
    if (!t.to || !allStates.has(t.to))     issues.push(issue('error', 'transition_to_undefined', `transition[${i}]: to "${t.to}" 未定義`, `transitions[${i}].to`))
  })

  // 衝突轉移 (conflicting transitions): same (from, on) pair appearing twice
  // is ambiguous -- which one fires is undefined.
  const seenFromOn = new Map()
  transitions.forEach((t, i) => {
    if (!t.from || !t.on) return
    const key = `${t.from} ${t.on}`
    if (seenFromOn.has(key)) {
      issues.push(issue('warning', 'conflicting_transition', `衝突轉移: "${t.from}" 對事件 "${t.on}" 有多條 transition (transition[${seenFromOn.get(key)}] 與 [${i}])`, `transitions[${i}]`))
    } else {
      seenFromOn.set(key, i)
    }
  })

  // 不可達狀態 (unreachable states): BFS forward from initial along transitions.
  if (doc.initial && allStates.has(doc.initial)) {
    const reachable = new Set([doc.initial])
    let grew = true
    while (grew) {
      grew = false
      for (const t of transitions) {
        if (reachable.has(t.from) && t.to && !reachable.has(t.to)) { reachable.add(t.to); grew = true }
      }
    }
    for (const s of allStates) {
      if (!reachable.has(s)) issues.push(issue('warning', 'unreachable_state', `不可達狀態: "${s}" 沒有從 "${doc.initial}" 出發的路徑`, s))
    }
  }

  return issues
}

// Convenience for renderers: the set of state names flagged unreachable,
// derived from the same issue list rather than re-running the BFS.
export function unreachableStatesOf(issues) {
  return new Set(issues.filter(i => i.code === 'unreachable_state').map(i => i.path))
}

// ── Entity (whitepaper §8.1 schema checks, applied to the fields this
// project's EntityIR actually declares so far: id, type) ──────────────
export function validateEntity(doc) {
  const issues = []
  if (!doc || typeof doc !== 'object') return [issue('error', 'not_a_mapping', 'document is not a mapping')]
  if (!doc.id)   issues.push(issue('error', 'missing_id', '缺少必填欄位 id', 'id'))
  if (!doc.type) issues.push(issue('warning', 'missing_type', '缺少 type 欄位', 'type'))
  return issues
}

export function validateEntityList(doc) {
  const issues = []
  const entities = Array.isArray(doc?.entities) ? doc.entities : []
  if (!entities.length) return [issue('warning', 'empty_entity_list', 'entity_list 沒有任何 entity')]

  const seenIds = new Map()
  entities.forEach((e, i) => {
    if (!e || !e.id) { issues.push(issue('error', 'missing_id', `entities[${i}] 缺少必填欄位 id`, `entities[${i}].id`)); return }
    if (seenIds.has(e.id)) {
      issues.push(issue('error', 'duplicate_id', `重複 id: "${e.id}" 同時出現在 entities[${seenIds.get(e.id)}] 與 [${i}]`, `entities[${i}].id`))
    } else {
      seenIds.set(e.id, i)
    }
  })
  return issues
}
