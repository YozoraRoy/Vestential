import { describe, it, expect } from 'vitest'
import {
  evaluateMarginDeleverage,
  evaluateBiasOversold,
  detectPriceVolumePattern,
  evaluateCapitalHedging,
  evaluateBottomRadarChecklist,
  type OHLCVItem,
} from './bottom-radar'

describe('Bottom Radar Engine (落底雷達與抄底 SOP 引擎)', () => {
  describe('一、籌碼去槓桿：融資維持率與單日減幅', () => {
    it('健康多頭：維持率 160% 以上', () => {
      // 融資餘額 6000 億，擔保市值 10000 億 -> 維持率 166.7%
      const res = evaluateMarginDeleverage(6000, 6010, 10000)
      expect(res.status).toBe('healthy')
      expect(res.marginMaintenanceRatio).toBeCloseTo(166.67, 1)
      expect(res.isMarginCleaned).toBe(false)
    })

    it('警戒區：維持率在 135% ~ 140%', () => {
      // 融資餘額 6000 億，擔保市值 8200 億 -> 維持率 136.7%
      const res = evaluateMarginDeleverage(6000, 6010, 8200)
      expect(res.status).toBe('caution')
      expect(res.isMarginCleaned).toBe(false)
    })

    it('恐慌斷頭極值：維持率 <= 130% 觸發去槓桿訊號', () => {
      // 融資餘額 6000 億，擔保市值 7600 億 -> 維持率 126.7%
      const res = evaluateMarginDeleverage(6000, 6010, 7600)
      expect(res.status).toBe('panic_bottom')
      expect(res.isMarginCleaned).toBe(true)
    })

    it('單日融資大減 50 億以上即使維持率 145% 亦觸發去槓桿進度', () => {
      // 前日 6000 億，今日 5930 億，單日大減 70 億
      const res = evaluateMarginDeleverage(5930, 6000, 8700) // 維持率 146.7%
      expect(res.marginChange).toBe(-70)
      expect(res.isMarginCleaned).toBe(true)
    })
  })

  describe('二、技術面：60 日季線負乖離率 (BIAS60)', () => {
    it('常態回檔：0% ~ -3%', () => {
      const res = evaluateBiasOversold(44000, 45000, 105, 108) // 乖離約 -2.2% 與 -2.8%
      expect(res.taiexTier).toBe('normal')
      expect(res.stock0050Tier).toBe('normal')
      expect(res.isBiasTriggered).toBe(false)
    })

    it('中度超跌：負乖離達 -5% ~ -7%', () => {
      // 加權 42500 vs 45000 -> -5.55%
      const res = evaluateBiasOversold(42500, 45000, 102, 108) // 0050: -5.56%
      expect(res.taiexTier).toBe('oversold')
      expect(res.isBiasTriggered).toBe(true)
      expect(res.tier2TargetPrice).toBeCloseTo(108 * 0.95, 1) // 0050 -5% 試單價
    })

    it('恐慌極值：負乖離破 -8% 以下', () => {
      // 0050 季線 108，現價 98 -> -9.26%
      const res = evaluateBiasOversold(44000, 45000, 98, 108)
      expect(res.stock0050Tier).toBe('panic')
      expect(res.isBiasTriggered).toBe(true)
      expect(res.tier3TargetPrice).toBeCloseTo(108 * 0.92, 1) // 0050 -8% 甜美價
    })
  })

  describe('三、量價與型態指標：換手、窒息與吞噬', () => {
    it('爆量長下影線（打樁線）：下影線 >= 實體 2 倍 且 量 >= 1.5 倍 20MA', () => {
      const history: OHLCVItem[] = Array.from({ length: 25 }, (_, i) => ({
        open: 100,
        high: 102,
        low: 98,
        close: 100,
        volume: 1000,
      }))
      // 最新一根：開 100，高 101，最低殺到 88，收 98（實體 2，下影線 98-88=10 >= 實體*2），量 2000 >= 1.5*1000
      history[24] = { open: 100, high: 101, low: 88, close: 98, volume: 2000 }
      const res = detectPriceVolumePattern(history)
      expect(res.hammer).toBe(true)
      expect(res.patternTriggered).toBe(true)
    })

    it('量縮窒息底：量 <= 60% 20MA 且 連續 3 日未破前日低', () => {
      const history: OHLCVItem[] = Array.from({ length: 25 }, (_, i) => ({
        open: 100,
        high: 102,
        low: 98,
        close: 100,
        volume: 1000,
      }))
      // 最近 3 天量縮至 500 (50% 20MA)，且低點 96, 96.5, 97（連續不破低）
      history[22] = { open: 98, high: 100, low: 96, close: 99, volume: 500 }
      history[23] = { open: 99, high: 101, low: 96.5, close: 100, volume: 500 }
      history[24] = { open: 100, high: 101, low: 97, close: 101, volume: 500 }
      const res = detectPriceVolumePattern(history)
      expect(res.volumeDrying).toBe(true)
      expect(res.patternTriggered).toBe(true)
    })

    it('破曉長紅吞噬：實體紅 K 吞噬前一日黑 K 高點 且 站上 5MA', () => {
      const history: OHLCVItem[] = Array.from({ length: 25 }, (_, i) => ({
        open: 95,
        high: 96,
        low: 94,
        close: 95,
        volume: 1000,
      }))
      // 前日黑 K：開 96，收 93，高 96
      history[23] = { open: 96, high: 96, low: 92, close: 93, volume: 1000 }
      // 當日長紅：開 92，收 98，吞噬前一日高點 96，且站上 5MA
      history[24] = { open: 92, high: 99, low: 91, close: 98, volume: 1500 }
      const res = detectPriceVolumePattern(history)
      expect(res.dawnEngulfing).toBe(true)
      expect(res.patternTriggered).toBe(true)
    })
  })

  describe('四、資金避險動向：外資期權與台幣匯率', () => {
    it('外資空單大回補 >= 5,000 口視為避險壓力解除', () => {
      // 昨未平倉淨空單 -38000 口，今日回補至 -31000 口（單日回補 7000 口）
      const res = evaluateCapitalHedging(-31000, 7000, [32.8, 32.7])
      expect(res.isTxShortCovering).toBe(true)
      expect(res.isHedgingTriggered).toBe(true)
    })

    it('外資空單降至 2.5 萬口以下即使當日未大回補亦視為低空單水位', () => {
      const res = evaluateCapitalHedging(-22000, 1000, [32.8, 32.7])
      expect(res.isTxShortCovering).toBe(true)
    })

    it('台幣匯率止貶由貶轉升', () => {
      // 匯率近 3 天：32.6 -> 32.9 (貶) -> 32.7 (升值)
      const res = evaluateCapitalHedging(-38000, 1000, [32.6, 32.9, 32.7])
      expect(res.isFxStabilized).toBe(true)
    })
  })

  describe('五、抄底 SOP 5 條件共振檢視清單', () => {
    it('滿足 3 項以上判定為安全買點共振', () => {
      const chk = evaluateBottomRadarChecklist({
        marginCleaned: true, // 1. 融資大減或維持率恐慌
        biasTriggered: true, // 2. 季線負乖離 <= -5%
        patternTriggered: true, // 3. 出現打樁/窒息/吞噬
        hedgingTriggered: false, // 4. 外資空單未回補
        fxStabilized: false, // 5. 台幣未止貶
      })
      expect(chk.metCount).toBe(3)
      expect(chk.isSafeToBuy).toBe(true)
      expect(chk.verdict).toBe('safe_buy_resonance')
    })

    it('未滿 3 項判定為跌勢宣洩中（建議觀望）', () => {
      const chk = evaluateBottomRadarChecklist({
        marginCleaned: false,
        biasTriggered: true,
        patternTriggered: false,
        hedgingTriggered: false,
        fxStabilized: true,
      })
      expect(chk.metCount).toBe(2)
      expect(chk.isSafeToBuy).toBe(false)
      expect(chk.verdict).toBe('declining_caution')
    })
  })
})
