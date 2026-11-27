import { NextResponse, type NextRequest } from 'next/server'
import { withApiAudit } from '@/lib/api-audit'
import { runHealthChecks } from '@/lib/health'

export async function GET(req: NextRequest) {
  return withApiAudit(req, 'health', async () => {
    try {
      const report = await runHealthChecks()
      return NextResponse.json(report, { status: report.ok ? 200 : 500 })
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e.message, issues: [] }, { status: 500 })
    }
  })
}