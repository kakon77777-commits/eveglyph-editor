import { createServer } from 'node:http'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.dirname(fileURLToPath(import.meta.url))
const types = { '.html':'text/html; charset=utf-8','.json':'application/json; charset=utf-8' }
createServer(async (req,res) => {
  const rel = req.url === '/' ? 'index.html' : decodeURIComponent(req.url).replace(/^\//,'')
  const target = path.resolve(root, rel)
  if (!target.startsWith(root + path.sep) && target !== path.join(root,'index.html')) return res.writeHead(400).end('bad path')
  try { const body=await fs.readFile(target); res.writeHead(200,{'content-type':types[path.extname(target)]||'text/plain; charset=utf-8'}); res.end(body) }
  catch { res.writeHead(404).end('not found') }
}).listen(4173,'127.0.0.1',()=>console.log('http://127.0.0.1:4173'))
