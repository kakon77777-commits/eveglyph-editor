import { promises as fs } from 'node:fs'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
const mko = JSON.parse(await fs.readFile(new URL('./mko.json', import.meta.url), 'utf8'))
const result = value => ({ content: [{ type:'text', text:JSON.stringify(value,null,2) }] })
const server = new McpServer({ name:'ocme-mvp', version:'0.1.0' })
server.registerTool('search_math_objects',{title:'搜尋數學物件',inputSchema:{query:z.string().default('')}},async({query})=>result(!query||`${mko.id} ${mko.titles['zh-Hant']}`.includes(query)?[{id:mko.id,title:mko.titles['zh-Hant'],type:mko.type}]:[]))
server.registerTool('get_math_object',{title:'取得完整 MKO',inputSchema:{id:z.string()}},async({id})=>result(id===mko.id?mko:{error:'unknown object'}))
server.registerTool('get_computational_companion',{title:'取得計算伴隨與非同一性聲明',inputSchema:{id:z.string()}},async({id})=>result(id===mko.id?mko.computational_companions:{error:'unknown object'}))
server.registerTool('get_verification_status',{title:'取得證據與形式化狀態',inputSchema:{id:z.string()}},async({id})=>result(id===mko.id?{proofs:mko.proofs,verification:mko.verification,formalization:mko.formalization}:{error:'unknown object'}))
await server.connect(new StdioServerTransport())
