'use strict';
/**
 * API riwayat Segel Digital (Universitas STEKOM) — penyimpanan di PostgreSQL.
 * Kontrak sama dengan versi Apps Script: POST JSON { token, action, ... } -> { ok, records }
 * action: list | add | delete | clear. Hanya metadata dokumen; PDF dan kunci tidak pernah dikirim.
 *
 * Env:
 *   DATABASE_URL            atau PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE (disarankan, nama DB boleh berspasi)
 *   SYNC_TOKEN              SHA-256 hex dari "sync|<kata sandi login>" (sama dengan yang dikirim web)
 *   ALLOWED_ORIGINS         daftar origin dipisah koma, mis. https://segeldokumen.vercel.app
 *   PORT                    default 3000
 *   PUBLIC_DIR              folder berisi index.html (opsional). Jika ada, GET / menyajikan web; API tetap di POST / dan POST /api/segel
 *   MAX_RECORDS             default 500
 */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const PORT = Number(process.env.PORT || 3000);
const MAX_RECORDS = Number(process.env.MAX_RECORDS || 500);
const TOKEN = process.env.SYNC_TOKEN || '';
const ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://segeldokumen.vercel.app').split(',').map(s => s.trim()).filter(Boolean);
if (!/^[0-9a-f]{64}$/.test(TOKEN)) { console.error('SYNC_TOKEN wajib diisi (SHA-256 hex 64 karakter).'); process.exit(1); }

// web statis (opsional): dibaca sekali saat start
const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(__dirname, 'public');
let PAGE = null;
try { PAGE = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html')); } catch (e) {}
const PAGE_ETAG = PAGE && '"' + crypto.createHash('sha1').update(PAGE).digest('hex').slice(0, 16) + '"';

const pool = new Pool(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL, max: 5 } : { max: 5 });

const COLS = ['id', 't', 'file', 'out', 'size', 'pages', 'stamps', 'signer', 'nidn', 'jabatan', 'layers', 'fp', 'sha'];
const SCHEMA = `
CREATE TABLE IF NOT EXISTS segel_riwayat (
  id         text PRIMARY KEY,
  waktu      timestamptz NOT NULL,
  file       text NOT NULL DEFAULT '',
  hasil      text NOT NULL DEFAULT '',
  ukuran     bigint NOT NULL DEFAULT 0,
  halaman    integer NOT NULL DEFAULT 0,
  cap        integer NOT NULL DEFAULT 0,
  penanda    text NOT NULL DEFAULT '',
  nidn       text NOT NULL DEFAULT '',
  jabatan    text NOT NULL DEFAULT '',
  lapisan    text NOT NULL DEFAULT '',
  sidik_cert text NOT NULL DEFAULT '',
  sha256     text NOT NULL DEFAULT '',
  dibuat     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS segel_riwayat_waktu_idx ON segel_riwayat (waktu DESC);`;

const str = (v, n = 300) => (typeof v === 'string' ? v.slice(0, n) : '');
const int = v => { const x = Math.round(Number(v)); return Number.isFinite(x) && x >= 0 && x < 2 ** 40 ? x : 0; };

function clean(r) {
  const id = str(r && r.id, 64);
  const t = new Date(r && r.t);
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(id) || isNaN(t)) return null;
  return [id, t.toISOString(), str(r.file), str(r.out), int(r.size), int(r.pages), int(r.stamps), str(r.signer), str(r.nidn, 30), str(r.jabatan), str(r.layers, 500), str(r.fp, 100), str(r.sha, 100)];
}

async function list() {
  const { rows } = await pool.query(`SELECT id, waktu, file, hasil, ukuran, halaman, cap, penanda, nidn, jabatan, lapisan, sidik_cert, sha256
    FROM segel_riwayat ORDER BY waktu DESC LIMIT $1`, [MAX_RECORDS]);
  return rows.map(r => ({ id: r.id, t: r.waktu.toISOString(), file: r.file, out: r.hasil, size: Number(r.ukuran), pages: r.halaman, stamps: r.cap,
    signer: r.penanda, nidn: r.nidn, jabatan: r.jabatan, layers: r.lapisan, fp: r.sidik_cert, sha: r.sha256 }));
}

async function handle(req) {
  const act = req.action;
  if (act === 'list') return list();
  if (act === 'add') {
    const rows = (Array.isArray(req.records) ? req.records : []).slice(0, 100).map(clean).filter(Boolean);
    for (const v of rows) {
      await pool.query(`INSERT INTO segel_riwayat (id, waktu, file, hasil, ukuran, halaman, cap, penanda, nidn, jabatan, lapisan, sidik_cert, sha256)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (id) DO NOTHING`, v);
    }
    await pool.query(`DELETE FROM segel_riwayat WHERE id IN (SELECT id FROM segel_riwayat ORDER BY waktu DESC OFFSET $1)`, [MAX_RECORDS]);
    return list();
  }
  if (act === 'delete') { await pool.query('DELETE FROM segel_riwayat WHERE id = $1', [str(req.id, 64)]); return list(); }
  if (act === 'clear') { await pool.query('TRUNCATE segel_riwayat'); return []; }
  throw Object.assign(new Error('unknown_action'), { code: 400 });
}

function tokenOk(t) {
  if (typeof t !== 'string' || t.length !== TOKEN.length) return false;
  return crypto.timingSafeEqual(Buffer.from(t), Buffer.from(TOKEN));
}

// pembatas laju sederhana per IP (percobaan token salah)
const fails = new Map();
function limited(ip) { const f = fails.get(ip); return f && f.n >= 10 && Date.now() - f.t < 60000; }
function noteFail(ip) { const f = fails.get(ip); if (!f || Date.now() - f.t > 60000) fails.set(ip, { n: 1, t: Date.now() }); else f.n++; }

const server = http.createServer((req, res) => {
  const origin = req.headers.origin;
  const allow = origin && ORIGINS.includes(origin);
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (allow) { headers['Access-Control-Allow-Origin'] = origin; headers['Vary'] = 'Origin'; }
  const send = (code, obj) => { res.writeHead(code, headers); res.end(JSON.stringify(obj)); };
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

  if (req.method === 'OPTIONS') {
    res.writeHead(204, Object.assign({}, headers, { 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' }));
    return res.end();
  }
  const url = (req.url || '/').split('?')[0].replace(/\/+$/, '') || '/';
  if (req.method === 'GET' || req.method === 'HEAD') {
    if (url === '/' && PAGE) {
      const h = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'ETag': PAGE_ETAG, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'SAMEORIGIN' };
      if (req.headers['if-none-match'] === PAGE_ETAG) { res.writeHead(304, h); return res.end(); }
      res.writeHead(200, h); return res.end(req.method === 'HEAD' ? undefined : PAGE);
    }
    if (url === '/health' || url === '/' || url === '/api/segel' || url === '/api/segel/health') {
      return pool.query('SELECT 1').then(() => send(200, { ok: true, service: 'segel-api', db: true }), () => send(503, { ok: false, service: 'segel-api', db: false }));
    }
    return send(404, { ok: false, error: 'not_found' });
  }
  if (req.method !== 'POST') return send(405, { ok: false, error: 'method_not_allowed' });
  if (url !== '/' && url !== '/api/segel') return send(404, { ok: false, error: 'not_found' });
  if (origin && !allow) return send(403, { ok: false, error: 'origin_not_allowed' });

  let body = '', size = 0, dead = false;
  req.on('data', c => { size += c.length; if (size > 200 * 1024) { dead = true; send(413, { ok: false, error: 'too_large' }); req.destroy(); } else body += c; });
  req.on('end', async () => {
    if (dead) return;
    let j; try { j = JSON.parse(body); } catch (e) { return send(400, { ok: false, error: 'bad_request' }); }
    if (limited(ip)) return send(429, { ok: false, error: 'rate_limited' });
    if (!j || !tokenOk(j.token)) { noteFail(ip); return send(401, { ok: false, error: 'unauthorized' }); }
    try { send(200, { ok: true, records: await handle(j) }); }
    catch (e) { if (e.code === 400) return send(400, { ok: false, error: e.message }); console.error(e); send(500, { ok: false, error: 'server_error' }); }
  });
});

(async () => {
  for (let i = 0; ; i++) {
    try { await pool.query(SCHEMA); break; }
    catch (e) { console.error('Menunggu database…', e.message); if (i >= 30) process.exit(1); await new Promise(r => setTimeout(r, 2000)); }
  }
  server.listen(PORT, '0.0.0.0', () => console.log('segel-api siap di :' + PORT));
})();
process.on('SIGTERM', () => server.close(() => pool.end().then(() => process.exit(0))));
