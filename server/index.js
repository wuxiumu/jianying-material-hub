// 剪映素材库 · 后端服务（Express + node:sqlite）
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db, DATA_DIR, MEDIA_DIR, ROOT, getTagsOf, setTagsOf } from './db.js';
import { makeThumb, probeMedia, deleteThumb } from './thumbs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

// 素材与缩略图静态托管
app.use('/media', express.static(DATA_DIR, { maxAge: '1d' }));

const TYPE_OF = (mime, filename = '') => {
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  // mimetype 不可靠时（如 application/octet-stream）按扩展名兜底
  const ext = path.extname(filename).toLowerCase();
  if (['.mp4', '.mov', '.m4v', '.avi', '.mkv', '.webm', '.flv', '.wmv', '.ts'].includes(ext)) return 'video';
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.heic', '.tiff', '.svg'].includes(ext)) return 'image';
  if (['.mp3', '.wav', '.aac', '.m4a', '.flac', '.ogg', '.wma', '.aiff'].includes(ext)) return 'audio';
  return null;
};

// multer 对中文文件名按 latin1 解码，这里转回 UTF-8
function fixName(name) {
  try {
    const fixed = Buffer.from(name, 'latin1').toString('utf8');
    // 转换后出现乱码替换符则回退原名
    return fixed.includes('�') ? name : fixed;
  } catch {
    return name;
  }
}

// 上传：先进临时目录，校验后再归档
const upload = multer({
  dest: path.join(DATA_DIR, 'tmp'),
  limits: { fileSize: 2 * 1024 * 1024 * 1024, files: 20 }, // 单文件最大 2GB
});

const row2json = (row) => row && ({
  ...row,
  tags: getTagsOf(row.id),
  abs_path: path.join(ROOT, 'data', row.path),
  url: `/media/${row.path.split(path.sep).map(encodeURIComponent).join('/')}`,
  thumb_url: row.thumb ? `/media/${row.thumb}` : null,
});

/* ---------------- 统计 ---------------- */
app.get('/api/stats', (req, res) => {
  const total = db.prepare(`SELECT COUNT(*) n FROM materials`).get().n;
  const byType = Object.fromEntries(
    db.prepare(`SELECT type, COUNT(*) n FROM materials GROUP BY type`).all().map(r => [r.type, r.n])
  );
  const byCategory = db.prepare(`
    SELECT c.id, c.name, COUNT(m.id) n FROM categories c
    LEFT JOIN materials m ON m.category_id = c.id
    GROUP BY c.id ORDER BY n DESC, c.id
  `).all();
  const recent = db.prepare(`SELECT * FROM materials ORDER BY created_at DESC LIMIT 6`).all().map(row2json);
  const totalSize = db.prepare(`SELECT COALESCE(SUM(size),0) s FROM materials`).get().s;
  res.json({ total, byType, byCategory, recent, totalSize });
});

/* ---------------- 素材 ---------------- */
app.get('/api/materials', (req, res) => {
  const { type, category_id, q, tag_ids } = req.query;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.page_size) || 24));
  const where = [];
  const params = [];
  if (type && ['video', 'image', 'audio'].includes(type)) { where.push(`m.type = ?`); params.push(type); }
  if (category_id) { where.push(`m.category_id = ?`); params.push(Number(category_id)); }
  if (q) { where.push(`(m.name LIKE ? OR m.note LIKE ? OR m.source LIKE ?)`); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const tagIds = String(tag_ids || '').split(',').map(Number).filter(Boolean);
  for (const tid of tagIds) {
    where.push(`EXISTS (SELECT 1 FROM material_tags mt WHERE mt.material_id = m.id AND mt.tag_id = ?)`);
    params.push(tid);
  }
  const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) n FROM materials m ${cond}`).get(...params).n;
  const rows = db.prepare(`
    SELECT m.* FROM materials m ${cond}
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, (page - 1) * pageSize);
  res.json({ total, page, page_size: pageSize, items: rows.map(row2json) });
});

app.get('/api/materials/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM materials WHERE id = ?`).get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: '素材不存在' });
  res.json(row2json(row));
});

app.post('/api/materials/upload', upload.array('files', 20), async (req, res) => {
  const categoryId = req.body.category_id ? Number(req.body.category_id) : null;
  const results = [];
  const errors = [];
  for (const f of req.files || []) {
    const origName = fixName(f.originalname);
    const type = TYPE_OF(f.mimetype, origName);
    if (!type) {
      errors.push({ name: origName, error: '不支持的文件类型' });
      fs.unlinkSync(f.path);
      continue;
    }
    const ext = path.extname(origName).toLowerCase() || '';
    const fname = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
    const rel = path.join('media', type, fname);
    const abs = path.join(DATA_DIR, rel);
    fs.renameSync(f.path, abs);
    // 入库
    const name = origName.replace(/\.[^.]+$/, '');
    const info = db.prepare(`
      INSERT INTO materials (name, type, path, size, category_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, type, rel, f.size, categoryId);
    const id = Number(info.lastInsertRowid);
    // 元数据 + 缩略图（异步尽力而为）
    const meta = await probeMedia(type, abs);
    const thumb = await makeThumb(type, abs, id);
    db.prepare(`UPDATE materials SET width=?, height=?, duration=?, thumb=? WHERE id=?`)
      .run(meta.width ?? null, meta.height ?? null, meta.duration ?? null, thumb, id);
    const tags = req.body.tags ? setTagsOf(id, String(req.body.tags).split(',')) : [];
    results.push({ ...row2json(db.prepare(`SELECT * FROM materials WHERE id=?`).get(id)), tags });
  }
  res.status(errors.length && !results.length ? 400 : 200).json({ items: results, errors });
});

app.patch('/api/materials/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare(`SELECT * FROM materials WHERE id = ?`).get(id);
  if (!row) return res.status(404).json({ error: '素材不存在' });
  const { name, category_id, note, source, tags } = req.body || {};
  db.prepare(`
    UPDATE materials SET
      name = COALESCE(?, name),
      category_id = ?,
      note = COALESCE(?, note),
      source = COALESCE(?, source),
      updated_at = datetime('now', 'localtime')
    WHERE id = ?
  `).run(name ?? null, category_id === undefined ? row.category_id : (category_id || null), note ?? null, source ?? null, id);
  if (Array.isArray(tags)) setTagsOf(id, tags);
  res.json(row2json(db.prepare(`SELECT * FROM materials WHERE id = ?`).get(id)));
});

app.delete('/api/materials/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare(`SELECT * FROM materials WHERE id = ?`).get(id);
  if (!row) return res.status(404).json({ error: '素材不存在' });
  db.prepare(`DELETE FROM materials WHERE id = ?`).run(id);
  const abs = path.join(DATA_DIR, row.path);
  if (fs.existsSync(abs)) fs.unlinkSync(abs);
  deleteThumb(id);
  res.json({ ok: true });
});

/* ---------------- 分类 ---------------- */
app.get('/api/categories', (req, res) => {
  res.json(db.prepare(`
    SELECT c.*, COUNT(m.id) material_count FROM categories c
    LEFT JOIN materials m ON m.category_id = c.id
    GROUP BY c.id ORDER BY c.id
  `).all());
});
app.post('/api/categories', (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: '分类名不能为空' });
  try {
    const info = db.prepare(`INSERT INTO categories (name) VALUES (?)`).run(name);
    res.json({ id: Number(info.lastInsertRowid), name });
  } catch {
    res.status(409).json({ error: '分类已存在' });
  }
});
app.patch('/api/categories/:id', (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: '分类名不能为空' });
  try {
    db.prepare(`UPDATE categories SET name = ? WHERE id = ?`).run(name, Number(req.params.id));
    res.json({ ok: true });
  } catch {
    res.status(409).json({ error: '分类已存在' });
  }
});
app.delete('/api/categories/:id', (req, res) => {
  db.prepare(`DELETE FROM categories WHERE id = ?`).run(Number(req.params.id));
  res.json({ ok: true }); // 素材的 category_id 自动置空（ON DELETE SET NULL）
});

/* ---------------- 标签 ---------------- */
app.get('/api/tags', (req, res) => {
  const q = String(req.query.q || '').trim();
  const rows = q
    ? db.prepare(`SELECT t.*, COUNT(mt.material_id) n FROM tags t LEFT JOIN material_tags mt ON mt.tag_id=t.id WHERE t.name LIKE ? GROUP BY t.id ORDER BY n DESC LIMIT 20`).all(`%${q}%`)
    : db.prepare(`SELECT t.*, COUNT(mt.material_id) n FROM tags t LEFT JOIN material_tags mt ON mt.tag_id=t.id GROUP BY t.id ORDER BY n DESC LIMIT 50`).all();
  res.json(rows);
});

/* ---------------- 生产模式：托管前端构建产物 ---------------- */
const distDir = path.join(ROOT, 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api\/|media\/).*/, (req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

const PORT = Number(process.env.API_PORT) || 3001;
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(path.join(DATA_DIR, 'tmp'), { recursive: true });
  app.listen(PORT, () => console.log(`[api] 剪映素材库后端已启动: http://localhost:${PORT}`));
}

export default app;
