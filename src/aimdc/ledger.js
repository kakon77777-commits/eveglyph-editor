// ─── AIMD-C computation ledger (roadmap Phase 3, AIMD-C v0.1) ──────────────
// Per-block execution record — whitepaper §11.1's λ_b tuple, trimmed to what
// this phase can honestly support: no external effects exist yet (L1 pure
// functions only, per Decision — see roadmap v0.6), so every recorded run is
// deterministic by construction. The useful part of the record right now is
// knowing WHAT was computed FROM WHAT (source/input/output hashes), not
// proving bit-exact cross-machine reproducibility — that needs the full
// L2+ sandboxed-compute story, out of scope here.
//
// A plain string hash (djb2), not a cryptographic one — this ledger answers
// "did the input change since last render," a local, non-adversarial
// question. Web Crypto's async digest() would complicate the otherwise-
// synchronous evaluate-and-render pipeline for no real benefit here.
function hash(str) {
  let h = 5381
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0
  return (h >>> 0).toString(16)
}

export function ledgerEntry(block, inputEnv, output) {
  return {
    block: block.id,
    runtime: 'aimd-core',
    runtime_version: '0.1.0',
    source_hash: hash(JSON.stringify(block)),
    input_hash: hash(JSON.stringify(inputEnv)),
    output_hash: hash(JSON.stringify(output)),
    deterministic: true,
    effects: [],
  }
}
