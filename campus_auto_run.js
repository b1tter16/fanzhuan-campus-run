const fs = require('fs');
const path = require('path');
const { getToken } = require('./token_reader');

const BASE = 'https://mp.schoopia.com/adm/sport/applet/';
const LOG = path.join(__dirname, 'campus_auto_run.log');
const TRACK = path.join(__dirname, 'reference_run_safe.json');
const APPID = 'wxb3cc2fbb0d37a32b';
const MAX_POINTS = 241;
const POINT_INTERVAL = 5; // seconds, same as a normal run
const NOTICE = '黄河科技学院特供。本工具完全免费并在 GitHub 开源，禁止倒卖；如您是付费获取，请联系卖家退款。';

function log(...args) {
  const line = new Date().toISOString() + ' ' + args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  console.log(line);
  try { fs.appendFileSync(LOG, line + '\n'); } catch {}
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function post(token, ep, body = {}, retries = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const r = await fetch(BASE + ep, {
        method: 'POST',
        headers: {'content-type': 'application/json', 'Token': token},
        body: JSON.stringify({mpCode: 'FZJY', ...body})
      });
      const text = await r.text();
      let j;
      try { j = JSON.parse(text); } catch { j = {raw: text}; }
      return {status: r.status, j, text};
    } catch (e) {
      lastErr = e;
      log('网络错误', ep.slice(0, 60), e.message, '重试', attempt);
      await sleep(1500 * attempt);
    }
  }
  return {status: 0, j: {success: false, error: String(lastErr)}, text: String(lastErr)};
}

async function waitUntil(tsSec) {
  const target = tsSec * 1000;
  while (Date.now() < target - 100) {
    await sleep(Math.min(target - Date.now(), 5000));
  }
}

function localTimeOk() {
  const h = new Date().getHours();
  return h >= 6 && h < 23;
}

(async () => {
  log('=== 校园跑自动任务开始 ===');
  log(NOTICE);
  const token = getToken();
  if (!token) { log('未找到登录 Token，请先在微信里打开一次“翻转任务跑”'); return 2; }

  if (!localTimeOk()) { log('当前不在 06:00-23:00 有效时段，跳过'); return 3; }

  if (!fs.existsSync(TRACK)) { log('缺少 reference_run_safe.json，请先放入自己的轨迹文件'); return 6; }
  const trackData = JSON.parse(fs.readFileSync(TRACK, 'utf8'));
  const pts = trackData.trackInfo.slice(0, MAX_POINTS);

  const nowInfo = await post(token, 'get/now/running/info?type=1');
  if (nowInfo.j.success && nowInfo.j.data && nowInfo.j.data.runningFlag) {
    log('已有正在进行中的跑步，跳过：', nowInfo.j.data.runningCode);
    return 4;
  }

  const task = await post(token, 'get/running/task/info/by/code');
  if (task.j.success && task.j.data) {
    log('任务进度：', '有效公里', task.j.data.validDistance, '/', task.j.data.taskTotalDistance,
      '有效次数', task.j.data.validNumber, '/', task.j.data.taskTotalNumber);
  }

  const start = Math.floor(Date.now() / 1000);
  const p0 = pts[0];
  const startQ = `time=${start}&latitude=${p0.latitude}&longitude=${p0.longitude}` +
    `&lastLatitude=${p0.latitude}&lastLongitude=${p0.longitude}&type=1`;
  const st = await post(token, 'start/running?' + startQ);
  log('开始跑步', st.status, st.text.slice(0, 500));
  if (!st.j.success || !st.j.data || !st.j.data.runningInfo) { log('开始失败，退出'); return 5; }

  const code = st.j.data.runningInfo.code;
  log('记录编号', code, '服务器开始时间', st.j.data.runningInfo.startTime);

  let last = {lat: Number(p0.latitude), lon: Number(p0.longitude), t: start};
  let saved = 0;
  let aborted = false;

  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    const lat = Number(p.latitude), lon = Number(p.longitude);
    const t = start + i * POINT_INTERVAL;
    await waitUntil(t);
    const q = `recordCode=${code}&latitude=${lat}&longitude=${lon}` +
      `&lastLatitude=${last.lat}&lastLongitude=${last.lon}` +
      `&time=${t}&startTime=${start}&lastTime=${last.t}` +
      `&status=0&trackIndex=${i}&type=1`;
    const r = await post(token, 'save/running/track?' + q);
    if (!r.j.success) {
      log('保存轨迹失败', i, r.status, r.text.slice(0, 800));
      aborted = true;
      break;
    }
    saved++;
    if (i % 20 === 0 || i === pts.length - 1) {
      log('进度', i + '/' + (pts.length - 1), '距离', r.j.data && r.j.data.runningDistance,
        '配速', r.j.data && r.j.data.runningSpeedStr);
    }
    last = {lat, lon, t};
  }

  const endT = start + (pts.length - 1) * POINT_INTERVAL;
  await waitUntil(endT);
  const finishQ = `recordCode=${code}&latitude=${last.lat}&longitude=${last.lon}` +
    `&lastLatitude=${last.lat}&lastLongitude=${last.lon}` +
    `&time=${endT}&startTime=${start}&lastTime=${last.t}&type=1`;
  const fin = await post(token, 'finish/running?' + finishQ, {}, 5);
  log('结束跑步', fin.status, fin.text.slice(0, 1500));
  log('已上传轨迹点', saved, aborted ? '(中途失败)' : '');

  const info = await post(token, 'get/running/record/info/by/record?record=' + code);
  const ri = info.j.data && info.j.data.runningInfo;
  if (ri) log('结果', {isValid: ri.isValid, runningDistance: ri.runningDistance, runningTime: ri.runningTime, endTime: ri.endTime});
  log('=== 校园跑自动任务结束 ===');
  return 0;
})().then(code => process.exit(code)).catch(e => { log('未捕获异常', e.stack || String(e)); process.exit(1); });
