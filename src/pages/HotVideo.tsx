import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  AudioLines, Clapperboard, Clock, Copy, Download, FileAudio, FileText, FilePlus2, Film,
  FolderOpen, Loader2, Plus, Save, Trash2, Upload, Wand2, X,
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
  buildScriptTxt, buildSrt, createScript, deleteScript, downloadText, extractAudio,
  formatDuration, formatSize, genVideoPackage, getDerivatives, getScript, listMaterials,
  listScripts, openExportFolder, saveScript, transcribeMaterial, uploadMaterials,
} from '@/lib/api'
import type { Derivatives, VideoPackage } from '@/lib/api'
import type { Material, Script, Segment } from '@/types'
import { cn } from '@/lib/utils'

export default function HotVideo() {
  const [scripts, setScripts] = useState<Script[]>([])
  const [current, setCurrent] = useState<Script | null>(null)
  const [segments, setSegments] = useState<Segment[]>([])
  const [title, setTitle] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [bgMaterials, setBgMaterials] = useState<Material[]>([])
  const [bgId, setBgId] = useState<string>('none')
  const [confirmDel, setConfirmDel] = useState(false)
  const [packaging, setPackaging] = useState(false)
  const [pkg, setPkg] = useState<VideoPackage | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  /* ① 原素材 */
  const [sources, setSources] = useState<Material[]>([])
  const [srcId, setSrcId] = useState<number | null>(null)
  const [deriv, setDeriv] = useState<Derivatives | null>(null)
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [transcribingSrc, setTranscribingSrc] = useState(false)
  const [transcript, setTranscript] = useState<{ scriptId: number; text: string } | null>(null)

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

  const loadSources = useCallback(async (selectId?: number) => {
    try {
      const [v, a] = await Promise.all([
        listMaterials({ type: 'video', page_size: 100 }),
        listMaterials({ type: 'audio', page_size: 100 }),
      ])
      const all = [...v.items, ...a.items]
        .filter(m => !m.derived_from)
        .sort((x, y) => y.id - x.id)
      setSources(all)
      if (selectId && all.some(m => m.id === selectId)) setSrcId(selectId)
    } catch { /* 原素材列表失败不阻断 */ }
  }, [])

  const refreshBg = useCallback(() => {
    Promise.all([listMaterials({ type: 'video', page_size: 100 }), listMaterials({ type: 'image', page_size: 100 })])
      .then(([v, i]) => setBgMaterials([...v.items, ...i.items]))
      .catch(() => { /* 背景列表失败不阻断 */ })
  }, [])

  useEffect(() => {
    loadScripts()
    loadSources()
    refreshBg()
  }, [loadScripts, loadSources, refreshBg])

  /* 选中原素材 → 加载衍生物（音频/文稿） */
  useEffect(() => {
    setDeriv(null)
    setTranscript(null)
    if (!srcId) return
    getDerivatives(srcId).then(d => {
      setDeriv(d)
      const sc = d.scripts[0]
      if (sc?.transcript_text) setTranscript({ scriptId: sc.id, text: sc.transcript_text })
    }).catch(() => { /* 忽略 */ })
  }, [srcId])

  const applyScript = (s: Script) => {
    setCurrent(s)
    setTitle(s.title)
    setSegments(s.segments.map(x => ({ start: x.start, end: x.end, text: x.text })))
    setBgId(s.bg_material_id ? String(s.bg_material_id) : 'none')
    setDirty(false)
    setPkg(null)
  }

  /* ---------- ① 原素材：上传 / 转音频 / 转写 ---------- */
  const doUploadSrc = async (files: File[]) => {
    if (!files.length || uploadPct !== null) return
    setUploadPct(0)
    try {
      const { items, errors } = await uploadMaterials(files, {}, setUploadPct)
      for (const e of errors) toast.error(`${e.name}：${e.error}`)
      if (items.length) {
        toast.success(`已入库 ${items.length} 个原素材，点击可查看详情`)
        await loadSources(items[0].id)
        refreshBg()
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '上传失败')
    } finally {
      setUploadPct(null)
    }
  }

  const src = sources.find(m => m.id === srcId) || null

  /** 确保原素材已转写：有文稿直接取，没有则跑 whisper（一次产出纯文字+时间稿） */
  const ensureScript = async (): Promise<Script | null> => {
    if (!src) return null
    const existed = deriv?.scripts?.[0]
    if (existed) return getScript(existed.id)
    if (transcribingSrc) return null
    setTranscribingSrc(true)
    try {
      toast.info('本机 whisper 转写中，1 分钟音频约需 5-10 秒…')
      const s = await transcribeMaterial(src.id)
      toast.success(`转写完成：${s.segments.length} 段 · ${s.duration}s`)
      const d = await getDerivatives(src.id).catch(() => null)
      if (d) setDeriv(d)
      loadScripts()
      return s
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '转写失败')
      return null
    } finally {
      setTranscribingSrc(false)
    }
  }

  const doExtractAudio = async () => {
    if (!src || extracting) return
    setExtracting(true)
    try {
      const a = await extractAudio(src.id)
      toast.success(`音频已入库：${a.name}`)
      const d = await getDerivatives(src.id).catch(() => null)
      if (d) setDeriv(d)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '转音频失败')
    } finally {
      setExtracting(false)
    }
  }

  const doShowText = async () => {
    const s = await ensureScript()
    if (s) setTranscript({ scriptId: s.id, text: s.transcript_text || s.segments.map(x => x.text).join('\n') })
  }

  const doOpenTimeline = async () => {
    const s = await ensureScript()
    if (s) {
      applyScript(s)
      toast.success('时间文字稿已载入下方时间轴')
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

      {/* ① 原素材区 */}
      <section className="rounded-xl border border-border bg-card p-5">
        <SectionTitle icon={Wand2} title="① 原素材" desc="上传爆款视频/音频即入库管理；点选素材看详情，可转音频、转文字、转时间文字稿" />
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="video/*,audio/*"
            className="hidden"
            onChange={e => {
              const fs = Array.from(e.target.files || [])
              if (fs.length) doUploadSrc(fs)
              e.target.value = ''
            }}
          />
          <Button onClick={() => fileRef.current?.click()} disabled={uploadPct !== null}>
            {uploadPct !== null ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {uploadPct !== null ? `上传中 ${uploadPct}%` : '上传视频 / 音频'}
          </Button>
          <span className="text-xs text-muted-foreground">或</span>
          <Button variant="outline" onClick={doCreate} disabled={transcribingSrc}>
            <FilePlus2 className="w-4 h-4" /> 新建空白文稿（数字人口播）
          </Button>
        </div>

        {/* 原素材列表 */}
        {sources.length > 0 && (
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {sources.map(m => (
              <button
                key={m.id}
                onClick={() => setSrcId(m.id === srcId ? null : m.id)}
                className={cn(
                  'shrink-0 w-44 rounded-lg border p-2 text-left transition-colors',
                  m.id === srcId
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-background hover:border-primary/40',
                )}
              >
                <div className="h-16 rounded-md bg-secondary/60 overflow-hidden flex items-center justify-center">
                  {m.thumb_url
                    ? <img src={m.thumb_url} alt={m.name} className="w-full h-full object-cover" />
                    : m.type === 'video' ? <Film className="w-5 h-5 text-muted-foreground" /> : <AudioLines className="w-5 h-5 text-muted-foreground" />}
                </div>
                <p className="mt-1.5 text-xs font-medium truncate">{m.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {m.type === 'video' ? '视频' : '音频'} · {formatDuration(m.duration)} · {formatSize(m.size)}
                </p>
              </button>
            ))}
          </div>
        )}

        {/* 原素材详情 */}
        {src && (
          <div className="mt-4 rounded-lg border border-border bg-background p-4">
            <div className="flex flex-col sm:flex-row gap-4">
              {/* 预览 */}
              <div className="shrink-0 w-full sm:w-56">
                {src.type === 'video' ? (
                  <video src={src.url} controls preload="metadata" className="w-full rounded-md bg-black aspect-video" />
                ) : (
                  <div className="rounded-md bg-secondary/40 p-4">
                    <audio src={src.url} controls preload="metadata" className="w-full" />
                  </div>
                )}
              </div>
              {/* 信息 + 操作 */}
              <div className="flex-1 min-w-0 space-y-3">
                <div>
                  <p className="text-sm font-medium truncate">{src.name}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {src.type === 'video' ? '视频' : '音频'}
                    {src.duration ? ` · ${formatDuration(src.duration)}` : ''}
                    {src.width && src.height ? ` · ${src.width}×${src.height}` : ''}
                    {` · ${formatSize(src.size)} · ${src.created_at}`}
                  </p>
                  <code className="block mt-1 text-[11px] text-muted-foreground truncate">{src.abs_path}</code>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {src.type === 'video' && (
                    <Button size="sm" variant="outline" onClick={doExtractAudio} disabled={extracting}>
                      {extracting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileAudio className="w-3.5 h-3.5" />}
                      {deriv?.audios.length ? '音频已提取（再看）' : '转音频'}
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={doShowText} disabled={transcribingSrc}>
                    {transcribingSrc ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                    {transcribingSrc ? '转写中…' : '转文字'}
                  </Button>
                  <Button size="sm" onClick={doOpenTimeline} disabled={transcribingSrc}>
                    {transcribingSrc ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Clock className="w-3.5 h-3.5" />}
                    转时间文字稿
                  </Button>
                </div>
                {deriv?.audios.map(a => (
                  <div key={a.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <FileAudio className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{a.name}（{formatSize(a.size)}）</span>
                    <audio src={a.url} controls preload="none" className="h-7 w-48" />
                  </div>
                ))}
              </div>
            </div>

            {/* 纯文字稿面板 */}
            {transcript && (
              <div className="mt-4 rounded-lg border border-primary/25 bg-primary/5 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium">纯文字稿（{transcript.text.length} 字）</p>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost" size="sm" className="h-7 px-2"
                      onClick={async () => {
                        try { await navigator.clipboard.writeText(transcript.text); toast.success('已复制') }
                        catch { toast.error('复制失败') }
                      }}
                    >
                      <Copy className="w-3.5 h-3.5" /> 复制
                    </Button>
                    <Button
                      variant="ghost" size="sm" className="h-7 px-2"
                      onClick={() => downloadText(`${src.name}.txt`, transcript.text)}
                    >
                      <Download className="w-3.5 h-3.5" /> 下载
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setTranscript(null)}>
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
                <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                  {transcript.text}
                </p>
              </div>
            )}
          </div>
        )}
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

