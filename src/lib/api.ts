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
  origin?: 'user' | 'hot' | ''
  category_id?: number | ''
  tag_ids?: number[]
  q?: string
  page?: number
  page_size?: number
}

export function listMaterials(p: ListParams) {
  const qs = new URLSearchParams()
  if (p.type) qs.set('type', p.type)
  if (p.origin) qs.set('origin', p.origin)
  if (p.category_id) qs.set('category_id', String(p.category_id))
  if (p.tag_ids?.length) qs.set('tag_ids', p.tag_ids.join(','))
  if (p.q) qs.set('q', p.q)
  qs.set('page', String(p.page ?? 1))
  qs.set('page_size', String(p.page_size ?? 24))
  return req<MaterialListResp>(`/materials?${qs}`)
}

export const getMaterial = (id: number) => req<Material>(`/materials/${id}`)

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
  opts: { categoryId?: number | ''; tags?: string; origin?: 'user' | 'hot' },
  onProgress: (pct: number) => void,
): Promise<{ items: Material[]; errors: { name: string; error: string }[] }> {
  return new Promise((resolve, reject) => {
    const fd = new FormData()
    files.forEach(f => fd.append('files', f))
    if (opts.categoryId) fd.append('category_id', String(opts.categoryId))
    if (opts.tags) fd.append('tags', opts.tags)
    if (opts.origin) fd.append('origin', opts.origin)
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

/* ---------- 爆款复刻：文稿 ---------- */
import type { Script } from '@/types'

export const listScripts = () => req<Script[]>('/scripts')
export const getScript = (id: number) => req<Script>(`/scripts/${id}`)
export function createScript(title: string) {
  return req<Script>('/scripts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
}
export function saveScript(id: number, data: { title?: string; segments?: { start: number; end: number; text: string }[]; bg_material_id?: number | null }) {
  return req<Script>(`/scripts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}
export const deleteScript = (id: number) => req<{ ok: boolean }>(`/scripts/${id}`, { method: 'DELETE' })

/** 一键生成剪映数字人视频包 */
export interface VideoPackage {
  ok: boolean
  dir: string
  files: string[]
  hasBg: boolean
  duration: number
}
export const genVideoPackage = (id: number) =>
  req<VideoPackage>(`/scripts/${id}/video-package`, { method: 'POST' })

/** 在访达中打开导出目录 */
export const openExportFolder = (dir: string) =>
  req<{ ok: boolean }>('/open-export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dir }),
  })

/** 上传视频/音频转写为文稿（耗时较长，无进度） */
export async function transcribe(file: File): Promise<Script> {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch(`${BASE}/transcribe`, { method: 'POST', body: fd })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as { error?: string }).error || `转写失败 (${res.status})`)
  return body as Script
}

/* ---------- 爆款复刻：原素材加工 ---------- */

/** 视频 → 提取音频素材（默认幂等；force 强制删除旧音频重新提取） */
export const extractAudio = (id: number, force = false) =>
  req<Material>(`/materials/${id}/extract-audio${force ? '?force=1' : ''}`, { method: 'POST' })

/** 原素材 → 转写为文稿（默认幂等；force 强制删除旧文稿重新转写） */
export const transcribeMaterial = (id: number, force = false) =>
  req<Script>(`/materials/${id}/transcribe${force ? '?force=1' : ''}`, { method: 'POST' })

/** 原素材的衍生物（音频 + 文稿） */
export interface Derivatives {
  audios: Material[]
  scripts: Script[]
}
export const getDerivatives = (id: number) => req<Derivatives>(`/materials/${id}/derivatives`)

/* ---------- 导出工具 ---------- */
export function srtTime(sec: number): string {
  const ms = Math.round(sec * 1000)
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const r = ms % 1000
  const p = (n: number, l = 2) => String(n).padStart(l, '0')
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`
}

export function buildSrt(segments: { start: number; end: number; text: string }[]): string {
  return segments
    .filter(s => s.text.trim())
    .map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.text.trim()}`)
    .join('\n\n') + '\n'
}

export function buildScriptTxt(title: string, segments: { start: number; end: number; text: string }[]): string {
  const head = `《${title}》口播文稿\n共 ${segments.length} 段 · 总时长 ${Math.max(...segments.map(s => s.end), 0)}s\n${'='.repeat(32)}\n`
  return head + segments
    .map((s, i) => `【第 ${i + 1} 段】${s.start}s - ${s.end}s\n${s.text.trim()}`)
    .join('\n\n') + '\n'
}

export function downloadText(filename: string, content: string) {
  const blob = new Blob(['﻿' + content], { type: 'text/plain;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

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
