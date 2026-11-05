export type RestrictionStatus =
  | 'ALLOW_AGENT'
  | 'REQUIRE_EVOTE_OR_ATTEND'
  | 'NO_ODD_LOT_GIFT'
  | 'UNKNOWN'
  | 'APP_ONLY'
  | 'EGIFT_ONLINE'
  | 'EVOTE_STOCK_AGENT'

function getOfficialRuleMap(ui: {
  restrictOneShare: string
  restrictFullLot: string
  restrictNoGift: string
  restrictMeetingOnly: string
}): Record<string, { status: RestrictionStatus; label: string; badgeClass: string }> {
  return {
    ONE_SHARE: {
      status: 'ALLOW_AGENT',
      label: ui.restrictOneShare,
      badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    },
    FULL_LOT: {
      status: 'NO_ODD_LOT_GIFT',
      label: ui.restrictFullLot,
      badgeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
    },
    NO_GIFT: {
      status: 'NO_ODD_LOT_GIFT',
      label: ui.restrictNoGift,
      badgeClass: 'bg-white/5 text-white/40 border-white/15',
    },
    MEETING_ONLY: {
      status: 'REQUIRE_EVOTE_OR_ATTEND',
      label: ui.restrictMeetingOnly,
      badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    },
  }
}

export function getOddLotRestriction(
  giftName?: string | null,
  distributionMethod?: string | null,
  claimRule?: string | null,
  claimRuleSource?: string | null,
  ui?: {
    restrictOneShare?: string
    restrictFullLot?: string
    restrictNoGift?: string
    restrictMeetingOnly?: string
    restrictEvoteOrAttend?: string
    restrictOddLotNoGift?: string
    restrictPending?: string
    restrictAgentClaimable?: string
    sourceOfficial?: string
    sourceEstimated?: string
    restrictAppOnly?: string
    restrictEgiftOnline?: string
    restrictEvoteStockAgent?: string
  },
  stockId?: string | null,
): {
  status: RestrictionStatus
  label: string
  badgeClass: string
  source: string
  officialText?: string | null
} {
  const sid = (stockId ?? '').trim()

  // 1. 僅限股東本人 APP 線上領取抵用券、無代領（大魯閣 1432）
  if (sid === '1432') {
    return {
      status: 'APP_ONLY',
      label: ui?.restrictAppOnly ?? '📱 僅本人APP',
      badgeClass: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
      source: '官方公告',
      officialText:
        '官方明確規定 1 股可領，但僅限股東本人下載「大魯閣 Plus」APP 驗證身分線上領取抵用券，現場與股代均不發放實體券，無法代領。',
    }
  }

  // 2. 集保 eGift 電子禮卡、線上直接入袋無須代領（四維航 5608、高力 8996、旭暉應材 6698、ABC-KY 6598、台耀 4746）
  const EGIFT_STOCKS = new Set(['5608', '8996', '6698', '6598', '4746'])
  if (EGIFT_STOCKS.has(sid)) {
    return {
      status: 'EGIFT_ONLINE',
      label: ui?.restrictEgiftOnline ?? '💻 集保eGift',
      badgeClass: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
      source: '官方公告',
      officialText:
        '採用集保結算所「eGift」數位發放，零股股東只要完成電子投票即可線上直接領取超商卡序號，無須跑股代或代領。',
    }
  }

  const ruleMap = getOfficialRuleMap({
    restrictOneShare: ui?.restrictOneShare ?? '✅ 1股可領',
    restrictFullLot: ui?.restrictFullLot ?? '❌ 需滿千股',
    restrictNoGift: ui?.restrictNoGift ?? '➖ 無紀念品',
    restrictMeetingOnly: ui?.restrictMeetingOnly ?? '⚠️ 需出席/電投',
  })

  if (claimRule && claimRuleSource === 'MOPS' && claimRule !== 'UNKNOWN' && ruleMap[claimRule]) {
    const cfg = ruleMap[claimRule]
    return { ...cfg, source: 'MOPS' }
  }

  const text = `${giftName || ''} ${distributionMethod || ''}`.toLowerCase()

  if (text.includes('親領') || text.includes('電子投票') || text.includes('電投') || text.includes('出席')) {
    return {
      status: 'REQUIRE_EVOTE_OR_ATTEND',
      label: ui?.restrictEvoteOrAttend ?? '⚠️ 需電投/親領',
      badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
      source: '推估',
    }
  }
  if (text.includes('不發') || text.includes('滿一張') || text.includes('滿一千股') || text.includes('千股以上')) {
    return {
      status: 'NO_ODD_LOT_GIFT',
      label: ui?.restrictOddLotNoGift ?? '❌ 零股不發放',
      badgeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
      source: '推估',
    }
  }
  if (!giftName || giftName === '-' || giftName === '待公告' || giftName === '無') {
    return {
      status: 'UNKNOWN',
      label: ui?.restrictPending ?? '⏳ 待公告',
      badgeClass: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
      source: '推估',
    }
  }

  return {
    status: 'EVOTE_STOCK_AGENT',
    label: ui?.restrictEvoteStockAgent ?? '🏛️ 需電投至股代領',
    badgeClass: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
    source: '推估',
    officialText:
      '民間三大徵求點拒收零股。股東需先完成電子投票，於指定日期持表決單赴券商股代部櫃檯親領/代領，或委託付費代領平台。',
  }
}
