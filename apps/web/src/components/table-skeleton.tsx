/**
 * Issue #75：全站表格共用 loading 骨架（沿 `app/odd-lot/loading.tsx` 視覺）。
 *
 * - spinner（圓環＋置中圖示感）＋ `rows` 列 pulse 佔位（預設 5 列）；
 * - 純展示無 hooks，server/client 皆可引用；
 * - /chip-radar 與 /ex-dividend 的裸「載入中…」由此替換，不再各寫一套。
 */
export function TableSkeleton({
  message = '載入中…',
  hint,
  rows = 5,
}: {
  message?: string
  hint?: string
  rows?: number
}) {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <div className="bg-[var(--bg-card)] border border-white/10 rounded-2xl p-10 flex flex-col items-center justify-center gap-4">
        <div className="w-12 h-12 border-2 border-white/10 border-t-[var(--accent)] rounded-full animate-spin" />
        <div className="text-center space-y-1.5">
          <p className="text-sm font-medium text-white">{message}</p>
          {hint ? <p className="text-xs text-[var(--text-secondary)]">{hint}</p> : null}
        </div>
      </div>
      <div className="bg-[var(--bg-card)] border border-white/5 rounded-2xl p-4 md:p-6 space-y-3 animate-pulse">
        {Array.from({ length: Math.max(1, rows) }).map((_, i) => (
          <div key={i} className="h-12 rounded-xl bg-white/5" />
        ))}
      </div>
    </div>
  )
}
