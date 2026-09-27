/* ============================================================
   此间 · 光学层（WebGL2 液态玻璃）

   为什么要有这一层
   ----------------
   界面上的每一块玻璃，背后其实是「此间」自己的极光——它是程序化的，
   完全在我们掌控之中。所以不需要任何形式的屏幕捕获，也不需要
   backdrop-filter：把极光和各块玻璃放进同一个片元着色器，一次全屏绘制
   就能得到真正的折射。

   这一版实现的光学模型，是从已验证的 C++ / D3D11 原型（D:\LiquidGlass）
   逐行移植过来的，不是另写一套近似：

     · SDF 圆角轮廓（Lp 范数，指数 2 = 圆角矩形，约 4.2 = Apple 连续曲率）
     · 贝塞尔剖面 G(t) = a·t − (a−e)·t² ,  a = 6 − 2e
     · 斯涅尔折射，玻璃 n = 1.52，R/G/B 三个波长各自算一次 → 真实色散
     · 环境采样菲涅尔：高光颜色取自背景反射方向，F0 = ((n−1)/(n+1))²
     · 中心不变形 / 内圈压缩 / 外圈反向，三区由同一条剖面自然导出

   关于「模糊」
   -----------
   极光是一组高斯光斑的叠加，而高斯与高斯卷积仍然是高斯——把半径按比例
   放宽，得到的就是数学上精确的模糊，不需要 Kawase 金字塔来回倒腾 FBO。
   所以毛玻璃层是一次「加宽采样」，比多趟模糊更快也更准。

   可读性硬约束
   ------------
   高光与折射全部画在画布上，DOM 文字永远在这块画布之上；
   且高光强度取自背景亮度，暗背景下自动变暗，不会出现发白的描边。
   ============================================================ */
(function (global) {
  'use strict';

  const MAX_PANELS = 12;
  // 画布分辨率上限。玻璃本身是柔和的，超过 1.5 倍的像素只是白白发热。
  const DPR_CAP = 1.5;

  // CSS 那边的 filter: blur() 会把光斑峰值摊薄，而模型里是按原始 alpha
  // 合成的，直接用会整体偏亮（暗色主题尤其明显）。这个系数把 WebGL 版的
  // 亮度校准回 CSS 版的水准，三套外观都按同一比例，颜色关系不变。
  const AURORA_BLUR_GAIN = 0.72;

  /** 默认参与玻璃化的表面。与 surfaces.css 里定义连续曲率的那组选择器一致。 */
  const PANEL_SELECTOR = [
    '[data-glass]',
    '.rail',
    '.hero',
    '.review-hero',
    '.ring-block',
    '.panel',
    '.card',
    '.stat',
    '.trace',
    '.summary',
    '.modal',
    '.write-block',
    '.print-stage',
    '.rail-card',
  ].join(',');

  /**
   * 每团光的性格——与 ambient.js 完全一致的漂移参数，
   * 这样换成 WebGL 之后运动质感不会突变。
   */
  const BLOBS = [
    { speed: 0.10, range: 0.20, wander: 0.085, wanderAmp: 0.055, parallax: 34 },
    { speed: 0.08, range: 0.17, wander: 0.117, wanderAmp: 0.045, parallax: -26 },
    { speed: 0.065, range: 0.24, wander: 0.061, wanderAmp: 0.065, parallax: 18 },
    { speed: 0.12, range: 0.15, wander: 0.143, wanderAmp: 0.040, parallax: -40 },
  ];

  const GLASS = {
    ior: 1.52,
    dispersion: 0.012,
    edgeSlope: 0.92,
    frost: 0.62,
    frostWiden: 2.6,
    probe: 96,
    highlight: 1.05,
    caustic: 0.38,
    // 圆角指数必须与 CSS 的 border-radius 一致，取 2（正圆弧）。
    //
    // 之前取 4.2（超椭圆，Apple 连续曲率）看着更"高级"，但它在对角方向上
    // 比同半径的正圆多鼓出约 20%：r=20px 时大约多 4px。CSS 的圆角是按正圆
    // 裁的，于是那 4px 的玻璃连同它的边缘高光一起露在卡片圆角之外 ——
    // 看上去就是"圆角没裁干净，还剩一点点"。
    cornerExp: 2.0,
    edgeShade: 0.10,
    // 中频起伏的幅度。折射要有东西可弯才看得见，这一点点起伏就是
    // 「玻璃下面确实有东西」的来源。
    detail: 0.14,
    // 每个面板的倒角与厚度按短边比例推算，再夹到合理区间
    bezelRatio: 0.17,
    bezelRange: [16, 66],
    thicknessRatio: 0.21,
    thicknessRange: [18, 88],
    tint: [1, 1, 1, 0.05],
  };

  const VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

  const FS = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

#define MAXP ${MAX_PANELS}

uniform vec2  uRes;        // 画布尺寸（设备像素）
uniform float uDpr;
uniform float uTime;

uniform vec3  uBg0;
uniform vec3  uBg1;
uniform vec4  uBlob[4];    // xy = 中心(css px), z = 半径, w = 强度
uniform vec3  uBlobCol[4];
uniform float uGrain;
uniform float uDetail;
uniform float uDebug;

uniform float uIOR;
uniform float uDisp;
uniform float uEdge;
uniform float uFrost;
uniform float uWiden;
uniform float uProbe;
uniform float uHi;
uniform float uCaustic;
uniform float uCorner;
uniform float uEdgeShade;
uniform vec4  uTint;

uniform int   uPanelCount;
uniform vec4  uRect[MAXP];    // xy = 中心, zw = 半宽高（css px）
uniform vec4  uStyle[MAXP];   // x = 圆角, y = 倒角宽度, z = 厚度, w = 染色强度

float hash21(vec2 q) {
  return fract(sin(dot(q, vec2(12.9898, 78.233))) * 43758.5453);
}
float vnoise(vec2 q) {
  vec2 i = floor(q), f = fract(q);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i),                  b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

/* ---------- 极光 ----------
   widen = 1 时是原始锐度；widen > 1 相当于把每个高斯光斑按比例放宽，
   对高斯叠加来说这就是精确的模糊。

   注意这里是 alpha 合成而不是相加。CSS 那边的写法是
   radial-gradient(rgba(...0.5), transparent)，等价于 mix(底, 光色, a)。
   第一版写成累加，在暖纸这种本来就接近白色的底色上只会一路加到纯白，
   颜色反而全都看不见了 —— 观感就是「一片惨白」。 */
vec3 auroraAt(vec2 p, float widen) {
  float t = clamp(p.y / (uRes.y / uDpr), 0.0, 1.0);
  vec3 acc = mix(uBg0, uBg1, t);

  /* 同样的 alpha，压在深色底上比压在浅色底上显眼得多 —— 这是感知问题，
     不是物理问题。暗房里如果照搬暖纸的强度，整片会灰成一片中调，
     所以按底色亮度衰减一次。亮底几乎不衰减，暗底收到约三成。 */
  float bgLuma = dot(mix(uBg0, uBg1, 0.5), vec3(0.2126, 0.7152, 0.0722));
  float atten = mix(0.30, 1.0, smoothstep(0.06, 0.55, bgLuma));

  for (int i = 0; i < 4; ++i) {
    vec2 q = (p - uBlob[i].xy) / max(uBlob[i].z * widen, 1.0);
    float a = clamp(exp(-dot(q, q) * 2.0) * uBlob[i].w * atten, 0.0, 1.0);
    acc = mix(acc, uBlobCol[i], a);
  }

  /* 中频起伏：折射得先有东西可弯，才看得出来。
     极光本身在几百像素尺度上都是平滑的，透镜再准也只是把一片渐变
     平移一点点，肉眼几乎无感 —— 之前「看不出玻璃」根因就在这里。
     叠一层很淡的中频噪声（约 170px 与 79px 两个尺度），边缘的压缩
     与外圈的反相立刻显形。只在未模糊的采样上加：加宽采样本来就会把
     这一层抹平，加了也是白算。 */
  if (widen < 1.5) {
    float d = vnoise(p * 0.0059) * 0.62 + vnoise(p * 0.0127) * 0.38;
    acc *= (1.0 + (d - 0.5) * uDetail);
  }
  return acc;
}

/* ---------- SDF ---------- */
float sdPanel(vec2 p, vec2 b, float r, float n) {
  vec2 q = abs(p) - b + r;
  vec2 o = max(q, 0.0);
  float m = pow(pow(o.x, n) + pow(o.y, n), 1.0 / n);
  return min(max(q.x, q.y), 0.0) + m - r;
}

/* Lp 场不是严格的距离场，所以处处用 |grad| 归一化，
   这样倒角的宽度在圆角处也保持恒定。 */
vec2 sdGrad(vec2 p, vec2 b, float r, float n) {
  const float e = 0.75;
  float dx = sdPanel(p + vec2(e, 0.0), b, r, n) - sdPanel(p - vec2(e, 0.0), b, r, n);
  float dy = sdPanel(p + vec2(0.0, e), b, r, n) - sdPanel(p - vec2(0.0, e), b, r, n);
  return vec2(dx, dy) / (2.0 * e);
}

/* ---------- 剖面斜率 ----------
   G(0) = 0    → 与中央平面相切，中心区域光学上是平的
   G 先增后减  → 位移量先增后减，映射折叠，外圈因此反向
   G(1) = e > 0 → 外沿仍有真实倾角，菲涅尔边缘才立得住 */
float bezelSlope(float t, float e) {
  float a = 6.0 - 2.0 * e;
  return a * t - (a - e) * t * t;
}

/* ---------- 斯涅尔折射 ----------
   返回横向位移，单位 css px。除以 |R.z| 是把方向换算成出射平面上的位置；
   夹角趋平时该比值有界（入射到光密介质永远不会全反射），所以不会爆掉。 */
vec2 refractOffset(vec3 N, float eta, float T) {
  vec3 I = vec3(0.0, 0.0, -1.0);
  vec3 R = refract(I, N, eta);
  return R.xy * (T / max(-R.z, 0.06));
}

float hash(vec2 q) {
  return fract(sin(dot(q, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  // gl_FragCoord 原点在左下，面板坐标来自 CSS（原点在左上）
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;

  vec3 col = auroraAt(p, 1.0);

  for (int k = 0; k < MAXP; ++k) {
    if (k >= uPanelCount) break;

    vec4 rc = uRect[k];
    vec4 st = uStyle[k];
    vec2 pc = p - rc.xy;
    vec2 hs = rc.zw;

    float bez = max(st.y, 1.0);
    float T   = max(st.z, 1.0);

    // 包围盒提前退出：绝大多数像素不在某块面板里，
    // 用 4 次比较换掉一次 SDF 求值，是这个着色器最划算的优化。
    float lim = bez + 8.0;
    if (abs(pc.x) > hs.x + lim || abs(pc.y) > hs.y + lim) continue;

    float d = sdPanel(pc, hs, st.x, uCorner);
    if (d > 0.0) continue;

    vec2 g  = sdGrad(pc, hs, st.x, uCorner);
    float gm = max(length(g), 1e-6);
    float dist = -d / gm;
    vec2 gdir = g / gm;

    float t = clamp(dist / bez, 0.0, 1.0);

    /* dist 是「离轮廓的距离」，所以 dist/B 在轮廓处是 0、往里走才变大 ——
       而剖面要求 t=1 在轮廓、t=0 在倒角内缘。这里必须取反。

       这一行原先写成 t = dist/bez（C++ 原型里也是），后果是整个面板内部
       t 被钳在 1：斜率恒为 e，等于内部整体平移一段，而轮廓处反而变平 ——
       菲涅尔、焦散、边缘压暗三处全都落在面板正中而不是边上。
       数学没错，是把参数接到了曲面错误的一端。 */
    t = 1.0 - t;

    // 表面法线：剖面沿外法线方向下降，所以上方法线向外倾
    float tanPhi = (T / bez) * bezelSlope(t, uEdge);
    vec3 N = normalize(vec3(gdir * tanPhi, 1.0));

    /* ---------- 三区自检（?optics=zones / offset / normal）----------
       把剖面直接画出来，而不是靠肉眼猜。分界点 t* = a / (2(a-e)) 是
       位移沿 t 的极值点：
         t < t*   位移随 t 递增 → 采样点被越推越深 → 内圈压缩
         t > t*   位移随 t 递减 → 采样点折返   → 外圈反向
       这条分界完全由这一条剖面决定，不是另外调的三个效果。 */
    if (uDebug > 0.5) {
      vec3 z;
      if (uDebug > 2.5) {
        z = N * 0.5 + 0.5;                                    // 表面法线
      } else if (uDebug > 1.5) {
        vec2 off = refractOffset(N, 1.0 / uIOR, T);           // 位移矢量
        z = vec3(clamp(abs(off) / 70.0, 0.0, 1.0), 1.0);
      } else {
        float a = 6.0 - 2.0 * uEdge;
        float slopeRate = a - 2.0 * (a - uEdge) * t;          // dG/dt
        if (t < 0.14)             z = vec3(0.92, 0.24, 0.24); // 中心：光学平坦
        else if (slopeRate > 0.0) z = vec3(0.18, 0.88, 0.36); // 内圈：压缩
        else                      z = vec3(0.24, 0.48, 1.00); // 外圈：反向
      }
      col = mix(col, z, 0.90);
      break;
    }

    // 三个波长各折射一次——这是真实色散，不是后期描边
    vec2 dR = refractOffset(N, 1.0 / (uIOR - uDisp), T);
    vec2 dG = refractOffset(N, 1.0 / uIOR, T);
    vec2 dB = refractOffset(N, 1.0 / (uIOR + uDisp), T);

    vec3 refr;
    refr.r = auroraAt(p + dR, 1.0).r;
    refr.g = auroraAt(p + dG, 1.0).g;
    refr.b = auroraAt(p + dB, 1.0).b;

    // 毛玻璃单独一层：折射采样保持锐利，否则变形会被糊掉、根本看不见
    vec3 frost = auroraAt(p, uWiden);
    vec3 body  = mix(refr, mix(refr, frost, 0.85), uFrost);

    // 菲涅尔：F0 由折射率算出；(n=1.52 时 F0 = 0.0426)
    float f0   = pow((uIOR - 1.0) / (uIOR + 1.0), 2.0);
    float cosT = clamp(N.z, 0.0, 1.0);
    float F    = f0 + (1.0 - f0) * pow(1.0 - cosT, 5.0);

    // 高光颜色来自背景：沿反射方向走过去采样，
    // 背景暗则高光暗——这里没有任何固定的白色。
    vec3 Vr = reflect(vec3(0.0, 0.0, -1.0), N);
    vec3 envCol = auroraAt(p + Vr.xy * uProbe, 2.2);
    vec3 envAvg = auroraAt(vec2(uRes.x / uDpr * 0.5, uRes.y / uDpr * 0.5), 7.0);
    float envLum = dot(envAvg, vec3(0.2126, 0.7152, 0.0722));

    vec3 spec = (envCol * 0.75 + envAvg * (0.35 + 0.65 * envLum)) * F * uHi;
    vec3 caustic = (envCol * 0.6 + envAvg * 0.4) * pow(t, 3.0) * uCaustic;

    vec3 tinted = mix(body, body * uTint.rgb, clamp(uTint.a, 0.0, 1.0));
    tinted += uTint.rgb * (uTint.a * 0.05 * envLum + uTint.a * 0.012);

    /* 材质本体。
       中心区域按模型是完全不折射的 —— 这是对的，但只有折射的话，
       面板内部就与背景毫无区别，整块玻璃会「消失」。
       做法是向环境色轻微收敛，而**不是加白**：
       暖纸底本来就接近白，再加白只会整片过曝，
       收敛则把对比压下来一点，才是「一层材料盖在上面」的观感。 */
    tinted = mix(tinted, envAvg * 1.02, 0.10);

    float edge = smoothstep(0.55, 1.0, t);
    tinted *= mix(1.0, 1.0 - uEdgeShade, edge);

    vec3 gcol = tinted + spec + caustic;

    float aa = clamp(-d / max(fwidth(d), 1e-4) + 0.5, 0.0, 1.0);
    col = mix(col, gcol, aa);
  }

  if (uGrain > 0.0) {
    col += (hash(p + fract(uTime) * 91.7) - 0.5) * uGrain;
  }

  fragColor = vec4(col, 1.0);
}`;

  // ---------------------------------------------------------------- utils --

  function parseColor(str) {
    if (!str) return null;
    const s = String(str).trim();
    // #rrggbb：--bg 这类令牌取出来是十六进制
    const hex = /^#([0-9a-fA-F]{6})$/.exec(s);
    if (hex) {
      const n = parseInt(hex[1], 16);
      return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
    }
    const m = /rgba?\(([^)]+)\)/.exec(s);
    if (!m) return null;
    const parts = m[1].split(',').map((v) => parseFloat(v));
    if (parseFloat(parts[3]) === 0) return null;   // 全透明不算颜色
    return [
      (parts[0] || 0) / 255,
      (parts[1] || 0) / 255,
      (parts[2] || 0) / 255,
      parts.length > 3 ? parts[3] : 1,
    ];
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rand(a, b) { return a + Math.random() * (b - a); }

  function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error('shader compile failed: ' + log);
    }
    return sh;
  }

  function isSupported() {
    try {
      const c = document.createElement('canvas');
      return !!(c.getContext && c.getContext('webgl2'));
    } catch (e) {
      return false;
    }
  }

  // ------------------------------------------------------------------ api --

  function create(opts) {
    const o = opts || {};
    const canvas = o.canvas;
    const host = o.host || document.querySelector('.ambient') || document.body;
    const debugMode = o.debug || 0;
    if (!canvas) return null;

    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'low-power',
      // 画布每帧重画，浏览器不必保留上一帧
      preserveDrawingBuffer: false,
    });
    if (!gl) return null;

    let prog;
    try {
      const vs = compile(gl, gl.VERTEX_SHADER, VS);
      const fs = compile(gl, gl.FRAGMENT_SHADER, FS);
      prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error('link failed: ' + gl.getProgramInfoLog(prog));
      }
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    } catch (e) {
      if (global.console) console.warn('[Optics] ' + e.message);
      return null;
    }

    gl.useProgram(prog);

    // 全屏三角形（比两个三角形的四边形少一次光栅化接缝）
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const U = {};
    [
      'uRes', 'uDpr', 'uTime', 'uBg0', 'uBg1', 'uBlob', 'uBlobCol', 'uGrain', 'uDetail', 'uDebug',
      'uIOR', 'uDisp', 'uEdge', 'uFrost', 'uWiden', 'uProbe', 'uHi', 'uCaustic',
      'uCorner', 'uEdgeShade', 'uTint', 'uPanelCount', 'uRect', 'uStyle',
    ].forEach((n) => { U[n] = gl.getUniformLocation(prog, n); });

    // ---- 极光：形状与颜色仍然由 CSS 决定，这里只负责运动与绘制 ----
    const auroraEls = Array.prototype.slice.call(document.querySelectorAll('.aurora'));
    const blobs = auroraEls.slice(0, 4).map((el, i) => ({
      el,
      cfg: BLOBS[i] || BLOBS[0],
      x: 0, y: 0, tx: 0, ty: 0,
      phase: rand(0, Math.PI * 2),
      wanderPhase: i * 1.7 + rand(0, Math.PI * 2),
      // 下面这些由 measureBlobs() 填充
      cx: 0, cy: 0, r: 220, col: [1, 1, 1], w: 0.3,
    }));

    const rect = { w: 1, h: 1, dpr: 1 };
    let panels = [];
    let panelEls = [];
    let lastBg = null;
    let bgWatch = 0;
    let raf = null;
    let last = 0;
    let clock = 0;
    let mx = 0, my = 0, tmx = 0, tmy = 0;
    let running = false;
    let reduceMotion = false;

    function measureBlobs() {
      const vw = rect.w;
      const vh = rect.h;
      blobs.forEach((b) => {
        const cs = getComputedStyle(b.el);
        const left = parseFloat(cs.left) || 0;
        const top = parseFloat(cs.top) || 0;
        const w = parseFloat(cs.width) || vw * 0.5;
        const h = parseFloat(cs.height) || vh * 0.5;
        b.cx = left + w / 2;
        b.cy = top + h / 2;

        // CSS 是 radial-gradient(... transparent 68%) 外加一层 blur，
        // 所以有效半径取「渐变可见半径 + 模糊半径」。
        const blur = parseFloat((/blur\(([\d.]+)px\)/.exec(cs.filter) || [])[1]) || 0;
        b.r = Math.max(w, h) / 2 * 0.68 + blur;

        const col = parseColor(cs.backgroundImage);
        const op = parseFloat(cs.opacity);
        const base = col || [1, 1, 1, 0.4];
        b.col = [base[0], base[1], base[2]];
        // CSS 的 alpha × 元素不透明度，就是这团光在画布上的强度。
        // blur 会把峰值摊薄，这里补一个经验系数，让 WebGL 版的亮度
        // 与 CSS 版对得上（否则暗色主题会明显偏亮）。
        b.w = base[3] * (isNaN(op) ? 1 : op) * AURORA_BLUR_GAIN;
      });
    }

    /* 面板分成两步量：
         queryPanelEls()  —— 重新查 DOM（贵），只在结构变化时做
         updatePanelRects() —— 每帧更新矩形（便宜），玻璃才能跟着
                              视图入场动画一起移动
       只查一次的话，路由切换时量到的是上一页的矩形，甚至量到空的。 */
    function queryPanelEls() {
      panelEls = Array.prototype.slice.call(document.querySelectorAll(PANEL_SELECTOR));
      // 圆角几乎不变，随元素一起缓存，省掉每帧的 getComputedStyle
      panelEls.forEach((el) => {
        const cs = getComputedStyle(el);
        el.__cjRadius = parseFloat(cs.borderTopLeftRadius) || 20;
      });
    }

    function updatePanelRects() {
      const found = [];
      for (let i = 0; i < panelEls.length; ++i) {
        const el = panelEls[i];
        const r = el.getBoundingClientRect();
        if (r.width < 24 || r.height < 24) continue;
        if (r.bottom < 0 || r.top > rect.h || r.right < 0 || r.left > rect.w) continue;
        found.push({ idx: i, area: r.width * r.height, r, radius: el.__cjRadius || 20 });
      }

      // 面积最大的若干块优先，再按文档顺序绘制——外层玻璃先画，
      // 嵌在它上面的内层后画，层次才对。
      found.sort((a, b) => b.area - a.area);
      const keep = found.slice(0, MAX_PANELS);
      keep.sort((a, b) => a.idx - b.idx);
      panels = keep;
    }

    function pushPanelUniforms() {
      const rects = new Float32Array(MAX_PANELS * 4);
      const styles = new Float32Array(MAX_PANELS * 4);
      const n = panels.length;
      for (let i = 0; i < n; ++i) {
        const p = panels[i];
        const r = p.r;
        const short = Math.min(r.width, r.height);
        const bezel = clamp(short * GLASS.bezelRatio, GLASS.bezelRange[0], GLASS.bezelRange[1]);
        const thick = clamp(short * GLASS.thicknessRatio, GLASS.thicknessRange[0], GLASS.thicknessRange[1]);
        rects[i * 4 + 0] = r.left + r.width / 2;
        rects[i * 4 + 1] = r.top + r.height / 2;
        rects[i * 4 + 2] = r.width / 2;
        rects[i * 4 + 3] = r.height / 2;
        styles[i * 4 + 0] = p.radius;
        styles[i * 4 + 1] = bezel;
        styles[i * 4 + 2] = thick;
        styles[i * 4 + 3] = 1;
      }
      gl.uniform4fv(U.uRect, rects);
      gl.uniform4fv(U.uStyle, styles);
      gl.uniform1i(U.uPanelCount, n);
    }

    function resize() {
      const w = global.innerWidth || document.documentElement.clientWidth || 1;
      const h = global.innerHeight || document.documentElement.clientHeight || 1;
      const dpr = Math.min(global.devicePixelRatio || 1, DPR_CAP);
      const pw = Math.max(1, Math.round(w * dpr));
      const ph = Math.max(1, Math.round(h * dpr));
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }
      rect.w = w; rect.h = h; rect.dpr = dpr;
      gl.viewport(0, 0, pw, ph);
      measureBlobs();
      queryPanelEls();
      updatePanelRects();
    }

    function pickTarget(b) {
      const vw = rect.w, vh = rect.h;
      b.tx = rand(-vw * b.cfg.range, vw * b.cfg.range);
      b.ty = rand(-vh * b.cfg.range, vh * b.cfg.range);
    }

    function readBg() {
      // 底色一律看 --bg 令牌，不要读 body 的 background：
      // 窗口改成真透明之后 body 的 background 是 transparent，
      // 读出来是纯黑，整块画布会直接黑掉（踩过一次）。
      const root = getComputedStyle(document.documentElement);
      const c = parseColor(root.getPropertyValue('--bg')) ||
                parseColor(getComputedStyle(document.body).backgroundColor) ||
                [0.96, 0.94, 0.9, 1];
      lastBg = c.slice(0, 3).map((v) => +v.toFixed(3));
      // 纵向渐变只往下压，不往上抬。
      // 原来是 *1.04，等于让画面顶部比底色还亮 —— 在本来就偏亮的暖纸底上
      // 这是实打实的过曝来源（实测全画面 9 成像素挤在最高一档里）。
      const g0 = [c[0], c[1], c[2]];
      const g1 = [c[0] * 0.94, c[1] * 0.94, c[2] * 0.94];
      gl.uniform3fv(U.uBg0, g0);
      gl.uniform3fv(U.uBg1, g1);
    }

    function draw(dt) {
      clock += dt;
      // 每帧更新矩形，玻璃才能跟着视图入场动画走
      updatePanelRects();

      // 主题刚切换的那一小段时间里持续重读底色。
      // 同步读一次是不够的：切 data-mode 与样式真正生效之间可能隔着
      // 一次样式重算甚至一段过渡动画，当场读到的还是旧颜色 ——
      // 现象就是暗房模式整片发白（底色仍是浅色的 #f6efe6）。
      if (bgWatch > 0) {
        bgWatch -= dt;
        readBg();
      }

      mx += (tmx - mx) * Math.min(1, dt * 2.4);
      my += (tmy - my) * Math.min(1, dt * 2.4);

      const blobArr = new Float32Array(16);
      const colArr = new Float32Array(12);
      for (let i = 0; i < blobs.length; ++i) {
        const b = blobs[i];
        if (!reduceMotion) {
          const spin = clock * b.cfg.wander + b.wanderPhase;
          const dx = Math.cos(spin) * rect.w * b.cfg.wanderAmp;
          const dy = Math.sin(spin * 0.78) * rect.h * b.cfg.wanderAmp;
          const a = 1 - Math.pow(1 - Math.min(b.cfg.speed, 0.9), dt * 60);
          b.x += (b.tx + dx - b.x) * a;
          b.y += (b.ty + dy - b.y) * a;
          const near = Math.max(10, rect.w * b.cfg.range * 0.08);
          if (Math.abs(b.tx - b.x) < near && Math.abs(b.ty - b.y) < near) {
            b.phase -= dt;
            if (b.phase <= 0) { pickTarget(b); b.phase = rand(1.6, 4.5); }
          }
        }
        const px = b.x + mx * b.cfg.parallax;
        const py = b.y + my * b.cfg.parallax * 0.7;
        blobArr[i * 4 + 0] = b.cx + px;
        blobArr[i * 4 + 1] = b.cy + py;
        blobArr[i * 4 + 2] = b.r;
        blobArr[i * 4 + 3] = b.w;
        colArr[i * 3 + 0] = b.col[0];
        colArr[i * 3 + 1] = b.col[1];
        colArr[i * 3 + 2] = b.col[2];
      }

      gl.uniform2f(U.uRes, canvas.width, canvas.height);
      gl.uniform1f(U.uDpr, rect.dpr);
      gl.uniform1f(U.uTime, clock);
      gl.uniform4fv(U.uBlob, blobArr);
      gl.uniform3fv(U.uBlobCol, colArr);

      gl.uniform1f(U.uGrain, 0.012);
      gl.uniform1f(U.uDetail, GLASS.detail);
      gl.uniform1f(U.uDebug, debugMode);
      gl.uniform1f(U.uIOR, GLASS.ior);
      gl.uniform1f(U.uDisp, GLASS.dispersion);
      gl.uniform1f(U.uEdge, GLASS.edgeSlope);
      gl.uniform1f(U.uFrost, GLASS.frost);
      gl.uniform1f(U.uWiden, GLASS.frostWiden);
      gl.uniform1f(U.uProbe, GLASS.probe);
      gl.uniform1f(U.uHi, GLASS.highlight);
      gl.uniform1f(U.uCaustic, GLASS.caustic);
      gl.uniform1f(U.uCorner, GLASS.cornerExp);
      gl.uniform1f(U.uEdgeShade, GLASS.edgeShade);
      gl.uniform4fv(U.uTint, new Float32Array(GLASS.tint));

      pushPanelUniforms();
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function tick(now) {
      raf = requestAnimationFrame(tick);
      if (!last) last = now;
      let dt = (now - last) / 1000;
      last = now;
      if (dt > 0.05) dt = 0.05;
      if (dt <= 0) return;
      draw(dt);
    }

    function onMove(e) {
      const w = rect.w || 1, h = rect.h || 1;
      tmx = clamp((e.clientX / w) * 2 - 1, -1, 1);
      tmy = clamp((e.clientY / h) * 2 - 1, -1, 1);
    }

    function onResize() { resize(); }

    // 面板会随路由与视图动画变化；视图容器一变就重新量一次
    let mo = null;
    function watchPanels() {
      const target = document.getElementById('view') || document.body;
      if (!global.MutationObserver) return;
      mo = new MutationObserver(() => { queryPanelEls(); updatePanelRects(); });
      mo.observe(target, { childList: true, subtree: true });
    }

    const api = {
      canvas,
      start() {
        if (running) return;
        running = true;
        reduceMotion =
          document.documentElement.dataset.reduceMotion === 'on' ||
          global.matchMedia('(prefers-reduced-motion: reduce)').matches;

        resize();
        readBg();
        blobs.forEach((b) => {
          b.x = rand(-rect.w * 0.06, rect.w * 0.06);
          b.y = rand(-rect.h * 0.06, rect.h * 0.06);
          pickTarget(b);
        });

        global.addEventListener('resize', onResize, { passive: true });
        if (!reduceMotion) {
          global.addEventListener('mousemove', onMove, { passive: true });
        }
        watchPanels();

        draw(1 / 60);
        raf = requestAnimationFrame(tick);
      },

      /** 主题切换后调用：颜色与尺寸都可能变了 */
      refresh() {
        if (!running) return;
        resize();
        // 底色不是读一次就完事，接着盯一会儿（见 draw 里的说明）
        bgWatch = 1.4;
      },

      /** 视图切换后调用 */
      measure() { if (running) { queryPanelEls(); updatePanelRects(); } },

      stop() {
        running = false;
        if (raf) cancelAnimationFrame(raf);
        raf = null;
        global.removeEventListener('resize', onResize);
        global.removeEventListener('mousemove', onMove);
        if (mo) { mo.disconnect(); mo = null; }
      },

      get panelCount() { return panels.length; },
      get blobCount() { return blobs.length; },
      /** 自检用：把实际送进着色器的值吐出来，光看画面猜不出问题在哪 */
      get debug() {
        const root = document.documentElement;
        const csr = getComputedStyle(root);
        return {
          mode: root.dataset.mode,
          spatial: root.dataset.spatial,
          theme: root.dataset.theme,
          storeMode: (global.CJ && global.CJ.Store &&
                      global.CJ.Store.state.settings.mode) || null,
          bgVar: csr.getPropertyValue('--bg').trim(),
          bodyBg: getComputedStyle(document.body).backgroundColor,
          parsedBg: lastBg,
          candidates: panelEls.length,
          picked: panels.length,
          radii: blobs.map((b) => Math.round(b.r)),
          weights: blobs.map((b) => +b.w.toFixed(3)),
        };
      },
    };

    return api;
  }

  global.Optics = { create, isSupported, PANEL_SELECTOR, MAX_PANELS };
})(window);
