import { dbExecute, dbQueryAll, dbQueryFirst, migrate } from './db.js'
import {
  fetchMopsMeetings,
  fetchMopsAnnouncementText,
  classifyClaimRule,
  rocToMonthDay,
  type ClaimResult,
  type MopsMeeting,
} from './fetchers/mops.js'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function parseArgs(argv: string[]): { limit: number; missingOnly: boolean; delay: number } {
  let limit = 0
  let missingOnly = false
  let delay = 120
  for (const arg of argv) {
    if (arg.startsWith('--limit=')) limit = parseInt(arg.split('=')[1], 10) || 0
    if (arg === '--missing-only') missingOnly = true
    if (arg.startsWith('--delay=')) delay = parseInt(arg.split('=')[1], 10) || 120
  }
  return { limit, missingOnly, delay }
}

interface StockRow {
  stock_id: string
  stock_name: string
}

async function upsertClaim(
  stockId: string,
  stockName: string,
  meeting: MopsMeeting | undefined,
  result: ClaimResult,
): Promise<void> {
  // ETF / 債券 ETF / REITs / ETN 不會發放股東會紀念品，直接略過不寫入
  if (
    stockId.startsWith('00') ||
    stockId.startsWith('01') ||
    stockId.startsWith('02') ||
    stockName.toUpperCase().includes('ETF')
  ) {
    return
  }
  const now = new Date().toISOString()
  const mopsDate = meeting ? rocToMonthDay(meeting.date) : ''
  const params = {
    sid: stockId,
    rule: result.rule,
    txt: result.evidence || null,
    md: mopsDate || null,
    url: meeting?.detailUrl ?? null,
    now,
  }

  const existing = await dbQueryFirst<{ id: number }>(
    'SELECT id FROM shareholder_gifts WHERE stock_id = @sid ORDER BY meeting_date DESC LIMIT 1',
    { sid: stockId },
  )
  if (existing) {
    await dbExecute(
      `UPDATE shareholder_gifts
         SET claim_rule = @rule, claim_rule_source = 'MOPS', mops_gift_text = @txt,
             mops_meeting_date = @md, mops_source_url = @url, mops_updated_at = @now
       WHERE id = @id`,
      { ...params, id: existing.id },
    )
  } else {
    await dbExecute(
      `INSERT INTO shareholder_gifts
         (stock_id, stock_name, meeting_date, gift_name, claim_rule, claim_rule_source,
          mops_gift_text, mops_meeting_date, mops_source_url, mops_updated_at)
       VALUES (@sid, @sname, @md, '-', @rule, 'MOPS', @txt, @md, @url, @now)`,
      { ...params, sname: stockName },
    )
  }
}

async function main() {
  const { limit, missingOnly, delay } = parseArgs(process.argv.slice(2))
  await migrate()

  const all = await dbQueryAll<StockRow>(
    `SELECT DISTINCT stock_id, stock_name FROM odd_lot_trades
      WHERE date = (SELECT MAX(date) FROM odd_lot_trades)
        AND stock_id NOT LIKE '00%'
        AND stock_id NOT LIKE '01%'
        AND stock_id NOT LIKE '02%'
        AND (stock_name IS NULL OR stock_name NOT LIKE '%ETF%')
      ORDER BY stock_id`,
  )

  let list = all
  if (missingOnly) {
    const existing = new Set(
      (
        await dbQueryAll<{ stock_id: string }>(
          `SELECT stock_id FROM shareholder_gifts
            WHERE claim_rule_source = 'MOPS' AND claim_rule IS NOT NULL AND claim_rule != 'UNKNOWN'`,
        )
      ).map(r => r.stock_id),
    )
    list = all.filter(s => !existing.has(s.stock_id))
    console.log(`[sync:mops] missing-only: ${all.length} stocks → ${list.length} to process`)
  }
  if (limit > 0) list = list.slice(0, limit)

  const counts: Record<string, number> = {}
  let noMeeting = 0
  let errors = 0

  for (let i = 0; i < list.length; i++) {
    const s = list[i]
    try {
      const meetings = await fetchMopsMeetings(s.stock_id)
      if (meetings.length === 0) {
        noMeeting++
        continue
      }
      const sorted = [...meetings]
        .filter(m => m.detailUrl && m.detailUrl.startsWith('http'))
        .sort((a, b) => b.date.localeCompare(a.date))
      let result: ClaimResult = { rule: 'UNKNOWN', evidence: '' }
      let used: MopsMeeting | undefined
      for (const mt of sorted.slice(0, 4)) {
        try {
          const text = await fetchMopsAnnouncementText(mt.detailUrl)
          const r = classifyClaimRule(text)
          if (r.rule !== 'UNKNOWN') {
            result = r
            used = mt
            break
          }
          if (!result.evidence && r.evidence) result = r
        } catch (e) {
          /* try next announcement */
        }
      }
      await upsertClaim(s.stock_id, s.stock_name, used, result)
      counts[result.rule] = (counts[result.rule] || 0) + 1
    } catch (e) {
      errors++
      if (errors <= 5) {
        console.warn(`[sync:mops] failed ${s.stock_id}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    if ((i + 1) % 25 === 0 || i + 1 === list.length) {
      console.log(`[sync:mops] progress ${i + 1}/${list.length}  ${JSON.stringify(counts)}  noMeeting=${noMeeting} errors=${errors}`)
    }
    await sleep(delay)
  }

  console.log(`[sync:mops] done. summary=${JSON.stringify(counts)} noMeeting=${noMeeting} errors=${errors}`)
  process.exit(0)
}

main().catch(e => {
  console.error('[sync:mops] fatal:', e)
  process.exit(1)
})
