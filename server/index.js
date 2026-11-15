// 剪映素材库 · 后端服务（Express + node:sqlite）
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { db, DATA_DIR, MEDIA_DIR, ROOT, getTagsOf, setTagsOf } from './db.js';
import { makeThumb, probeMedia, deleteThumb } from './thumbs.js';
import { transcribeFile } from './transcribe.js';
import { FFMPEG } from './bin.js';

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
  const { type, category_id, q, tag_ids, origin } = req.query;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.page_size) || 24));
  const where = [];
  const params = [];
  if (type && ['video', 'image', 'audio'].includes(type)) { where.push(`m.type = ?`); params.push(type); }
  if (origin && ['user', 'hot'].includes(origin)) { where.push(`m.origin = ?`); params.push(origin); }
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
    SELECT m.*,
      (SELECT COUNT(*) FROM materials a WHERE a.derived_from = m.id AND a.type = 'audio') audio_count,
      (SELECT COUNT(*) FROM scripts s WHERE s.material_id = m.id) script_count
    FROM materials m ${cond}
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
  const origin = req.body.origin === 'hot' ? 'hot' : 'user';
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
      INSERT INTO materials (name, type, path, size, category_id, origin)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(name, type, rel, f.size, categoryId, origin);
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
  const { name, category_id, note, source, link, tags } = req.body || {};
  db.prepare(`
    UPDATE materials SET
      name = COALESCE(?, name),
      category_id = ?,
      note = COALESCE(?, note),
      source = COALESCE(?, source),
      link = COALESCE(?, link),
      updated_at = datetime('now', 'localtime')
    WHERE id = ?
  `).run(name ?? null, category_id === undefined ? row.category_id : (category_id || null), note ?? null, source ?? null, link ?? null, id);
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

/* ---------------- 爆款复刻：原素材加工（转音频 / 转写） ---------------- */
const runCmd = (cmd, args, timeout = 600000) => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) reject(new Error(stderr?.slice(-300) || err.message));
    else resolve(stdout);
  });
});

// 视频 → 音频素材（默认幂等；?force=1 删除旧音频强制重新提取）
app.post('/api/materials/:id/extract-audio', async (req, res) => {
  const id = Number(req.params.id);
  const force = req.query.force === '1' || req.body?.force === true;
  const row = db.prepare(`SELECT * FROM materials WHERE id = ?`).get(id);
  if (!row) return res.status(404).json({ error: '素材不存在' });
  if (row.type !== 'video') return res.status(400).json({ error: '只有视频素材需要提取音频' });
  const existing = db.prepare(`SELECT * FROM materials WHERE derived_from = ? AND type = 'audio'`).get(id);
  if (existing && !force) return res.json(row2json(existing));
  if (existing && force) {
    const oldAbs = path.join(DATA_DIR, existing.path);
    db.prepare(`DELETE FROM materials WHERE id = ?`).run(existing.id);
    if (fs.existsSync(oldAbs)) fs.unlinkSync(oldAbs);
  }
  const abs = path.join(DATA_DIR, row.path);
  if (!fs.existsSync(abs)) return res.status(400).json({ error: '源文件已丢失' });
  const fname = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.mp3`;
  const rel = path.join('media', 'audio', fname);
  try {
    const t0 = Date.now();
    await runCmd(FFMPEG, ['-y', '-i', abs, '-vn', '-c:a', 'libmp3lame', '-q:a', '4', path.join(DATA_DIR, rel)], 300000);
    const genMs = Date.now() - t0;
    const size = fs.statSync(path.join(DATA_DIR, rel)).size;
    const info = db.prepare(`
      INSERT INTO materials (name, type, path, size, duration, derived_from, source, gen_ms)
      VALUES (?, 'audio', ?, ?, ?, ?, ?, ?)
    `).run(`${row.name}（音频）`, rel, size, row.duration ?? null, id, `提取自素材 #${id}`, genMs);
    res.json(row2json(db.prepare(`SELECT * FROM materials WHERE id = ?`).get(Number(info.lastInsertRowid))));
  } catch (e) {
    try { fs.unlinkSync(path.join(DATA_DIR, rel)); } catch { /* 忽略 */ }
    res.status(500).json({ error: `转音频失败：${e.message}` });
  }
});

// 原素材 → 转写（默认幂等；?force=1 删除旧文稿强制重新转写，时间段级联删除）
app.post('/api/materials/:id/transcribe', async (req, res) => {
  const id = Number(req.params.id);
  const force = req.query.force === '1' || req.body?.force === true;
  const row = db.prepare(`SELECT * FROM materials WHERE id = ?`).get(id);
  if (!row) return res.status(404).json({ error: '素材不存在' });
  if (row.type !== 'video' && row.type !== 'audio') return res.status(400).json({ error: '只支持视频或音频素材' });
  const existing = db.prepare(`SELECT * FROM scripts WHERE material_id = ?`).get(id);
  if (existing && !force) return res.json(script2json(existing));
  if (existing && force) {
    db.prepare(`DELETE FROM scripts WHERE material_id = ?`).run(id);
  }
  const abs = path.join(DATA_DIR, row.path);
  if (!fs.existsSync(abs)) return res.status(400).json({ error: '源文件已丢失' });
  try {
    const t0 = Date.now();
    const { duration, segments } = await transcribeFile(abs);
    const genMs = Date.now() - t0;
    const transcript = segments.map(s => s.text).join('\n');
    const info = db.prepare(`
      INSERT INTO scripts (title, source_type, source_name, duration, material_id, transcript_text, gen_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(row.name, row.type, row.name, duration, id, transcript, genMs);
    const scriptId = Number(info.lastInsertRowid);
    const ins = db.prepare(`INSERT INTO segments (script_id, ord, start, end, text) VALUES (?, ?, ?, ?, ?)`);
    segments.forEach((s, i) => ins.run(scriptId, i, s.start, s.end, s.text));
    res.json(script2json(db.prepare(`SELECT * FROM scripts WHERE id = ?`).get(scriptId)));
  } catch (e) {
    res.status(500).json({ error: `转写失败：${e.message}` });
  }
});

// 原素材的衍生物：提取出的音频 + 关联文稿
app.get('/api/materials/:id/derivatives', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare(`SELECT * FROM materials WHERE id = ?`).get(id);
  if (!row) return res.status(404).json({ error: '素材不存在' });
  const audios = db.prepare(`SELECT * FROM materials WHERE derived_from = ? AND type = 'audio'`).all(id).map(row2json);
  const scripts = db.prepare(`
    SELECT s.*, COUNT(g.id) segment_count FROM scripts s
    LEFT JOIN segments g ON g.script_id = s.id
    WHERE s.material_id = ? GROUP BY s.id
  `).all(id);
  res.json({ audios, scripts });
});

/* ---------------- 爆款复刻：文稿与时间轴 ---------------- */
const script2json = (row) => row && ({
  ...row,
  segments: db.prepare(`SELECT id, ord, start, end, text FROM segments WHERE script_id = ? ORDER BY ord`).all(row.id),
});

// 上传视频/音频 → 转写 → 自动建文稿
const transcribeUpload = multer({ dest: path.join(DATA_DIR, 'tmp'), limits: { fileSize: 2 * 1024 * 1024 * 1024 } });
app.post('/api/transcribe', transcribeUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '缺少文件' });
  const origName = fixName(req.file.originalname);
  const type = TYPE_OF(req.file.mimetype, origName);
  if (type !== 'video' && type !== 'audio') {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: '只支持视频或音频文件' });
  }
  try {
    const { duration, segments } = await transcribeFile(req.file.path);
    const title = origName.replace(/\.[^.]+$/, '');
    const info = db.prepare(`INSERT INTO scripts (title, source_type, source_name, duration) VALUES (?, ?, ?, ?)`)
      .run(title, type, origName, duration);
    const scriptId = Number(info.lastInsertRowid);
    const ins = db.prepare(`INSERT INTO segments (script_id, ord, start, end, text) VALUES (?, ?, ?, ?, ?)`);
    segments.forEach((s, i) => ins.run(scriptId, i, s.start, s.end, s.text));
    res.json(script2json(db.prepare(`SELECT * FROM scripts WHERE id = ?`).get(scriptId)));
  } catch (e) {
    res.status(500).json({ error: `转写失败：${e.message}` });
  } finally {
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }
});

app.get('/api/scripts', (req, res) => {
  res.json(db.prepare(`
    SELECT s.*, COUNT(g.id) segment_count FROM scripts s
    LEFT JOIN segments g ON g.script_id = s.id
    GROUP BY s.id ORDER BY s.updated_at DESC
  `).all());
});

app.get('/api/scripts/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM scripts WHERE id = ?`).get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: '文稿不存在' });
  res.json(script2json(row));
});

// 新建空白文稿（无音频模式）
app.post('/api/scripts', (req, res) => {
  const title = String(req.body?.title || '').trim() || '未命名文稿';
  const info = db.prepare(`INSERT INTO scripts (title, source_type) VALUES (?, 'none')`).run(title);
  const id = Number(info.lastInsertRowid);
  // 默认给 6 段 × 3 秒
  const ins = db.prepare(`INSERT INTO segments (script_id, ord, start, end, text) VALUES (?, ?, ?, ?, '')`);
  for (let i = 0; i < 6; i++) ins.run(id, i, i * 3, (i + 1) * 3);
  res.json(script2json(db.prepare(`SELECT * FROM scripts WHERE id = ?`).get(id)));
});

// 整体保存：标题 + 全部时间段 + 背景素材
app.put('/api/scripts/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare(`SELECT * FROM scripts WHERE id = ?`).get(id);
  if (!row) return res.status(404).json({ error: '文稿不存在' });
  const { title, segments, bg_material_id } = req.body || {};
  db.prepare(`UPDATE scripts SET title = COALESCE(?, title), bg_material_id = ?, updated_at = datetime('now','localtime') WHERE id = ?`)
    .run(title ?? null, bg_material_id === undefined ? row.bg_material_id : (bg_material_id || null), id);
  if (Array.isArray(segments)) {
    db.prepare(`DELETE FROM segments WHERE script_id = ?`).run(id);
    const ins = db.prepare(`INSERT INTO segments (script_id, ord, start, end, text) VALUES (?, ?, ?, ?, ?)`);
    segments.forEach((s, i) => {
      const start = Number(s.start), end = Number(s.end);
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
        ins.run(id, i, start, end, String(s.text || ''));
      }
    });
    // 总时长 = 最后一段结束时间
    const maxEnd = db.prepare(`SELECT COALESCE(MAX(end), 0) m FROM segments WHERE script_id = ?`).get(id).m;
    db.prepare(`UPDATE scripts SET duration = ? WHERE id = ?`).run(maxEnd, id);
  }
  res.json(script2json(db.prepare(`SELECT * FROM scripts WHERE id = ?`).get(id)));
});

app.delete('/api/scripts/:id', (req, res) => {
  db.prepare(`DELETE FROM scripts WHERE id = ?`).run(Number(req.params.id));
  res.json({ ok: true });
});

/* ---------------- 剪映视频包导出 ---------------- */
const EXPORTS_DIR = path.join(DATA_DIR, 'exports');

const srtTime = (sec) => {
  const ms = Math.round(sec * 1000);
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor((ms % 3600000) / 60000))}:${p(Math.floor((ms % 60000) / 1000))},${p(ms % 1000, 3)}`;
};

// 一键生成剪映数字人视频包：字幕.srt + 口播文稿.txt + 背景素材 + 操作指引
app.post('/api/scripts/:id/video-package', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare(`SELECT * FROM scripts WHERE id = ?`).get(id);
  if (!row) return res.status(404).json({ error: '文稿不存在' });
  const segs = db.prepare(`SELECT start, end, text FROM segments WHERE script_id = ? ORDER BY ord`).all(id);
  const filled = segs.filter(s => s.text.trim());
  if (!filled.length) return res.status(400).json({ error: '文稿还没有文字内容，请先填写并保存' });

  const safe = row.title.replace(/[\/\\:*?"<>|]/g, '_').trim().slice(0, 40) || `文稿${id}`;
  const dir = path.join(EXPORTS_DIR, `${id}-${safe}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  // 1. 字幕 SRT（剪映「文本 → 本地字幕」导入后，数字人按时间轴念稿）
  const srt = filled.map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.text.trim()}`).join('\n\n') + '\n';
  fs.writeFileSync(path.join(dir, '字幕.srt'), '﻿' + srt);

  // 2. 口播文稿 TXT（完整文案备份，便于复制改写）
  const total = Math.max(...filled.map(s => s.end), 0);
  const txt = `《${row.title}》口播文稿\n共 ${filled.length} 句 · 总时长 ${total.toFixed(1)}s\n${'='.repeat(32)}\n\n`
    + filled.map((s, i) => `【第 ${i + 1} 句】${s.start.toFixed(1)}s - ${s.end.toFixed(1)}s\n${s.text.trim()}`).join('\n\n') + '\n';
  fs.writeFileSync(path.join(dir, '口播文稿.txt'), '﻿' + txt);

  // 3. 背景素材副本（视频或图片，铺底用）
  let bgFile = null;
  if (row.bg_material_id) {
    const m = db.prepare(`SELECT * FROM materials WHERE id = ?`).get(row.bg_material_id);
    if (m) {
      const abs = path.join(DATA_DIR, m.path);
      if (fs.existsSync(abs)) {
        bgFile = `背景素材${path.extname(m.path).toLowerCase()}`;
        fs.copyFileSync(abs, path.join(dir, bgFile));
      }
    }
  }

  // 4. 剪映操作指引
  const guide = [
    `《${row.title}》剪映数字人成片步骤`,
    ``,
    `1. 打开剪映专业版 → 新建项目`,
    bgFile
      ? `2. 把本文件夹的「${bgFile}」拖进轨道铺底，长度拉到 ${total.toFixed(0)} 秒`
      : `2. 在剪映里选一个背景视频/图片拖进轨道铺底，长度拉到 ${total.toFixed(0)} 秒`,
    `3. 顶部菜单「文本」→「本地字幕」→ 导入本文件夹的「字幕.srt」`,
    `4. 在右侧字幕列表里全选所有字幕（点第一条，Shift 点最后一条）`,
    `5. 点「数字人」→ 选形象、选音色 → 数字人会按字幕时间轴自动口播`,
    `6. 检查一遍字幕换行和数字人位置，导出即可`,
    ``,
    `提示：口播文稿.txt 是完整文案，临时改词可以直接从里面复制。`,
    ``,
  ].join('\n');
  fs.writeFileSync(path.join(dir, '剪映操作指引.txt'), '﻿' + guide);

  res.json({ ok: true, dir, files: fs.readdirSync(dir).sort(), hasBg: !!bgFile, duration: total });
});

// 在访达中打开导出目录（仅限 exports 目录之内，防越权）
app.post('/api/open-export', (req, res) => {
  const dir = path.resolve(String(req.body?.dir || ''));
  const base = path.resolve(EXPORTS_DIR);
  if (!dir.startsWith(base + path.sep) || !fs.existsSync(dir)) {
    return res.status(400).json({ error: '目录不存在或不允许打开' });
  }
  spawn('open', [dir], { detached: true, stdio: 'ignore' }).unref();
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
