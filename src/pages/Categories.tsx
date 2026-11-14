import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Check, FolderOpen, FolderPlus, Loader2, Pencil, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { createCategory, deleteCategory, listCategories, renameCategory } from '@/lib/api'
import type { Category } from '@/types'

export default function Categories() {
  const [items, setItems] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [deleting, setDeleting] = useState<Category | null>(null)

  const load = useCallback(async () => {
    try {
      setItems(await listCategories())
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const add = async () => {
    const name = newName.trim()
    if (!name || adding) return
    setAdding(true)
    try {
      await createCategory(name)
      toast.success(`分类「${name}」已创建`)
      setNewName('')
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '创建失败')
    } finally {
      setAdding(false)
    }
  }

  const saveRename = async (id: number) => {
    const name = editName.trim()
    if (!name) { setEditingId(null); return }
    try {
      await renameCategory(id, name)
      toast.success('已重命名')
      setEditingId(null)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '重命名失败')
    }
  }

  const doDelete = async () => {
    if (!deleting) return
    try {
      await deleteCategory(deleting.id)
      toast.success(`分类「${deleting.name}」已删除`)
      setDeleting(null)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败')
    }
  }

  return (
    <div className="px-6 py-6 max-w-2xl">
      <h1 className="text-xl font-semibold">分类管理</h1>
      <p className="text-sm text-muted-foreground mt-1 mb-6">
        按创作场景组织素材，例如：口播素材、产品展示、B-Roll 空镜、音乐音效、封面图
      </p>

      {/* 新增 */}
      <div className="flex gap-2 mb-6">
        <Input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add() }}
          placeholder="输入新分类名称…"
          className="max-w-xs"
        />
        <Button onClick={add} disabled={!newName.trim() || adding}>
          {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderPlus className="w-4 h-4" />}
          新建分类
        </Button>
      </div>

      {/* 列表 */}
      {loading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : items.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground text-sm">
          <FolderOpen className="w-8 h-8 mx-auto mb-3 opacity-50" />
          还没有分类，先创建一个吧
        </div>
      ) : (
        <div className="border border-border rounded-xl divide-y divide-border overflow-hidden">
          {items.map(c => (
            <div key={c.id} className="flex items-center gap-3 px-4 py-3 bg-card hover:bg-accent/40 transition-colors">
              <FolderOpen className="w-4 h-4 text-primary shrink-0" />
              {editingId === c.id ? (
                <>
                  <Input
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') saveRename(c.id)
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                    autoFocus
                    className="h-8 max-w-56"
                  />
                  <Button size="sm" variant="ghost" onClick={() => saveRename(c.id)} aria-label="确认重命名">
                    <Check className="w-4 h-4 text-primary" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} aria-label="取消重命名">
                    <X className="w-4 h-4" />
                  </Button>
                </>
              ) : (
                <>
                  <span className="text-sm font-medium flex-1">{c.name}</span>
                  <span className="text-xs text-muted-foreground">{c.material_count ?? 0} 个素材</span>
                  <Button
                    size="sm" variant="ghost" aria-label={`重命名 ${c.name}`}
                    onClick={() => { setEditingId(c.id); setEditName(c.name) }}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="sm" variant="ghost" aria-label={`删除 ${c.name}`}
                    onClick={() => setDeleting(c)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <AlertDialog open={!!deleting} onOpenChange={open => { if (!open) setDeleting(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除分类「{deleting?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              该分类下的 {deleting?.material_count ?? 0} 个素材不会被删除，只会变为「未分类」。
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
    </div>
  )
}
