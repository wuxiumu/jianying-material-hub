// 外部命令路径解析：预览卡片启动的服务 PATH 不含 /opt/homebrew/bin，必须兜底绝对路径
import fs from 'node:fs';

const SEARCH = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];

export function resolveBin(name) {
  for (const dir of SEARCH) {
    const p = `${dir}/${name}`;
    if (fs.existsSync(p)) return p;
  }
  return name; // 实在找不到就交给 PATH，报错信息会带 ENOENT
}

export const FFMPEG = resolveBin('ffmpeg');
export const FFPROBE = resolveBin('ffprobe');
export const SIPS = resolveBin('sips');
