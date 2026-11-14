import type { Category, Material, MaterialListResp, MaterialType, Stats, Tag } from '@/types'

const BASE = '/api'

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, init)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error || `请求失败 (${res.status})`)
  }
  return res.json() as Promise<T>
}

export interface ListParams {
  type?: MaterialType | ''
  category_id?: number | ''
  tag_ids?: number[]
  q?: string
  page?: number
  page_size?: number
}

export function listMaterials(p: ListParams) {
  const qs = new URLSearchParams()
  if (p.type) qs.set('type', p.type)
  if (p.category_id) qs.set('category_id', String(p.category_id))
  if (p.tag_ids?.length) qs.set('tag_ids', p.tag_ids.join(','))
  if (p.q) qs.set('q', p.q)
  qs.set('page', String(p.page ?? 1))
  qs.set('page_size', String(p.page_size ?? 24))
  return req<MaterialListResp>(`/materials?${qs}`)
}

export function updateMaterial(id: number, data: Partial<Pick<Material, 'name' | 'category_id' | 'note' | 'source'>> & { tags?: string[] }) {
  return req<Material>(`/materials/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export function deleteMaterial(id: number) {
  return req<{ ok: boolean }>(`/materials/${id}`, { method: 'DELETE' })
}

/** 带进度回调的上传（XHR），onProgress 收 0-100 */
export function uploadMaterials(
  files: File[],
  opts: { categoryId?: number | ''; tags?: string },
  onProgress: (pct: number) => void,
): Promise<{ items: Material[]; errors: { name: string; error: string }[] }> {
  return new Promise((resolve, reject) => {
    const fd = new FormData()
    files.forEach(f => fd.append('files', f))
    if (opts.categoryId) fd.append('category_id', String(opts.categoryId))
    if (opts.tags) fd.append('tags', opts.tags)
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${BASE}/materials/upload`)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText)
        if (xhr.status >= 400) reject(new Error(body.errors?.[0]?.error || body.error || '上传失败'))
        else resolve(body)
      } catch {
        reject(new Error('上传响应解析失败'))
      }
    }
    xhr.onerror = () => reject(new Error('网络错误，上传失败'))
    xhr.send(fd)
  })
}

export const listCategories = () => req<Category[]>('/categories')
export function createCategory(name: string) {
  return req<Category>('/categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}
export function renameCategory(id: number, name: string) {
  return req<{ ok: boolean }>(`/categories/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}
export const deleteCategory = (id: number) => req<{ ok: boolean }>(`/categories/${id}`, { method: 'DELETE' })

export const listTags = (q?: string) => req<Tag[]>(`/tags${q ? `?q=${encodeURIComponent(q)}` : ''}`)

export const getStats = () => req<Stats>('/stats')

export function formatSize(bytes: number): string {
  if (bytes >= 1 << 30) return `${(bytes / (1 << 30)).toFixed(2)} GB`
  if (bytes >= 1 << 20) return `${(bytes / (1 << 20)).toFixed(1)} MB`
  if (bytes >= 1 << 10) return `${(bytes / (1 << 10)).toFixed(0)} KB`
  return `${bytes} B`
}

export function formatDuration(sec: number | null): string {
  if (!sec) return ''
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
