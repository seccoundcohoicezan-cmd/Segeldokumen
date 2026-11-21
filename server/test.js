// Uji integrasi: jalankan dengan PG* + SYNC_TOKEN yang menunjuk ke database uji (BUKAN produksi): node test.js
const { spawn } = require('child_process');
const T = process.env.SYNC_TOKEN, PORT = 3991, U = `http://127.0.0.1:${PORT}`;
const post = (b, h = {}) => fetch(U, { method: 'POST', headers: Object.assign({ 'Content-Type': 'text/plain' }, h), body: JSON.stringify(b) }).then(async r => [r.status, await r.json(), r.headers]);
const ok = (c, m) => { if (!c) { console.error('GAGAL:', m); process.exitCode = 1; } else console.log('ok  -', m); };
(async () => {
  const p = spawn('node', ['server.js'], { env: Object.assign({}, process.env, { PORT, ALLOWED_ORIGINS: 'https://segeldokumen.vercel.app' }), stdio: 'inherit' });
  for (let i = 0; i < 40; i++) { try { if ((await fetch(U + '/health')).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 250)); }
  let [s, j] = await post({ token: 'x'.repeat(64), action: 'list' }); ok(s === 401 && !j.ok, 'token salah ditolak');
  await post({ token: T, action: 'clear' });
  const rec = { id: 'AAAA1111BBBB2222', t: '2026-10-19T04:00:00.000Z', file: 'a.pdf', out: 'a-signed.pdf', size: 1234, pages: 3, stamps: 2, signer: 'Dr. X', nidn: '0612345678', jabatan: 'Rektor', layers: 'tanda tangan digital, AES-256', fp: 'AB', sha: 'CD' };
  [s, j] = await post({ token: T, action: 'add', records: [rec, { id: '!!', t: 'bukan tanggal' }] }); ok(s === 200 && j.records.length === 1, 'add valid, rekaman rusak dibuang');
  ok(JSON.stringify(j.records[0]) === JSON.stringify(rec), 'rekaman kembali persis sama (round-trip)');
  [s, j] = await post({ token: T, action: 'add', records: [Object.assign({}, rec, { file: 'dobel.pdf' })] }); ok(j.records.length === 1 && j.records[0].file === 'a.pdf', 'id sama tidak menimpa (idempoten)');
  await post({ token: T, action: 'add', records: [Object.assign({}, rec, { id: 'CCCC3333DDDD4444', t: '2026-10-20T04:00:00Z' })] });
  [s, j] = await post({ token: T, action: 'list' }); ok(j.records.length === 2 && j.records[0].id === 'CCCC3333DDDD4444', 'urut terbaru dulu');
  [s, j] = await post({ token: T, action: 'add', records: [Object.assign({}, rec, { id: 'EEEE5555', file: "x'); DROP TABLE segel_riwayat;--" })] }); [s, j] = await post({ token: T, action: 'list' }); ok(j.records.length === 3, 'SQL injection tidak berefek');
  [s, j] = await post({ token: T, action: 'delete', id: 'CCCC3333DDDD4444' }); ok(j.records.length === 2, 'delete');
  let r = await fetch(U, { method: 'OPTIONS', headers: { Origin: 'https://segeldokumen.vercel.app' } }); ok(r.status === 204 && r.headers.get('access-control-allow-origin') === 'https://segeldokumen.vercel.app', 'CORS preflight origin diizinkan');
  r = await fetch(U, { method: 'POST', headers: { Origin: 'https://evil.example' }, body: '{}' }); ok(r.status === 403, 'origin asing ditolak');
  [s, j] = await post({ token: T, action: 'clear' }); ok(j.records.length === 0, 'clear');

  // identitas penanda tangan
  const fpA = Array(32).fill('AB').join(':'), fpB = Array(32).fill('CD').join(':'), fpC = Array(32).fill('EF').join(':');
  const P12 = 'MIIK' + 'A'.repeat(400);
  [s, j] = await post({ token: T, action: 'id_list' }); for (const x of j.identities) await post({ token: T, action: 'id_delete', fp: x.fp });
  [s, j] = await post({ token: T, action: 'id_add', identity: { fp: fpA, name: 'Dr. Fauzan Daffa, M.Kom', title: 'Rektor', org: 'Universitas STEKOM', p12b64: P12 } });
  ok(s === 200 && j.identities.length === 1 && j.identities[0].p12b64 === P12 && j.identities[0].name === 'Dr. Fauzan Daffa, M.Kom', 'id_add menyimpan identitas + p12');
  [s, j] = await post({ token: T, action: 'id_add', identity: { fp: fpA, name: 'Dr. Fauzan Daffa, M.Kom', p12b64: P12 } }); ok(s === 200 && j.identities.length === 1, 'id_add sidik sama = idempoten');
  for (const nm of ['Fauzan Daffa', 'FAUZAN DAFFA S.Kom', 'Fauzan Dafa', 'Prof. Dr. Fauzan Daffa', 'Fauzan Daffa Putra']) {
    [s, j] = await post({ token: T, action: 'id_add', identity: { fp: fpB, name: nm, p12b64: P12 } });
    ok(s === 409 && j.error === 'duplicate' && j.match.fp === fpA, `nama mirip ditolak: "${nm}"`);
  }
  [s, j] = await post({ token: T, action: 'id_add', identity: { fp: fpB, name: 'Dr. Joseph Teguh Santoso, M.Kom', p12b64: P12 } }); ok(s === 200 && j.identities.length === 2, 'nama berbeda diterima');
  [s, j] = await post({ token: T, action: 'id_add', identity: { fp: 'xx', name: 'Siapa', p12b64: P12 } }); ok(s === 400, 'sidik tidak valid ditolak');
  [s, j] = await post({ token: T, action: 'id_add', identity: { fp: fpC, name: 'Orang Lain', p12b64: 'bukan base64!' } }); ok(s === 400, 'p12 tidak valid ditolak');
  [s, j] = await post({ token: 'x'.repeat(64), action: 'id_list' }); ok(s === 401, 'id_list tanpa token ditolak');
  [s, j] = await post({ token: T, action: 'id_delete', fp: fpA }); ok(j.identities.length === 1 && j.identities[0].fp === fpB, 'id_delete');
  [s, j] = await post({ token: T, action: 'id_add', identity: { fp: fpC, name: 'Fauzan Daffa', p12b64: P12 } }); ok(s === 200 && j.identities.length === 2, 'setelah dihapus, nama boleh dibuat lagi');
  for (const x of j.identities) await post({ token: T, action: 'id_delete', fp: x.fp });
  p.kill();
})().catch(e => { console.error(e); process.exit(1); });
