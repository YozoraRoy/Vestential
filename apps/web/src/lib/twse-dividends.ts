/**
 * Issue #35：TWSE TWT48U（除權除息預告表）每日 CSV 抓取＋解析。
 * Issue #90／#95：TWT49U 月表歷史回填（#95 年起現金股利解析精確化＋官方
 *   `t187ap45_L` 覆寫權息精確值，見檔內 TWT49U 段註解）。
 * Issue #101：TWT49U 息列另存「除權息前收盤價」為 `prev_close`（除息日昨收），
 *   供逐年已實現殖利率（÷該年最後一次除息日昨收）；歷史回填走 repair 端點重跑
 *   （既有 covered 月照抓，不動 `covered_months` 機制）。
 *
 * 沿用 arena MI_INDEX 抓取模式（`packages/ai-engine/src/arena/universe.ts`）：
 * big5 解碼（失敗退 utf-8）＋容錯解析（欄位名動態定位、非法列略過）＋
 * 失敗不擋主流程（呼叫端 best-effort，見 `ensureTodayDividends`）＋
 * 限流/失敗告警沿用 #24 `reportServerError`（30 分鐘同 key 去重）。
 *
 * TWT48U 實測格式（2026-08 起）：
 * - 首行 `"除權除息預告表"`；表頭含 `除權除息日期,股票代號,名稱,除權息,...,現金股利,...`
 * - 日期為民國年 `115年10月08日`；代號帶 Excel 前綴 `="00400A"`；
 * - `現金股利` 可能是數字或 `待公告實際收益分配金額`（後者略過不寫快取）。
 */

import type { TwseDividendInput } from '@stock/database'

const TWT48U_URL = 'https://www.twse.com.tw/exchangeReport/TWT48U'

/** TWT48U 單檔抓取超時（TWSE 偶發慢回；逾時視為失敗，走降級＋告警，不擋主流程）。 */
export const TWT48U_FETCH_TIMEOUT_MS = 20000

export interface Twt48uParseResult {
  rows: TwseDividendInput[]
  /** 略過列數（待公告／格式不符；供 log 觀察，不進 UI）。 */
  skipped: number
}

/** 民國年日期 `115年10月08日` → `2026-10-08`；格式不符回 null（該列略過）。 */
export function parseRocDateToIso(raw: string): string | null {
  const m = (raw ?? '').trim().match(/^(\d{2,3})年(\d{1,2})月(\d{1,2})日$/)
  if (!m) return null
  const y = 1911 + Number(m[1])
  const mo = String(Number(m[2])).padStart(2, '0')
  const d = String(Number(m[3])).padStart(2, '0')
  const iso = `${y}-${mo}-${d}`
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  const t = new Date(`${iso}T12:00:00+08:00`)
  return Number.isNaN(t.getTime()) ? null : iso
}

/** 代號清洗：`="00400A"` → `00400A`；去除空白引號，轉大寫。 */
export function cleanTwseCode(raw: string): string {
  return (raw ?? '')
    .trim()
    .replace(/^="?(.*?)"?$/, '$1')
    .replace(/^"+|"+$/g, '')
    .trim()
    .toUpperCase()
}

function parseCashDividend(raw: string): number | null {
  const t = (raw ?? '').trim().replace(/,/g, '')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** 簡易 CSV 行切分（TWT48U 欄位皆以雙引號包覆；內嵌逗號不切）。 */
function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      if (inQuote && line[i + 1] === '"') {
        cur += '"'
        i++
      } else {
        inQuote = !inQuote
      }
    } else if (c === ',' && !inQuote) {
      out.push(cur)
      cur = ''
    } else {
      cur += c
    }
  }
  out.push(cur)
  return out.map((f) => f.trim())
}

/**
 * 容錯解析 TWT48U CSV 全文：
 * - 表頭以欄位名動態定位（`股票代號`／`除權除息日期`／`現金股利`），欄順異動不炸；
 * - 找不到表頭 → 回空陣列（呼叫端視為無檔，不 throw）；
 * - 資料列任一欄非法（代號空／日期非法／現金非正數）→ 單列略過計 skipped。
 *
 * 註（#101）：TWT48U 為「預告表」（多為未來事件），**無**除權息前收盤價欄位，
 * 故此處不帶 `prev_close`（維持 null）；前收由 TWT49U 月表（除息後）補上。
 */
export function parseTwt48uCsv(text: string): Twt48uParseResult {
  const rows: TwseDividendInput[] = []
  let skipped = 0
  const lines = (text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  let idxCode = -1
  let idxDate = -1
  let idxCash = -1
  let headerFound = false
  for (const line of lines) {
    const fields = splitCsvLine(line)
    if (!headerFound) {
      const iCode = fields.findIndex((f) => f.includes('股票代號'))
      const iDate = fields.findIndex((f) => f.includes('除權除息日期'))
      const iCash = fields.findIndex((f) => f.includes('現金股利'))
      if (iCode >= 0 && iDate >= 0 && iCash >= 0) {
        idxCode = iCode
        idxDate = iDate
        idxCash = iCash
        headerFound = true
      }
      continue
    }
    const symbol = cleanTwseCode(fields[idxCode] ?? '')
    const exDate = parseRocDateToIso(fields[idxDate] ?? '')
    const cash = parseCashDividend(fields[idxCash] ?? '')
    if (!symbol || !exDate || cash == null) {
      skipped++
      continue
    }
    rows.push({ symbol, ex_date: exDate, cash_dividend: cash })
  }
  return { rows, skipped }
}

/** 抓 TWT48U 單日 CSV 全文（big5 優先，失敗退 utf-8；逾時/HTTP 錯誤直接 throw）。 */
export async function fetchTwt48uText(dateCompact: string): Promise<string> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TWT48U_FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(`${TWT48U_URL}?response=csv&date=${dateCompact}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        Referer: 'https://www.twse.com.tw/',
      },
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`TWSE TWT48U error: ${res.status} (${dateCompact})`)
    const buf = Buffer.from(await res.arrayBuffer())
    try {
      return new TextDecoder('big5', { fatal: true }).decode(buf)
    } catch {
      return new TextDecoder('utf-8').decode(buf)
    }
  } finally {
    clearTimeout(timer)
  }
}

/** 抓＋解析 TWT48U 單日（`YYYY-MM-DD`）；解析層永不 throw（無表頭即回空陣列）。 */
export async function fetchTwt48uDay(dateStr: string): Promise<Twt48uParseResult> {
  const text = await fetchTwt48uText(dateStr.replace(/-/g, ''))
  return parseTwt48uCsv(text)
}

// ─── TWT49U 除權除息計算結果表（Issue #90：真歷史區間查詢；#95 解析精確化）──
// 背景：TWT48U `?date=` 無視日期、永遠只回當期預告 → 以它做歷史回填會無限空轉
// （同批反覆重抓、cursor 凍結）。歷史改走 TWT49U `startDate/endDate` 區間。
//
// #95 解析口徑（精確化，取代舊「前收 − 減除股利參考價」一律推導）：
// - `權/息 == 息`（純除息）→ 現金股利＝`權值+息值`（第 6 欄；TWT49U 截斷至 6 位小數）；
// - `權`／`權息` → **不再以價差推導**（價差含無償配股價值，會產生假殖利率，
//   如 1773 勝一 2025-06-13 被推成 27.25）；改走官方 `t187ap45_L` 精確值，
//   查不到就不寫入（UI 顯示 —），並刪除既有推導列（見 planTwt49uMonth）。
// 月粒度：由新往舊；覆蓋判定改用 `agent_settings` 明確月集合（#95；見
//   TWSE_DIVIDENDS_COVERED_MONTHS_KEY）；每輪上限 6 個月；單月失敗不擋整輪；
//   TWT48U 每日累積（往未來）照舊。
const TWT49U_URL = 'https://www.twse.com.tw/exchangeReport/TWT49U'

/** TWT49U 單月抓取超時（月資料約數百列；逾時 throw 由呼叫端逐月 best-effort）。 */
export const TWT49U_FETCH_TIMEOUT_MS = 20000

export interface Twt49uParseResult {
  /** 精確列（純除息：現金股利＝`權值+息值`）。 */
  rows: TwseDividendInput[]
  /** 權／權息列：無精確現金股利，待官方表覆寫或刪列（#95）。 */
  unresolved: Twt49uUnresolvedRow[]
  /** 略過列數（日期/代號非法／息列無有效現金）；供 log 觀察。 */
  skipped: number
}

/**
 * TWT49U 權／權息列（#95）：現金股利無法從此表得知（`權值+息值` 含配股價值）。
 * `derivedValue` 僅為「舊推導列」的比對值（＝前收 − 減除股利參考價，或退用
 * `權值+息值`），供刪除時確認該列確實是推導產物，**不是**現金股利。
 */
export interface Twt49uUnresolvedRow {
  symbol: string
  ex_date: string
  /** `權/息` 欄原值（`權`／`權息`／其他）。 */
  kind: string
  derivedValue: number | null
}

function parseNumLoose(raw: unknown): number | null {
  const t = String(raw ?? '').replace(/,/g, '').trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}

/**
 * 解析 TWT49U JSON data 列：
 * [資料日期ROC, 代號, 名稱, 除權息前收盤價, 參考價, 權值+息值, 權/息, 漲停, 跌停,
 *  開盤競價基準, 減除股利參考價, ...]。純函式，可單測。
 *
 * #95：`息` 列取 `權值+息值`（第 6 欄）為現金股利；`權`／`權息` 列不推導，
 * 收進 `unresolved` 交由官方 `t187ap45_L` 覆寫（見 matchOfficialDividend）。
 * #101：`息` 列另帶第 4 欄「除權息前收盤價」為 `prev_close`（除息日昨收，供逐年
 * 已實現殖利率）；`權`／`權息` unresolved 列維持不帶（現金股利尚不可信，前收亦無意義）。
 */
export function parseTwt49uRows(data: unknown[][]): Twt49uParseResult {
  const rows: TwseDividendInput[] = []
  const unresolved: Twt49uUnresolvedRow[] = []
  let skipped = 0
  for (const cols of data ?? []) {
    const arr = cols as unknown[]
    const exDate = parseRocDateToIso(String(arr?.[0] ?? ''))
    const symbol = cleanTwseCode(String(arr?.[1] ?? ''))
    if (!symbol || !exDate) {
      skipped++
      continue
    }
    const total = parseNumLoose(arr?.[5])
    const kind = String(arr?.[6] ?? '').trim()
    const prevClose = parseNumLoose(arr?.[3])
    const deductRef = parseNumLoose(arr?.[10])
    const derivedRaw =
      prevClose != null && deductRef != null
        ? round4(prevClose - deductRef)
        : total != null
          ? round4(total)
          : null
    if (kind === '息') {
      if (total == null || total <= 0) {
        skipped++
        continue
      }
      rows.push({
        symbol,
        ex_date: exDate,
        cash_dividend: total,
        // #101：前收 ≤0（官方表以 0 表示無值）視為無值。
        prev_close: prevClose != null && prevClose > 0 ? prevClose : null,
      })
      continue
    }
    // 權 / 權息 / 其他：不以價差推導（配股價值會污染現金股利）。
    unresolved.push({ symbol, ex_date: exDate, kind: kind || 'unknown', derivedValue: derivedRaw })
  }
  return { rows, unresolved, skipped }
}

/** 抓 TWT49U 單月（YYYY-MM）；stat 非 OK 即 throw（呼叫端逐月 best-effort）。 */
export async function fetchTwt49uMonth(month: string): Promise<Twt49uParseResult> {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`invalid month: ${month}`)
  const y = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  const lastDay = new Date(y, m, 0).getDate()
  const mm = String(m).padStart(2, '0')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TWT49U_FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(
      `${TWT49U_URL}?response=json&startDate=${y}${mm}01&endDate=${y}${mm}${String(lastDay).padStart(2, '0')}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          Referer: 'https://www.twse.com.tw/',
        },
        signal: ctrl.signal,
      },
    )
    if (!res.ok) throw new Error(`TWSE TWT49U error: ${res.status} (${month})`)
    const body: any = await res.json()
    if (body?.stat !== 'OK') throw new Error(`TWSE TWT49U stat!=OK (${month}): ${String(body?.stat ?? '').slice(0, 80)}`)
    return parseTwt49uRows(Array.isArray(body?.data) ? body.data : [])
  } finally {
    clearTimeout(timer)
  }
}

// ─── 官方股利分派表 t187ap45_L（Issue #95）──────────────────────────
// TWSE OpenAPI「上市公司股利分派情形」（UTF-8 JSON，實測 1229 列／1 家公司多列）。
// 用途：權／權息股的**精確現金股利**（TWT49U 的 `權值+息值` 對權息列含配股價值，
// 價差推導會產生假殖利率）。限制：只有「最新一次出表」的年度（實測僅 114／115
// 年度、董事會日集中於 2026），故 2022～2024 的權息股查不到 → 依決策「跳過該列／
// 刪除推導值，寧缺勿錯」（UI 顯示 —）。ETF 收益分配不在本表（0056／00919 等）。
export const T187AP45_L_URL = 'https://openapi.twse.com.tw/v1/opendata/t187ap45_L'
/**
 * 官方表抓取逾時（#95 P4 修正：20s → 120s）。
 *
 * 量測依據（2.47 MB JSON，undici 同款）：
 * - 本機：undici 自動 gzip（`content-encoding: gzip`）→ 傳輸 471 KB、6.4 秒；
 *   無壓縮對照 2.47 MB → 42～60 秒（TWSE 端為慢速串流，`starttransfer` 即 ~1 秒級）。
 * - 生產（Azure App Service `stock-platform-roy`，region **Canada Central**，跨區）：
 *   20 秒**每次都**被 AbortController 中止（`official_error: "This operation was aborted"`），
 *   兩次實測一致 → 20s 對跨區抓取不足（#95 P4 前置）。
 *
 * 上限理由：sync workflow（`sync-portfolio-prices.yml`）`--max-time 240`；
 * repair route 同一請求內還要逐月抓 TWT49U（6 個月約 10～20 秒），
 * 故 120s 為安全上限（最壞 120s + 20s ≪ 240s，亦遠低於 route `maxDuration=300`）。
 * 失敗仍走既有 best-effort 降級（僅套息列），不擋主流程。
 */
export const T187AP45_FETCH_TIMEOUT_MS = 120000
/** 官方值與 TWT49U 值視為同一筆的容差（元/股）。TWT49U 值截斷至 6 位小數且
 *  可能與「宣告值」有換算差（實測 3416 融程電 2026-06-30：TWT49U 5.095945 vs
 *  官方 5.1），故取 0.005（半分錢）：誤差上限 ≤ 0.01，既對齊官方值又不致配錯事件。 */
export const OFFICIAL_VALUE_TOLERANCE = 0.005
/** 權息列 fallback（董事會日 ≤ ex_date 且最接近）允許的最大間隔天數（寧缺勿錯）。 */
export const OFFICIAL_FALLBACK_MAX_GAP_DAYS = 180

export interface OfficialDividendRow {
  symbol: string
  /** 董事會（擬議）股利分派日 'YYYY-MM-DD'；缺／非法為 null。 */
  boardDate: string | null
  /** 現金股利合計（元/股）＝盈餘分配＋法定盈餘公積＋資本公積。 */
  cash: number
  /** 股利年度（民國年原值，僅觀測用）。 */
  dividendYear: string
}

/** 取欄位值：優先同名 key，其次「key 含 needle」（OpenAPI 欄名可能調整）。 */
function pickField(row: Record<string, unknown>, needle: string): string {
  if (needle in row) return String(row[needle] ?? '')
  for (const [k, v] of Object.entries(row)) {
    if (k.includes(needle)) return String(v ?? '')
  }
  return ''
}

/** 民國 compact 日期 `1150311` → `2026-03-11`；非法回 null。 */
export function parseRocCompactToIso(raw: string): string | null {
  const t = (raw ?? '').trim().replace(/[-\/]/g, '')
  if (!/^\d{7}$/.test(t)) return null
  const y = 1911 + Number(t.slice(0, 3))
  const mo = Number(t.slice(3, 5))
  const d = Number(t.slice(5, 7))
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * 解析 t187ap45_L JSON（陣列或 `{data:[...]}`）。純函式，可單測。
 * 現金股利合計＝「股東配發-盈餘分配之現金股利(元/股)」
 * ＋「法定盈餘公積發放之現金(元/股)」＋「資本公積發放之現金(元/股)」。
 */
export function parseT187ap45Rows(input: unknown): OfficialDividendRow[] {
  const raw = input as { data?: unknown } | unknown[] | null
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { data?: unknown })?.data)
      ? ((raw as { data: unknown[] }).data)
      : []
  const out: OfficialDividendRow[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const symbol = cleanTwseCode(pickField(row, '公司代號'))
    if (!symbol) continue
    const parts = ['盈餘分配之現金股利', '法定盈餘公積發放之現金', '資本公積發放之現金(元/股)'].map(
      (k) => parseNumLoose(pickField(row, k)) ?? 0,
    )
    const cash = Math.round(parts.reduce((a, b) => a + b, 0) * 1e8) / 1e8
    out.push({
      symbol,
      boardDate: parseRocCompactToIso(pickField(row, '股利分派日')),
      cash,
      dividendYear: pickField(row, '股利年度'),
    })
  }
  return out
}

/** 抓官方股利分派表（逾時／HTTP 錯誤／JSON 例外直接 throw，由呼叫端 best-effort 降級）。 */
export async function fetchT187ap45Table(): Promise<OfficialDividendRow[]> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), T187AP45_FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(T187AP45_L_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', Accept: 'application/json' },
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`TWSE t187ap45_L error: ${res.status}`)
    return parseT187ap45Rows(await res.json())
  } finally {
    clearTimeout(timer)
  }
}

function dayGap(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T12:00:00+08:00`)
  const b = Date.parse(`${toIso}T12:00:00+08:00`)
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.POSITIVE_INFINITY
  return Math.round((b - a) / 86400000)
}

/**
 * 由官方表挑出某 (symbol, ex_date) 的精確現金股利（元/股）；對不到回 null。
 *
 * 規則（#95）：
 * 1. 候選＝同代號、`董事會（擬議）股利分派日 ≤ ex_date`、現金 > 0 的列；
 * 2. `twtValue` 有值（息列）→ 取「值最接近」且誤差 ≤ OFFICIAL_VALUE_TOLERANCE 者
 *    （純精度校正；實測 2330 06-11 的 6.000035 對到官方 114Q4 的 6.00003573，
 *    而 09-16 的 7.000001 對到官方 115Q1 的 7.00000137；3416 06-30 的
 *    5.095945 對到官方 5.1）；
 * 3. 權息列（無可信現金值）→ 取董事會日最接近者，但間隔須 ≤ 180 天（啟發式；
 *    官方表只有最新出表年度，2022～2024 一律對不到 → 不覆寫）；
 * 4. 純 `權` 列 → 恆回 null（除權＝無現金股利；官方表的現金屬同代號的另一個
 *    除息事件，套用會憑空生出假股利）。
 */
export function matchOfficialDividend(
  official: OfficialDividendRow[] | null | undefined,
  symbol: string,
  exDate: string,
  twtValue: number | null,
  kind: string = '息',
): number | null {
  const sym = cleanTwseCode(symbol)
  if (!sym || !/^\d{4}-\d{2}-\d{2}$/.test(exDate)) return null
  const rows = (official ?? []).filter(
    (r) => r.symbol === sym && r.boardDate != null && r.boardDate <= exDate && r.cash > 0,
  )
  if (rows.length === 0) return null
  if (twtValue != null && Number.isFinite(twtValue)) {
    let best: OfficialDividendRow | null = null
    let bestDiff = Number.POSITIVE_INFINITY
    for (const r of rows) {
      const diff = Math.abs(r.cash - twtValue)
      if (diff < bestDiff - 1e-12) {
        best = r
        bestDiff = diff
      }
    }
    return best && bestDiff <= OFFICIAL_VALUE_TOLERANCE ? best.cash : null
  }
  if (kind === '權') return null
  const cands = rows.filter((r) => dayGap(r.boardDate!, exDate) <= OFFICIAL_FALLBACK_MAX_GAP_DAYS)
  if (cands.length === 0) return null
  return cands.reduce((a, b) => (b.boardDate! > a.boardDate! ? b : a)).cash
}

// ─── 單月計畫（抓取→解析→官方覆寫→刪推導列；#95）──────────────────
export interface DividendsMonthPlan {
  month: string
  /** 精確列（息列＋官方覆寫／官方補值）；可直接 upsert。 */
  upserts: TwseDividendInput[]
  /** 官方表覆寫／補值筆數（觀測）。 */
  officialOverrides: number
  /** 權／權息且查不到官方精確值（不寫入；UI 顯示 —）。 */
  unresolved: Twt49uUnresolvedRow[]
  /** 待刪除的舊推導列（值比對後才刪，見 deleteTwseDividendIfMatches）。 */
  deleteCandidates: Array<{ symbol: string; ex_date: string; derivedValue: number }>
  /** 解析略過列數。 */
  skipped: number
}

/**
 * 抓 TWT49U 單月並產生寫入／刪除計畫（不寫 DB；`official` 為 null 時僅做息列）。
 * 抓取失敗直接 throw（呼叫端逐月 best-effort）。
 *
 * #101：息列（含官方值覆寫者，見下方 spread）保留 `prev_close`；權／權息列改由官方表
 * 補值時不帶前收（該列現金股利來源非 TWT49U 息值，前收無對應語意）→ DB 存 null。
 */
export async function planTwt49uMonth(
  month: string,
  official: OfficialDividendRow[] | null,
): Promise<DividendsMonthPlan> {
  const { rows, unresolved, skipped } = await fetchTwt49uMonth(month)
  const upserts: TwseDividendInput[] = []
  let officialOverrides = 0
  for (const r of rows) {
    const officialCash = matchOfficialDividend(official, r.symbol, r.ex_date, r.cash_dividend, '息')
    if (officialCash != null && Math.abs(officialCash - r.cash_dividend) > 1e-9) {
      upserts.push({ ...r, cash_dividend: officialCash })
      officialOverrides++
      continue
    }
    upserts.push(r)
  }
  const deleteCandidates: DividendsMonthPlan['deleteCandidates'] = []
  for (const u of unresolved) {
    const officialCash = matchOfficialDividend(official, u.symbol, u.ex_date, null, u.kind)
    if (officialCash != null) {
      upserts.push({ symbol: u.symbol, ex_date: u.ex_date, cash_dividend: officialCash })
      officialOverrides++
      continue
    }
    if (u.derivedValue != null && u.derivedValue > 0) {
      deleteCandidates.push({ symbol: u.symbol, ex_date: u.ex_date, derivedValue: u.derivedValue })
    }
  }
  return { month, upserts, officialOverrides, unresolved, deleteCandidates, skipped }
}

export interface DividendsWriteResult {
  /** 實際 upsert 筆數（dry-run 或 upsert 失敗為 0）。 */
  written: number
  /** 實際刪除筆數。 */
  deleted: number
  /** 是否確實完成寫入（dry-run 或 upsert 拋錯 → false）。呼叫端**只可**在 ok=true 時標記覆蓋。 */
  ok: boolean
  /** ok=false 或刪除部分失敗的原因（觀測；正常時 null）。 */
  reason: string | null
}

/**
 * 執行單月計畫：upsert 先於 delete，確保官方值不被誤刪。
 *
 * #95 P2 修正：**`opts` 改為必填、移除 dry-run 預設值**。舊簽名
 * `applyDividendsMonthPlan(plan, opts?)` 的 `opts?.dryRun !== false` 讓漏傳 opts 的呼叫端
 * 靜默變成 no-op（不寫入卻仍被標記覆蓋 → 永久資料空洞，實測 repair `written:0`）。
 * 漏傳 opts 現在直接 TypeError（不碰 DB），下一輪就炸出來而不會靜默漏寫；
 * 回傳 `ok` 供呼叫端判斷「是否真的寫入」。
 */
export async function writeDividendsMonthPlan(
  plan: DividendsMonthPlan,
  opts: { dryRun: boolean },
): Promise<DividendsWriteResult> {
  if (opts.dryRun) return { written: 0, deleted: 0, ok: false, reason: 'dry-run' }
  const { upsertTwseDividends, deleteTwseDividendIfMatches } = await import('@stock/database')
  let written = 0
  try {
    written = await upsertTwseDividends(plan.upserts)
  } catch (e) {
    console.error('[TwseDividends] month plan upsert failed (non-blocking):', e)
    // upsert 失敗時不做刪除：刪掉舊推導列卻沒補上精確值＝資料淨損（下輪重試整月）。
    return { written: 0, deleted: 0, ok: false, reason: e instanceof Error ? e.message : 'upsert failed' }
  }
  let deleted = 0
  let deleteError: string | null = null
  for (const d of plan.deleteCandidates) {
    try {
      deleted += await deleteTwseDividendIfMatches(d.symbol, d.ex_date, d.derivedValue)
    } catch (e) {
      deleteError = e instanceof Error ? e.message : 'delete failed'
      console.error('[TwseDividends] month plan delete failed (non-blocking):', e)
    }
  }
  return { written, deleted, ok: true, reason: deleteError ? `partial-delete-fail: ${deleteError}` : null }
}

// ─── #44：5 年殖利率回填（lazy＋封頂；Issue #90 改月粒度 TWT49U）───────
// 背景：twse_dividends 由每日 ensureTodayDividends 逐日累積，當年齊全；
// 過去年份冷啟動時整年缺檔，5 年平均需回填歷史。
//
// 窗（#95）：5 年平均＝去年為止 5 個完整年度 → 回填窗由 5 年延長為 6 年
// （`YIELD_BACKFILL_YEARS＝6`，涵蓋 `(Y-5)-01` 起），否則最舊一年無資料。
// 上限值（實作註明）：YIELD_BACKFILL_MAX_MONTHS_PER_RUN＝6（TWT49U 單月回全市場
// 數百列；每月約數百筆寫入，配額遠低於舊逐日 30 天）。
// 覆蓋判定（#95 修正）：**不再**以「該月 DB 有任一筆」視為已覆蓋（日快取 2026-09-25
// 才上線，2026-09 只有 9 筆卻被判定覆蓋 → 缺口永不補）；改記於 `agent_settings`
// 明確月集合（TWSE_DIVIDENDS_COVERED_MONTHS_KEY），只有「TWT49U 整月抓取成功**且確實寫入**」
// 才標記（#95 P2：舊版呼叫 applyDividendsMonthPlan 漏傳 opts → 靜默 no-op 卻標記覆蓋
// ＝永久資料空洞），無限空轉仍不可能。
// 呼叫時機：同步鈕＋排程順帶（沿用既有 ensureTodayDividends 位置），
// best-effort 永不 throw；/dividends 讀取端唯讀不觸發。
export const YIELD_BACKFILL_YEARS = 6
export const YIELD_BACKFILL_MAX_MONTHS_PER_RUN = 6

/** 已成功回填月集合的 agent_settings key（值為 'YYYY-MM' JSON 陣列）。 */
export const TWSE_DIVIDENDS_COVERED_MONTHS_KEY = 'twse_dividends.covered_months'
/** 集合保留上限（月；10 年＝120，防無限成長）。 */
const COVERED_MONTHS_MAX = 120

export function parseCoveredMonths(raw: string | null | undefined): string[] {
  try {
    const arr = JSON.parse(raw ?? '[]')
    if (!Array.isArray(arr)) return []
    return arr.filter((m): m is string => typeof m === 'string' && /^\d{4}-\d{2}$/.test(m))
  } catch {
    return []
  }
}

/** 讀取已回填月集合（讀不到視為空集合＝全部重抓，寧多抓不漏抓）。 */
export async function getCoveredMonths(): Promise<Set<string>> {
  try {
    const { getAgentSetting } = await import('@stock/database')
    return new Set(parseCoveredMonths(await getAgentSetting(TWSE_DIVIDENDS_COVERED_MONTHS_KEY)))
  } catch {
    return new Set()
  }
}

/**
 * 標記月份已回填成功（聯集寫回，保留最近 COVERED_MONTHS_MAX 個月）。
 * 回傳**實際寫入成功**的月清單（無效輸入或寫入失敗回 `[]`）——呼叫端不得自行
 * 假設「傳進去的都標成功了」（#95 P2：repair 曾用 `covered.size + applied.length` 謊報）。
 */
export async function markMonthsCovered(months: string[]): Promise<string[]> {
  const add = months.filter((m) => /^\d{4}-\d{2}$/.test(m))
  if (add.length === 0) return []
  try {
    const { getAgentSetting, setAgentSetting } = await import('@stock/database')
    const current = parseCoveredMonths(await getAgentSetting(TWSE_DIVIDENDS_COVERED_MONTHS_KEY))
    const merged = [...new Set([...current, ...add])].sort().slice(-COVERED_MONTHS_MAX)
    await setAgentSetting({
      key: TWSE_DIVIDENDS_COVERED_MONTHS_KEY,
      value: JSON.stringify(merged),
      category: 'sync',
      label: 'TWT49U 已成功回填月（YYYY-MM JSON 陣列；#95 起為覆蓋判定依據）',
    })
    return add
  } catch (e) {
    console.error('[TwseDividends] markMonthsCovered failed (non-blocking):', e)
    return []
  }
}

export type YieldBackfillStatus = 'done' | 'advanced' | 'failed'

export interface YieldBackfillYear {
  year: string
  rows: number
  missing: boolean
}

export interface YieldBackfillResult {
  status: YieldBackfillStatus
  years: YieldBackfillYear[]
  /** 本輪實際抓取月數（≤ 上限 6；沿用欄位名，語意為月）。 */
  fetchedDays: number
  /** 本輪寫入筆數。 */
  written: number
  /** 本輪刪除的舊推導列筆數（#95：權／權息失真值不留）。 */
  deleted: number
  /** 本輪以官方 `t187ap45_L` 覆寫／補值筆數（#95）。 */
  officialOverrides: number
  /** 觀測用 cursor（下輪最舊已抓月／'done'；真進度以 covered months 集合為準）。 */
  cursor: string | null
  /** 失敗／空檔說明；正常時為 null。 */
  reason: string | null
}

/** 回填月份窗（當年往前推滿 6 年之 1 月起，到當月；由新往舊）。 */
export function backfillMonthWindow(today: string, windowYears: number = YIELD_BACKFILL_YEARS): string[] {
  const y = Number(today.slice(0, 4))
  const m = Number(today.slice(5, 7))
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return []
  const out: string[] = []
  let cy = y
  let cm = m
  const stop = `${y - windowYears + 1}-01`
  while (`${cy}-${String(cm).padStart(2, '0')}` >= stop) {
    out.push(`${cy}-${String(cm).padStart(2, '0')}`)
    cm--
    if (cm < 1) {
      cm = 12
      cy--
    }
  }
  return out
}

/**
 * 回填依賴注入（#95 P2：讓「無寫入不得標記覆蓋」可被單測斷言）。
 * 未提供者用真實實作（DB／TWSE）。
 */
export interface YieldBackfillDeps {
  /** 該年 DB 筆數（唯讀觀測）。 */
  yearRows?: (year: string) => Promise<number>
  /** 已成功回填月集合（覆蓋判定依據）。 */
  coveredMonths?: () => Promise<Set<string>>
  /** 單月計畫（抓取＋官方比對；不寫 DB）。 */
  planMonth?: (month: string) => Promise<DividendsMonthPlan>
  /** 執行計畫（**必須傳 dryRun:false** 才會真的寫入）。 */
  writeMonth?: (plan: DividendsMonthPlan) => Promise<DividendsWriteResult>
  markCovered?: (months: string[]) => Promise<unknown>
}

export async function ensureYieldHistoryBackfill(
  today: string,
  opts?: { maxMonths?: number; official?: OfficialDividendRow[] | null; deps?: YieldBackfillDeps },
): Promise<YieldBackfillResult> {
  const maxMonths = opts?.maxMonths ?? YIELD_BACKFILL_MAX_MONTHS_PER_RUN
  const empty: YieldBackfillResult = {
    status: 'failed', years: [], fetchedDays: 0, written: 0, deleted: 0, officialOverrides: 0,
    cursor: null, reason: null,
  }
  const deps = opts?.deps ?? {}
  const yearRows =
    deps.yearRows ??
    (async (year: string) => {
      const { getTwseDividendsByYear } = await import('@stock/database')
      return (await getTwseDividendsByYear(year)).length
    })
  const loadCovered = deps.coveredMonths ?? getCoveredMonths
  // #95 P2：回填一律走非 dry-run（舊版漏傳 opts 讓每日回填變 no-op 卻標記覆蓋）。
  const writeMonth = deps.writeMonth ?? ((plan: DividendsMonthPlan) => writeDividendsMonthPlan(plan, { dryRun: false }))
  const markCovered = deps.markCovered ?? markMonthsCovered
  try {
    const months = backfillMonthWindow(today)
    if (months.length === 0) return { ...empty, reason: 'invalid-today' }

    // 分年筆數（coverage 觀測；缺年＝整年 0 筆）。
    const years: YieldBackfillYear[] = []
    const seenYears = [...new Set(months.map((mo) => mo.slice(0, 4)))]
    for (const year of seenYears) {
      let rows = 0
      try {
        rows = await yearRows(year)
      } catch {
        rows = 0
      }
      years.push({ year, rows, missing: rows === 0 })
    }

    // 覆蓋判定（#95）：只認「TWT49U 整月抓取成功並套用」的明確月集合。
    // （舊法「該月有任一筆即覆蓋」會讓部分月永遠不被補滿，如 2026-09 只有 9 筆。）
    const covered = await loadCovered()
    const pending = months.filter((mo) => !covered.has(mo))
    if (pending.length === 0) {
      return { status: 'done', years, fetchedDays: 0, written: 0, deleted: 0, officialOverrides: 0, cursor: 'done', reason: null }
    }

    // 官方股利分派表（權息精確值）本輪抓一次；失敗降級＝僅套息列（best-effort）。
    const official =
      opts?.official !== undefined ? opts.official : await fetchT187ap45Table().catch(() => null)
    const planMonth = deps.planMonth ?? ((mo: string) => planTwt49uMonth(mo, official))

    // 每輪封頂：只抓最新 maxMonths 個月；單月失敗不中斷（下輪重試該月）。
    const batch = pending.slice(0, Math.max(1, maxMonths))
    let written = 0
    let deleted = 0
    let officialOverrides = 0
    let okMonths = 0
    let lastError: string | null = null
    for (const mo of batch) {
      let plan: DividendsMonthPlan
      let applied: DividendsWriteResult
      try {
        plan = await planMonth(mo)
        applied = await writeMonth(plan)
      } catch (e: unknown) {
        lastError = e instanceof Error ? e.message : 'TWT49U month fetch failed'
        continue
      }
      officialOverrides += plan.officialOverrides
      // #95 P2：只有確實寫入成功（ok=true，即非 dry-run 且 upsert 未拋錯）才標記覆蓋。
      // 無寫入仍標記 → 整個回填窗被標成「已覆蓋」卻無資料＝永久資料空洞。
      if (!applied.ok) {
        lastError = `not-written: ${applied.reason ?? mo}`
        continue
      }
      okMonths++
      written += applied.written
      deleted += applied.deleted
      try {
        await markCovered([mo])
      } catch (e: unknown) {
        lastError = `mark-covered-failed: ${e instanceof Error ? e.message : String(e)}`
      }
    }

    const oldestAttempted = batch[batch.length - 1]
    const remaining = pending.length - batch.length
    // cursor 僅供觀測（covered months 集合才是真進度）：下輪最舊已抓月／done。
    const nextCursor = remaining <= 0 ? 'done' : oldestAttempted
    if (okMonths === 0) {
      return {
        status: 'failed', years, fetchedDays: 0, written: 0, deleted: 0, officialOverrides: 0, cursor: nextCursor,
        reason: lastError ?? 'empty-history',
      }
    }
    return {
      status: nextCursor === 'done' ? 'done' : 'advanced',
      years, fetchedDays: batch.length, written, deleted, officialOverrides, cursor: nextCursor,
      reason: lastError ? `partial-fail: ${lastError}` : null,
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'yield backfill failed'
    console.error('[TwseDividends] backfill failed (non-blocking):', message)
    return { ...empty, reason: message }
  }
}

// ─── 缺檔才抓（同步鈕＋16:00 排程順帶更新）─────────────────────────
// TWT48U 是「預告表」：單次抓取回多筆未來除息事件，逐日累積成當年快取。
// 「已有快取不重抓」以 agent_settings 抓取日標記判斷（同日第二次直接 skip；
// UNIQUE(symbol, ex_date) 另保冪等）。全程 best-effort：永不 throw，
// 失敗回 { status: 'failed' }＋走 #24 reportServerError 告警（30 分鐘去重）。
export const TWSE_DIVIDENDS_FETCH_MARKER = 'twse_dividends.last_fetch_date'

export type EnsureDividendsStatus =
  | 'updated'
  | 'skipped-cached'
  | 'skipped-non-trading-day'
  | 'failed'

export interface EnsureDividendsResult {
  status: EnsureDividendsStatus
  fetched: number
  written: number
  skippedParse: number
  /** 'non-trading-day' | 'empty-file' | 錯誤訊息；成功且有檔時為 null。 */
  reason: string | null
}

function isRateLimitedLike(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? '')
  return /429|rate.?limit|too many/i.test(msg)
}

export async function getDividendsCacheInfo(today: string): Promise<{ cacheAsOf: string | null; isTradingDay: boolean }> {
  let cacheAsOf: string | null = null
  try {
    const { getAgentSetting } = await import('@stock/database')
    cacheAsOf = await getAgentSetting(TWSE_DIVIDENDS_FETCH_MARKER)
  } catch {
    cacheAsOf = null
  }
  const { isTwseTradingDay } = await import('./twse-calendar')
  return { cacheAsOf, isTradingDay: isTwseTradingDay(today) }
}

export async function ensureTodayDividends(today: string): Promise<EnsureDividendsResult> {
  const empty: EnsureDividendsResult = { status: 'failed', fetched: 0, written: 0, skippedParse: 0, reason: null }
  try {
    const { isTwseTradingDay } = await import('./twse-calendar')
    if (!isTwseTradingDay(today)) {
      return { ...empty, status: 'skipped-non-trading-day', reason: 'non-trading-day' }
    }
    const { getAgentSetting, setAgentSetting, upsertTwseDividends } = await import('@stock/database')
    let marker: string | null = null
    try {
      marker = await getAgentSetting(TWSE_DIVIDENDS_FETCH_MARKER)
    } catch {}
    if (marker === today) {
      return { ...empty, status: 'skipped-cached', reason: null }
    }
    const { rows, skipped } = await fetchTwt48uDay(today)
    let written = 0
    try {
      written = await upsertTwseDividends(rows)
    } catch (e) {
      console.error('[TwseDividends] upsert failed (non-blocking):', e)
    }
    try {
      await setAgentSetting({
        key: TWSE_DIVIDENDS_FETCH_MARKER,
        value: today,
        category: 'sync',
        label: 'TWT48U 除息快取最近抓取日（YYYY-MM-DD；同日不重抓）',
      })
    } catch {}
    return {
      status: 'updated',
      fetched: rows.length,
      written,
      skippedParse: skipped,
      reason: rows.length === 0 ? 'empty-file' : null,
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'TWT48U fetch failed'
    console.error('[TwseDividends] fetch failed (non-blocking):', message)
    try {
      const { reportServerError } = await import('./server-alert')
      void reportServerError({
        route: 'TWT48U dividends fetch',
        status: isRateLimitedLike(e) ? 429 : 502,
        error: `TWT48U fetch failed (${today}): ${message}`,
      })
    } catch {}
    return { ...empty, reason: message }
  }
}
