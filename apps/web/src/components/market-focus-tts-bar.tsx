'use client'

import { Pause, Play, Square } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '@/i18n/LanguageProvider'
import type { Dict } from '@/i18n/dictionaries'
import type { Locale } from '@/i18n/config'

type TtsStatus = 'idle' | 'playing' | 'paused'

/** 中文口音選擇：自動（瀏覽器預設）／台灣國語／香港粵語。 */
type TtsAccent = 'auto' | 'tw' | 'hk'

const SPEECH_RATES = [1, 1.5, 2, 2.5, 3] as const

/** locale → utterance.lang 對應；中文口音由 voice 選擇覆寫。 */
function localeToLang(locale: string): string {
  if (locale === 'ja') return 'ja-JP'
  if (locale === 'en') return 'en-US'
  return 'zh-TW'
}

/** 從裝置 voice 清單找台灣／香港中文語音（找不到回 null，由瀏覽器 fallback）。 */
function findAccentVoice(accent: 'tw' | 'hk'): SpeechSynthesisVoice | null {
  try {
    const voices = window.speechSynthesis?.getVoices() ?? []
    const norm = (s: string) => s.toLowerCase()
    if (accent === 'tw') {
      return (
        voices.find((v) => norm(v.lang).startsWith('zh-tw')) ??
        voices.find((v) => norm(v.name).includes('taiwan') || v.name.includes('台灣')) ??
        null
      )
    }
    return (
      voices.find((v) => norm(v.lang).startsWith('zh-hk') || norm(v.lang).startsWith('yue')) ??
      voices.find(
        (v) =>
          norm(v.name).includes('hong kong') ||
          norm(v.name).includes('hongkong') ||
          v.name.includes('香港') ||
          v.name.includes('粵語') ||
          norm(v.name).includes('cantonese'),
      ) ??
      null
    )
  } catch {
    return null
  }
}

/**
 * 長文切段（iOS Safari 單一 utterance 過長會斷尾）：
 * 先按句讀切分，再合併至每段約 200 字以內。
 */
function splitIntoChunks(text: string, maxLen = 200): string[] {
  const sentences = text.match(/[^。！？!?…\n]+[。！？!?…\n]*/g) ?? [text]
  const chunks: string[] = []
  let buf = ''
  for (const s of sentences) {
    const piece = s.trim()
    if (!piece) continue
    if ((buf + piece).length > maxLen && buf) {
      chunks.push(buf)
      buf = piece
    } else {
      buf += piece
    }
  }
  if (buf) chunks.push(buf)
  return chunks.length > 0 ? chunks : [text]
}

interface MarketFocusTtsBarProps {
  /** 當日 AI 總覽全文（meta.summary）。 */
  summary: string
  locale: Locale
  /** Server 端注入的語系文案（避免 client 初始 SSR 用預設語系造成 flash）。 */
  t?: Dict['marketFocus']
}

export function MarketFocusTtsBar({ summary, locale, t: tProp }: MarketFocusTtsBarProps) {
  const { dict } = useI18n()
  const t = tProp ?? dict.marketFocus
  const [supported, setSupported] = useState(false)
  const [status, setStatus] = useState<TtsStatus>('idle')
  const [rate, setRate] = useState<number>(1)
  const [accent, setAccent] = useState<TtsAccent>('auto')
  /** 裝置是否找得到台灣／香港中文語音（voiceschanged 非同步，載入後更新）。 */
  const [accentFound, setAccentFound] = useState<{ tw: boolean; hk: boolean }>({ tw: false, hk: false })
  const chunksRef = useRef<string[]>([])
  const indexRef = useRef(0)
  const rateRef = useRef(1)
  const accentRef = useRef<TtsAccent>('auto')
  const lang = localeToLang(locale)

  rateRef.current = rate
  accentRef.current = accent

  // client 掛載後才偵測 speechSynthesis；不支援直接隱藏（不報錯、不提示）。
  useEffect(() => {
    const ok =
      typeof window !== 'undefined' &&
      'speechSynthesis' in window &&
      typeof window.speechSynthesis?.speak === 'function'
    setSupported(ok)
    if (!ok) return
    // 預熱＋偵測口音語音（部分瀏覽器需 voiceschanged 後才載入）。
    const detect = () => {
      try {
        window.speechSynthesis.getVoices()
      } catch {
        /* 忽略 */
      }
      setAccentFound({ tw: findAccentVoice('tw') !== null, hk: findAccentVoice('hk') !== null })
    }
    detect()
    try {
      window.speechSynthesis.onvoiceschanged = detect
    } catch {
      /* 忽略 */
    }
    return () => {
      try {
        if (window.speechSynthesis && window.speechSynthesis.onvoiceschanged === detect) {
          window.speechSynthesis.onvoiceschanged = null
        }
      } catch {
        /* 忽略 */
      }
    }
  }, [])

  const speakChunk = useCallback(
    (index: number) => {
      const synth = window.speechSynthesis
      const chunks = chunksRef.current
      if (index >= chunks.length) {
        indexRef.current = 0
        setStatus('idle')
        return
      }
      indexRef.current = index
      const utter = new SpeechSynthesisUtterance(chunks[index])
      // 口音有選且裝置找得到對應 voice 就指定；否則沿用 locale 預設由瀏覽器選聲。
      const accentNow = accentRef.current
      if (accentNow !== 'auto') {
        const voice = findAccentVoice(accentNow)
        if (voice) {
          utter.voice = voice
          utter.lang = voice.lang
        } else {
          utter.lang = localeToLang(locale)
        }
      } else {
        utter.lang = localeToLang(locale)
      }
      utter.rate = rateRef.current
      utter.onend = () => {
        // 使用者中途按停止會 cancel 並觸發 onend，需以狀態守衛避免自動續播。
        if (indexRef.current !== index) return
        speakChunk(index + 1)
      }
      utter.onerror = () => {
        indexRef.current = -1
        setStatus('idle')
      }
      synth.speak(utter)
    },
    [locale],
  )

  const startFrom = useCallback(
    (index: number) => {
      const synth = window.speechSynthesis
      synth.cancel()
      chunksRef.current = splitIntoChunks(summary)
      setStatus('playing')
      // cancel 後立即 speak 在 iOS 需落在同一次手勢事件內；
      // 按鈕 onClick 直接呼叫即滿足手勢觸發要求。
      speakChunk(index)
    },
    [summary, speakChunk],
  )

  const handleMain = useCallback(() => {
    const synth = window.speechSynthesis
    if (status === 'playing') {
      synth.pause()
      setStatus('paused')
    } else if (status === 'paused') {
      synth.resume()
      setStatus('playing')
    } else {
      startFrom(0)
    }
  }, [status, startFrom])

  const handleStop = useCallback(() => {
    indexRef.current = -1
    window.speechSynthesis.cancel()
    indexRef.current = 0
    setStatus('idle')
  }, [])

  const handleRate = useCallback(
    (next: number) => {
      setRate(next)
      rateRef.current = next
      // 播放中切語速：從目前段落以新語速重播，暫停中則僅記住語速、維持暫停。
      if (status === 'playing') {
        const synth = window.speechSynthesis
        synth.cancel()
        const at = indexRef.current < 0 ? 0 : indexRef.current
        setStatus('playing')
        speakChunk(at)
      }
    },
    [status, speakChunk],
  )

  // 卸載／換頁時停止發聲，避免背景殘留語音。
  useEffect(() => {
    const stop = () => {
      try {
        window.speechSynthesis?.cancel()
      } catch {
        /* 忽略 */
      }
    }
    window.addEventListener('pagehide', stop)
    return () => {
      window.removeEventListener('pagehide', stop)
      stop()
    }
  }, [])

  if (!supported) return null

  const mainLabel = status === 'playing' ? t.ttsPause : status === 'paused' ? t.ttsResume : t.ttsPlay

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label={t.ttsPlay}>
      <button
        type="button"
        onClick={handleMain}
        aria-label={mainLabel}
        aria-pressed={status === 'playing'}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent)]/15 border border-[var(--accent)]/40 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--accent)]/25 transition"
      >
        {status === 'playing' ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
        {mainLabel}
      </button>
      {(status === 'playing' || status === 'paused') && (
        <button
          type="button"
          onClick={handleStop}
          aria-label={t.ttsStop}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition"
        >
          <Square className="w-3.5 h-3.5" />
          {t.ttsStop}
        </button>
      )}
      <label className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
        <span>{t.ttsSpeed}</span>
        <select
          value={rate}
          onChange={(e) => handleRate(Number(e.target.value))}
          aria-label={t.ttsSpeed}
          className="px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]/60 [&>option]:bg-[var(--bg-secondary)] [&>option]:text-[var(--text-primary)]"
        >
          {SPEECH_RATES.map((r) => (
            <option key={r} value={r}>
              {r}x
            </option>
          ))}
        </select>
      </label>
      {(accentFound.tw || accentFound.hk) && (
        <label className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
          <span>{t.ttsAccent}</span>
          <select
            value={accent}
            onChange={(e) => setAccent(e.target.value as TtsAccent)}
            aria-label={t.ttsAccent}
            className="px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]/60 [&>option]:bg-[var(--bg-secondary)] [&>option]:text-[var(--text-primary)]"
          >
            <option value="auto">{t.ttsAccentAuto}</option>
            {accentFound.tw && <option value="tw">{t.ttsAccentTW}</option>}
            {accentFound.hk && <option value="hk">{t.ttsAccentHK}</option>}
          </select>
        </label>
      )}
      {status !== 'idle' && (
        <span
          aria-live="polite"
          className="text-[11px] px-2 py-0.5 rounded-full bg-white/10 text-[var(--text-secondary)]"
        >
          {status === 'playing' ? t.ttsPlaying : t.ttsPaused}
        </span>
      )}
    </div>
  )
}
