/* ============================================================
   此间 · 程序化「照片」生成器
   Demo 里没有真实相机，用 Canvas 生成 8 种胶片感的画面，
   保证回顾页/相纸墙一打开就有内容可看（不依赖任何外部图片）。
   ============================================================ */
(function (global) {
  'use strict';

  const { mulberry32 } = global.CJ.utils;

  const PALETTES = [
    { name: '晨雾', sky: ['#e9eef2', '#cfd9df', '#b3c1c9'], sun: '#fdf6e8', accent: '#7d8f95', ground: '#54606a', grade: 'rgba(120,140,150,0.14)' },
    { name: '黄昏', sky: ['#f7d9b0', '#eaa877', '#c9724f'], sun: '#fff0cf', accent: '#8a4d38', ground: '#4a2f2a', grade: 'rgba(210,120,70,0.16)' },
    { name: '窗光', sky: ['#fbf3e6', '#f0e2cd', '#dcc6a8'], sun: '#fffaf0', accent: '#b08a5c', ground: '#7a5f45', grade: 'rgba(220,180,120,0.14)' },
    { name: '苔绿', sky: ['#e6ecdf', '#cfdcc4', '#a9bd9d'], sun: '#f6f4d8', accent: '#5b6e4c', ground: '#3d4a34', grade: 'rgba(110,140,90,0.15)' },
    { name: '夜灯', sky: ['#2b2f3c', '#1f2430', '#161a24'], sun: '#f6dfa6', accent: '#4a5468', ground: '#10131a', grade: 'rgba(60,70,110,0.2)' },
    { name: '素纸', sky: ['#faf6ef', '#f2ebe0', '#e6dbcb'], sun: '#ffffff', accent: '#c8b49a', ground: '#a8957c', grade: 'rgba(190,170,140,0.12)' },
    { name: '藕紫', sky: ['#f0e6ee', '#dcc8dc', '#bda2c0'], sun: '#fdf3f8', accent: '#7d6a8f', ground: '#584a66', grade: 'rgba(150,110,160,0.15)' },
    { name: '蜜橘', sky: ['#ffe9c9', '#f9c887', '#e2913f'], sun: '#fff8e6', accent: '#b06a25', ground: '#6d431c', grade: 'rgba(230,160,70,0.16)' },
  ];

  function roundRect(ctx, x, y, w, hh, r) {
    const rr = Math.min(r, w / 2, hh / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + hh, rr);
    ctx.arcTo(x + w, y + hh, x, y + hh, rr);
    ctx.arcTo(x, y + hh, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  /* ---------- 预烘噪点瓦片 ----------
     逐像素调用 rnd() 处理 27 万像素会明显卡主线程；
     改成预生成 3 张 128×128 的噪声瓦片，再用 createPattern 平铺，
     成本从 O(像素) 降到 O(瓦片)，视觉上几乎无差别。 */
  const NOISE_TILES = [];
  function noiseTile(i) {
    if (NOISE_TILES[i]) return NOISE_TILES[i];
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const cx = c.getContext('2d');
    const img = cx.createImageData(128, 128);
    const rnd = mulberry32(9781 + i * 7717);
    for (let k = 0; k < img.data.length; k += 4) {
      const v = 128 + (rnd() - 0.5) * 255;
      img.data[k] = v;
      img.data[k + 1] = v;
      img.data[k + 2] = v;
      img.data[k + 3] = 255;
    }
    cx.putImageData(img, 0, 0);
    NOISE_TILES[i] = c;
    return c;
  }

  /** 亮度加权的颗粒：中间调最多、暗部与高光干净 —— 这是"像胶片"与"像脏屏幕"的分界 */
  function grain(ctx, w, hh, tileIndex, amount = 20) {
    const img = ctx.getImageData(0, 0, w, hh);
    const data = img.data;
    const nx = ctx.createPattern(noiseTile(tileIndex), 'repeat');
    const src = noiseTile(tileIndex).getContext('2d').getImageData(0, 0, 128, 128).data;
    for (let y = 0; y < hh; y += 1) {
      const ty = (y & 127) * 128;
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 4;
        const lum = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
        // 中间调权重最高（L·(1-L)×4 的经典响应）
        const weight = 4 * lum * (1 - lum) * 0.8 + 0.2;
        const n = (src[(ty + (x & 127)) * 4] - 128) * (amount / 128) * weight;
        data[i] = clamp255(data[i] + n);
        data[i + 1] = clamp255(data[i + 1] + n * 0.96);
        data[i + 2] = clamp255(data[i + 2] + n * 1.05);
      }
    }
    ctx.putImageData(img, 0, 0);
    void nx;
  }

  const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

  /* ---------- 胶片色调曲线（256×1 逐通道 spline LUT） ----------
     灵感来自 evanw/glfx.js 的 curves.js：先生成查找表，再一次遍历完成
     色彩映射，比 soft-light 叠加更接近真实胶片的肩部与趾部。 */
  function buildLUT(points) {
    const lut = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) {
      const x = i / 255;
      let j = 0;
      while (j < points.length - 2 && x > points[j + 1][0]) j += 1;
      const [x0, y0] = points[j];
      const [x1, y1] = points[j + 1];
      const t = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
      const s = t * t * (3 - 2 * t); // smoothstep，避免折线感
      lut[i] = clamp255(Math.round((y0 + (y1 - y0) * s) * 255));
    }
    return lut;
  }

  const R_CURVE = buildLUT([
    [0, 0.035],
    [0.22, 0.185],
    [0.5, 0.53],
    [0.78, 0.81],
    [1, 0.965],
  ]);
  const G_CURVE = buildLUT([
    [0, 0.028],
    [0.22, 0.175],
    [0.5, 0.515],
    [0.78, 0.8],
    [1, 0.96],
  ]);
  const B_CURVE = buildLUT([
    [0, 0.05],
    [0.22, 0.205],
    [0.5, 0.545],
    [0.78, 0.815],
    [1, 0.95],
  ]);

  function applyCurves(ctx, w, hh) {
    const img = ctx.getImageData(0, 0, w, hh);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = R_CURVE[d[i]];
      d[i + 1] = G_CURVE[d[i + 1]];
      d[i + 2] = B_CURVE[d[i + 2]];
    }
    ctx.putImageData(img, 0, 0);
  }

  /** 红晕（halation）：亮部溢出 + 暖色 + 高斯模糊 + screen 叠加 */
  function halation(ctx, w, hh) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = hh;
    const cx = c.getContext('2d');
    cx.filter = 'brightness(1.5) contrast(3.4) saturate(0)';
    cx.drawImage(ctx.canvas, 0, 0);
    cx.filter = 'none';
    cx.globalCompositeOperation = 'multiply';
    cx.fillStyle = 'rgba(255, 168, 116, 1)';
    cx.fillRect(0, 0, w, hh);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.3;
    ctx.filter = 'blur(12px)';
    ctx.drawImage(c, 0, 0);
    ctx.restore();
  }

  function vignette(ctx, w, hh, strength = 0.42) {
    const g = ctx.createRadialGradient(w * 0.5, hh * 0.46, Math.min(w, hh) * 0.28, w * 0.5, hh * 0.5, Math.max(w, hh) * 0.78);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(28,20,14,${strength})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, hh);
  }

  function grade(ctx, w, hh, color) {
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, hh);
    ctx.restore();
  }

  function lightLeak(ctx, w, hh, rnd, pal) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const g = ctx.createLinearGradient(w, 0, w * 0.35, hh);
    g.addColorStop(0, 'rgba(255,196,140,0.55)');
    g.addColorStop(0.45, 'rgba(255,150,110,0.18)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(w, 0);
    ctx.lineTo(w * (0.62 + rnd() * 0.16), 0);
    ctx.lineTo(w * (0.3 + rnd() * 0.1), hh);
    ctx.lineTo(w, hh);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    void pal;
  }

  function softCircle(ctx, x, y, r, color, alpha = 1) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /* ---------------- 8 种画面 ---------------- */

  function sceneHorizon(ctx, w, hh, pal, rnd) {
    const horizon = hh * (0.55 + rnd() * 0.12);
    const g = ctx.createLinearGradient(0, 0, 0, hh);
    g.addColorStop(0, pal.sky[0]);
    g.addColorStop(0.5, pal.sky[1]);
    g.addColorStop(1, pal.sky[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, hh);

    const sunX = w * (0.24 + rnd() * 0.52);
    const sunY = horizon - hh * (0.1 + rnd() * 0.16);
    softCircle(ctx, sunX, sunY, Math.min(w, hh) * 0.2, pal.sun, 0.85);
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = pal.sun;
    ctx.beginPath();
    ctx.arc(sunX, sunY, Math.min(w, hh) * 0.055, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 层叠远山
    const layers = 3;
    for (let l = 0; l < layers; l += 1) {
      const t = l / (layers - 1 || 1);
      const base = horizon + t * hh * 0.08;
      const amp = hh * (0.05 + t * 0.05);
      ctx.beginPath();
      ctx.moveTo(-10, hh);
      ctx.lineTo(-10, base);
      let x = -10;
      while (x < w + 20) {
        const step = w * (0.1 + rnd() * 0.14);
        const cx = x + step / 2;
        const cy = base - amp * (0.35 + rnd() * 0.9) * (1 - t * 0.35);
        ctx.quadraticCurveTo(cx, cy, x + step, base - amp * (rnd() - 0.5) * 0.4);
        x += step;
      }
      ctx.lineTo(w + 10, hh);
      ctx.closePath();
      ctx.fillStyle = `rgba(${hexToRgb(pal.ground)}, ${(0.24 + t * 0.3).toFixed(2)})`;
      ctx.fill();
    }
    ctx.fillStyle = `rgba(${hexToRgb(pal.ground)}, 0.72)`;
    ctx.fillRect(0, hh * 0.9, w, hh * 0.1);
  }

  function sceneSkyline(ctx, w, hh, pal, rnd) {
    const g = ctx.createLinearGradient(0, 0, 0, hh);
    g.addColorStop(0, pal.sky[0]);
    g.addColorStop(0.62, pal.sky[1]);
    g.addColorStop(1, pal.sky[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, hh);
    softCircle(ctx, w * (0.3 + rnd() * 0.4), hh * 0.42, Math.min(w, hh) * 0.28, pal.sun, 0.5);

    const baseY = hh * 0.82;
    let x = -10;
    while (x < w + 10) {
      const bw = w * (0.045 + rnd() * 0.075);
      const bh = hh * (0.1 + rnd() * 0.34);
      ctx.fillStyle = `rgba(${hexToRgb(pal.ground)}, ${0.5 + rnd() * 0.4})`;
      ctx.fillRect(x, baseY - bh, bw, bh);
      // 亮着的窗
      const cols = Math.max(1, Math.floor(bw / (w * 0.022)));
      const rows = Math.max(1, Math.floor(bh / (hh * 0.045)));
      for (let c = 0; c < cols; c += 1) {
        for (let r = 0; r < rows; r += 1) {
          if (rnd() > 0.68) {
            ctx.fillStyle = `rgba(255, 226, 168, ${0.35 + rnd() * 0.5})`;
            ctx.fillRect(
              x + c * (bw / cols) + bw / cols * 0.28,
              baseY - bh + r * (bh / rows) + bh / rows * 0.26,
              Math.max(1.4, (bw / cols) * 0.4),
              Math.max(1.4, (bh / rows) * 0.38)
            );
          }
        }
      }
      x += bw + w * 0.008;
    }
    ctx.fillStyle = `rgba(${hexToRgb(pal.ground)}, 0.9)`;
    ctx.fillRect(0, baseY, w, hh - baseY);
  }

  function sceneWindow(ctx, w, hh, pal, rnd) {
    ctx.fillStyle = pal.sky[2];
    ctx.fillRect(0, 0, w, hh);
    // 窗外天空
    const pad = w * 0.14;
    const g = ctx.createLinearGradient(0, pad, 0, hh * 0.7);
    g.addColorStop(0, pal.sky[0]);
    g.addColorStop(1, pal.sun);
    ctx.fillStyle = g;
    ctx.fillRect(pad, pad, w - pad * 2, hh * 0.62);
    softCircle(ctx, w * (0.35 + rnd() * 0.3), hh * 0.34, Math.min(w, hh) * 0.16, '#ffffff', 0.7);
    // 远处的树
    ctx.fillStyle = `rgba(${hexToRgb(pal.accent)}, 0.5)`;
    for (let i = 0; i < 5; i += 1) {
      const tx = pad + rnd() * (w - pad * 2);
      const ty = hh * 0.7;
      ctx.beginPath();
      ctx.arc(tx, ty - hh * 0.06, w * (0.03 + rnd() * 0.05), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(tx - 1.2, ty - hh * 0.06, 2.4, hh * 0.08);
    }
    // 窗框
    ctx.strokeStyle = `rgba(${hexToRgb(pal.ground)}, 0.85)`;
    ctx.lineWidth = Math.max(4, w * 0.022);
    ctx.strokeRect(pad, pad, w - pad * 2, hh * 0.62);
    ctx.beginPath();
    ctx.moveTo(w / 2, pad);
    ctx.lineTo(w / 2, pad + hh * 0.62);
    ctx.moveTo(pad, pad + hh * 0.31);
    ctx.lineTo(w - pad, pad + hh * 0.31);
    ctx.stroke();
    // 窗台与影子
    ctx.fillStyle = `rgba(${hexToRgb(pal.ground)}, 0.32)`;
    ctx.fillRect(0, hh * 0.76, w, hh * 0.24);
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = 'rgba(255,244,222,0.8)';
    ctx.beginPath();
    ctx.moveTo(pad * 1.1, hh * 0.76);
    ctx.lineTo(w - pad, hh * 0.76);
    ctx.lineTo(w - pad * 0.2, hh);
    ctx.lineTo(pad * 2, hh);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function sceneLeaf(ctx, w, hh, pal, rnd) {
    const g = ctx.createLinearGradient(0, 0, w, hh);
    g.addColorStop(0, pal.sky[0]);
    g.addColorStop(1, pal.sky[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, hh);
    const leaves = 5 + Math.floor(rnd() * 4);
    for (let i = 0; i < leaves; i += 1) {
      const cx = w * (0.16 + rnd() * 0.68);
      const cy = hh * (0.16 + rnd() * 0.68);
      const len = Math.min(w, hh) * (0.14 + rnd() * 0.24);
      const ang = rnd() * Math.PI * 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ang);
      ctx.globalAlpha = 0.42 + rnd() * 0.4;
      ctx.fillStyle = i % 2 ? pal.accent : pal.ground;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(len * 0.45, -len * 0.42, len, 0);
      ctx.quadraticCurveTo(len * 0.45, len * 0.42, 0, 0);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.42)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(len, 0);
      ctx.stroke();
      ctx.restore();
    }
    softCircle(ctx, w * 0.76, hh * 0.2, Math.min(w, hh) * 0.34, 'rgba(255,250,230,0.85)', 0.8);
  }

  function sceneTable(ctx, w, hh, pal, rnd) {
    const g = ctx.createLinearGradient(0, 0, 0, hh);
    g.addColorStop(0, pal.sky[0]);
    g.addColorStop(1, pal.sky[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, hh);
    // 桌面
    ctx.fillStyle = `rgba(${hexToRgb(pal.accent)}, 0.72)`;
    ctx.beginPath();
    ctx.moveTo(0, hh * 0.62);
    ctx.lineTo(w, hh * 0.5);
    ctx.lineTo(w, hh);
    ctx.lineTo(0, hh);
    ctx.closePath();
    ctx.fill();
    // 斜射的光带
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = 'rgba(255,246,224,0.5)';
    ctx.beginPath();
    ctx.moveTo(w * (0.1 + rnd() * 0.1), 0);
    ctx.lineTo(w * (0.34 + rnd() * 0.1), 0);
    ctx.lineTo(w * (0.62 + rnd() * 0.1), hh);
    ctx.lineTo(w * (0.3 + rnd() * 0.1), hh);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // 杯子
    const cx = w * (0.3 + rnd() * 0.4);
    const cy = hh * (0.58 + rnd() * 0.08);
    const cw = Math.min(w, hh) * 0.24;
    const ch = cw * 0.82;
    ctx.fillStyle = pal.sky[0];
    roundRect(ctx, cx - cw / 2, cy - ch, cw, ch, cw * 0.12);
    ctx.fill();
    ctx.strokeStyle = `rgba(${hexToRgb(pal.ground)},0.5)`;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx, cy - ch, cw / 2, cw * 0.11, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${hexToRgb(pal.ground)},0.35)`;
    ctx.fill();
    // 影子
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = pal.ground;
    ctx.beginPath();
    ctx.ellipse(cx + cw * 0.3, cy + ch * 0.1, cw * 0.85, ch * 0.16, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    softCircle(ctx, w * 0.82, hh * 0.16, Math.min(w, hh) * 0.26, 'rgba(255,248,228,0.9)', 0.75);
  }

  function sceneBokeh(ctx, w, hh, pal, rnd) {
    const g = ctx.createLinearGradient(0, 0, w, hh);
    g.addColorStop(0, pal.sky[1]);
    g.addColorStop(0.6, pal.sky[2]);
    g.addColorStop(1, pal.ground);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, hh);
    const colors = ['rgba(255,232,190,0.9)', 'rgba(255,196,150,0.75)', 'rgba(255,255,255,0.7)', 'rgba(214,160,210,0.5)'];
    for (let i = 0; i < 16; i += 1) {
      softCircle(
        ctx,
        w * rnd(),
        hh * rnd(),
        Math.min(w, hh) * (0.05 + rnd() * 0.16),
        colors[i % colors.length],
        0.35 + rnd() * 0.5
      );
    }
  }

  function sceneLamp(ctx, w, hh, pal, rnd) {
    const g = ctx.createLinearGradient(0, 0, 0, hh);
    g.addColorStop(0, pal.sky[0]);
    g.addColorStop(1, pal.sky[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, hh);
    const lampX = w * (0.26 + rnd() * 0.44);
    const lampY = hh * (0.2 + rnd() * 0.14);
    // 灯杆
    ctx.strokeStyle = `rgba(${hexToRgb(pal.accent)},0.85)`;
    ctx.lineWidth = Math.max(3, w * 0.012);
    ctx.beginPath();
    ctx.moveTo(lampX, lampY);
    ctx.lineTo(lampX, hh * (0.72 + rnd() * 0.1));
    ctx.stroke();
    // 灯头
    ctx.fillStyle = pal.sun;
    ctx.beginPath();
    ctx.ellipse(lampX, lampY, w * 0.045, hh * 0.03, 0, 0, Math.PI * 2);
    ctx.fill();
    softCircle(ctx, lampX, lampY + hh * 0.03, Math.min(w, hh) * 0.42, 'rgba(255,226,160,0.85)', 0.8);
    // 地面与光池
    ctx.fillStyle = `rgba(${hexToRgb(pal.ground)}, 0.85)`;
    ctx.fillRect(0, hh * 0.82, w, hh * 0.18);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = 'rgba(255,226,160,0.35)';
    ctx.beginPath();
    ctx.ellipse(lampX, hh * 0.88, w * 0.32, hh * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function sceneField(ctx, w, hh, pal, rnd) {
    const g = ctx.createLinearGradient(0, 0, w, hh);
    g.addColorStop(0, pal.sky[0]);
    g.addColorStop(0.55, pal.sky[1]);
    g.addColorStop(1, pal.sky[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, hh);
    const bands = 5 + Math.floor(rnd() * 3);
    for (let i = 0; i < bands; i += 1) {
      const t = i / bands;
      ctx.save();
      ctx.globalAlpha = 0.16 + t * 0.42;
      ctx.fillStyle = i % 2 ? pal.accent : pal.ground;
      ctx.beginPath();
      ctx.moveTo(-10, hh * (0.3 + t * 0.6));
      let x = -10;
      while (x < w + 20) {
        const step = w * (0.18 + rnd() * 0.2);
        ctx.quadraticCurveTo(x + step / 2, hh * (0.3 + t * 0.6) + (rnd() - 0.5) * hh * 0.1, x + step, hh * (0.3 + t * 0.6));
        x += step;
      }
      ctx.lineTo(w + 10, hh + 10);
      ctx.lineTo(-10, hh + 10);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    softCircle(ctx, w * (0.2 + rnd() * 0.6), hh * 0.18, Math.min(w, hh) * 0.3, pal.sun, 0.6);
  }

  const SCENES = [sceneHorizon, sceneSkyline, sceneWindow, sceneLeaf, sceneTable, sceneBokeh, sceneLamp, sceneField];
  const SCENE_NAMES = ['地平线', '城市', '窗', '叶', '桌面', '光斑', '路灯', '原野'];

  const cache = new Map();

  /**
   * 生成一张"照片"
   * @param {number} seed 决定画面内容（同 seed 永远同图）
   * @param {number} size 边长
   * @returns {string} dataURL
   */
  function photo(seed, size = 520) {
    const key = `${seed}:${size}`;
    if (cache.has(key)) return cache.get(key);
    const rnd = mulberry32((seed || 1) * 2654435761);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const pal = PALETTES[Math.floor(rnd() * PALETTES.length)];
    const scene = SCENES[Math.floor(rnd() * SCENES.length)];

    ctx.save();
    scene(ctx, size, size, pal, rnd);
    ctx.restore();

    // 统一的胶片处理：调色 → 边角压暗 → 高光晕 → 偶尔漏光 → 颗粒
    grade(ctx, size, size, pal.grade);
    vignette(ctx, size, size, 0.34 + rnd() * 0.16);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const bloom = ctx.createRadialGradient(size * 0.34, size * 0.3, 0, size * 0.34, size * 0.3, size * 0.72);
    bloom.addColorStop(0, 'rgba(255,246,228,0.26)');
    bloom.addColorStop(1, 'rgba(255,246,228,0)');
    ctx.fillStyle = bloom;
    ctx.fillRect(0, 0, size, size);
    ctx.restore();
    if (rnd() > 0.55) lightLeak(ctx, size, size, rnd, pal);
    grain(ctx, size, size, rnd, 13);

    const url = canvas.toDataURL('image/jpeg', 0.86);
    cache.set(key, url);
    return url;
  }

  function photoMeta(seed) {
    const rnd = mulberry32((seed || 1) * 2654435761);
    const pal = PALETTES[Math.floor(rnd() * PALETTES.length)];
    const scene = SCENES[Math.floor(rnd() * SCENES.length)];
    const idx = SCENES.indexOf(scene);
    return { palette: pal.name, scene: SCENE_NAMES[idx] };
  }

  /** 把用户选中的真实图片压成相纸尺寸的 dataURL */
  /* 把用户上传的图规范成一张方形相纸。
     三处都是为「可用级」补的：

     1. **尺寸和体积压下来**（720/q0.88 → 560/q0.80）。
        整个 state 是塞进**一个** localStorage 键的，而 Chromium 每源配额
        约 5MB。原来一张约 110–250KB，十五张就顶到天花板，一旦写不进去，
        不只是这张照片没了 —— 之后所有写入（设置、抽卡、打卡）全部失效。
        压到约 45–70KB 后，十五张加文字也只有 1MB 出头，留足余量。

     2. **解码前先卡体积**。以前选一张 30MB / 5000 万像素的图，
        渲染进程会先按原分辨率整个解码再缩，卡好几秒甚至 OOM。

     3. **onload 里整体包 try/catch**。
        side 可能算成 0（宽或高为 0 的畸形图、width="0" 的 SVG），
        于是 drawImage 抛 IndexSizeError。那个异常抛在事件回调里、
        不在 Promise 执行器内，所以 resolve 和 reject 都不会被调用 ——
        Promise 永久挂起，界面表现为「点了没反应」，连错误提示都没有。 */
  function normalizeUpload(file, size = 560) {
    return new Promise((resolve, reject) => {
      const MAX_BYTES = 24 * 1024 * 1024;
      if (!file) { reject(new Error('没有选择文件')); return; }
      if (file.size > MAX_BYTES) {
        reject(new Error('图片超过 24 MB，换一张小一点的'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          try {
            const side = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);
            if (!side || side < 1) throw new Error('这张图片读不出尺寸');
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            const sx = ((img.naturalWidth || img.width) - side) / 2;
            const sy = ((img.naturalHeight || img.height) - side) / 2;
            ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
            // 加一点胶片感，让真实照片和生成的画面质感统一
            const rnd = mulberry32(Date.now() & 0xffff);
            grade(ctx, size, size, 'rgba(210,160,110,0.12)');
            vignette(ctx, size, size, 0.3);
            grain(ctx, size, size, rnd() * 8 | 0, 9);
            resolve(canvas.toDataURL('image/jpeg', 0.80));
          } catch (err) {
            reject(err);           // 必须在这里兜住，否则 Promise 永久挂起
          }
        };
        img.onerror = () => reject(new Error('这张图片解不开'));
        img.src = reader.result;
      };
      reader.onerror = () => reject(new Error('文件读不出来'));
      reader.readAsDataURL(file);
    });
  }

  function hexToRgb(hex) {
    const v = hex.replace('#', '');
    const n = parseInt(v.length === 3 ? v.split('').map((c) => c + c).join('') : v, 16);
    return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
  }

  global.Photo = { photo, photoMeta, normalizeUpload, PALETTES };
})(window);
