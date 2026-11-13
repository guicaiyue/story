#!/usr/bin/env node
// 开发介入度量：从 dsh-dev 的会话日志与任务卡数据里统计「人为了推进开发做了多少动作」。
//
// 用法（在宿主上跑）：
//   node scripts/dev-metrics.mjs            # 汇总所有 story 工作区会话
//   node scripts/dev-metrics.mjs <session>  # 只看某个会话
// 输出 JSON，方便贴进复盘文档。
//
// 数据来源：
//   $DSH_HOME/sessions/--workspace-story--/<session>/session.v4.jsonl.zstd
//   $DSH_HOME/dsh-task-cards/cards.json
//   $DSH_HOME/dsh-task-cards/cards.json.journal/<cardId>.jsonl

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const DSH_HOME = process.env.DSH_DEV_HOME || '/vol1/1000/docker/dsh-dev/data/dsh'
const SESSIONS = path.join(DSH_HOME, 'sessions', '--workspace-story--')
const CARDS = path.join(DSH_HOME, 'dsh-task-cards', 'cards.json')
const JOURNAL_DIR = path.join(DSH_HOME, 'dsh-task-cards', 'cards.json.journal')

function readEvents(sessionId) {
  const file = path.join(SESSIONS, sessionId, 'session.v4.jsonl.zstd')
  if (!existsSync(file)) throw new Error(`会话日志不存在：${file}`)
  const raw = execFileSync('zstd', ['-dc', file], { maxBuffer: 512 * 1024 * 1024 }).toString()
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

function listSessions() {
  if (!existsSync(SESSIONS)) return []
  return readdirSync(SESSIONS)
    .filter((name) => name.startsWith('session-'))
    .map((name) => ({ name, at: statSync(path.join(SESSIONS, name)).mtimeMs }))
    .sort((a, b) => a.at - b.at)
    .map((item) => item.name)
}

/** 人工消息 vs 系统派发：只看 source.kind。 */
function countMessages(events) {
  const out = { human: 0, cardAnswer: 0, other: 0, turns: 0 }
  for (const event of events) {
    if (event.type === 'turn/end') out.turns += 1
    if (event.type !== 'user/message') continue
    const kind = event.data?.source?.kind || 'unknown'
    if (kind === 'user') out.human += 1
    else if (kind === 'dsh-task-cards') out.cardAnswer += 1
    else out.other += 1
  }
  return out
}

/** 任务卡：从 journal 数「人做的决定」，从 cards.json 数状态。 */
function countCardActions() {
  const out = {
    cards: 0,
    approved: 0,
    answered: 0,
    autoApplied: 0,
    confirmed: 0,
    otherAuthority: 0,
  }
  if (!existsSync(CARDS)) return out
  const cards = JSON.parse(readFileSync(CARDS, 'utf8'))
  out.cards = cards.length
  for (const card of cards) {
    if (card.advice?.autoApply) out.autoApplied += 1
    if (card.deliveryState === 'confirmed') out.confirmed += 1
    const events = Array.isArray(card.events) ? card.events : []
    if (events.some((event) => event.type === 'answered')) out.answered += 1
  }
  if (!existsSync(JOURNAL_DIR)) return out
  for (const name of readdirSync(JOURNAL_DIR)) {
    if (!name.endsWith('.jsonl')) continue
    for (const line of readFileSync(path.join(JOURNAL_DIR, name), 'utf8').split('\n')) {
      if (!line) continue
      let event
      try {
        event = JSON.parse(line)
      } catch {
        continue
      }
      if (event.actor === 'scheduler' && event.authority === 'user') out.approved += 1
      else if (event.actor !== 'system') out.otherAuthority += 1
    }
  }
  return out
}

const explicit = process.argv[2]
const sessions = explicit ? [explicit] : listSessions()
const totals = { human: 0, cardAnswer: 0, other: 0, turns: 0 }
const perSession = {}

for (const sessionId of sessions) {
  try {
    const counted = countMessages(readEvents(sessionId))
    perSession[sessionId] = counted
    for (const key of Object.keys(totals)) totals[key] += counted[key]
  } catch (err) {
    perSession[sessionId] = { error: err.message }
  }
}

console.log(
  JSON.stringify(
    {
      at: new Date().toISOString(),
      sessions: sessions.length,
      totals,
      card: countCardActions(),
      perSession,
    },
    null,
    2,
  ),
)
