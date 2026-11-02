import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getCurrentUserFromReq } from '@/lib/auth'
import {
  getActiveArenaAgentByOwner,
  getArenaHoldings,
  getArenaSnapshots,
  getArenaTrades,
  getArenaDecisionLogs,
  getArenaDividendCredits,
} from '@stock/database'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getCurrentUserFromReq(req)
  if (!user) return NextResponse.json({ error: '請先登入' }, { status: 401 })

  const agent = await getActiveArenaAgentByOwner(user.id)
  if (!agent) return NextResponse.json({ agent: null }, { headers: { 'Cache-Control': 'no-store' } })

  const [holdings, snapshots, trades, decisionLogs, dividendCredits] = await Promise.all([
    getArenaHoldings(agent.id),
    getArenaSnapshots(agent.id),
    getArenaTrades(agent.id, 50),
    getArenaDecisionLogs(agent.id),
    getArenaDividendCredits(agent.id).catch((err) => {
      console.error('[Arena API my] getArenaDividendCredits failed:', err)
      return []
    }),
  ])

  const totalDividends = dividendCredits.reduce((sum, c) => sum + (Number(c.amount) || 0), 0)

  return NextResponse.json(
    { agent, holdings, snapshots, trades, decisionLogs, dividendCredits, totalDividends },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}