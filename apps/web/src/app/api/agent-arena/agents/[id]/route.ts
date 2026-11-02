import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getCurrentUserFromReq, isAdminUser } from '@/lib/auth'
import {
  getArenaAgentById,
  updateArenaAgentConfig,
  setArenaAgentStatus,
  resetArenaAgentLedger,
  updateArenaAgentCash,
  getArenaHoldings,
  getArenaSnapshots,
  getArenaTrades,
  getArenaDecisionLogs,
  getArenaDividendCredits,
} from '@stock/database'
import { INVESTMENT_FRAMEWORKS } from '@stock/ai-engine'

export const dynamic = 'force-dynamic'

const VALID_TONES = new Set(['aggressive', 'neutral', 'conservative'])
const VALID_STRATEGIES = new Set(INVESTMENT_FRAMEWORKS.map((f) => f.id))

interface Params {
  params: Promise<{ id: string }>
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const agentId = Number(id)
    if (!Number.isInteger(agentId) || agentId <= 0) {
      return NextResponse.json({ error: '無效的 agent id' }, { status: 400 })
    }

    const agent = await getArenaAgentById(agentId)
    if (!agent) {
      return NextResponse.json({ error: '找不到該 agent' }, { status: 404 })
    }

    const [holdings, snapshots, trades, decisionLogs, dividendCredits] = await Promise.all([
      getArenaHoldings(agent.id).catch((err) => {
        console.error('[Arena API] getArenaHoldings failed:', err)
        return []
      }),
      getArenaSnapshots(agent.id).catch((err) => {
        console.error('[Arena API] getArenaSnapshots failed:', err)
        return []
      }),
      getArenaTrades(agent.id, 50).catch((err) => {
        console.error('[Arena API] getArenaTrades failed:', err)
        return []
      }),
      getArenaDecisionLogs(agent.id).catch((err) => {
        console.error('[Arena API] getArenaDecisionLogs failed:', err)
        return []
      }),
      getArenaDividendCredits(agent.id).catch((err) => {
        console.error('[Arena API] getArenaDividendCredits failed:', err)
        return []
      }),
    ])

    const totalDividends = dividendCredits.reduce((sum, c) => sum + (Number(c.amount) || 0), 0)

    return NextResponse.json(
      { agent, holdings, snapshots, trades, decisionLogs, dividendCredits, totalDividends },
      { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' } },
    )
  } catch (err: any) {
    console.error('[Arena API] GET agent detail error:', err)
    return NextResponse.json({ error: err?.message || '取得 Agent 詳情失敗' }, { status: 500 })
  }
}

async function ownerOrAdmin(req: NextRequest, agentOwnerId: number): Promise<boolean> {
  const user = await getCurrentUserFromReq(req)
  if (!user) return false
  if (user.id === agentOwnerId) return true
  return isAdminUser(user)
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const agentId = Number(id)
  if (!Number.isInteger(agentId) || agentId <= 0) return NextResponse.json({ error: '無效的 agent id' }, { status: 400 })

  const agent = await getArenaAgentById(agentId)
  if (!agent) return NextResponse.json({ error: '找不到該 agent' }, { status: 404 })
  if (!(await ownerOrAdmin(req, agent.owner_user_id))) return NextResponse.json({ error: '無權限修改' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 30) : undefined
  const strategyId = body?.strategyId
  const tone = body?.tone

  if (name !== undefined && name.length < 1) return NextResponse.json({ error: '名稱不可為空' }, { status: 400 })
  if (strategyId !== undefined && !VALID_STRATEGIES.has(strategyId)) return NextResponse.json({ error: '無效的策略' }, { status: 400 })
  if (tone !== undefined && !VALID_TONES.has(tone)) return NextResponse.json({ error: '無效的風險偏好' }, { status: 400 })

  const personality = typeof body?.personality === 'string'
    ? (body.personality.trim() ? body.personality.trim().slice(0, 40) : null)
    : body?.personality === null ? null : undefined
  const strategyParams = body?.strategyParams !== undefined ? body.strategyParams : undefined

  const ok = await updateArenaAgentConfig(agentId, {
    name: name !== undefined ? name : undefined,
    strategyId,
    tone,
    personality,
    strategyParams,
  })
  if (!ok) return NextResponse.json({ error: '更新失敗' }, { status: 500 })
  return NextResponse.json({ message: '已更新' })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params
  const agentId = Number(id)
  if (!Number.isInteger(agentId) || agentId <= 0) return NextResponse.json({ error: '無效的 agent id' }, { status: 400 })

  const agent = await getArenaAgentById(agentId)
  if (!agent) return NextResponse.json({ error: '找不到該 agent' }, { status: 404 })
  if (agent.status !== 'active' && agent.status !== 'paused') {
    return NextResponse.json({ error: '該 agent 已不可刪除' }, { status: 409 })
  }
  if (!(await ownerOrAdmin(req, agent.owner_user_id))) return NextResponse.json({ error: '無權限刪除' }, { status: 403 })

  await resetArenaAgentLedger(agentId)
  await updateArenaAgentCash(agentId, agent.initial_capital)
  await setArenaAgentStatus(agentId, 'reset', '由使用者刪除')
  return NextResponse.json({ message: '已刪除' })
}