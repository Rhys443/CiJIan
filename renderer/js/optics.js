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
     · 边缘剖面 H(u)：四分之一圆与 smootherstep 之间插值（liquid = 1），
       两端一阶二阶导都为 0 —— 表面贴着边界切线方向起来，没有折角
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
    /* 抽卡结果的「任务披露」面板本身没有底色，在极光/暖纸上直接压字很好看，
       底图换成照片之后却变成"白字浮在照片上"，整页的主角没有承托。
       选择器写成 [data-bg="photo"] .reveal，只有照片模式才把它玻璃化 ——
       暖纸与极光那两套的样子一点不动。 */
    '[data-bg="photo"] .reveal',
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
    /* 色散加大：这是「玻璃感」最直接的来源。
       原来 0.012 在中心区域几乎看不出分色，玻璃读起来像一块模糊的塑料。 */
    dispersion: 0.030,

    /* ============ 边缘剖面：形状参数 ============
       这四个值是在范例 cijian-v18-demo.html 里逐个拉定的，用户已确认：

         liquid      液态程度：剖面在「四分之一圆」与「smootherstep」之间插值
         spanRatio   鼓起范围：占面板短边的比例
         height      鼓起高度：表面最高点相对边界的高差（css px）
         edgeShade   边缘厚度：贴边那一圈压暗的强度

       **liquid 必须取满 1.0。**
       计划文档里记的滑杆值是 0.08，但那个值在数学上做不到「去掉直角」：
       剖面是 mix(brick, smootherstep, liquid)，而 brick = sqrt(1-(1-u)^2)
       在 u=0（正好在轮廓上）的导数是**无穷**，只要 liquid < 1，
       这一项就仍然在，表面照样以 90 度撞上边界 —— 那正是用户说的「直角」。
       所以这里按「结构性修改」那一条取纯 smootherstep：
       两端一阶、二阶导都为 0，边界处切线水平，没有折点。 */
    liquid: 1.0,
    spanRatio: 0.30,
    spanRange: [8, 260],
    height: 17,
    /* 边缘压暗从 0.17 收到 0.07（用户拉定的值）。
       它现在是一圈**贴边为 0** 的鼓包，不再是边界上的一道台阶 —— 见 shader。 */
    edgeShade: 0.07,

    frost: 0.62,
    /* 上面那对 frost 值现在只是**兜底**：真实取值由用户那根滑杆决定
       （见 frostWidth() / frostMix()，50 正好落回 160 / 0.62）。
       留在这里是为了 Store 还没初始化时有个合理缺省。 */
    frostPhoto: 0.62,
    /* 毛玻璃的加宽半径。调小 = 折射采样更贴近原图 = 变形更锐利、更「玻璃」。 */
    frostWiden: 2.15,
    probe: 96,
    /* 高光与焦散都往上提，玻璃边缘才会「亮起来」。
       但第一版给到 1.55 / 0.72 之后每一块面板都在往外冒光，
       整屏像背光板 —— 收到 1.30 / 0.52。
       现在公式换成了窄高光（见 shader），加法的总量本来就小得多，
       所以这两个值再次下调：高光是「一小块亮」，不是「一圈亮」。 */
    highlight: 0.95,
    caustic: 0.40,
    // 圆角指数必须与 CSS 的 border-radius 一致，取 2（正圆弧）。
    //
    // 之前取 4.2（超椭圆，Apple 连续曲率）看着更"高级"，但它在对角方向上
    // 比同半径的正圆多鼓出约 20%：r=20px 时大约多 4px。CSS 的圆角是按正圆
    // 裁的，于是那 4px 的玻璃连同它的边缘高光一起露在卡片圆角之外 ——
    // 看上去就是"圆角没裁干净，还剩一点点"。
    cornerExp: 2.0,
    // 中频起伏的幅度。折射要有东西可弯才看得见，这一点点起伏就是
    // 「玻璃下面确实有东西」的来源。往上提一档，多一层可弯的细节。
    detail: 0.26,
    /* 折射厚度。与「鼓起范围」分开：范围决定形状铺多宽，
       厚度决定同样的倾角能把背景掰弯多少。 */
    thicknessRatio: 0.30,
    thicknessRange: [24, 120],
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

/* ---------- 背景来源 ----------
   uBgMode 0 = 程序化极光（没设底图时的默认，保留原有基础）
           1 = 用户上传的照片或视频帧

   tPhoto 是原始纹理，tFrost 是它的重度降采样版本（毛玻璃用）。
   两者共用同一套 cover 映射，保证「折射采到的位置」与「磨砂糊出来的位置」
   严格对得上 —— 否则玻璃边缘会和它自己的磨砂层错位。
   uEnvAvg 由 JS 在生成 tFrost 时顺手算出（降采样图的均值），
   菲涅尔的环境亮度用它，比在着色器里猜一个点准得多。 */
uniform float     uBgMode;
uniform vec2      uBgScale;
uniform vec2      uBgOffset;
uniform float     uOverlay;
uniform float     uLightGlass;
uniform vec3      uEnvAvg;
uniform sampler2D tPhoto;
uniform sampler2D tFrost;

/* 全局跟手光晕（规格里的 L2） */
uniform vec2  uGlowPos;    // 鼠标位置，css px
uniform float uGlowAmt;    // 0..1，进出场淡入淡出
uniform vec3  uGlowCol;

uniform float uIOR;
uniform float uDisp;
uniform float uLiquid;
uniform float uHeight;
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
uniform vec4  uStyle[MAXP];   // x = 圆角, y = 鼓起范围, z = 折射厚度, w = 染色强度

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

/* ---------- 背景取色：照片/视频 或 极光 ----------
   cover 映射与 CSS 的 object-fit:cover 等价：填满窗口、不拉伸、
   超出的部分裁掉。窗口比例与底图比例不一致时，靠 JS 算出的
   uBgScale/uBgOffset 把可见区域对准中心。 */
vec2 coverUV(vec2 p) {
  vec2 css = vec2(uRes.x / uDpr, uRes.y / uDpr);
  return clamp(p / css * uBgScale + uBgOffset, vec2(0.0), vec2(1.0));
}

vec3 bgAt(vec2 p, float widen) {
  vec3 c;
  if (uBgMode > 0.5) {
    /* 屏幕坐标 p 的 y 向下、纹理行 0 是图像顶行，两者方向一致，
       所以这里不需要翻转 —— 加了反而会上下颠倒。 */
    vec2 uv = coverUV(p);
    /* widen < 1.5 是「要锐利」的那一路（背景本体 + 折射采样）。
       折射必须采原图：糊过的图会把自己的变形一起抹掉，
       透镜再准也看不出来 —— 这正是之前「看不出玻璃」的原因。
       其余（毛玻璃、环境探测）走降采样那张。 */
    c = (widen < 1.5 ? texture(tPhoto, uv) : texture(tFrost, uv)).rgb;
  } else {
    c = auroraAt(p, widen);
  }
  /* 压暗层夹在底图与玻璃之间 —— 所以放在这里而不是最后叠：
     玻璃折射到的应该是「已经压暗过的」背景，否则玻璃下面的画面
     会比周围亮一档，边界立刻露馅。

     亮色玻璃是反过来的：暖白面板压在暗照片上会显得跳，
     所以这里把底图**提亮**一档去接它，而不是继续压暗。
     提亮要克制（1.14），过头照片就灰了。 */
  float lift = (uBgMode > 0.5 && uLightGlass > 0.5) ? 1.14 : 1.0;
  return c * (1.0 - uOverlay) * lift;
}

/* ---------- 全局跟手光晕 ----------
   加在**背景之上、玻璃之下**：也就是说它先落进背景，再由玻璃去模糊、
   去折射。这才是「光晕穿透玻璃」—— 玻璃边缘会把光晕一起掰弯。
   如果把它做成压在玻璃上面的 DOM 层，玻璃的 blur 根本碰不到它，
   看上去就只是贴了一张会动的膜，这也是规格把它放在 L2 的原因。 */
vec3 addGlow(vec2 p, vec3 c) {
  if (uGlowAmt <= 0.001) return c;
  float r = length(p - uGlowPos);
  /* 半径从 190 收到 105。
     原来那团光大到快盖住半屏，而且接近纯白 —— 底图被它冲掉，
     观感是「屏幕上有一块过曝」，不是「有个东西在发光」。
     收小之后它才像一束光，而不是一片白雾。 */
  float g = exp(-(r * r) / (105.0 * 105.0));

  /* 按「还剩多少余量」给光。
     这是加法叠加，而极光模式的底本来就接近白（纸色约 0.9），
     再直接加 0.62 会超过 1 被**夹断成纯白** —— 那一块就是用户说的
     「跟随鼠标的光有点曝光」，字也被一起冲掉。
     所以先看这一点当前有多亮，只给它剩下来的余量（留一成安全余量，
     免得底色估偏一点就又顶到 100%）。

     暗房底约 0.1，余量接近 0.9，光几乎不打折 —— 所以这一条
     实际上只改极光，其他档位的观感不动。 */
  float head = clamp(1.0 - max(max(c.r, c.g), c.b), 0.0, 1.0) * 0.9;
  return c + uGlowCol * (g * uGlowAmt * head);
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

/* ---------- 边缘剖面：形状 ----------
   参数 u 是「离轮廓的距离 / 鼓起范围」：
     u = 0 正好在轮廓上，u = 1 在鼓起范围的内端。

   两条剖面按 liquid 插值：

     brick   = 四分之一圆 sqrt(1 - (1-u)^2)
               u=0 处导数**无穷** → 表面以 90 度撞上边界。
               圆角本身是圆的，但撞击角度是硬的，看上去就是「玻璃砖接缝」。

     liquidP = smootherstep u^3 (6u^2 - 15u + 10)
               u=0 与 u=1 处一阶、二阶导都为 0 →
               表面以切线方向贴着边界起来，一路平滑拱到中心，全程没有折点。

   这一对函数就是「四棱台」那道棱的根：不是圆角不够圆，是切线方向不对。 */
float profileHeight(float u, float liquid) {
  u = clamp(u, 0.0, 1.0);
  float brick   = sqrt(max(0.0, 1.0 - (1.0 - u) * (1.0 - u)));
  float liquidP = u * u * u * (u * (u * 6.0 - 15.0) + 10.0);
  return mix(brick, liquidP, liquid);
}

/* dH/du —— 解析式，不另外做差分：
   位置对法线方向的距离求导就是 ∇dist（SDF 的解析梯度 gdir），
   所以 tanPhi = (height / span) * profileSlope(u)。

   两端都为 0，这就是「边界上没有折角」的数学表达。
   注意 brick 的导数在 u=0 是无穷：只要 liquid < 1，
   这一项就仍然带着那条直角 —— 所以 liquid 必须取满 1。 */
float profileSlope(float u, float liquid) {
  u = clamp(u, 0.0, 1.0);
  float s = 1.0 - u;
  float brickD   = s / max(sqrt(max(1.0 - s * s, 1e-6)), 1e-3);
  float liquidD  = 30.0 * u * u * s * s;
  return mix(brickD, liquidD, liquid);
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

  vec3 col = addGlow(p, bgAt(p, 1.0));

  for (int k = 0; k < MAXP; ++k) {
    if (k >= uPanelCount) break;

    vec4 rc = uRect[k];
    vec4 st = uStyle[k];
    vec2 pc = p - rc.xy;
    vec2 hs = rc.zw;

    float span = max(st.y, 1.0);
    float T    = max(st.z, 1.0);

    /* 包围盒提前退出：绝大多数像素不在某块面板里。
       lim 只需要覆盖抗锯齿的那一两个像素 —— 面板**外面**的像素
       紧接着就会被 d > 0 挡掉，把 lim 开到 span 那么大
       （30% 短边之后最大能到两百多）只会让更多无关像素白跑一次 SDF。 */
    float lim = 8.0;
    if (abs(pc.x) > hs.x + lim || abs(pc.y) > hs.y + lim) continue;

    float d = sdPanel(pc, hs, st.x, uCorner);
    if (d > 0.0) continue;

    vec2 g  = sdGrad(pc, hs, st.x, uCorner);
    float gm = max(length(g), 1e-6);
    float dist = -d / gm;
    vec2 gdir = g / gm;

    /* u = 离轮廓的距离 / 鼓起范围。
       u=0 在轮廓上，u=1 在鼓起范围的内端 —— 与剖面的参数方向一致。

       这一行原来写的是 t = clamp(dist / bez) 再取反，
       后果是整个面板内部被钳在 t=1：斜率恒为常数，等于内部整体平移一段，
       而轮廓处反而变平 —— 菲涅尔、焦散、边缘压暗三处全都落在面板正中
       而不是边上。数学没错，是把参数接到了曲面错误的一端。 */
    float u = clamp(dist / span, 0.0, 1.0);

    /* 表面法线：剖面高度沿外法线方向下降，所以上方法线向外倾。
       tanPhi 是表面的真实倾角（对距离求导），
       不再乘厚度 —— 厚度只负责「同样的倾角能掰弯多少背景」，
       见下面的 refractOffset。形状与厚度混在一起正是前几轮
       怎么调都调不干净的原因之一。 */
    float tanPhi = (uHeight / span) * profileSlope(u, uLiquid);
    vec3 N = normalize(vec3(gdir * tanPhi, 1.0));

    /* ---------- 三区自检（?optics=zones / offset / normal）----------
       把剖面直接画出来，而不是靠肉眼猜。
       分界点 u = 0.5 是 smootherstep 导数 30u^2(1-u)^2 的极值点：
         u < 0.5   位移随 u 递增 → 采样点被越推越深 → 内圈压缩
         u > 0.5   位移随 u 递减 → 采样点折返   → 外圈反向
       这条分界完全由这一条剖面决定，不是另外调的三个效果。 */
    if (uDebug > 0.5) {
      vec3 z;
      if (uDebug > 3.5) {
        z = vec3(u);                                          // 剖面参数 u：贴边 0 → 内端 1
      } else if (uDebug > 2.5) {
        z = N * 0.5 + 0.5;                                    // 表面法线
      } else if (uDebug > 1.5) {
        vec2 off = refractOffset(N, 1.0 / uIOR, T);           // 位移矢量
        z = vec3(clamp(abs(off) / 70.0, 0.0, 1.0), 1.0);
      } else {
        if (u < 0.14)      z = vec3(0.92, 0.24, 0.24);        // 贴边：切线水平，光学上几乎平坦
        else if (u < 0.50) z = vec3(0.18, 0.88, 0.36);        // 内圈：压缩
        else               z = vec3(0.24, 0.48, 1.00);        // 外圈：反向
      }
      // u 场单独一路：**不掺背景**，纯值输出。
      // 掺了背景就看不出「这一像素到底有没有被面板覆盖」——
      // 而覆盖范围正是查「边上那条带子」时唯一要知道的事。
      if (uDebug > 3.5) { col = vec3(u); break; }
      col = mix(col, z, 0.90);
      break;
    }

    // 三个波长各折射一次——这是真实色散，不是后期描边
    vec2 dR = refractOffset(N, 1.0 / (uIOR - uDisp), T);
    vec2 dG = refractOffset(N, 1.0 / uIOR, T);
    vec2 dB = refractOffset(N, 1.0 / (uIOR + uDisp), T);

    vec3 refr;
    refr.r = bgAt(p + dR, 1.0).r;
    refr.g = bgAt(p + dG, 1.0).g;
    refr.b = bgAt(p + dB, 1.0).b;

    // 毛玻璃单独一层：折射采样保持锐利，否则变形会被糊掉、根本看不见
    vec3 frost = bgAt(p, uWiden);
    vec3 body  = mix(refr, mix(refr, frost, 0.85), uFrost);

    // 菲涅尔：F0 由折射率算出；(n=1.52 时 F0 = 0.0426)
    float f0   = pow((uIOR - 1.0) / (uIOR + 1.0), 2.0);
    float cosT = clamp(N.z, 0.0, 1.0);
    float F    = f0 + (1.0 - f0) * pow(1.0 - cosT, 5.0);

    // 高光颜色来自背景：沿反射方向走过去采样，
    // 背景暗则高光暗——这里没有任何固定的白色。
    vec3 Vr = reflect(vec3(0.0, 0.0, -1.0), N);
    vec3 envCol = bgAt(p + Vr.xy * uProbe, 2.2);
    /* 有底图时用 JS 算好的均值（生成降采样图时顺手求得），
       比在着色器里挑一个点去猜准得多 —— 菲涅尔的环境亮度直接决定
       玻璃边缘亮不亮，猜错会让暗背景下的边缘发白。
       极光模式下没有这张图，仍按原来的宽高斯采中心。 */
    vec3 envAvg = (uBgMode > 0.5)
      ? uEnvAvg
      : auroraAt(vec2(uRes.x / uDpr * 0.5, uRes.y / uDpr * 0.5), 7.0);
    float envLum = dot(envAvg, vec3(0.2126, 0.7152, 0.0722));

    /* 高光：窄的 Blinn-Phong，而不是整圈菲涅尔。
       原来这里是 (envCol * 0.75 + ...) * F * uHi，而 F 在整圈边缘都趋近 1 ——
       等于沿面板一圈都在加法叠白光，压在本来就亮的底上必然过曝，
       实测观感就是「像相机曝光过度」，用户直接说「太丑了，像白内障」。
       真正的玻璃不发光：它只在正对光源的那一小块地方有高光。
       所以改成朝一个固定光源的窄高光（指数 110），
       菲涅尔只留很轻的一点给边缘「存在感」。

       注意：这段 GLSL 整体在 JS 模板字符串里，注释中**不能出现反引号**，
       否则会提前把模板字符串截断，整段脚本语法错误、界面直接退回 CSS 版本。
       这个坑已经踩过两次了。 */
    vec3 Ldir = normalize(vec3(-0.42, 0.62, 0.66));
    vec3 Vdir = vec3(0.0, 0.0, 1.0);
    vec3 Hdir = normalize(Ldir + Vdir);
    float narrow = pow(max(dot(N, Hdir), 0.0), 110.0);
    vec3 spec = envAvg * narrow * uHi * 1.7;
    vec3 caustic = (envCol * 0.6 + envAvg * 0.4) * F * 0.20 * uCaustic;

    vec3 tinted = mix(body, body * uTint.rgb, clamp(uTint.a, 0.0, 1.0));
    tinted += uTint.rgb * (uTint.a * 0.05 * envLum + uTint.a * 0.012);

    /* 材质本体。
       中心区域按模型是完全不折射的 —— 这是对的，但只有折射的话，
       面板内部就与背景毫无区别，整块玻璃会「消失」。
       做法是向环境色轻微收敛，而**不是加白**：
       暖纸底本来就接近白，再加白只会整片过曝，
       收敛则把对比压下来一点，才是「一层材料盖在上面」的观感。

       照片模式下这一步必须按底图亮度自适应。
       原来固定向 envAvg 收敛，等于「背景多亮面板就多亮」；
       碰上黄昏预设中间那条太阳带，面板跟着烧成暖橙色，
       压在它上面的白字就没有背衬 —— 实测「填满 5 张相纸」的 5
       和「今天的卡已经洗好了」那行小字几乎读不出来。
       玻璃透出多亮的东西，文字就需要多强的背衬，所以这里改成
       把面板亮度拉回一个固定区间：暗底略提、亮底压暗。
       只在照片模式生效 —— 极光那一路是调好的，一点不动。 */
    vec3 bodyTarget = envAvg * 1.02;
    float panelDim = 1.0;
    /* 亮色玻璃（浅色外观 + 照片底图）走另一条路：
       面板要保持暖白，不能被压暗，也不能跟着底图走 ——
       否则「浅色」又会变成一块深色玻璃，外观开关再次形同虚设。
       对应地，底图会被提亮一档（见 bgAt），让暖白面板不至于显得跳。 */
    if (uBgMode > 0.5 && uLightGlass < 0.5) {
      /* 比值要夹住。底图很暗时 envLum 接近 0，不夹的话这个比值会到 29 倍，
         把底图那一点点偏色一起放大成一块怪色（近黑但偏青的照片会变成满屏青）。
         夹到 6 倍足够把暗底面板提到该有的亮度，又不会放大色偏。 */
      float ratio = clamp(mix(0.62, 0.34, smoothstep(0.16, 0.78, envLum))
                          / max(envLum, 0.015), 0.0, 6.0);
      bodyTarget = envAvg * ratio;
      /* 面板本体只压一点点（0.96 → 0.80）。
         原来压到 0.44，面板几乎变成实心暗块 —— 玻璃「透」的感觉全没了，
         这也是整屏发闷的来源之一。压暗的任务现在归自适应文字。 */
      panelDim = mix(0.96, 0.80, smoothstep(0.16, 0.78, envLum));
    } else if (uLightGlass > 0.5) {
      // 暖白玻璃：向亮部收敛，不是向底图收敛
      bodyTarget = mix(envAvg, vec3(1.0, 0.985, 0.965), 0.72);
    }
    tinted = mix(tinted, bodyTarget, 0.10);

    /* ---------- 边缘厚度：贴边为 0 的鼓包 ----------
       原来是 mix(1.0, 1.0 - uEdgeShade, smoothstep(0.55, 1.0, t))：
       它在轮廓上（t=1）等于 1 - uEdgeShade，而面板**外面**没有这个系数 ——
       边界两侧差了 uEdgeShade 那么多亮度，那是一条明暗上的台阶。
       轮廓再顺滑也消不掉它，因为它根本不是形状问题。

       现在改成两端都为 0 的鼓包：贴边 0 → 稍进一点最深 → 再往里回到 0。
       跨过边界时亮度连续，看不出接缝，但玻璃仍然有「边的厚度」。

       它同时是窗口左缘那条灰带的根：侧栏贴着窗口左缘，
       面板边界与窗口边界重合，那圈台阶在别处只是一圈描边，
       在这里就是一整条 8-10px 的竖带。 */
    float ridge = smoothstep(0.0, 0.22, u) * (1.0 - smoothstep(0.22, 0.70, u));
    tinted *= 1.0 - uEdgeShade * ridge;

    vec3 gcol = (tinted + spec + caustic) * panelDim;

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
      'uIOR', 'uDisp', 'uLiquid', 'uHeight', 'uFrost', 'uWiden', 'uProbe', 'uHi', 'uCaustic',
      'uCorner', 'uEdgeShade', 'uTint', 'uPanelCount', 'uRect', 'uStyle',
      'uBgMode', 'uBgScale', 'uBgOffset', 'uOverlay', 'uLightGlass', 'uEnvAvg', 'tPhoto', 'tFrost',
      'uGlowPos', 'uGlowAmt', 'uGlowCol',
    ].forEach((n) => { U[n] = gl.getUniformLocation(prog, n); });

    /* ================= 背景：照片 / 视频 =================
       mode 0 = 程序化极光（默认，没设底图时用）
       mode 1 = 用户上传的照片或视频帧

       frost 那张不走 GPU 上的 Kawase 金字塔，而是在 CPU 侧把源画到一张
       160px 宽的小画布，再靠双线性放大回来。对毛玻璃来说，盒式降采样 +
       双线性放大在视觉上就是高斯，而代码量比搭金字塔小一个数量级；
       视频逐帧重做也只是 160×90 量级的绘制，代价可以忽略。
       顺手在同一个循环里把均值求出来，供菲涅尔的环境亮度使用。 */
    const bg = {
      mode: 0,
      el: null,            // HTMLImageElement / HTMLVideoElement
      isVideo: false,
      tex: null, frostTex: null,
      cv: null, cx: null,
      scale: [1, 1],
      offset: [0, 0],
      envAvg: [0.5, 0.5, 0.5],
      overlay: 0.30,
      /* 压暗层强度按底图亮度自适应（见 uploadBackground）。
         理由：固定值只能对一类照片成立 —— 暗照片压 0.30 已经发闷，
         亮照片压 0.30 又明显不够，白字直接糊掉。
         调用方一旦自己 setOverlay 过，就锁住不再自动改，
         免得把显式设置覆盖掉。 */
      overlayTarget: 0.30,
      overlayLocked: false,
      lastFrame: -1,
    };

    /* 极光（无底图）的压暗层。
       **极光是特别例外**：它整块底就是那张暖纸，压暗只会把它变成脏灰 ——
       浅色下压到 0.10 就够（原来的 0.30 让 #e6dbca 变成 #a1998d，
       实测就是它把整屏读成了灰）。
       暗房与空间不动：那两档本来就该是暗底，0.30 / 0.34 是调好的。 */
    function auroraOverlay() {
      const m = document.documentElement.dataset.mode;
      if (m === 'light') return 0.10;
      if (m === 'spatial') return 0.34;
      return 0.30;
    }

    /* 底图（照片 / 视频）的压暗层，按外观分档：
         浅色 → 固定 0.25（用户定的值）
         深色 → 在自适应值上**再加深 10%**（照片在暗房里要更沉一点）
         空间 → 保持原来的自适应，不动
       自适应那一档是「照片太亮时压一点，好让白字读得出来」，
       0.05–0.16 随底图亮度走 —— 和极光那条是两件事。 */
    function photoOverlay() {
      const lum = 0.2126 * bg.envAvg[0] + 0.7152 * bg.envAvg[1] + 0.0722 * bg.envAvg[2];
      const t = clamp((lum - 0.18) / (0.75 - 0.18), 0, 1);
      const adapt = 0.05 + 0.11 * (t * t * (3 - 2 * t));
      const m = document.documentElement.dataset.mode;
      if (m === 'light') return 0.25;
      if (m === 'dark') return Math.min(0.9, adapt + 0.10);
      return adapt;
    }

    function makeTex() {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      return t;
    }
    bg.tex = makeTex();
    bg.frostTex = makeTex();
    bg.cv = document.createElement('canvas');
    bg.cx = bg.cv.getContext('2d', { willReadFrequently: true });

    /* ============ 玻璃模糊程度：交给用户 ============
       设置页「外观」里那根滑杆，0–100，50 是原来的标准。

       玻璃的模糊在 WebGL 模式下**完全在着色器里**（backdrop-filter 是关掉的），
       由两个旋钮共同决定：
         frostW    毛玻璃那张降采样图的宽度 —— 图越小，放大回来越糊
         frostMix  毛玻璃在玻璃本体里的占比 —— 越大越少露出锐利的折射
       两个一起走，滑杆推到底就是"明显更糊但仍然有形状"。

       以前这两个值是写死的，而且有底图时自动加一档 ——
       那是"我替你判断"；现在改成一根明确的旋钮：
       底图细节多、读起来吃力的时候，自己往右拉一格就行。
       两端都留了余量：0 不是全清晰（262），100 也不是糊成一片（60）。 */
    function blurLevel() {
      const st = global.CJ && global.CJ.Store && global.CJ.Store.state &&
                 global.CJ.Store.state.settings;
      const v = st && typeof st.glassBlur === 'number' ? st.glassBlur : 50;
      return clamp(v, 0, 100) / 100;
    }
    function frostWidth() { return Math.round(260 - 200 * blurLevel()); }
    function frostMix() { return 0.44 + 0.36 * blurLevel(); }

    /* 取背景源的真实像素尺寸。
       必须分类型取：<canvas> 既没有 naturalWidth 也没有 videoWidth，
       早先只写了 `el.videoWidth || el.naturalWidth`，预设底图（canvas）
       因此拿到 0，uploadBackground 第一行就 return —— 纹理永远没上传，
       画面上只剩一块没初始化的近黑，看着像极光还以为是配色问题。 */
    function srcSize(el) {
      if (!el) return { w: 0, h: 0 };
      if (typeof el.getContext === 'function') {
        return { w: el.width | 0, h: el.height | 0 };
      }
      return {
        w: el.videoWidth || el.naturalWidth || el.width || 0,
        h: el.videoHeight || el.naturalHeight || el.height || 0,
      };
    }

    function uploadBackground() {
      const el = bg.el;
      if (!el) return;
      const { w, h } = srcSize(el);
      if (!w || !h) return;

      gl.bindTexture(gl.TEXTURE_2D, bg.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
        bg.uploadError = '';
      } catch (e) {
        /* 视频尚未解码出首帧时确实会抛，跳过这一帧即可 —— 但不能就此闭嘴。
           这个 catch 原本是静默的，于是「跨域视频源导致每一帧都抛」这种情况
           表现为：readyState>=2、backgroundReady=true、uBgMode=1，
           但纹理永远是空的，画面全黑，而外面一点线索都没有。
           把错误留下来，自检里能直接读到。 */
        bg.uploadError = String((e && e.message) || e);
        if (!bg.uploadWarned) {
          bg.uploadWarned = true;
          console.warn('[optics] 背景纹理上传失败：', bg.uploadError);
        }
        return;
      }

      const FROST_W = frostWidth();
      const fh = Math.max(1, Math.round(FROST_W * h / w));
      if (bg.cv.width !== FROST_W || bg.cv.height !== fh) {
        bg.cv.width = FROST_W; bg.cv.height = fh;
      }
      const cx = bg.cx;
      cx.imageSmoothingEnabled = true;
      cx.imageSmoothingQuality = 'high';
      cx.clearRect(0, 0, FROST_W, fh);
      cx.drawImage(el, 0, 0, FROST_W, fh);
      gl.bindTexture(gl.TEXTURE_2D, bg.frostTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bg.cv);

      /* 底色均值决定压暗层与面板压暗强度，但它要 getImageData ——
         那是一次 GPU→CPU 同步回读，很贵。图只上传一次，无所谓；
         视频是**每帧**都走这里，每帧回读一次会明显拖慢渲染。
         所以视频降频：每 12 帧才重算一次均值，肉眼看不出差别。
         只跳过回读本身 —— 后面的 cover 映射每帧都要算。 */
      const wantAvg = !bg.isVideo || (bg.avgTick = (bg.avgTick || 0) + 1) % 12 === 1;
      if (wantAvg) {
        try {
          const d = cx.getImageData(0, 0, FROST_W, fh).data;
          let r = 0, g = 0, b = 0, n = 0;
          for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
          if (n) bg.envAvg = [r / n / 255, g / n / 255, b / n / 255];
        } catch (e) {
          /* 跨域图会抛 SecurityError；保留上一次的均值即可 */
        }
      }

      /* 压暗层跟着底图亮度走：底图越亮压得越多。
         递推目标是连续值，渲染循环里再平滑逼近 ——
         视频每帧都会重算均值，直接赋值会让压暗层跟着画面忽明忽暗。
         分档规则见 photoOverlay()。 */
      if (!bg.overlayLocked) {
        bg.overlayTarget = photoOverlay();
      }

      // cover 映射：与 CSS object-fit:cover 等价，居中裁切
      const cssW = rect.w || 1, cssH = rect.h || 1;
      const s = Math.max(cssW / w, cssH / h);
      const dw = w * s, dh = h * s;
      bg.scale = [cssW / dw, cssH / dh];
      bg.offset = [(1 - cssW / dw) / 2, (1 - cssH / dh) / 2];
    }

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
    /* 全局跟手光晕的状态。
       颜色不再写死一个偏蓝的近白色 —— 那正是「太白了」的来源：
       它是**加法**叠上去的，接近纯白就意味着不管底图是什么都会被冲成白。
       改成按当前底决定：
         · 有底图 → 取底图自身均值的暖化版本，光是「底图的颜色更亮了一点」；
         · 极光模式 → 取主题色再往白里混，光是「主题色的光」。
       具体赋值在 tickGlow() 里，每帧跟着环境走。 */
    const glow = { x: 0, y: 0, amt: 0, target: 0, col: [0.42, 0.53, 0.82] };
    let themeCol = [0.81, 0.39, 0.22];   // --theme 的解析结果，readBg 里更新
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
    /* 极光 + 浅色这一种组合下，卡片**不参与光学层**。
       理由：玻璃的三样东西（折射位移 / 白色内高光 / 边缘压暗）
       压在暖白上是互相抵消的 —— 高光把颜色冲淡、压暗又把亮度拉回，
       净效果只剩一层灰。那一档改用「微微透光 + 一点点高斯模糊」的哑光材质
       （见 glass.css 的 .mat-aurora 一段）。
       **侧栏保留**：它贴窗口左缘、背后永远有光在动，玻璃在那里成立，
       而且它成了左右两侧的分界。
       其余任何组合（浅色 + 有底图 / 暗房 / 空间）一行都不走这条路。 */
    function auroraLight() {
      return document.documentElement.dataset.mode === 'light' && bg.mode === 0;
    }

    function queryPanelEls() {
      let list = Array.prototype.slice.call(document.querySelectorAll(PANEL_SELECTOR));
      if (auroraLight()) list = list.filter((el) => el.classList.contains('rail'));
      panelEls = list;
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
        /* 鼓起范围：短边的 30%（用户拉定的值）。
           它同时是剖面的「作用半径」—— 隆起从边界往里铺这么宽。
           原来的倒角只有短边的 11.5%，折射挤在很窄的一圈里，
           那一圈与旁边的落差就是肉眼看到的那条线。 */
        const span = clamp(short * GLASS.spanRatio, GLASS.spanRange[0], GLASS.spanRange[1]);
        const thick = clamp(short * GLASS.thicknessRatio, GLASS.thicknessRange[0], GLASS.thicknessRange[1]);
        rects[i * 4 + 0] = r.left + r.width / 2;
        rects[i * 4 + 1] = r.top + r.height / 2;
        rects[i * 4 + 2] = r.width / 2;
        rects[i * 4 + 3] = r.height / 2;
        styles[i * 4 + 0] = p.radius;
        styles[i * 4 + 1] = span;
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
      /* 纵向渐变只往下压，不往上抬。
         原来是 *1.04，等于让画面顶部比底色还亮 —— 在本来就偏亮的暖纸底上
         这是实打实的过曝来源（实测全画面 9 成像素挤在最高一档里）。
         现在只压 2%：用户明确说过「亮色模式不需要黑色的底，暖白就好」，
         原来那 6% 会在整屏上糊出一层灰，浅色下尤其像屏幕脏了。 */
      const g0 = [c[0], c[1], c[2]];
      const g1 = [c[0] * 0.98, c[1] * 0.98, c[2] * 0.98];
      gl.uniform3fv(U.uBg0, g0);
      gl.uniform3fv(U.uBg1, g1);

      // 主题色：极光模式下光晕跟着它走
      const t = parseColor(root.getPropertyValue('--theme'));
      if (t) themeCol = t.slice(0, 3);

      // 压暗层跟着外观走：极光 10%（浅色）/ 30%（暗房）/ 34%（空间）；
      // 有底图时走 photoOverlay()（浅色 0.25、深色自适应 +0.10）
      if (!bg.overlayLocked) {
        bg.overlayTarget = bg.mode === 0 ? auroraOverlay() : photoOverlay();
      }
    }

    /* 光晕颜色按当前底决定，每帧算一次（很便宜）。
       底图存在时取底图均值的暖化版 —— 光就成了「底图本身亮起来的一块」，
       而不是一层与画面无关的白。极光模式下取主题色往白里混 55%，
       既带得住主题，又不会暗到看不出是光。 */
    function updateGlowColor() {
      let r, g, b;
      if (bg.mode === 1) {
        const e = bg.envAvg;
        // 往暖白拉，同时整体提亮：光的色相是底图的，亮度比底图高一档
        r = e[0] * 0.55 + 0.42;
        g = e[1] * 0.55 + 0.38;
        b = e[2] * 0.55 + 0.33;
      } else {
        r = themeCol[0] * 0.45 + 0.55;
        g = themeCol[1] * 0.45 + 0.52;
        b = themeCol[2] * 0.45 + 0.50;
      }
      // 上限压到 0.62：这是加法叠加，再高就会把底图冲成白
      const k = 0.62 / Math.max(r, g, b, 0.001);
      const s = Math.min(1, k);
      glow.col[0] = r * s; glow.col[1] = g * s; glow.col[2] = b * s;
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
      gl.uniform1f(U.uLiquid, GLASS.liquid);
      gl.uniform1f(U.uHeight, GLASS.height);
      gl.uniform1f(U.uFrost, frostMix());
      gl.uniform1f(U.uWiden, GLASS.frostWiden);
      gl.uniform1f(U.uProbe, GLASS.probe);
      gl.uniform1f(U.uHi, GLASS.highlight);
      gl.uniform1f(U.uCaustic, GLASS.caustic);
      gl.uniform1f(U.uCorner, GLASS.cornerExp);
      gl.uniform1f(U.uEdgeShade, GLASS.edgeShade);
      gl.uniform4fv(U.uTint, new Float32Array(GLASS.tint));

      /* ---- 背景 ---- */
      // 视频逐帧重传；图片只在换了源之后传一次
      if (bg.mode === 1 && bg.el) {
        if (bg.isVideo) {
          if (bg.el.readyState >= 2) uploadBackground();
        } else if (bg.needsUpload) {
          uploadBackground();
          bg.needsUpload = false;
        }
      }
      gl.uniform1f(U.uBgMode, bg.mode);
      gl.uniform2fv(U.uBgScale, bg.scale);
      gl.uniform2fv(U.uBgOffset, bg.offset);
      bg.overlay += (bg.overlayTarget - bg.overlay) * Math.min(1, dt * 1.6);
      gl.uniform1f(U.uOverlay, bg.overlay);
      /* 亮色玻璃：浅色外观 + 照片底图。每帧重读 —— 切换外观时立刻生效，
         不用等任何重绘。读 dataset 很便宜。 */
      gl.uniform1f(U.uLightGlass,
        (bg.mode === 1 && document.documentElement.dataset.mode === 'light') ? 1 : 0);
      gl.uniform3fv(U.uEnvAvg, bg.envAvg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, bg.tex);
      gl.uniform1i(U.tPhoto, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, bg.frostTex);
      gl.uniform1i(U.tFrost, 1);

      /* ---- 全局跟手光晕 ---- */
      // 进退场用指数逼近；位置本身不平滑（跟手要快，慢了比不跟更明显）
      updateGlowColor();
      glow.amt += (glow.target - glow.amt) * Math.min(1, dt * 7);
      gl.uniform2f(U.uGlowPos, glow.x, glow.y);
      /* 强度上限从 1.0 收到 0.62：颜色已经带了底图/主题的色相，
         再按 1.0 叠上去还是会过曝。收一档之后它是一层「有颜色的亮」，
         不是一块白斑。 */
      gl.uniform1f(U.uGlowAmt, glow.amt * 0.62);
      gl.uniform3fv(U.uGlowCol, glow.col);

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
      // 全局光晕直接跟真实光标，不做平滑：光晕跟手迟钝会比不跟更明显
      glow.x = e.clientX;
      glow.y = e.clientY;
      glow.target = 1;
    }

    function onLeave() { glow.target = 0; }

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
          global.addEventListener('mouseleave', onLeave, { passive: true });
          global.document.addEventListener('mouseleave', onLeave, { passive: true });
        }
        watchPanels();

        draw(1 / 60);
        raf = requestAnimationFrame(tick);
      },

      /** 主题切换后调用：颜色与尺寸都可能变了 */
      refresh() {
        if (!running) return;
        resize();
        /* 底图是静态图片时，纹理只在 needsUpload 时重传一次 ——
           而模糊滑杆改了降采样图的尺寸，必须让它重传，
           否则拖动滑杆画面不动（只有视频会每帧重传，不受影响）。 */
        if (bg.mode === 1 && !bg.isVideo) bg.needsUpload = true;
        // 底色不是读一次就完事，接着盯一会儿（见 draw 里的说明）
        bgWatch = 1.4;
      },

      /** 视图切换后调用 */
      measure() { if (running) { queryPanelEls(); updatePanelRects(); } },

      /* ---------------- 背景来源 ----------------
         el 传 HTMLImageElement / HTMLVideoElement / HTMLCanvasElement。
         三张程序化预设就是以 canvas 直接进来的（零加载、不会失败）。
         视频由调用方保证已在播放（muted + loop + playsInline），
         这里只负责每帧把当前帧搬进纹理。
         传 null 即退回程序化极光。 */
      setBackground(el, isVideo) {
        bg.el = el || null;
        bg.isVideo = !!isVideo;
        if (!bg.el) { bg.mode = 0; return; }
        bg.mode = 1;
        bg.needsUpload = true;
        // 图片可能还没解码完就传了空纹理；解码后再补一次
        if (!isVideo && typeof el.decode === 'function') {
          el.decode().then(() => { bg.needsUpload = true; }).catch(() => {});
        }
      },

      /** 退回程序化极光 */
      clearBackground() {
        bg.el = null; bg.mode = 0;
        // 极光有自己的压暗档位（浅色几乎为 0、暗房 0.30）；底图的自适应值不能留着
        if (!bg.overlayLocked) bg.overlayTarget = auroraOverlay();
      },

      /* 压暗层强度（规格里的 L1）。
         **必须同时写 overlay 与 overlayTarget**：渲染循环每帧都在把
         overlay 往 overlayTarget 插值，只写 overlay 的话下一帧就被拉回去了 ——
         这个 bug 让截图工具的 --overlay0 一直是空操作（画面毫无变化）。 */
      setOverlay(v) {
        bg.overlayLocked = true;
        bg.overlay = clamp(v, 0, 0.9);
        bg.overlayTarget = bg.overlay;
      },

      get hasBackground() { return bg.mode === 1; },

      /** 自检用：背景纹理上传是否一直在失败（跨域源会每帧都抛） */
      get backgroundUploadError() { return bg.uploadError || ''; },

      /** 当前背景是否已就绪（图片解码完 / 视频出帧 / 画布已绘制） */
      get backgroundReady() {
        if (bg.mode !== 1 || !bg.el) return false;
        if (bg.isVideo) return bg.el.readyState >= 2;
        // 同样是 canvas 与 img 的区别：canvas 没有 complete / naturalWidth
        return srcSize(bg.el).w > 0;
      },

      stop() {
        running = false;
        if (raf) cancelAnimationFrame(raf);
        raf = null;
        global.removeEventListener('resize', onResize);
        global.removeEventListener('mousemove', onMove);
        global.removeEventListener('mouseleave', onLeave);
        global.document.removeEventListener('mouseleave', onLeave);
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
          /* 毛玻璃那张降采样图的宽度与它在玻璃本体里的占比 ——
             「模糊提高一个层级」调的就是这两个数，光看画面量不出来。 */
          frostW: frostWidth(),
          frostMix: +frostMix().toFixed(3),
          blurSetting: (global.CJ && global.CJ.Store && global.CJ.Store.state &&
                        global.CJ.Store.state.settings.glassBlur),
          overlay: +bg.overlayTarget.toFixed(3),
          /* 真正送进着色器的几何。
             查「玻璃的位置和 DOM 对不上」这类问题时，
             看 getBoundingClientRect 是没用的 —— 要看的是这一刻的 uRect/uStyle。 */
          panelRects: panels.map((p) => ({
            cls: String(p.r && panelEls[p.idx] ? panelEls[p.idx].className : '?').slice(0, 30),
            rect: [p.r.left, p.r.top, p.r.width, p.r.height].map((v) => +v.toFixed(1)),
            radius: p.radius,
            span: +clamp(Math.min(p.r.width, p.r.height) * GLASS.spanRatio,
                         GLASS.spanRange[0], GLASS.spanRange[1]).toFixed(1),
            thick: +clamp(Math.min(p.r.width, p.r.height) * GLASS.thicknessRatio,
                          GLASS.thicknessRange[0], GLASS.thicknessRange[1]).toFixed(1),
          })),
          radii: blobs.map((b) => Math.round(b.r)),
          weights: blobs.map((b) => +b.w.toFixed(3)),
        };
      },
    };

    return api;
  }

  global.Optics = { create, isSupported, PANEL_SELECTOR, MAX_PANELS };
})(window);
