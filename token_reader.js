const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const APPID = 'wxb3cc2fbb0d37a32b';
const USERS_DIR = path.join(process.env.APPDATA, 'Tencent', 'xwechat', 'radium', 'users');

function varint(buf, p) {
  let x = 0, s = 0;
  while (p < buf.length) {
    const b = buf[p++];
    x |= (b & 0x7f) << s;
    if (!(b & 0x80)) break;
    s += 7;
  }
  return [x >>> 0, p];
}

function decryptFile(mainPath, crcPath) {
  const main = fs.readFileSync(mainPath);
  const crc = fs.readFileSync(crcPath);
  const iv = crc.slice(12, 28);
  const actualSize = main.readUInt32LE(0);
  const ct = main.slice(4, 4 + actualSize);
  const cryptKey = 'w' + APPID.slice(2).split('').filter((_, i) => i % 2 === 0).join('');
  const key = Buffer.alloc(16);
  Buffer.from(cryptKey, 'ascii').copy(key);
  const d = crypto.createDecipheriv('aes-128-cfb', key, iv);
  return Buffer.concat([d.update(ct), d.final()]);
}

function parseMMKV(pt) {
  const out = {};
  let p = 4;
  while (p < pt.length) {
    let klen, vlen;
    [klen, p] = varint(pt, p);
    if (!klen || klen > 4096 || p + klen > pt.length) break;
    const k = pt.slice(p, p + klen).toString('utf8');
    p += klen;
    [vlen, p] = varint(pt, p);
    if (vlen > pt.length - p) break;
    const raw = pt.slice(p, p + vlen);
    p += vlen;
    const s = raw.toString('utf8');
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) {
      try {
        const obj = JSON.parse(s.slice(a, b + 1));
        if (obj && Object.prototype.hasOwnProperty.call(obj, 'data')) out[k] = obj.data;
        else out[k] = s.slice(a, b + 1);
      } catch { out[k] = s; }
    } else out[k] = s;
  }
  return out;
}

function getToken() {
  const candidates = [];
  if (!fs.existsSync(USERS_DIR)) return null;
  for (const user of fs.readdirSync(USERS_DIR)) {
    const root = path.join(USERS_DIR, user, 'applet', 'local', APPID);
    if (!fs.existsSync(root)) continue;
    for (const dir of ['usrmmkvstorage0', 'usrmmkvstorage1', 'mmkvadapterstorage']) {
      const mainPath = path.join(root, dir, APPID);
      const crcPath = mainPath + '.crc';
      if (!fs.existsSync(mainPath) || !fs.existsSync(crcPath)) continue;
      try {
        const kv = parseMMKV(decryptFile(mainPath, crcPath));
        if (kv.Token) candidates.push(kv.Token);
        if (kv.token) candidates.push(kv.token);
      } catch (e) {
        // ignore corrupt store
      }
    }
  }
  return candidates[0] || null;
}

module.exports = { getToken };

if (require.main === module) {
  const t = getToken();
  console.log(t ? t : 'TOKEN_NOT_FOUND');
}
