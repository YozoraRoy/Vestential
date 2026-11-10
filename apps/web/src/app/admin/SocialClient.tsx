'use client'

import { useEffect, useState } from 'react'
import { btn, btnGhost, Card, getJson, Help, input, post, ResultBanner, SectionPageWrapper, type Result } from './_components'

type SocialCardStyle = 'classic' | 'meme' | 'ai'

interface DryRunResult {
  editionKey?: string | null
  cardStyle?: SocialCardStyle
  igCardStyle?: 'ai' | 'meme'
  cards?: { classic: string; meme: string; ai: string }
  captions?: { instagram: string; threads: string; facebook: string }
  meme?: { title: string; punchline: string } | null
  /** 發布時會自動貼上 IG 的第一則留言（導流）。 */
  igDriveComment?: string
  /** #31 首回覆問題預覽（乾跑時產生；enabled=false 表示開關 off，實發時跳過）。 */
  firstReply?: {
    text: string
    category: string
    categoryLabel: string
    source: 'llm' | 'fallback'
    tagged: boolean
    mode: string
    enabled: boolean
  } | null
  results?: Array<{ platform: string; status: string; error?: string | null; commentStatus?: string | null }>
  message?: string
  skipped?: boolean
  triggered?: boolean
  error?: string
}

type SocialPlatform = 'instagram' | 'threads' | 'facebook'

const TH_LIMIT = 500

const BG_PRESET_OPTIONS = [
  { id: 'auto', label: '🤖 AI 智能匹配新聞' },
  { id: 'chip', label: '🔬 晶片半導體' },
  { id: 'ai', label: '🧠 AI 算力中心' },
  { id: 'finance', label: '📈 金融趨勢線' },
  { id: 'energy', label: '⚡ 綠能智慧電網' },
  { id: 'shipping', label: '🚢 航運貨櫃巨輪' },
  { id: 'none', label: '⬛ 純色漸層 (無底圖)' },
]

export function SocialClient() {
  const [result, setResult] = useState<Result>(null)
  const [preview, setPreview] = useState<DryRunResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  // 2026-11 起只留 Threads：平台固定 threads（IG／FB 已停用）。
  const [platforms] = useState<SocialPlatform[]>(['threads'])
  const [threadsCardStyle, setThreadsCardStyle] = useState<SocialCardStyle>('ai')
  const [draftThreads, setDraftThreads] = useState('')
  const [bgPreset, setBgPreset] = useState('auto')
  const [bgCustomPrompt, setBgCustomPrompt] = useState('')
  const [generatingBg, setGeneratingBg] = useState(false)

  // #31 首回覆開關（讀寫 social.reply_tag_metaai；off＝不發首回覆）
  const [firstReplyMode, setFirstReplyMode] = useState('editor')
  const [firstReplyModeBusy, setFirstReplyModeBusy] = useState(false)

  // Threads 回覆小編
  const [replyUrl, setReplyUrl] = useState('')
  const [replyBusy, setReplyBusy] = useState(false)
  const [replyPost, setReplyPost] = useState<{ shortcode: string; mediaId: string | null; author: string; text: string; permalink: string } | null>(null)
  const [replyDraft, setReplyDraft] = useState('')
  const [replyDraftError, setReplyDraftError] = useState<string | undefined>(undefined)
  const [replyAlreadyReplied, setReplyAlreadyReplied] = useState(false)
  const [replyMaxChars, setReplyMaxChars] = useState(500)

  // 節慶乾跑（中秋 MVP）：只生成賀圖＋三平台文案預覽，不寫 DB、不真發
  const [festivalPreview, setFestivalPreview] = useState<{
    editionKey?: string | null
    card?: string
    captions?: { instagram: string; threads: string; facebook: string }
    message?: string
    skipped?: boolean
    triggered?: boolean
    error?: string
  } | null>(null)
  const [festivalBusy, setFestivalBusy] = useState(false)

  useEffect(() => {
    if (!busy) {
      setElapsed(0)
      return
    }
    const t = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [busy])

  // #31 首回覆開關初始值（後台 Agent 設定 social.reply_tag_metaai）
  useEffect(() => {
    getJson('/api/admin/settings').then((r) => {
      if (r.ok && r.body?.success) {
        const found = (r.body.settings ?? []).find((s: { key: string; value: string }) => s.key === 'social.reply_tag_metaai')
        if (found) setFirstReplyMode(found.value || 'editor')
      }
    }).catch(() => {})
  }, [])

  const saveFirstReplyMode = async (mode: string) => {
    setFirstReplyMode(mode)
    setFirstReplyModeBusy(true)
    const r = await post('/api/admin/settings', { key: 'social.reply_tag_metaai', value: mode })
    setFirstReplyModeBusy(false)
    setResult(r.ok ? { ok: true, message: `首回覆開關已切為 ${mode}` } : { ok: false, message: `開關儲存失敗：${r.body?.error ?? ''}` })
  }

  const run = async (dryRun: boolean, force: boolean) => {
    setBusy(true)
    const r = await post('/api/admin/social/publish', { dryRun, force, platforms }, 180000)
    setBusy(false)
    if (r.ok && r.body.success) {
      if (dryRun) {
        setPreview(r.body as DryRunResult)
        setThreadsCardStyle('ai')
        setDraftThreads(r.body.captions?.threads ?? '')
        setResult({
          ok: true,
          message: r.body.triggered ? `乾跑完成（edition ${r.body.editionKey}）` : `${r.body.message ?? 'skipped'}（${r.body.error ?? ''}）`,
        })
      } else {
        setResult({
          ok: true,
          message: `發布結果：${JSON.stringify(r.body.results ?? r.body)}`,
        })
      }
    } else {
      setResult({ ok: false, message: r.body?.error ? `失敗：${r.body.error}` : (r.ok ? '失敗：未知錯誤' : '連線逾時或網路錯誤') })
    }
  }

  const handleRegenerateBg = async (presetChoice = bgPreset) => {
    if (!preview?.editionKey) return
    setGeneratingBg(true)
    const r = await post(
      '/api/admin/social/generate-image',
      {
        preset: presetChoice,
        prompt: bgCustomPrompt.trim() || undefined,
        editionKey: preview.editionKey,
        meme: preview.meme,
      },
      60000,
    )
    setGeneratingBg(false)
    if (r.ok && r.body?.success && r.body?.cards) {
      setPreview((prev) => (prev ? { ...prev, cards: r.body.cards } : prev))
      setResult({
        ok: true,
        message: presetChoice === 'none' ? '已切換為純色深色漸層' : '科技底圖已成功重新生成並套用至所有圖卡！',
      })
    } else {
      setResult({
        ok: false,
        message: r.body?.error ? `底圖生成失敗：${r.body.error}` : '底圖生成連線逾時或網路錯誤',
      })
    }
  }

  const runFestivalDryRun = async () => {
    setFestivalBusy(true)
    const r = await post('/api/admin/social/publish', { festival: true, dryRun: true }, 180000)
    setFestivalBusy(false)
    if (r.ok && r.body.success) {
      setFestivalPreview(r.body)
      setResult({
        ok: true,
        message: r.body.triggered ? `節慶乾跑完成（edition ${r.body.editionKey}）` : `${r.body.message ?? 'skipped'}`,
      })
    } else {
      setResult({ ok: false, message: r.body?.error ? `失敗：${r.body.error}` : (r.ok ? '失敗：未知錯誤' : '連線逾時或網路錯誤') })
    }
  }

  const runThreadsReplyDraft = async () => {
    if (!replyUrl.trim()) return
    setReplyBusy(true)
    setReplyPost(null)
    setReplyDraft('')
    setReplyDraftError(undefined)
    setReplyAlreadyReplied(false)
    const r = await post('/api/admin/social/threads-reply/draft', { url: replyUrl }, 90000)
    setReplyBusy(false)
    if (r.ok && r.body.success && r.body.post) {
      setReplyPost(r.body.post)
      setReplyDraft(r.body.draft ?? '')
      setReplyDraftError(r.body.draftError)
      setReplyAlreadyReplied(!!r.body.alreadyReplied)
      setReplyMaxChars(r.body.maxChars ?? 500)
      setResult({ ok: true, message: `貼文讀取完成（@${r.body.post.author}），以下是擬稿。` })
    } else {
      setResult({ ok: false, message: r.body?.error ? `失敗：${r.body.error}` : '連線逾時或網路錯誤' })
    }
  }

  const publishThreadsReplyDraft = async () => {
    if (!replyPost?.mediaId || !replyDraft.trim()) return
    setReplyBusy(true)
    const r = await post(
      '/api/admin/social/threads-reply/publish',
      { mediaId: replyPost.mediaId, replyText: replyDraft, force: false },
      90000,
    )
    setReplyBusy(false)
    if (r.ok && r.body.success) {
      setReplyAlreadyReplied(true)
      setResult({ ok: true, message: `回覆已發布（${r.body.externalId}）` })
    } else {
      setResult({ ok: false, message: r.body?.error ? `發布失敗：${r.body.error}` : '連線逾時或網路錯誤' })
    }
  }

  const overReply = replyPost && Array.from(replyDraft).length > replyMaxChars

  const publishManual = async () => {
    if (!preview?.cards || !preview.editionKey || platforms.length === 0) return
    setBusy(true)

    const imageUrls: Partial<Record<SocialPlatform, string | null>> = {}

    if (platforms.includes('threads')) {
      const upTh = await post(
        '/api/admin/social/card-image',
        { editionKey: preview.editionKey, style: threadsCardStyle, dataUrl: preview.cards[threadsCardStyle] },
        60000,
      )
      if (!upTh.ok || !upTh.body?.success) {
        setBusy(false)
        setResult({ ok: false, message: `上傳 Threads 圖卡失敗：${upTh.body?.error ?? 'network'}` })
        return
      }
      imageUrls.threads = upTh.body.url
    }

    const r = await post(
      '/api/admin/social/publish',
      {
        dryRun: false,
        force: false,
        platforms,
        imageUrls,
        // IG／FB 已停用，仍帶空字串以符合 API 的 SocialCaptions 型別。
        captions: { instagram: '', threads: draftThreads, facebook: '' },
      },
      180000,
    )
    setBusy(false)
    if (r.ok && r.body.success) {
      setResult({ ok: true, message: `手動發布結果：${JSON.stringify(r.body.results ?? r.body)}` })
    } else {
      setResult({ ok: false, message: r.body?.error ? `發布失敗：${r.body.error}` : '連線逾時或網路錯誤' })
    }
  }

  const overTh = draftThreads.length > TH_LIMIT
  const isThSelected = platforms.includes('threads')
  const manualDisabled =
    busy ||
    platforms.length === 0 ||
    (isThSelected && (overTh || draftThreads.trim() === ''))

  const publishButtonText = '確認發布（僅 Threads）'

  return (
    <SectionPageWrapper title="社群小編" subtitle="Threads (AI 吉祥物全圖卡) 文案＋圖卡預覽與發布">
      <ResultBanner result={result} onDismiss={() => setResult(null)} />
      <Card title="操作">
        <div className="mb-4 flex flex-wrap items-center gap-3 pb-3 border-b border-[var(--border)]">
          <span className="text-sm font-semibold text-[var(--text-secondary)]">發布目標平台：</span>
          <span className="text-sm font-medium text-[var(--text-primary)]">🧵 Threads</span>
          <span className="text-xs text-[var(--text-secondary)]">（Instagram／Facebook 已停用，發布與 token 偵測皆不再執行）</span>
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-3 pb-3 border-b border-[var(--border)]">
          <span className="text-sm font-semibold text-[var(--text-secondary)]">首回覆（Threads）：</span>
          <select
            className={input + ' w-auto text-sm'}
            value={firstReplyMode}
            onChange={(e) => saveFirstReplyMode(e.target.value)}
            disabled={busy || firstReplyModeBusy}
            aria-label="首回覆（Threads）開關"
          >
            <option value="on">@meta.ai 版（預設）</option>
            <option value="editor">降級：小編提問版（去 tag）</option>
            <option value="off">關閉（不發首回覆）</option>
          </select>
          <Help text="on＝主文後自動發「@meta.ai＋問題」的 Threads 自回覆（IG 第二則留言已停用）；editor＝降級去 tag 小編提問版；off＝不發首回覆。驗證協議：首發 2 小時查 @meta.ai 有無回，有則維持 on、無則切 editor。" />
        </div>
        <div className="flex flex-wrap gap-3">
          <button className={btn} onClick={() => run(true, false)} disabled={busy}>
            {busy ? '處理中…' : '乾跑預覽（文案＋圖卡×3）'}
          </button>
          <button className={btnGhost} onClick={() => run(false, false)} disabled={busy || platforms.length === 0}>
            直接發布（僅未發布平台）
          </button>
          <button className={btnGhost} onClick={() => run(false, true)} disabled={busy || platforms.length === 0}>
            強制重發選定平台（清去重）
          </button>
          <button className={btnGhost} onClick={runFestivalDryRun} disabled={busy || festivalBusy}>
            {festivalBusy ? '節慶乾跑中…' : '🌕 節慶乾跑（中秋賀圖＋Threads 文案）'}
          </button>
          <div className="flex items-center">
            <Help text="Threads 一律搭配「AI 吉祥物全圖卡」。乾跑只產出預覽，不呼叫 Meta API 也不寫去重。節慶乾跑僅在中秋當天產出賀圖＋賀詞，非節日回 skipped。" />
          </div>
        </div>
        {busy && (
          <p className="mt-4 text-sm text-[var(--text-secondary)]">
            ⏳ 呼叫 AI 生成文案與三種圖卡中…（已等待 {elapsed} 秒，通常需 30~120 秒）。完成前請勿關閉頁面。
          </p>
        )}
        {!preview && !busy && (
          <p className="mt-4 text-sm text-[var(--text-secondary)]">尚未乾跑。按下「乾跑預覽」會產出 Threads 文案＋三種圖卡（品牌資訊卡／梗圖大字卡／AI 吉祥物全圖卡）供選。</p>
        )}
      </Card>

      {festivalPreview?.card && festivalPreview?.captions && !festivalBusy && (
        <Card title="🌕 節慶乾跑預覽（中秋賀圖＋Threads 賀詞，不寫 DB、不真發）">
          <p className="mb-4 text-sm text-[var(--text-secondary)]">edition：{festivalPreview.editionKey}</p>
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={festivalPreview.card}
                alt="中秋賀圖預覽"
                className="w-full max-w-[400px] mx-auto rounded-2xl border border-[var(--accent)]/40 shadow-lg"
              />
            </div>
            <div className="space-y-4">
              <div>
                <h3 className="mb-1 text-sm font-semibold text-[var(--accent)]">
                  Threads 賀詞（{Array.from(festivalPreview.captions.threads).length}/500）
                </h3>
                <p className="whitespace-pre-wrap break-words rounded-xl border border-[var(--border)] bg-black/20 p-3 text-sm text-[var(--text-primary)]">
                  {festivalPreview.captions.threads}
                </p>
              </div>
            </div>
          </div>
        </Card>
      )}

      {preview?.cards && !busy && (
        <>
          {/* AI 科技底圖工作室 */}
          <Card title="🎨 AI 科技底圖工作室 (Cloudflare FLUX.1-schnell)">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-[var(--text-secondary)]">底圖風格預設：</span>
                {BG_PRESET_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={generatingBg || busy}
                    onClick={() => {
                      setBgPreset(opt.id)
                      handleRegenerateBg(opt.id)
                    }}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-colors cursor-pointer ${
                      bgPreset === opt.id
                        ? 'bg-[var(--accent)] text-black font-semibold border-[var(--accent)]'
                        : 'border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-secondary)]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[280px]">
                  <input
                    type="text"
                    className={input}
                    placeholder="自訂 Prompt (選填，如: cyberpunk futuristic data center in taipei)"
                    value={bgCustomPrompt}
                    onChange={(e) => setBgCustomPrompt(e.target.value)}
                    disabled={generatingBg || busy}
                  />
                </div>
                <button
                  className={btn}
                  type="button"
                  onClick={() => handleRegenerateBg()}
                  disabled={generatingBg || busy}
                >
                  {generatingBg ? '🎨 科技底圖生成中…' : '🔄 重新生成底圖'}
                </button>
              </div>
              <p className="text-xs text-[var(--text-secondary)]">
                💡 採用 Cloudflare Workers AI 免費額度生成，每次約耗時 2~3 秒。點擊上方風格標籤即可一鍵替換底圖；若需極簡版面可點「純色深色漸層」。
              </p>
            </div>
          </Card>

          <div className="grid gap-6 max-w-2xl mx-auto">
            {/* Threads 設定與預覽 */}
            {isThSelected && (
              <Card title="🧵 Threads 發布設定">
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-[var(--text-secondary)]">圖卡配圖：</span>
                    <div className="flex gap-4 text-sm">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="threadsCardStyle"
                          checked={threadsCardStyle === 'classic'}
                          onChange={() => setThreadsCardStyle('classic')}
                          className="accent-[var(--accent)]"
                        />
                        品牌資訊卡
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="threadsCardStyle"
                          checked={threadsCardStyle === 'meme'}
                          onChange={() => setThreadsCardStyle('meme')}
                          className="accent-[var(--accent)]"
                        />
                        梗圖大字卡
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="threadsCardStyle"
                          checked={threadsCardStyle === 'ai'}
                          onChange={() => setThreadsCardStyle('ai')}
                          className="accent-[var(--accent)]"
                        />
                        🎨 AI 吉祥物全圖卡 (預設)
                      </label>
                    </div>
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={preview.cards[threadsCardStyle]}
                    alt="Threads 圖卡預覽"
                    className="w-full max-w-[400px] mx-auto rounded-2xl border border-white/20 shadow-lg mb-4"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold text-[var(--accent)]">Threads 文案</h3>
                    <span className={`text-xs ${overTh ? 'text-[var(--accent-red)]' : 'text-[var(--text-secondary)]'}`}>
                      {draftThreads.length}/{TH_LIMIT}
                    </span>
                  </div>
                  <textarea
                    className={input}
                    rows={8}
                    maxLength={TH_LIMIT + 100}
                    value={draftThreads}
                    onChange={(e) => setDraftThreads(e.target.value)}
                  />
                </div>
              </Card>
            )}
          </div>

          <Card title="確認發布">
            {preview.meme && (
              <p className="mb-4 text-sm text-[var(--text-secondary)]">
                💡 本次 AI 生成梗圖概念：主標題 <b>{preview.meme.title}</b> ／ {preview.meme.punchline}
              </p>
            )}
            {preview.firstReply && (
              <div className="mb-4 rounded-xl border border-[var(--border)] bg-black/20 p-3">
                <p className="text-sm font-semibold text-[var(--accent)]">
                  🤖 首回覆預覽（{preview.firstReply.categoryLabel}類・{preview.firstReply.source === 'llm' ? 'AI 生成' : '固定題庫兜底'}・{Array.from(preview.firstReply.text).length}/100 字）
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-[var(--text-primary)]">{preview.firstReply.text}</p>
                {!preview.firstReply.enabled && (
                  <p className="mt-1 text-xs text-[var(--accent-red)]">開關目前為關閉，實發時不會發出此首回覆。</p>
                )}
              </div>
            )}
            <div className="flex items-center gap-3">
              <button
                className={btn}
                onClick={publishManual}
                disabled={manualDisabled}
              >
                {busy ? '處理中…' : publishButtonText}
              </button>
              <Help text="會將選定平台的對應圖卡快照上傳，再以編輯後的文案對選定平台發布。" />
            </div>
          </Card>
        </>
      )}

      <Card title="🧵 Threads 回覆小編（擬稿 → 審核 → 發布）">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[300px]">
            <input
              type="text"
              className={input}
              placeholder="貼上 Threads 貼文網址或短代碼（例如 https://www.threads.com/@user/post/Dc2VzRiElRJ）"
              value={replyUrl}
              onChange={(e) => setReplyUrl(e.target.value)}
              disabled={replyBusy}
            />
          </div>
          <button className={btn} onClick={runThreadsReplyDraft} disabled={replyBusy || !replyUrl.trim()}>
            {replyBusy ? '處理中…' : '讀取貼文並擬稿'}
          </button>
          <button
            className={btnGhost}
            onClick={runThreadsReplyDraft}
            disabled={replyBusy || !replyPost}
          >
            🔄 重新擬稿
          </button>
          <Help text="帶 LLM 依品牌語氣「順著話題自然接話」擬稿；發布前可自行修改。回覆是純文字。注意：Threads API 目前只允許回覆「自家／可讀取」的貼文，回覆別人熱門貼文常被平台拒絕（需 App Review 打通）。" />
        </div>

        {replyPost && (
          <div className="mt-3 space-y-3">
            {replyAlreadyReplied && (
              <p className="text-sm text-[var(--accent-red)]">⚠️ 這則貼文已回覆過（去重擋下），發布按鈕已停用。</p>
            )}
            <div className="rounded-xl border border-[var(--border)] bg-black/20 p-3">
              <p className="text-xs text-[var(--text-secondary)] mb-1">
                @{replyPost.author} 的原串文{' '}
                <a
                  href={replyPost.permalink}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--accent)] underline break-all"
                >
                  {replyPost.permalink}
                </a>
              </p>
              <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap break-words">{replyPost.text}</p>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-semibold text-[var(--accent)]">擬稿回覆（可編輯）</h3>
                <span className={`text-xs ${overReply ? 'text-[var(--accent-red)]' : 'text-[var(--text-secondary)]'}`}>
                  {Array.from(replyDraft).length}/{replyMaxChars}
                </span>
              </div>
              <textarea
                className={input}
                rows={5}
                maxLength={replyMaxChars + 100}
                value={replyDraft}
                onChange={(e) => setReplyDraft(e.target.value)}
                disabled={replyBusy}
              />
              {replyDraftError && (
                <p className="mt-1 text-xs text-[var(--accent-red)]">AI 擬稿失敗：{replyDraftError}（可自行撰寫後發布）</p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                className={btn}
                onClick={publishThreadsReplyDraft}
                disabled={replyBusy || replyAlreadyReplied || !replyPost.mediaId || !replyDraft.trim() || !!overReply}
              >
                {replyBusy ? '處理中…' : '發布回覆（人工審核後）'}
              </button>
              <Help text="按下才會真正發布（TEXT 回覆載具 → threads_publish）。發布過程約需 40 秒等待容器就緒。" />
            </div>
          </div>
        )}
      </Card>
    </SectionPageWrapper>
  )
}