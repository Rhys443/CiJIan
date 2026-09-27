/* ============================================================
   bg:// 协议 —— 把 userData/background/ 里的文件当成正常响应吐回去

   为什么需要自定义协议，而不是直接用 file://
   file:// 页面读别的本地文件在 Chromium 里默认受限；自定义协议既绕开这个限制，
   也能在主进程里挡住目录穿越（这是唯一一道闸）。

   为什么单独成一个文件
   dev/shot.js 自己建窗口用 desktopCapturer 截图，它不加载 main.js。
   协议注册原本只写在 main.js 里，于是截图工具里 bg:// 是个**无人处理的 scheme** ——
   图片和视频底图一律加载失败，现场只看到 hasBackground:false 和
   「MEDIA_ELEMENT_ERROR: Format error」，看上去像产品坏了，其实是工具缺了一半。
   抽出来之后两边注册的是同一份实现，工具里量到的就是用户会遇到的。
   ============================================================ */
'use strict';

const { app, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp',
  '.mp4': 'video/mp4', '.m4v': 'video/x-m4v', '.mov': 'video/quicktime',
  '.webm': 'video/webm', '.ogv': 'video/ogg',
};

const bgDir = () => path.join(app.getPath('userData'), 'background');

/* 把请求的文件名解析到 background 目录内。
   解析后的路径必须仍在目录里，否则返回 null —— 防 ../ 穿越。 */
function resolveBgPath(name) {
  const dir = bgDir();
  const full = path.resolve(dir, path.basename(String(name || '')));
  return full.startsWith(dir + path.sep) ? full : null;
}

/* 必须在 app ready **之前**调用，否则 stream / secure 这些特权不生效。 */
function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'bg',
      privileges: {
        standard: true, secure: true, supportFetchAPI: true, stream: true,
        /* corsEnabled 是必需的，不是可选的。
           页面跑在 file:// 下，bg:// 对它来说是**另一个源**：
           不加这个特权，<img>/<video> 拿到的就是「被污染」的资源，
           WebGL 的 texImage2D 会直接抛
           「The video element contains cross-origin data」——
           每一帧都抛，纹理永远是空的，画面全黑。
           现象极具迷惑性：readyState>=2、backgroundReady=true、uBgMode=1，
           只有画面是黑的。所以「上传自己的底图」整条功能曾经是坏的，
           而程序化预设（canvas 直接当纹理）完全正常，一直没被发现。 */
        corsEnabled: true,
      },
    },
  ]);
}

/* 允许页面（file:// 的 origin 是 "null"）跨源取用。
   配合渲染进程里给 <img>/<video> 设置的 crossOrigin="anonymous" 一起生效：
   两个都做，资源才算 CORS 干净，才能进 WebGL 纹理和 canvas。 */
const CORS = { 'access-control-allow-origin': '*' };

function registerHandler() {
  protocol.handle('bg', async (request) => {
    try {
      const name = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '');
      const full = resolveBgPath(name);
      if (!full) return new Response('forbidden', { status: 403 });

      const st = await fs.promises.stat(full);
      const type = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
      const range = request.headers.get('range');
      const m = range && /^bytes=(\d*)-(\d*)\s*$/.exec(range.trim());

      /* 自己实现 Range，不能用 net.fetch 转发请求头 ——
         实测 net.fetch 对 file: 会**忽略** Range，一律返回 200 且不带
         Content-Range，等于没转发。而这一段是必需的：
         手机拍的 MP4 常常把 moov atom 放在文件尾部，浏览器必须先发
         Range 请求把尾部拿回来才能起播；没有 206 就得把整个文件下完。
         本地文件也逃不掉，只是慢一点、不那么明显。
         用流式响应，不把整个文件读进内存 —— 上限 200 MB。 */
      if (m) {
        let start, end;
        if (m[1] === '') {
          // bytes=-N：最后 N 个字节
          const n = parseInt(m[2], 10) || 0;
          start = Math.max(0, st.size - n);
          end = st.size - 1;
        } else {
          start = parseInt(m[1], 10);
          end = m[2] === '' ? st.size - 1 : Math.min(parseInt(m[2], 10), st.size - 1);
        }
        if (!Number.isFinite(start) || start > end || start >= st.size) {
          return new Response(null, {
            status: 416,
            headers: { 'content-range': 'bytes */' + st.size },
          });
        }
        return new Response(Readable.toWeb(fs.createReadStream(full, { start, end })), {
          status: 206,
          headers: Object.assign({
            'content-type': type,
            'content-length': String(end - start + 1),
            'content-range': 'bytes ' + start + '-' + end + '/' + st.size,
            'accept-ranges': 'bytes',
          }, CORS),
        });
      }

      return new Response(Readable.toWeb(fs.createReadStream(full)), {
        status: 200,
        headers: Object.assign({
          'content-type': type,
          'content-length': String(st.size),
          'accept-ranges': 'bytes',
        }, CORS),
      });
    } catch (e) {
      return new Response('bad request', { status: 400 });
    }
  });
}

module.exports = { bgDir, resolveBgPath, registerScheme, registerHandler };
