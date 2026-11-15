// 缩略图生成：图片用 macOS 自带 sips，视频用 ffmpeg 抽帧
import { execFile } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { THUMB_DIR } from './db.js';
import { FFMPEG, FFPROBE, SIPS } from './bin.js';

function run(cmd, args, timeout = 30000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${cmd} failed: ${stderr || err.message}`));
      else resolve(stdout);
    });
  });
}

// sips 仅 macOS 有；Linux 下图片处理自动回退到 ffmpeg
const HAS_SIPS = fs.existsSync(SIPS);

/** 为素材生成缩略图，返回缩略图相对路径（data/ 下），失败返回 null */
export async function makeThumb(type, absFilePath, materialId) {
  const out = path.join(THUMB_DIR, `${materialId}.jpg`);
  try {
    if (type === 'image' && HAS_SIPS) {
      // sips：等比缩到最长边 640，转 jpeg
      await run(SIPS, ['-Z', '640', '-s', 'format', 'jpeg', '-s', 'formatOptions', '80', absFilePath, '--out', out]);
    } else if (type === 'image' || type === 'video') {
      // ffmpeg：图片整帧缩放；视频第 1 秒抽帧，宽 640
      const pre = type === 'video' ? ['-ss', '1'] : [];
      await run(FFMPEG, ['-y', ...pre, '-i', absFilePath, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '3', out]);
    } else {
      return null; // 音频不生成缩略图，前端用图标
    }
    return fs.existsSync(out) ? `thumbs/${materialId}.jpg` : null;
  } catch (e) {
    console.error(`[thumb] material ${materialId}:`, e.message);
    return null;
  }
}

/** 提取媒体元数据：宽高 / 时长（尽力而为，失败返回空对象） */
export async function probeMedia(type, absFilePath) {
  const meta = {};
  try {
    if (type === 'image' && HAS_SIPS) {
      const w = await run(SIPS, ['-g', 'pixelWidth', absFilePath]);
      const h = await run(SIPS, ['-g', 'pixelHeight', absFilePath]);
      meta.width = Number(w.match(/pixelWidth:\s*(\d+)/)?.[1]) || null;
      meta.height = Number(h.match(/pixelHeight:\s*(\d+)/)?.[1]) || null;
    } else if (type === 'image' || type === 'video' || type === 'audio') {
      const out = await run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height', '-of', 'csv=p=0', absFilePath]).catch(() => '');
      const [w, h] = out.trim().split(',').map(Number);
      if (w) meta.width = w;
      if (h) meta.height = h;
      const dur = await run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1', absFilePath]).catch(() => '');
      const d = parseFloat(dur.trim());
      if (d > 0) meta.duration = Math.round(d * 10) / 10;
    }
  } catch { /* 元数据失败不阻断入库 */ }
  return meta;
}

export function deleteThumb(materialId) {
  const p = path.join(THUMB_DIR, `${materialId}.jpg`);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
