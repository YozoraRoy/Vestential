'use client'

import { useCallback, useEffect, useState } from 'react'
import { btnGhost, Card, getJson, Help, InfoRow, input, post, ResultBanner, SectionPageWrapper, type Result } from './_components'

interface AgentSetting {
  key: string
  category: string
  label: string
  value: string
  updatedAt: string | null
  editable: boolean
  help: string | null
  builtinPrompt: string | null
}

const GROUPS: Array<{ key: string; label: string }> = [
  { key: 'market-focus', label: '市場焦點小編' },
  { key: 'social', label: '社群小編' },
  { key: 'arena', label: '競技場' },
  { key: 'ui', label: '介面顯示' },
  { key: 'custom', label: '自訂' },
]

const isTextarea = (key: string) => key.includes('prompt') || key.includes('personality')

export function SettingsClient() {
  const [settings, setSettings] = useState<AgentSetting[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [result, setResult] = useState<Result>(null)
  const [savedKey, setSavedKey] = useState<string | null>(null)
  const [showBuiltin, setShowBuiltin] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    const r = await getJson('/api/admin/settings')
    if (r.ok && r.body.success) {
      setSettings(r.body.settings ?? [])
      const d: Record<string, string> = {}
      for (const x of r.body.settings ?? []) d[x.key] = x.value
      setDrafts(d)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const save = async (key: string) => {
    setSavedKey(key)
    const r = await post('/api/admin/settings', { key, value: drafts[key] ?? '' })
    setSavedKey(null)
    setResult(r.ok ? { ok: true, message: `已儲存 ${key}` } : { ok: false, message: `儲存失敗：${r.body?.error ?? ''}` })
  }

  return (
    <SectionPageWrapper title="Agent 設定" subtitle="各小編／競技場的可調參數；未填空白代表使用內建預設。prompt 欄可展開「內建預設」參考。滑到「?」看說明">
      <ResultBanner result={result} onDismiss={() => setResult(null)} />
      {GROUPS.map((g) => {
        const list = settings.filter((s) => s.category === g.key)
        if (list.length === 0) return null
        return (
          <Card key={g.key} title={g.label}>
            <div className="grid md:grid-cols-2 gap-x-8 gap-y-5">
              {list.map((s) => (
                <div key={s.key}>
                  <label className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)] mb-1">
                    {s.label}
                    {s.help ? <Help text={s.help} /> : null}
                  </label>
                  {s.editable ? (
                    <div>
                      <div className="flex gap-2">
                        <textarea
                          className={input + (isTextarea(s.key) ? ' min-h-[72px]' : ' min-h-[40px]')}
                          value={drafts[s.key] ?? ''}
                          onChange={(e) => setDrafts((d) => ({ ...d, [s.key]: e.target.value }))}
                          aria-label={s.label}
                        />
                        <button
                          className={btnGhost + ' shrink-0 self-start'}
                          onClick={() => save(s.key)}
                          disabled={savedKey === s.key}
                        >
                          存
                        </button>
                      </div>
                      {s.builtinPrompt ? (
                        <div className="mt-1.5">
                          <button
                            className="text-xs text-[var(--text-secondary)] hover:text-[var(--accent)] underline decoration-dotted underline-offset-2"
                            onClick={() => setShowBuiltin((x) => ({ ...x, [s.key]: !x[s.key] }))}
                          >
                            {showBuiltin[s.key] ? '隱藏內建預設 ▲' : '內建預設（點開參考）▼'}
                          </button>
                          {showBuiltin[s.key] ? (
                            <pre className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-white/[0.03] p-3 text-xs leading-relaxed text-[var(--text-secondary)]">
                              {s.builtinPrompt}
                            </pre>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                      <InfoRow label="" value={s.value || '（唯讀，未設定）'} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )
      })}
    </SectionPageWrapper>
  )
}