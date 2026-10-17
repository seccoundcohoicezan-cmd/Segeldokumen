# Segel Digital

Tanda tangan elektronik di dalam PDF — langsung di browser, tanpa server. Live: https://segeldokumen.vercel.app

## Fitur
- Tanda tangan digital PKCS#7 (adbe.pkcs7.detached) + kunci DocMDP anti-perubahan
- Enkripsi AES-256 (PDF 2.0, V5/R6) dengan batasan izin
- Opsi halaman jadi gambar + pola anti-OCR
- **Cap bebas tata letak**: seret & ubah ukuran cap di pratinjau halaman, tambah cap di halaman mana pun, salin ke semua halaman, posisi cepat 9 titik, keyboard (panah / +− / Delete)
- Gaya cap: 5 model (QR kiri, QR kanan, tegak, QR saja, teks saja), 5 warna, isi bisa dipilih, judul cap bisa diubah
- Mendukung halaman berputar (/Rotate) dan ukuran halaman campuran
- Tab "Periksa keaslian" untuk memverifikasi PDF bertanda tangan

Satu file: `index.html`. Pustaka (pdf.js, pdf-lib, node-forge, qrcode-generator, JSZip) dimuat dari CDN dengan versi terkunci.
