// 语音转写：ffmpeg 提取 16k WAV → whisper-cli（本机 Metal 加速）→ 带时间戳分段
import { execFile } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { FFMPEG, FFPROBE } from './bin.js';

// 可用环境变量覆盖（Linux 部署时用 .env 或 systemd Environment 配置）
const WHISPER = process.env.WHISPER_CLI || '/opt/homebrew/bin/whisper-cli';
const MODEL = process.env.WHISPER_MODEL || '/Users/m6mini/Documents/kimi/models/ggml-small.bin';

function run(cmd, args, timeout = 600000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr?.slice(-500) || err.message));
      else resolve(stdout);
    });
  });
}

/**
 * 转写视频/音频文件，返回 { duration, segments: [{start, end, text}] }（秒）
 * 失败抛出带中文说明的错误
 */
export async function transcribeFile(inputPath) {
  if (!fs.existsSync(MODEL)) throw new Error(`whisper 模型不存在：${MODEL}`);
  const tmpId = crypto.randomBytes(6).toString('hex');
  const wav = path.join(os.tmpdir(), `jmh-${tmpId}.wav`);
  const outBase = path.join(os.tmpdir(), `jmh-${tmpId}-out`);
  try {
    // 1) 统一转 16k 单声道 WAV
    await run(FFMPEG, ['-y', '-i', inputPath, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav], 120000);
    // 2) 时长
    let duration = 0;
    try {
      const d = await run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', wav]);
      duration = Math.round(parseFloat(d.trim()) * 10) / 10 || 0;
    } catch { /* 尽力而为 */ }
    // 3) whisper 转写（-ml 20 控制分段长度，中文约一句一段）
    await run(WHISPER, ['-m', MODEL, '-f', wav, '-l', 'zh', '-ml', '20', '-oj', '-of', outBase]);
    const jsonPath = `${outBase}.json`;
    if (!fs.existsSync(jsonPath)) throw new Error('whisper 未产出结果文件');
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const segments = (data.transcription || [])
      .map(s => ({
        start: Math.round(s.offsets.from / 100) / 10,
        end: Math.round(s.offsets.to / 100) / 10,
        text: String(s.text || '').trim(),
      }))
      .filter(s => s.text && s.end > s.start);
    if (!segments.length) throw new Error('没有识别到语音内容，请确认文件含中文人声');
    fs.unlinkSync(jsonPath);
    return { duration, segments };
  } finally {
    for (const f of [wav, `${outBase}.json`]) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* 忽略 */ }
    }
  }
}
