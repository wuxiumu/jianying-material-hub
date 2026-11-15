import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { toast } from 'sonner'
import {
  AudioLines, Check, Clapperboard, Copy, FileImage, FileText, Film, LayoutGrid, List,
  Loader2, Music, Pencil, Plus, RefreshCw, Save, Search, Trash2, Upload, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  deleteMaterial, extractAudio, formatDuration, formatMs, formatSize, getDerivatives,
  getScript, getStats, listCategories, listMaterials, listTags, saveScript,
  transcribeMaterial, updateMaterial, uploadMaterials,
} from '@/lib/api'
import type { Derivatives } from '@/lib/api'
import type { Category, Material, MaterialType, Script, Stats, Tag } from '@/types'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 24
const ACCEPT = 'video/*,image/*,audio/*'

const TYPE_META: Record<MaterialType, { label: string; icon: typeof Film; color: string }> = {
  video: { label: '视频', icon: Film, color: 'bg-sky-500/15 text-sky-400' },
  image: { label: '图片', icon: FileImage, color: 'bg-emerald-500/15 text-emerald-400' },
  audio: { label: '音频', icon: Music, color: 'bg-amber-500/15 text-amber-400' },
}

export default function Library() {
  const [items, setItems] = useState<Material[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<Stats | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [type, setType] = useState<MaterialType | ''>('')
  const [searchParams, setSearchParams] = useSearchParams()
  const [origin, setOriginState] = useState<'user' | 'hot'>(searchParams.get('origin') === 'hot' ? 'hot' : 'user')
  const setOrigin = (o: 'user' | 'hot') => {
    setOriginState(o)
    setSearchParams(o === 'hot' ? { origin: 'hot' } : {}, { replace: true })
  }
  const [categoryId, setCategoryId] = useState<number | ''>('')
  const [tagIds, setTagIds] = useState<number[]>([])
  const [q, setQ] = useState('')
  const [qDebounced, setQDebounced] = useState('')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [detail, setDetail] = useState<Material | null>(null)
  const [scriptSrc, setScriptSrc] = useState<Material | null>(null)

  // 搜索防抖
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])

  const load = useCallback(async (p: number, append: boolean) => {
    setLoading(true)
    try {
      const data = await listMaterials({
        type, origin, category_id: categoryId, tag_ids: tagIds, q: qDebounced, page: p, page_size: PAGE_SIZE,
      })
      setItems(prev => (append ? [...prev, ...data.items] : data.items))
      setTotal(data.total)
      setPage(p)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [type, origin, categoryId, tagIds, qDebounced])

  const loadMeta = useCallback(async () => {
    try {
      const [c, t, s] = await Promise.all([listCategories(), listTags(), getStats()])
      setCategories(c)
      setAllTags(t)
      setStats(s)
    } catch { /* 元信息失败不阻断 */ }
  }, [])

  useEffect(() => { loadMeta() }, [loadMeta])
  useEffect(() => { load(1, false) }, [load])

  const refresh = () => { load(1, false); loadMeta() }

  const toggleTag = (id: number) =>
    setTagIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))

  const hasFilter = Boolean(type || categoryId || tagIds.length || qDebounced)

  return (
    <div className="min-h-dvh flex flex-col">
      {/* 顶部统计 */}
      <header className="px-6 pt-6 pb-4 border-b border-border">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">素材库</h1>
            <p className="text-sm text-muted-foreground mt-1">
              统一管理剪映创作素材，上传、打标、检索、一键复制路径
            </p>
          </div>
          <UploadZone categories={categories} onDone={refresh} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
          <StatTile label="素材总数" value={stats?.total} suffix="个" icon={Clapperboard} />
          <StatTile label="视频" value={stats?.byType.video} suffix="条" icon={Film} />
          <StatTile label="图片 / 音频" value={stats ? (stats.byType.image ?? 0) + (stats.byType.audio ?? 0) : undefined} suffix="个" icon={AudioLines} />
          <StatTile label="占用空间" text={stats ? formatSize(stats.totalSize) : undefined} icon={Upload} />
        </div>
      </header>

      {/* 筛选栏 */}
      <div className="px-6 py-4 border-b border-border space-y-3">
        {/* 库分区：我的素材 / 爆款素材 */}
        <div className="flex items-center gap-2">
          {([['user', '我的素材'], ['hot', '爆款素材']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setOrigin(key)}
              className={cn(
                'px-4 h-9 rounded-lg text-sm font-medium transition-colors border',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                origin === key
                  ? 'bg-primary/10 text-primary border-primary/40'
                  : 'text-muted-foreground border-border hover:text-foreground hover:border-primary/30',
              )}
            >
              {label}
            </button>
          ))}
          {origin === 'hot' && (
            <span className="text-xs text-muted-foreground">
              来自「爆款复刻」上传的原视频/音频，点卡片可查看加工状态
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={type || 'all'} onValueChange={v => setType(v === 'all' ? '' : (v as MaterialType))}>
            <TabsList>
              <TabsTrigger value="all">全部</TabsTrigger>
              <TabsTrigger value="video">视频</TabsTrigger>
              <TabsTrigger value="image">图片</TabsTrigger>
              <TabsTrigger value="audio">音频</TabsTrigger>
            </TabsList>
          </Tabs>
          <Select
            value={categoryId === '' ? 'all' : String(categoryId)}
            onValueChange={v => setCategoryId(v === 'all' ? '' : Number(v))}
          >
            <SelectTrigger className="w-36">
              <SelectValue placeholder="全部分类" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部分类</SelectItem>
              {categories.map(c => (
                <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative flex-1 min-w-48 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="搜索名称 / 备注 / 来源…"
              className="pl-9"
            />
            {q && (
              <button
                onClick={() => setQ('')}
                aria-label="清空搜索"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="ml-auto flex items-center gap-1 border border-border rounded-lg p-0.5">
            <ViewBtn active={view === 'grid'} onClick={() => setView('grid')} icon={LayoutGrid} label="网格视图" />
            <ViewBtn active={view === 'list'} onClick={() => setView('list')} icon={List} label="列表视图" />
          </div>
        </div>
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {allTags.map(t => (
              <button key={t.id} onClick={() => toggleTag(t.id)}>
                <Badge
                  variant={tagIds.includes(t.id) ? 'default' : 'outline'}
                  className={cn('cursor-pointer transition-colors', !tagIds.includes(t.id) && 'hover:border-primary/50 hover:text-primary')}
                >
                  {t.name}{typeof t.n === 'number' && t.n > 0 ? ` ${t.n}` : ''}
                </Badge>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 素材区 */}
      <div className="flex-1 px-6 py-5">
        {loading && items.length === 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-4">
            {Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="aspect-video rounded-xl" />)}
          </div>
        ) : items.length === 0 ? (
          <EmptyState hasFilter={hasFilter} onClear={() => { setType(''); setCategoryId(''); setTagIds([]); setQ('') }} />
        ) : view === 'grid' ? (
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-4">
            {items.map(m => <MaterialCard key={m.id} m={m} onOpen={() => setDetail(m)} />)}
          </div>
        ) : (
          <div className="border border-border rounded-xl overflow-hidden divide-y divide-border">
            {items.map(m => <MaterialRow key={m.id} m={m} categories={categories} onOpen={() => setDetail(m)} />)}
          </div>
        )}

        {items.length > 0 && items.length < total && (
          <div className="flex justify-center mt-6">
            <Button variant="outline" disabled={loading} onClick={() => load(page + 1, true)}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              加载更多（{items.length}/{total}）
            </Button>
          </div>
        )}
      </div>

      <DetailDialog
        material={detail}
        categories={categories}
        onClose={() => setDetail(null)}
        onChanged={() => { setDetail(null); refresh() }}
        onRefresh={refresh}
        onOpenScript={m => setScriptSrc(m)}
      />
      <ScriptDialog
        material={scriptSrc}
        onClose={() => setScriptSrc(null)}
        onChanged={refresh}
      />
    </div>
  )
}

/* ---------- 顶部统计块 ---------- */
function StatTile({ label, value, text, suffix, icon: Icon }: {
  label: string; value?: number; text?: string; suffix?: string; icon: typeof Film
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 flex items-center gap-3">
      <Icon className="w-4 h-4 text-primary shrink-0" />
      <div className="min-w-0">
        <div className="text-[11px] text-muted-foreground">{label}</div>
        <div className="text-base font-semibold leading-tight">
          {text ?? (value === undefined ? '—' : `${value} ${suffix ?? ''}`)}
        </div>
      </div>
    </div>
  )
}

function ViewBtn({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: typeof List; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'w-8 h-8 rounded-md flex items-center justify-center transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="w-4 h-4" />
    </button>
  )
}

/* ---------- 空状态 ---------- */
function EmptyState({ hasFilter, onClear }: { hasFilter: boolean; onClear: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-16 h-16 rounded-2xl bg-secondary flex items-center justify-center mb-4">
        <Clapperboard className="w-7 h-7 text-muted-foreground" />
      </div>
      <p className="font-medium">{hasFilter ? '没有符合条件的素材' : '素材库还是空的'}</p>
      <p className="text-sm text-muted-foreground mt-1 mb-4">
        {hasFilter ? '换个筛选条件试试' : '点击右上角「上传素材」，把视频 / 图片 / 音频拖进来'}
      </p>
      {hasFilter && <Button variant="outline" size="sm" onClick={onClear}>清空筛选条件</Button>}
    </div>
  )
}

/* ---------- 上传 ---------- */
function UploadZone({ categories, onDone }: { categories: Category[]; onDone: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [pct, setPct] = useState(0)
  const [categoryId, setCategoryId] = useState<string>('none')

  const doUpload = async (files: File[]) => {
    if (!files.length || uploading) return
    setUploading(true)
    setPct(0)
    try {
      const res = await uploadMaterials(files, { categoryId: categoryId === 'none' ? '' : Number(categoryId) }, setPct)
      const okCount = res.items.length
      if (okCount > 0) toast.success(`已入库 ${okCount} 个素材`)
      for (const err of res.errors) toast.error(`${err.name}：${err.error}`)
      if (okCount > 0) onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '上传失败')
    } finally {
      setUploading(false)
    }
  }

  const pick = (list: FileList | null) => {
    if (!list) return
    const files = Array.from(list).filter(f =>
      f.type.startsWith('video/') || f.type.startsWith('image/') || f.type.startsWith('audio/'))
    if (files.length < list.length) toast.warning('已跳过不支持的文件类型')
    void doUpload(files)
  }

  return (
    <div className="flex items-center gap-2">
      <Select value={categoryId} onValueChange={setCategoryId}>
        <SelectTrigger className="w-32">
          <SelectValue placeholder="选择分类" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">不指定分类</SelectItem>
          {categories.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files) }}
        className={cn('relative', dragging && 'opacity-90')}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={e => { pick(e.target.files); e.target.value = '' }}
        />
        <Button onClick={() => inputRef.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          {uploading ? `上传中 ${pct}%` : '上传素材'}
        </Button>
        {dragging && (
          <div className="absolute -inset-1 rounded-lg border-2 border-dashed border-primary pointer-events-none" />
        )}
        {uploading && (
          <div className="absolute left-0 right-0 -bottom-2">
            <Progress value={pct} className="h-1" />
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------- 网格卡片 ---------- */
function MaterialCard({ m, onOpen }: { m: Material; onOpen: () => void }) {
  const meta = TYPE_META[m.type]
  const Icon = meta.icon
  return (
    <button
      onClick={onOpen}
      className={cn(
        'group text-left rounded-xl border border-border bg-card overflow-hidden',
        'transition-all hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-0.5',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <div className="relative aspect-video bg-secondary/60 flex items-center justify-center overflow-hidden">
        {m.thumb_url ? (
          <img src={m.thumb_url} alt={m.name} loading="lazy" className="w-full h-full object-cover" />
        ) : (
          <Icon className="w-8 h-8 text-muted-foreground/50" />
        )}
        <span className={cn('absolute top-2 left-2 text-[10px] px-1.5 py-0.5 rounded-md font-medium backdrop-blur', meta.color)}>
          {meta.label}
        </span>
        {m.duration != null && (
          <span className="absolute bottom-2 right-2 text-[10px] px-1.5 py-0.5 rounded-md bg-black/70 text-white font-mono">
            {formatDuration(m.duration)}
          </span>
        )}
      </div>
      <div className="p-2.5">
        <p className="text-xs font-medium truncate" title={m.name}>{m.name}</p>
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-[10px] text-muted-foreground">{formatSize(m.size)}</span>
          <span className="text-[10px] text-muted-foreground">{m.created_at.slice(0, 10)}</span>
        </div>
        {m.origin === 'hot' && (
          <div className="flex items-center gap-1 mt-1.5">
            {(m.audio_count ?? 0) > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-400">🎵 已转音频</span>
            )}
            {(m.script_count ?? 0) > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-primary/15 text-primary">📝 已转文字稿</span>
            )}
            {!(m.audio_count ?? 0) && !(m.script_count ?? 0) && (
              <span className="text-[10px] text-muted-foreground">待加工</span>
            )}
          </div>
        )}
      </div>
    </button>
  )
}

/* ---------- 列表行 ---------- */
function MaterialRow({ m, categories, onOpen }: { m: Material; categories: Category[]; onOpen: () => void }) {
  const meta = TYPE_META[m.type]
  const Icon = meta.icon
  const cat = categories.find(c => c.id === m.category_id)
  return (
    <button
      onClick={onOpen}
      className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-accent/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <div className="w-14 h-9 rounded-md bg-secondary overflow-hidden shrink-0 flex items-center justify-center">
        {m.thumb_url
          ? <img src={m.thumb_url} alt="" loading="lazy" className="w-full h-full object-cover" />
          : <Icon className="w-4 h-4 text-muted-foreground/60" />}
      </div>
      <span className={cn('text-[10px] px-1.5 py-0.5 rounded-md font-medium shrink-0', meta.color)}>{meta.label}</span>
      <span className="text-sm truncate flex-1">{m.name}</span>
      <span className="text-xs text-muted-foreground w-24 truncate hidden md:block">{cat?.name ?? '—'}</span>
      <span className="text-xs text-muted-foreground w-20 text-right hidden sm:block">{formatSize(m.size)}</span>
      <span className="text-xs text-muted-foreground w-24 text-right hidden lg:block">{m.created_at.slice(0, 16)}</span>
    </button>
  )
}

/* ---------- 详情弹窗 ---------- */
function DetailDialog({ material, categories, onClose, onChanged, onRefresh, onOpenScript }: {
  material: Material | null
  categories: Category[]
  onClose: () => void
  onChanged: () => void
  onRefresh: () => void
  onOpenScript: (m: Material) => void
}) {
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState('none')
  const [source, setSource] = useState('')
  const [link, setLink] = useState('')
  const [note, setNote] = useState('')
  const [tagsList, setTagsList] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [copied, setCopied] = useState(false)
  const [hotDeriv, setHotDeriv] = useState<Derivatives | null>(null)
  const [hotBusy, setHotBusy] = useState<null | 'audio' | 'script'>(null)
  const [confirmRegen, setConfirmRegen] = useState<null | 'audio' | 'script'>(null)
  const [showText, setShowText] = useState(false)

  const refreshDeriv = useCallback(async (id: number) => {
    const d = await getDerivatives(id).catch(() => null)
    if (d) setHotDeriv(d)
  }, [])

  useEffect(() => {
    if (material) {
      setName(material.name)
      setCategoryId(material.category_id ? String(material.category_id) : 'none')
      setSource(material.source || '')
      setLink(material.link || '')
      setNote(material.note || '')
      setTagsList(material.tags.map(t => t.name))
      setTagInput('')
      setCopied(false)
      setHotDeriv(null)
      setConfirmRegen(null)
      setShowText(false)
      if (material.origin === 'hot') refreshDeriv(material.id)
    }
  }, [material, refreshDeriv])

  const meta = material ? TYPE_META[material.type] : null

  const save = async () => {
    if (!material || saving) return
    setSaving(true)
    try {
      await updateMaterial(material.id, {
        name: name.trim() || material.name,
        category_id: categoryId === 'none' ? null : Number(categoryId),
        source: source.trim(),
        link: link.trim(),
        note: note.trim(),
        tags: tagsList,
      })
      toast.success('已保存')
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const copyPath = async () => {
    if (!material) return
    try {
      await navigator.clipboard.writeText(material.abs_path)
      setCopied(true)
      toast.success('已复制文件路径，可直接拖入剪映使用')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('复制失败，请手动复制')
    }
  }

  const doDelete = async () => {
    if (!material) return
    try {
      await deleteMaterial(material.id)
      toast.success('素材已删除')
      setConfirmDel(false)
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败')
    }
  }

  /* 爆款加工：转音频 / 转写（force 时删除旧产物重跑） */
  const runExtract = async (force: boolean) => {
    if (!material || hotBusy) return
    setConfirmRegen(null)
    setHotBusy('audio')
    try {
      const a = await extractAudio(material.id, force)
      toast.success(`${force ? '已重新提取' : '音频已生成'}：${formatSize(a.size)}`)
      await refreshDeriv(material.id)
      onRefresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '转音频失败')
    } finally {
      setHotBusy(null)
    }
  }
  const runTranscribe = async (force: boolean) => {
    if (!material || hotBusy) return
    setConfirmRegen(null)
    setHotBusy('script')
    try {
      toast.info('本机 whisper 转写中，请稍候…')
      const s = await transcribeMaterial(material.id, force)
      toast.success(`${force ? '已重新' : ''}转写完成：${s.segments.length} 段`)
      await refreshDeriv(material.id)
      onRefresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '转写失败')
    } finally {
      setHotBusy(null)
    }
  }

  return (
    <>
      <Dialog open={!!material} onOpenChange={open => { if (!open) onClose() }}>
        <DialogContent className="max-w-5xl h-[88dvh] flex flex-col overflow-hidden">
          {material && meta && (
            <>
              <DialogHeader className="shrink-0">
                <DialogTitle className="flex items-center gap-2">
                  <span className={cn('text-[10px] px-1.5 py-0.5 rounded-md font-medium', meta.color)}>{meta.label}</span>
                  {material.name}
                </DialogTitle>
                <DialogDescription>
                  {formatSize(material.size)}
                  {material.width ? ` · ${material.width}×${material.height}` : ''}
                  {material.duration ? ` · ${formatDuration(material.duration)}` : ''}
                  {` · 入库于 ${material.created_at}`}
                </DialogDescription>
              </DialogHeader>

              <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
              {/* 预览（限制高度，不抢占表单空间） */}
              <div className="rounded-xl overflow-hidden bg-secondary/50 border border-border flex justify-center">
                {material.type === 'video' && (
                  <video src={material.url} controls className="max-h-52 max-w-full" />
                )}
                {material.type === 'image' && (
                  <img src={material.url} alt={material.name} className="max-h-52 max-w-full object-contain" />
                )}
                {material.type === 'audio' && (
                  <div className="p-4 flex items-center gap-3 w-full">
                    <Music className="w-6 h-6 text-amber-400 shrink-0" />
                    <audio src={material.url} controls className="w-full" />
                  </div>
                )}
              </div>

              {/* 爆款素材：加工流水线（转音频 / 转文字 / 时间文字稿） */}
              {material.origin === 'hot' && (() => {
                const audio = hotDeriv?.audios[0]
                const script = hotDeriv?.scripts[0]
                return (
                  <div className="rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-medium">爆款加工</p>
                      <a
                        href={`/hot?src=${material.id}`}
                        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs text-primary hover:bg-primary/10 transition-colors"
                      >
                        <Clapperboard className="w-3.5 h-3.5" /> 去爆款复刻页
                      </a>
                    </div>

                    {/* 音频（仅视频可提取） */}
                    {material.type === 'video' && (
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="w-14 shrink-0 text-muted-foreground">🎵 音频</span>
                        {audio ? (
                          <>
                            <span className="text-muted-foreground">
                              {formatSize(audio.size)} · 耗时 {formatMs(audio.gen_ms)}
                            </span>
                            <audio src={audio.url} controls preload="none" className="h-7 w-44" />
                            <button
                              onClick={() => setConfirmRegen('audio')}
                              disabled={!!hotBusy}
                              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                            >
                              <RefreshCw className="w-3 h-3" /> 重新生成
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="text-muted-foreground/60">未转化</span>
                            <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={() => runExtract(false)} disabled={!!hotBusy}>
                              {hotBusy === 'audio' ? <Loader2 className="w-3 h-3 animate-spin" /> : null}转音频
                            </Button>
                          </>
                        )}
                      </div>
                    )}

                    {/* 文字稿 */}
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="w-14 shrink-0 text-muted-foreground">📝 文字稿</span>
                      {script ? (
                        <>
                          <span className="text-muted-foreground">
                            {(script.transcript_text || '').length} 字 · 耗时 {formatMs(script.gen_ms)}
                          </span>
                          <button
                            onClick={() => setShowText(true)}
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                          >
                            <FileText className="w-3 h-3" /> 查看
                          </button>
                          <button
                            onClick={() => setConfirmRegen('script')}
                            disabled={!!hotBusy}
                            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                          >
                            <RefreshCw className="w-3 h-3" /> 重新生成
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="text-muted-foreground/60">未转化</span>
                          <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={() => runTranscribe(false)} disabled={!!hotBusy}>
                            {hotBusy === 'script' ? <Loader2 className="w-3 h-3 animate-spin" /> : null}转文字
                          </Button>
                        </>
                      )}
                    </div>

                    {/* 时间文字稿 */}
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="w-14 shrink-0 text-muted-foreground">🕐 时间稿</span>
                      {script ? (
                        <>
                          <span className="text-muted-foreground">{script.segment_count} 段</span>
                          <button
                            onClick={() => onOpenScript(material)}
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                          >
                            <FileText className="w-3 h-3" /> 打开时间轴
                          </button>
                          <button
                            onClick={() => setConfirmRegen('script')}
                            disabled={!!hotBusy}
                            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                          >
                            <RefreshCw className="w-3 h-3" /> 重新生成
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="text-muted-foreground/60">未转化</span>
                          <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={() => runTranscribe(false)} disabled={!!hotBusy}>
                            {hotBusy === 'script' ? <Loader2 className="w-3 h-3 animate-spin" /> : null}转时间文字稿
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                )
              })()}

              {/* 编辑表单 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="space-y-1.5">
                  <span className="text-xs text-muted-foreground">名称</span>
                  <Input value={name} onChange={e => setName(e.target.value)} />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs text-muted-foreground">分类</span>
                  <Select value={categoryId} onValueChange={setCategoryId}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">未分类</SelectItem>
                      {categories.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </label>
                <div className="space-y-1.5 md:col-span-2">
                  <span className="text-xs text-muted-foreground">标签（回车添加一个，点 × 移除）</span>
                  <div
                    className="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 min-h-9 cursor-text focus-within:ring-2 focus-within:ring-ring"
                    onClick={e => (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.focus()}
                  >
                    {tagsList.map(t => (
                      <span key={t} className="inline-flex items-center gap-1 rounded-md bg-primary/10 text-primary px-2 py-0.5 text-xs">
                        {t}
                        <button
                          type="button"
                          aria-label={`移除标签 ${t}`}
                          onClick={() => setTagsList(prev => prev.filter(x => x !== t))}
                          className="text-primary/60 hover:text-primary"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                    <input
                      value={tagInput}
                      onChange={e => {
                        const v = e.target.value
                        // 逗号也直接成标签（兼容旧习惯）
                        if (/[,，]$/.test(v)) {
                          const t = v.slice(0, -1).trim()
                          if (t && !tagsList.includes(t)) setTagsList(prev => [...prev, t])
                          setTagInput('')
                        } else {
                          setTagInput(v)
                        }
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          const t = tagInput.trim()
                          if (t && !tagsList.includes(t)) setTagsList(prev => [...prev, t])
                          setTagInput('')
                        } else if (e.key === 'Backspace' && !tagInput && tagsList.length) {
                          setTagsList(prev => prev.slice(0, -1))
                        }
                      }}
                      placeholder={tagsList.length ? '' : '输入后回车，例：口播'}
                      className="flex-1 min-w-28 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                    />
                  </div>
                </div>
                <label className="space-y-1.5">
                  <span className="text-xs text-muted-foreground">来源</span>
                  <Input value={source} onChange={e => setSource(e.target.value)} placeholder="例：AI 生成 / 实拍 / 素材网站" />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs text-muted-foreground">链接（原视频 URL）</span>
                  <Input value={link} onChange={e => setLink(e.target.value)} placeholder="例：https://v.douyin.com/…" />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs text-muted-foreground">备注</span>
                  <Textarea value={note} onChange={e => setNote(e.target.value)} rows={1} placeholder="适用场景、使用注意事项…" />
                </label>
              </div>

              {/* 文件路径 */}
              <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2">
                <code className="text-[11px] text-muted-foreground truncate flex-1" title={material.abs_path}>
                  {material.abs_path}
                </code>
                <Button size="sm" variant="outline" onClick={copyPath}>
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? '已复制' : '复制路径'}
                </Button>
              </div>

              </div>{/* 滚动内容区结束 */}

              {/* 底部操作栏固定 */}
              <div className="shrink-0 flex items-center justify-between border-t border-border pt-3 mt-1">
                <Button variant="destructive" size="sm" onClick={() => setConfirmDel(true)}>
                  <Trash2 className="w-3.5 h-3.5" /> 删除素材
                </Button>
                <Button onClick={save} disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pencil className="w-4 h-4" />}
                  保存修改
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDel} onOpenChange={setConfirmDel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除这个素材？</AlertDialogTitle>
            <AlertDialogDescription>
              「{material?.name}」及其缩略图将从素材库中删除，本地文件一并移除，此操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 文字稿查看弹窗 */}
      <Dialog open={showText} onOpenChange={setShowText}>
        <DialogContent className="max-w-xl max-h-[80dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" /> 文字稿
            </DialogTitle>
            <DialogDescription>
              {hotDeriv?.scripts[0] ? `${(hotDeriv.scripts[0].transcript_text || '').length} 字 · 转写耗时 ${formatMs(hotDeriv.scripts[0].gen_ms)}` : ''}
            </DialogDescription>
          </DialogHeader>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
            {hotDeriv?.scripts[0]?.transcript_text || '（无内容）'}
          </p>
          <div className="flex justify-end">
            <Button
              variant="outline" size="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(hotDeriv?.scripts[0]?.transcript_text || '')
                  toast.success('已复制')
                } catch { toast.error('复制失败') }
              }}
            >
              <Copy className="w-3.5 h-3.5" /> 复制全文
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 爆款加工：重新生成确认 */}
      <AlertDialog open={!!confirmRegen} onOpenChange={open => { if (!open) setConfirmRegen(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmRegen === 'audio' ? '重新生成音频？' : '重新生成文字稿？'}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmRegen === 'audio'
                ? '将删除已提取的音频文件，重新从视频提取。'
                : '将删除当前文字稿和时间轴文稿（包括手动修改），用 whisper 重新转写，此操作不可恢复。'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => (confirmRegen === 'audio' ? runExtract(true) : runTranscribe(true))}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              删除并重新生成
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/* ---------- 爆款素材：时间轴文稿弹窗（预览 / 编辑 / 复制 / 重新生成） ---------- */
type SegDraft = { start: number; end: number; text: string }

function ScriptDialog({ material, onClose, onChanged }: {
  material: Material | null
  onClose: () => void
  onChanged: () => void
}) {
  const [script, setScript] = useState<Script | null>(null)
  const [segments, setSegments] = useState<SegDraft[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [regen, setRegen] = useState(false)
  const [confirmRegen, setConfirmRegen] = useState(false)
  const [dirty, setDirty] = useState(false)

  const load = useCallback(async () => {
    if (!material) return
    setLoading(true)
    try {
      const d = await getDerivatives(material.id)
      const sc = d.scripts[0]
      if (sc) {
        const full = await getScript(sc.id)
        setScript(full)
        setSegments(full.segments.map(s => ({ start: s.start, end: s.end, text: s.text })))
      } else {
        setScript(null)
        setSegments([])
      }
    } catch {
      toast.error('加载文稿失败')
    } finally {
      setLoading(false)
    }
  }, [material])

  useEffect(() => {
    setDirty(false)
    setConfirmRegen(false)
    setScript(null)
    setSegments([])
    if (material) load()
  }, [material, load])

  const editSeg = (i: number, patch: Partial<SegDraft>) => {
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

  const doSave = async () => {
    if (!script || saving) return
    for (let i = 0; i < segments.length; i++) {
      if (!(segments[i].end > segments[i].start)) {
        toast.error(`第 ${i + 1} 段结束时间必须大于开始时间`)
        return
      }
    }
    setSaving(true)
    try {
      const saved = await saveScript(script.id, { title: script.title, segments })
      setScript(saved)
      setSegments(saved.segments.map(s => ({ start: s.start, end: s.end, text: s.text })))
      setDirty(false)
      toast.success('文稿已保存')
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const doGenerate = async (force: boolean) => {
    if (!material || regen) return
    setConfirmRegen(false)
    setRegen(true)
    try {
      toast.info('本机 whisper 转写中，请稍候…')
      const s = await transcribeMaterial(material.id, force)
      setScript(s)
      setSegments(s.segments.map(x => ({ start: x.start, end: x.end, text: x.text })))
      setDirty(false)
      toast.success(`${force ? '已重新' : ''}转写完成：${s.segments.length} 段`)
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '转写失败')
    } finally {
      setRegen(false)
    }
  }

  const doCopy = async () => {
    const text = segments.filter(s => s.text.trim()).map(s => s.text.trim()).join('\n')
    if (!text) { toast.error('还没有文字内容'); return }
    try {
      await navigator.clipboard.writeText(text)
      toast.success('文稿已复制（纯文字）')
    } catch {
      toast.error('复制失败')
    }
  }

  const total = Math.max(...segments.map(s => s.end), 0)

  return (
    <>
      <Dialog open={!!material} onOpenChange={open => { if (!open) onClose() }}>
        <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
          {material && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-primary" />
                  时间轴文稿
                </DialogTitle>
                <DialogDescription className="truncate">
                  {material.name}
                  {script ? ` · ${segments.length} 段 · 总时长 ${total.toFixed(1)}s` : ''}
                  {dirty ? ' · 有未保存修改' : ''}
                </DialogDescription>
              </DialogHeader>

              {loading ? (
                <div className="py-16 flex items-center justify-center text-muted-foreground text-sm gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> 加载文稿…
                </div>
              ) : !script ? (
                <div className="py-12 text-center space-y-3">
                  <p className="text-sm text-muted-foreground">这个爆款素材还没有时间轴文稿</p>
                  <Button onClick={() => doGenerate(false)} disabled={regen}>
                    {regen ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                    {regen ? '转写中…' : '生成时间文字稿'}
                  </Button>
                </div>
              ) : (
                <>
                  <div className="space-y-2 max-h-[46dvh] overflow-y-auto pr-1">
                    {segments.map((s, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="w-6 text-xs text-muted-foreground text-right shrink-0">{i + 1}</span>
                        <input
                          type="number" step={0.1} min={0} value={s.start}
                          aria-label={`第 ${i + 1} 段开始时间`}
                          onChange={e => editSeg(i, { start: Number(e.target.value) })}
                          className="w-16 h-8 rounded-md border border-input bg-background px-1.5 text-xs font-mono text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                        <span className="text-muted-foreground text-xs">→</span>
                        <input
                          type="number" step={0.1} min={0} value={s.end}
                          aria-label={`第 ${i + 1} 段结束时间`}
                          onChange={e => editSeg(i, { end: Number(e.target.value) })}
                          className="w-16 h-8 rounded-md border border-input bg-background px-1.5 text-xs font-mono text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                        <Input
                          value={s.text}
                          onChange={e => editSeg(i, { text: e.target.value })}
                          placeholder={`第 ${i + 1} 句…`}
                          className="flex-1 h-8 text-xs"
                        />
                        <button
                          onClick={() => insertAfter(i)}
                          aria-label={`在第 ${i + 1} 段后插入`}
                          title="插入一段"
                          className="p-1 rounded-md text-muted-foreground hover:text-primary hover:bg-accent transition-colors"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => removeSeg(i)}
                          aria-label={`删除第 ${i + 1} 段`}
                          title="删除这一段"
                          className="p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-accent transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <Button
                      variant="outline" size="sm"
                      className="text-destructive border-destructive/30 hover:bg-destructive/10"
                      onClick={() => setConfirmRegen(true)}
                      disabled={regen || saving}
                    >
                      {regen ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                      {regen ? '转写中…' : '重新生成'}
                    </Button>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={doCopy}>
                        <Copy className="w-3.5 h-3.5" /> 复制文稿
                      </Button>
                      <Button size="sm" onClick={doSave} disabled={saving || !dirty}>
                        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                        {dirty ? '保存修改' : '已保存'}
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmRegen} onOpenChange={setConfirmRegen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>重新生成时间轴文稿？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除当前文稿（包括你手动修改的内容），用 whisper 重新转写，此操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => doGenerate(true)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              删除并重新生成
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
