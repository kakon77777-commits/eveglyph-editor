export async function monitor(type, payload = {}) {
  try {
    await fetch('/api/monitor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, ...payload })
    })
  } catch {
    // Diagnostics must never interrupt the editor.
  }
}
