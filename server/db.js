// SQLite 数据层（Node 24 内置 node:sqlite，零原生依赖）
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const MEDIA_DIR = path.join(DATA_DIR, 'media');
export const THUMB_DIR = path.join(DATA_DIR, 'thumbs');

for (const dir of [DATA_DIR, MEDIA_DIR, THUMB_DIR,
  path.join(MEDIA_DIR, 'video'), path.join(MEDIA_DIR, 'image'), path.join(MEDIA_DIR, 'audio')]) {
  fs.mkdirSync(dir, { recursive: true });
}

export const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('video', 'image', 'audio')),
  path TEXT NOT NULL,
  thumb TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  width INTEGER,
  height INTEGER,
  duration REAL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  source TEXT DEFAULT '',
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS material_tags (
  material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (material_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_materials_type ON materials(type);
CREATE INDEX IF NOT EXISTS idx_materials_category ON materials(category_id);
CREATE INDEX IF NOT EXISTS idx_materials_created ON materials(created_at DESC);

-- 爆款复刻：口播文稿
CREATE TABLE IF NOT EXISTS scripts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'none' CHECK (source_type IN ('video', 'audio', 'none')),
  source_name TEXT DEFAULT '',
  duration REAL DEFAULT 0,
  bg_material_id INTEGER REFERENCES materials(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 文稿时间段（时间轴）
CREATE TABLE IF NOT EXISTS segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  script_id INTEGER NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  start REAL NOT NULL,
  end REAL NOT NULL,
  text TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_segments_script ON segments(script_id, ord);
`);

// 轻量迁移：老库补列（已存在则忽略报错）
const addCol = (table, col, ddl) => {
  try { db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`).run(); } catch { /* 已存在 */ }
};
addCol('materials', 'derived_from', 'INTEGER REFERENCES materials(id) ON DELETE SET NULL'); // 派生来源（如视频提取出的音频）
addCol('scripts', 'material_id', 'INTEGER REFERENCES materials(id) ON DELETE SET NULL');    // 文稿关联的原素材
addCol('scripts', 'transcript_text', 'TEXT');                                                // 纯文字稿（无时间戳）

// 默认分类
const seed = db.prepare(`INSERT OR IGNORE INTO categories (name) VALUES (?)`);
for (const name of ['口播素材', '产品展示', 'B-Roll 空镜', '音乐音效', '封面图', '未分类']) {
  seed.run(name);
}

export function getTagsOf(materialId) {
  return db.prepare(`
    SELECT t.id, t.name FROM tags t
    JOIN material_tags mt ON mt.tag_id = t.id
    WHERE mt.material_id = ? ORDER BY t.name
  `).all(materialId);
}

export function setTagsOf(materialId, tagNames) {
  const names = [...new Set((tagNames || []).map(s => String(s).trim()).filter(Boolean))];
  db.prepare(`DELETE FROM material_tags WHERE material_id = ?`).run(materialId);
  const insTag = db.prepare(`INSERT OR IGNORE INTO tags (name) VALUES (?)`);
  const getTag = db.prepare(`SELECT id FROM tags WHERE name = ?`);
  const link = db.prepare(`INSERT OR IGNORE INTO material_tags (material_id, tag_id) VALUES (?, ?)`);
  for (const name of names) {
    insTag.run(name);
    const { id } = getTag.get(name);
    link.run(materialId, id);
  }
  return getTagsOf(materialId);
}
