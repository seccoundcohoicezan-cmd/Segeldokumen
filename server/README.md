# segel-api — riwayat segel di PostgreSQL

Layanan kecil (Node 20+, hanya dependensi `pg`) untuk menyimpan **riwayat pembuatan segel** (metadata saja) di PostgreSQL.
Tabel `segel_riwayat` dibuat otomatis saat start. PDF dan kunci sertifikat tidak pernah dikirim ke sini.

## Environment
| Variabel | Isi |
|---|---|
| `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` | koneksi database (disarankan, karena nama DB boleh berspasi). Atau `DATABASE_URL` (spasi harus di-encode `%20`). |
| `SYNC_TOKEN` | SHA-256 hex dari `sync|<kata sandi login>` (token yang dikirim web). |
| `ALLOWED_ORIGINS` | origin web yang diizinkan, default `https://segeldokumen.vercel.app` |
| `PORT` | default `3000` |

Jangan menaruh kredensial di repo. Isi lewat Environment di Dokploy.

## Deploy di Dokploy
1. Application baru dari repo ini, Build Type **Dockerfile**, Docker Context Path `server`, Dockerfile Path `server/Dockerfile`.
2. Environment seperti di atas. `PGHOST` = Internal Host database (satu project/jaringan dengan database Postgres).
3. Domain + HTTPS ke port `3000`. Cek `GET /health` harus `{"ok":true,"db":true}`.
4. Isi `API_URL` di `index.html` dengan domain itu, lalu push.

## Uji
`PG*` dan `SYNC_TOKEN` ke database uji, lalu `npm test`.
