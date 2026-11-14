export type MaterialType = 'video' | 'image' | 'audio'

export interface Tag {
  id: number
  name: string
  n?: number
}

export interface Material {
  id: number
  name: string
  type: MaterialType
  path: string
  abs_path: string
  url: string
  thumb: string | null
  thumb_url: string | null
  size: number
  width: number | null
  height: number | null
  duration: number | null
  category_id: number | null
  source: string
  note: string
  tags: Tag[]
  created_at: string
  updated_at: string
}

export interface Category {
  id: number
  name: string
  material_count?: number
  created_at?: string
}

export interface MaterialListResp {
  total: number
  page: number
  page_size: number
  items: Material[]
}

export interface Stats {
  total: number
  byType: Partial<Record<MaterialType, number>>
  byCategory: { id: number; name: string; n: number }[]
  recent: Material[]
  totalSize: number
}
