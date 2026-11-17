'use strict';
/**
 * route_gen.js —— 随机校园路线生成器
 *
 * 思路：
 *   1. 把 reference_run_safe.json 里录制的真实校园轨迹当作“校园道路骨架”，
 *      先去噪平滑，再按 2 米间距重采样成一条可漫游的走廊。
 *   2. 每次运行随机决定：起点位置、出发方向、总路程、折返点、左右偏移、GPS 抖动。
 *   3. 沿走廊按固定步长推进，走到走廊两端就自然折返（相当于“跑到操场另一头再折回”）。
 *   4. 每一步固定 5 秒，步长固定 11.07 米 => 配速与原来完全一致（7'32"/km）。
 *
 * 这样每一趟的路线都不一样（起点不同、方向不同、折返点不同、左右位置不同），
 * 但轨迹始终落在校内已知可跑的道路上，不会跑到教学楼或校外。
 */

const EARTH_R = 6371000;

// ==== 与旧版完全一致的配速参数 ====
const SPEED_MPS = 2.214;              // 7.53 分/公里，和原版一模一样
const STEP_SECONDS = 5;               // 原版：每 5 秒上传一个点
const STEP_METERS = SPEED_MPS * STEP_SECONDS; // ≈ 11.07 米

function toRad(d) { return d * Math.PI / 180; }

function haversine(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

/** 以校区中心为原点的局部平面坐标（米），校园尺度下误差可忽略 */
function makeProjection(lat0, lon0) {
  const ky = 110540;                                   // 1 度纬度 ≈ 110.54 km
  const kx = 111320 * Math.cos(toRad(lat0));           // 1 度经度
  return {
    forward: (lat, lon) => [(lon - lon0) * kx, (lat - lat0) * ky],
    inverse: (x, y) => [lat0 + y / ky, lon0 + x / kx],
  };
}

function rand(min, max) { return min + Math.random() * (max - min); }
function randInt(min, max) { return Math.floor(rand(min, max + 1)); }

/** 三次移动平均（端点保持），去掉 GPS 抖动，让路线看起来是平滑跑出来的 */
function smooth(points, passes = 3, window = 2) {
  let cur = points.map(p => [p[0], p[1]]);
  const n = cur.length;
  for (let pass = 0; pass < passes; pass++) {
    const next = cur.map(p => [p[0], p[1]]);
    for (let i = 0; i < n; i++) {
      let sx = 0, sy = 0, c = 0;
      for (let k = -window; k <= window; k++) {
        const j = i + k;
        if (j < 0 || j >= n) continue;
        sx += cur[j][0]; sy += cur[j][1]; c++;
      }
      next[i] = [sx / c, sy / c];
    }
    cur = next;
  }
  return cur;
}

/**
 * 把轨迹点变成等间距走廊
 * @returns {{pts: Array<[number,number]>, cum: number[], len: number, proj: object}}
 */
function buildCorridor(trackInfo, spacing = 2, smoothPasses = 1, smoothWindow = 1) {
  const raw = trackInfo.map(p => [Number(p.latitude), Number(p.longitude)]);
  const lat0 = raw.reduce((s, p) => s + p[0], 0) / raw.length;
  const lon0 = raw.reduce((s, p) => s + p[1], 0) / raw.length;
  const proj = makeProjection(lat0, lon0);

  const xy = smooth(raw.map(p => proj.forward(p[0], p[1])), smoothPasses, smoothWindow);

  // 累积弧长
  const cum = [0];
  for (let i = 1; i < xy.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
  }
  const len = cum[cum.length - 1];

  // 等间距重采样
  const pts = [];
  let seg = 1;
  for (let s = 0; s <= len; s += spacing) {
    while (seg < cum.length - 1 && cum[seg] < s) seg++;
    const s0 = cum[seg - 1], s1 = cum[seg];
    const t = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
    pts.push([
      xy[seg - 1][0] + (xy[seg][0] - xy[seg - 1][0]) * t,
      xy[seg - 1][1] + (xy[seg][1] - xy[seg - 1][1]) * t,
    ]);
  }
  return { pts, cum, len, proj, spacing };
}

/** 取走廊上弧长 s 处的位置与切向单位向量 */
function sampleAt(corridor, s) {
  const { pts, spacing } = corridor;
  const maxIdx = pts.length - 1;
  const clamped = Math.min(Math.max(s, 0), maxIdx * spacing);
  const idx = clamped / spacing;
  const i = Math.min(Math.floor(idx), maxIdx - 1);
  const t = idx - i;
  const x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t;
  const y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t;
  let dx = pts[i + 1][0] - pts[i][0];
  let dy = pts[i + 1][1] - pts[i][1];
  const d = Math.hypot(dx, dy) || 1;
  return { x, y, tx: dx / d, ty: dy / d };
}


/* ------------------------------------------------------------------
 * 路线生成
 *
 * 关键约束：学校的有效判定会看“打卡点”，所以每趟都要把校园主干道走完一遍，
 * 否则可能漏点导致本次无效。因此在保证“全覆盖”的前提下做随机：
 *   - 随机起点（沿着主路 0 ~ L 任取）
 *   - 先朝较近的一端跑一小段（d1），折返
 *   - 顺向把整条主路跑完（L）
 *   - 再按剩余路程 R 继续（R 随机 0 ~ 900 m）
 * 总路程 = d1 + L + R，平均约 3.6 km，比原来的 2.66 km 更长。
 * 配速始终不变：每点 5 秒，步长 11.07 米。
 * ------------------------------------------------------------------ */

function pickLegs(len, opts = {}) {
  const extra = opts.extraMeters !== undefined ? opts.extraMeters : rand(0, 700);
  const s0 = opts.startS !== undefined
    ? Math.min(Math.max(opts.startS, 25), len - 25)
    : rand(25, Math.max(25, len - 25));

  // 朝较近的一端跑，折返点就在那一端，天然合理
  const dir1 = s0 <= len / 2 ? -1 : 1;
  const d1 = Math.min(s0, len - s0);
  const end1 = dir1 < 0 ? 0 : len;
  const end2 = dir1 < 0 ? len : 0;

  const legs = [];
  if (d1 > 1) legs.push({ start: s0, dir: dir1, length: d1 });
  legs.push({ start: end1, dir: -dir1, length: len });
  if (extra > 1) legs.push({ start: end2, dir: dir1, length: extra });

  const total = legs.reduce((a, l) => a + l.length, 0);
  return { legs, s0, d1, total };
}

/**
 * 生成一条随机路线
 * @param {object} corridor buildCorridor 的返回值
 * @param {object} opts
 *   extraMeters  走完主路后额外加跑的距离（米，默认随机 0~900）
 *   startS       指定起点弧长（默认随机）
 *   lateral      最大左右偏移（米，默认随机）
 *   jitter       单点 GPS 抖动（米，默认随机）
 */
function generateRoute(corridor, opts = {}) {
  const { len, proj } = corridor;
  const lateral = opts.lateral !== undefined ? opts.lateral : rand(2.5, 6.0);
  const jitter = opts.jitter !== undefined ? opts.jitter : rand(0.6, 1.5);

  const { legs, s0, total } = pickLegs(len, opts);
  const steps = Math.max(1, Math.round(total / STEP_METERS));
  const distance = steps * STEP_METERS;      // 保证与步数严格对应
  const seconds = steps * STEP_SECONDS;

  // 速度抖动：总和归零，平均配速与原来完全一致，但瞬间快慢像真人
  const noises = [];
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    const n = rand(-0.16, 0.16);
    noises.push(1 + n);
    sum += n;
  }
  const norm = steps / (steps + sum);

  // 左右偏移场：两个不同波长的正弦叠加，让去程和回程分别跑在路的两侧
  const amp1 = lateral * rand(0.5, 1.0);
  const amp2 = lateral * rand(0.10, 0.35);
  const lam1 = rand(180, 520);
  const lam2 = rand(45, 110);
  const ph1 = rand(0, Math.PI * 2);
  const ph2 = rand(0, Math.PI * 2);

  const points = [];
  let traveled = 0;

  function emit(sArc) {
    const smp = sampleAt(corridor, sArc);
    const nx = -smp.ty, ny = smp.tx;                    // 左法向
    const off = amp1 * Math.sin(2 * Math.PI * traveled / lam1 + ph1) +
      amp2 * Math.sin(2 * Math.PI * traveled / lam2 + ph2);
    const jx = rand(-jitter, jitter);
    const jy = rand(-jitter, jitter);
    const [lat, lon] = proj.inverse(smp.x + nx * off + jx, smp.y + ny * off + jy);
    points.push({ latitude: Number(lat.toFixed(6)), longitude: Number(lon.toFixed(6)) });
  }

  emit(s0);

  let legIdx = 0;
  let inLeg = 0;          // 当前这一段已跑的距离
  let s = s0;

  function nextLeg() {
    legIdx++;
    inLeg = 0;
    if (legIdx < legs.length) s = legs[legIdx].start;
  }

  for (let i = 0; i < steps; i++) {
    let remain = STEP_METERS * noises[i] * norm;
    while (remain > 1e-9) {
      if (legIdx >= legs.length) {
        // 兜底：零头沿最后一段方向走完
        const dir = legs.length ? legs[legs.length - 1].dir : 1;
        const take = remain;
        s = Math.min(len, Math.max(0, s + dir * take));
        traveled += take;
        break;
      }
      const leg = legs[legIdx];
      const left = leg.length - inLeg;
      if (left <= 1e-9) { nextLeg(); continue; }
      const take = Math.min(remain, left);
      s = Math.min(len, Math.max(0, s + leg.dir * take));
      inLeg += take;
      traveled += take;
      remain -= take;
      if (left - take <= 1e-9) nextLeg();
    }
    emit(s);
  }

  return {
    points,
    distance: Math.round(distance),
    seconds,
    pace: seconds / (distance / 1000),
    startS: Math.round(s0),
    turns: Math.max(0, Math.min(legs.length, 3) - 1),
    stepMeters: STEP_METERS,
    lateral,
    jitter,
    legs: legs.map(l => ({ start: Math.round(l.start), dir: l.dir, length: Math.round(l.length) })),
  };
}

/** 简单统计，给日志和预览用 */
function summarize(route) {
  let dist = 0;
  for (let i = 1; i < route.points.length; i++) {
    dist += haversine(route.points[i - 1].latitude, route.points[i - 1].longitude,
      route.points[i].latitude, route.points[i].longitude);
  }
  return {
    points: route.points.length,
    distanceMeters: Math.round(dist),
    seconds: route.seconds,
    minutes: Number((route.seconds / 60).toFixed(2)),
    paceMinPerKm: Number((route.seconds / 60 / (dist / 1000)).toFixed(2)),
  };
}

module.exports = {
  SPEED_MPS, STEP_SECONDS, STEP_METERS,
  buildCorridor, generateRoute, summarize, haversine,
};
