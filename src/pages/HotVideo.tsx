import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  AudioLines, Clapperboard, Copy, Download, FileText, FilePlus2, Film, FolderOpen,
  Loader2, Plus, Save, Trash2, Upload, Wand2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  buildScriptTxt, buildSrt, createScript, deleteScript, downloadText,
  genVideoPackage, getScript, listMaterials, listScripts, openExportFolder,
  saveScript, transcribe,
} from '@/lib/api'
import type { VideoPackage } from '@/lib/api'
import type { Material, Script, Segment } from '@/types'
import { cn } from '@/lib/utils'

export default function HotVideo() {
  const [scripts, setScripts] = useState<Script[]>([])
  const [current, setCurrent] = useState<Script | null>(null)
  const [segments, setSegments] = useState<Segment[]>([])
  const [title, setTitle] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [bgMaterials, setBgMaterials] = useState<Material[]>([])
  const [bgId, setBgId] = useState<string>('none')
  const [confirmDel, setConfirmDel] = useState(false)
  const [packaging, setPackaging] = useState(false)
  const [pkg, setPkg] = useState<VideoPackage | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  /* ---------- 数据加载 ---------- */
  const loadScripts = useCallback(async (keepId?: number) => {
    try {
      const list = await listScripts()
      setScripts(list)
      if (keepId) {
        const full = await getScript(keepId)
        applyScript(full)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载失败')
    }
  }, [])

  useEffect(() => {
    loadScripts()
    // 背景候选：素材库里的视频和图片
    Promise.all([listMaterials({ type: 'video', page_size: 100 }), listMaterials({ type: 'image', page_size: 100 })])
      .then(([v, i]) => setBgMaterials([...v.items, ...i.items]))
      .catch(() => { /* 背景列表失败不阻断 */ })
  }, [loadScripts])

  const applyScript = (s: Script) => {
    setCurrent(s)
    setTitle(s.title)
    setSegments(s.segments.map(x => ({ start: x.start, end: x.end, text: x.text })))
    setBgId(s.bg_material_id ? String(s.bg_material_id) : 'none')
    setDirty(false)
    setPkg(null)
  }

  /* ---------- ① 扒稿 ---------- */
  const doTranscribe = async (file: File) => {
    if (transcribing) return
    setTranscribing(true)
    try {
      toast.info('正在提取音频并转写，请稍候…')
      const s = await transcribe(file)
      toast.success(`转写完成：${s.segments.length} 段 · ${s.duration}s`)
      applyScript(s)
      loadScripts()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '转写失败')
    } finally {
      setTranscribing(false)
    }
  }

  const doCreate = async () => {
    try {
      const s = await createScript('未命名口播稿')
      toast.success('已创建空白文稿，默认 6 段 × 3 秒，可直接改')
      applyScript(s)
      loadScripts()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '创建失败')
    }
  }

  /* ---------- ② 时间轴编辑 ---------- */
  const editSeg = (i: number, patch: Partial<Segment>) => {
    setSegments(prev => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
    setDirty(true)
  }
  const insertAfter = (i: number) => {
    setSegments(prev => {
      const at = prev[i]
      const ns = { start: at.end, end: at.end + (at.end - at.start || 3), text: '' }
      return [...prev.slice(0, i + 1), ns, ...prev.slice(i + 1)]
    })
    setDirty(true)
  }
  const removeSeg = (i: number) => {
    setSegments(prev => prev.filter((_, idx) => idx !== i))
    setDirty(true)
  }
  const totalDuration = useMemo(() => Math.max(...segments.map(s => s.end), 0), [segments])
  const filledCount = useMemo(() => segments.filter(s => s.text.trim()).length, [segments])

  const doSave = async () => {
    if (!current || saving) return
    // 校验
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i]
      if (!(s.end > s.start)) { toast.error(`第 ${i + 1} 段结束时间必须大于开始时间`); return }
    }
    setSaving(true)
    try {
      const saved = await saveScript(current.id, {
        title: title.trim() || current.title,
        segments,
        bg_material_id: bgId === 'none' ? null : Number(bgId),
      })
      toast.success('文稿已保存')
      applyScript(saved)
      loadScripts()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!current) return
    try {
      await deleteScript(current.id)
      toast.success('文稿已删除')
      setConfirmDel(false)
      setCurrent(null)
      setSegments([])
      loadScripts()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败')
    }
  }

  /* ---------- ③ 导出 ---------- */
  const bg = bgMaterials.find(m => String(m.id) === bgId)
  const doExportSrt = () => {
    if (!filledCount) { toast.error('还没有任何文字内容'); return }
    downloadText(`${title || '字幕'}.srt`, buildSrt(segments))
    toast.success('字幕.srt 已下载，剪映「文本→导入字幕」即可给数字人念')
  }
  const doExportTxt = () => {
    if (!filledCount) { toast.error('还没有任何文字内容'); return }
    downloadText(`${title || '口播文稿'}.txt`, buildScriptTxt(title || '口播文稿', segments))
    toast.success('口播文稿.txt 已下载')
  }
  const copyBgPath = async () => {
    if (!bg) return
    try {
      await navigator.clipboard.writeText(bg.abs_path)
      toast.success('背景素材路径已复制')
    } catch {
      toast.error('复制失败')
    }
  }

  /* ---------- ④ 一键剪映视频包 ---------- */
  const doPackage = async () => {
    if (!current || packaging) return
    if (dirty) { toast.warning('有未保存的修改，请先保存文稿再生成'); return }
    if (!filledCount) { toast.error('还没有任何文字内容'); return }
    setPackaging(true)
    try {
      const p = await genVideoPackage(current.id)
      setPkg(p)
      toast.success(`视频包已生成：${p.files.length} 个文件`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '生成失败')
    } finally {
      setPackaging(false)
    }
  }
  const doOpenFolder = async () => {
    if (!pkg) return
    try {
      await openExportFolder(pkg.dir)
      toast.success('已在访达中打开')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '打开失败')
    }
  }

  return (
    <div className="px-6 py-6 max-w-4xl space-y-6">
      {/* 头部 */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">爆款复刻</h1>
          <p className="text-sm text-muted-foreground mt-1">
            扒稿 → 改时间轴 → 数字人口播 + 背景 = 成片
          </p>
        </div>
        <div className="flex items-center gap-2">
          {scripts.length > 0 && (
            <Select
              value={current ? String(current.id) : ''}
              onValueChange={async v => {
                try { applyScript(await getScript(Number(v))) } catch { toast.error('加载文稿失败') }
              }}
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder="打开已有文稿…" />
              </SelectTrigger>
              <SelectContent>
                {scripts.map(s => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.title}（{s.segment_count ?? 0} 段）
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {current && (
            <Button variant="ghost" size="sm" onClick={() => setConfirmDel(true)} className="text-muted-foreground hover:text-destructive">
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {/* ① 扒稿区 */}
      <section className="rounded-xl border border-border bg-card p-5">
        <SectionTitle icon={Wand2} title="① 扒稿" desc="上传爆款视频或音频，自动转写成带时间轴的文字稿；没有音频就新建空白文稿自己写" />
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <input
            ref={fileRef}
            type="file"
            accept="video/*,audio/*"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) doTranscribe(f)
              e.target.value = ''
            }}
          />
          <Button onClick={() => fileRef.current?.click()} disabled={transcribing}>
            {transcribing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {transcribing ? '转写中…' : '上传视频 / 音频扒稿'}
          </Button>
          <span className="text-xs text-muted-foreground">或</span>
          <Button variant="outline" onClick={doCreate} disabled={transcribing}>
            <FilePlus2 className="w-4 h-4" /> 新建空白文稿（数字人口播）
          </Button>
          {transcribing && (
            <span className="text-xs text-muted-foreground animate-pulse">
              本机 whisper 转写中，1 分钟音频约需 5-10 秒…
            </span>
          )}
        </div>
      </section>

      {/* ② 时间轴编辑区 */}
      {current && (
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionTitle icon={FileText} title="② 时间轴文稿" desc="每段一句口播；可改文字、调时间、在固定时间点插入内容" />
            <div className="text-xs text-muted-foreground">
              {segments.length} 段 · 已填 {filledCount} 段 · 总时长 {totalDuration.toFixed(1)}s
            </div>
          </div>
          <div className="mt-4 mb-3 flex items-center gap-2">
            <span className="text-xs text-muted-foreground shrink-0">标题</span>
            <Input value={title} onChange={e => { setTitle(e.target.value); setDirty(true) }} className="max-w-xs h-8" />
          </div>
          <div className="space-y-2">
            {segments.map((s, i) => (
              <div key={i} className="flex items-center gap-2 group">
                <span className="w-7 text-xs text-muted-foreground text-right shrink-0">{i + 1}</span>
                <TimeInput value={s.start} onChange={v => editSeg(i, { start: v })} label="开始" />
                <span className="text-muted-foreground text-xs">→</span>
                <TimeInput value={s.end} onChange={v => editSeg(i, { end: v })} label="结束" />
                <Input
                  value={s.text}
                  onChange={e => editSeg(i, { text: e.target.value })}
                  placeholder={`第 ${i + 1} 句口播…`}
                  className="flex-1 h-9"
                />
                <button
                  onClick={() => insertAfter(i)}
                  aria-label={`在第 ${i + 1} 段后插入`}
                  title="在此时间点后插入一段"
                  className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Plus className="w-4 h-4" />
                </button>
                <button
                  onClick={() => removeSeg(i)}
                  aria-label={`删除第 ${i + 1} 段`}
                  title="删除这一段"
                  className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-4 flex justify-end">
            <Button onClick={doSave} disabled={saving || !dirty}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {dirty ? '保存文稿' : '已保存'}
            </Button>
          </div>
        </section>
      )}

      {/* ③ 背景与导出区 */}
      {current && (
        <section className="rounded-xl border border-border bg-card p-5">
          <SectionTitle icon={Film} title="③ 背景与导出" desc="选一个背景视频/背景图，导出字幕后剪映数字人按它念稿，视频就完整了" />
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground shrink-0">背景素材</span>
              <Select value={bgId} onValueChange={v => { setBgId(v); setDirty(true) }}>
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="从素材库选择…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不选背景</SelectItem>
                  {bgMaterials.map(m => (
                    <SelectItem key={m.id} value={String(m.id)}>
                      {m.type === 'video' ? '🎬' : m.type === 'image' ? '🖼' : '🎵'} {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {bg && (
                <Button variant="outline" size="sm" onClick={copyBgPath}>
                  <Copy className="w-3.5 h-3.5" /> 复制背景路径
                </Button>
              )}
            </div>
            {bg && (
              <code className="block text-[11px] text-muted-foreground bg-secondary/40 rounded-lg px-3 py-2 truncate">
                {bg.abs_path}
              </code>
            )}
            <div className="border-t border-border pt-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={doPackage} disabled={packaging || !filledCount}>
                  {packaging ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clapperboard className="w-4 h-4" />}
                  {packaging ? '生成中…' : '生成剪映视频包'}
                </Button>
                {pkg && (
                  <Button variant="outline" onClick={doOpenFolder}>
                    <FolderOpen className="w-4 h-4" /> 在访达中打开
                  </Button>
                )}
                {dirty && (
                  <span className="text-xs text-amber-600 dark:text-amber-400">有未保存修改，请先保存文稿再生成</span>
                )}
              </div>
              {pkg && (
                <div className="rounded-lg border border-primary/25 bg-primary/5 px-4 py-3 space-y-1.5">
                  <p className="text-xs font-medium">
                    已生成 {pkg.files.length} 个文件（总时长 {pkg.duration.toFixed(0)}s
                    {pkg.hasBg ? ' · 含背景素材' : ' · 未选背景'}）
                  </p>
                  <ul className="text-xs text-muted-foreground space-y-0.5">
                    {pkg.files.map(f => <li key={f}>📄 {f}</li>)}
                  </ul>
                  <p className="text-xs text-muted-foreground leading-relaxed pt-1">
                    按文件夹里的「剪映操作指引.txt」操作：背景铺底 → 导入字幕.srt → 全选字幕 → 数字人选形象开念 → 导出成片。
                  </p>
                </div>
              )}
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer select-none hover:text-foreground">单独下载文件</summary>
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button variant="outline" size="sm" onClick={doExportSrt}>
                    <Download className="w-3.5 h-3.5" /> 字幕 .srt
                  </Button>
                  <Button variant="outline" size="sm" onClick={doExportTxt}>
                    <AudioLines className="w-3.5 h-3.5" /> 口播文稿 .txt
                  </Button>
                </div>
              </details>
            </div>
          </div>
        </section>
      )}

      {!current && (
        <div className="rounded-xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
          先在①里扒一个爆款，或新建一份空白文稿
        </div>
      )}

      <AlertDialog open={confirmDel} onOpenChange={setConfirmDel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除文稿「{current?.title}」？</AlertDialogTitle>
            <AlertDialogDescription>时间轴内容将一并删除，此操作不可恢复。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function SectionTitle({ icon: Icon, title, desc }: { icon: typeof Film; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="w-4 h-4 text-primary mt-0.5 shrink-0" />
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
      </div>
    </div>
  )
}

function TimeInput({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <input
      type="number"
      step={0.1}
      min={0}
      value={value}
      aria-label={`${label}时间（秒）`}
      onChange={e => onChange(Number(e.target.value))}
      className={cn(
        'w-20 h-9 rounded-md border border-input bg-background px-2 text-xs font-mono text-center',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    />
  )
}

