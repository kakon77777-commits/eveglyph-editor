// ─── STUDIO DRAFT GENERATOR ──────────────────────────────────────
// AI may propose a bounded authoring draft here. It never writes a file or
// mutates Runtime State until a human applies the YAML and validates it.

import jsYaml from 'js-yaml'
import { validateStateMachine } from './validate.js'

export const STUDIO_DRAFT_FORMAT = 'compilableworld.studio-draft/v0.1'

export const STUDIO_LIMITS = Object.freeze({
  states: 64,
  transitions: 256,
  variables: 128,
  events: 256,
  instructions: 256,
  responses: 512,
  examplesPerInstruction: 12,
  textChars: 4000,
  promptChars: 24000,
})

const issue = (severity, code, message, path) => ({ severity, code, message, path })
const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value)

function boundedText(value, path, issues) {
  if (value === undefined || value === null) return
  if (typeof value !== 'string') {
    issues.push(issue('error', 'invalid_text', '文字欄位必須是字串', path))
    return
  }
  if (value.length > STUDIO_LIMITS.textChars) {
    issues.push(issue('error', 'text_limit_exceeded', '文字超過 ' + STUDIO_LIMITS.textChars + ' 字元上限', path))
  }
}

function validateNamedRecords(records, path, limit, issues, textFields = []) {
  if (records === undefined) return
  if (!Array.isArray(records)) {
    issues.push(issue('error', 'invalid_record_list', '必須是陣列', path))
    return
  }
  if (records.length > limit) {
    issues.push(issue('error', 'record_limit_exceeded', '超過 ' + limit + ' 筆上限', path))
  }
  records.forEach((record, index) => {
    const recordPath = path + '[' + index + ']'
    if (!isObject(record)) {
      issues.push(issue('error', 'invalid_record', '每筆資料必須是 object', recordPath))
      return
    }
    const name = record.id ?? record.name
    if (typeof name !== 'string' || !name.trim()) {
      issues.push(issue('error', 'missing_record_id', '每筆資料需要 id 或 name', recordPath + '.id'))
    }
    textFields.forEach(field => boundedText(record[field], recordPath + '.' + field, issues))
  })
}

export function validateStudioDraft(document) {
  const issues = []
  if (!isObject(document)) return [issue('error', 'not_a_mapping', 'AI draft 必須是 object', '')]
  if (document.kind !== 'state_machine') {
    issues.push(issue('error', 'unsupported_draft_kind', '目前 Studio 生成器只接受 kind: state_machine', 'kind'))
    return issues
  }
  if (typeof document.id !== 'string' || !document.id.trim()) {
    issues.push(issue('error', 'missing_id', 'state machine 需要 id', 'id'))
  }
  if (!Array.isArray(document.states)) {
    issues.push(issue('error', 'missing_states', 'state machine 需要 states 陣列', 'states'))
  } else {
    if (document.states.length > STUDIO_LIMITS.states) {
      issues.push(issue('error', 'state_limit_exceeded', '超過 ' + STUDIO_LIMITS.states + ' 個狀態上限', 'states'))
    }
    document.states.forEach((state, index) => {
      if (typeof state !== 'string' || !state.trim()) {
        issues.push(issue('error', 'invalid_state_name', '狀態名稱必須是非空字串', 'states[' + index + ']'))
      }
    })
  }

  validateStateMachine(document).forEach(item => {
    issues.push({ ...item, code: 'state_machine_' + item.code })
  })

  if (Array.isArray(document.transitions) && document.transitions.length > STUDIO_LIMITS.transitions) {
    issues.push(issue('error', 'transition_limit_exceeded', '超過 ' + STUDIO_LIMITS.transitions + ' 條 transition 上限', 'transitions'))
  }
  if (Array.isArray(document.transitions)) {
    document.transitions.forEach((transition, index) => {
      const path = 'transitions[' + index + ']'
      if (!isObject(transition)) return
      if (Array.isArray(transition.guards)) {
        transition.guards.forEach((guard, guardIndex) => boundedText(guard, path + '.guards[' + guardIndex + ']', issues))
      } else if (transition.guards !== undefined) {
        issues.push(issue('error', 'invalid_guards', 'guards 必須是字串陣列', path + '.guards'))
      }
      boundedText(transition.on, path + '.on', issues)
    })
  }

  validateNamedRecords(document.variables, 'variables', STUDIO_LIMITS.variables, issues, ['description'])
  validateNamedRecords(document.events, 'events', STUDIO_LIMITS.events, issues, ['description'])
  validateNamedRecords(document.instructions, 'instructions', STUDIO_LIMITS.instructions, issues, ['description', 'intent'])
  validateNamedRecords(document.responses, 'responses', STUDIO_LIMITS.responses, issues, ['text', 'description'])

  if (Array.isArray(document.instructions)) {
    document.instructions.forEach((record, index) => {
      const path = 'instructions[' + index + '].examples'
      if (!isObject(record) || record.examples === undefined) return
      if (!Array.isArray(record.examples)) {
        issues.push(issue('error', 'invalid_instruction_examples', 'examples 必須是陣列', path))
      } else if (record.examples.length > STUDIO_LIMITS.examplesPerInstruction) {
        issues.push(issue('error', 'instruction_example_limit_exceeded', '每個 instruction 最多 ' + STUDIO_LIMITS.examplesPerInstruction + ' 個例句', path))
      } else {
        record.examples.forEach((example, exampleIndex) => boundedText(example, path + '[' + exampleIndex + ']', issues))
      }
    })
  }

  return issues
}

function candidateText(raw) {
  const text = String(raw || '').trim()
  const fence = String.fromCharCode(96).repeat(3)
  const fenced = text.match(new RegExp(fence + '(?:json|ya?ml)?\\s*([\\s\\S]*?)' + fence, 'i'))
  if (fenced) return fenced[1].trim()
  const firstObject = text.indexOf('{')
  const lastObject = text.lastIndexOf('}')
  if (firstObject >= 0 && lastObject > firstObject) return text.slice(firstObject, lastObject + 1)
  return text
}

export function parseStudioDraft(raw) {
  const source = candidateText(raw)
  if (!source) return { document: null, yaml: '', issues: [issue('error', 'empty_ai_draft', 'AI 沒有回傳內容', '')] }
  let document
  try {
    document = jsYaml.load(source)
  } catch (error) {
    return { document: null, yaml: '', issues: [issue('error', 'draft_parse_error', error.message, '')] }
  }
  const issues = validateStudioDraft(document)
  let yaml = ''
  try {
    yaml = jsYaml.dump(document, { noRefs: true, lineWidth: 120, sortKeys: false })
  } catch (error) {
    issues.push(issue('error', 'draft_serialize_error', error.message, ''))
  }
  return { document, yaml, issues }
}

export function buildStudioPrompt({ instruction = '', source = '', activePath = '' } = {}) {
  const safeSource = String(source || '').slice(0, STUDIO_LIMITS.promptChars)
  const safeInstruction = String(instruction || '').trim() || '根據目前文件，提出一個可擴展但不誇張的複雜狀態機。'
  const lines = [
    '你是 CompilableWorld / EveGlyph Studio 的世界設計助手。請產生一份「待人工審核」的 state machine YAML draft。',
    '',
    '硬性規則：',
    '1. 只輸出一個 YAML object，不要 Markdown code fence，不要解釋文字。',
    '2. 根節點必須是 kind: state_machine，並包含 id、initial、states、transitions。',
    '3. 可額外產生 variables、events、instructions、responses，供語義資料與大量語言指令／回復使用；這些都是 draft，不是已執行規則。',
    '4. transitions 的 on 必須是穩定的事件名稱；guards 只能是短字串條件，不要放 Python、JavaScript、SQL 或任意程式碼。',
    '5. 對不確定的外部引用，使用清楚的 placeholder 或空陣列，不要捏造現有 Runtime API。',
    '6. 控制規模：最多 ' + STUDIO_LIMITS.states + ' states、' + STUDIO_LIMITS.transitions + ' transitions、' + STUDIO_LIMITS.variables + ' variables、' + STUDIO_LIMITS.events + ' events、' + STUDIO_LIMITS.instructions + ' instructions、' + STUDIO_LIMITS.responses + ' responses。',
    '7. 每個 instruction 最多 ' + STUDIO_LIMITS.examplesPerInstruction + ' 個 examples；每個文字欄位最多 ' + STUDIO_LIMITS.textChars + ' 字元。',
    '',
    '建議結構：',
    'kind: state_machine',
    'id: example.machine',
    'initial: dormant',
    'states: [dormant, active, completed]',
    'variables:',
    '  - id: trust',
    '    type: number',
    '    default: 0',
    '    description: ...',
    'events:',
    '  - id: dialogue.responded',
    '    description: ...',
    '    payload: []',
    'instructions:',
    '  - id: ask_about_caravan',
    '    intent: dialogue.responded',
    '    examples: []',
    '    description: ...',
    'responses:',
    '  - id: response.initial',
    '    when: []',
    '    text: ...',
    '    description: ...',
    'transitions:',
    '  - from: dormant',
    '    to: active',
    '    on: dialogue.responded',
    '    guards: []',
    '',
    '使用者需求：',
    safeInstruction,
    '',
    '目前文件：' + (activePath || '(未命名)'),
    '---',
    safeSource || '(目前沒有文件內容，請建立最小可用 draft)',
    '---',
  ]
  return lines.join('\n')
}

export function summarizeStudioIssues(issues) {
  const errors = issues.filter(item => item.severity === 'error').length
  const warnings = issues.filter(item => item.severity === 'warning').length
  return { errors, warnings, ok: errors === 0 }
}
