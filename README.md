# Nadiya & Arga · Undangan Pernikahan Digital

Undangan pernikahan digital bertema **buku cerita cat air (watercolour storybook)**. Kisah Nadiya & Arga diceritakan dalam tujuh bab bergambar, dengan efek depth (parallax) yang dibuat dari foto asli, tirai panggung beranimasi, musik latar, dan formulir RSVP di bagian akhir.

Situs ini sepenuhnya statis (HTML, CSS, dan JavaScript murni) sehingga bisa langsung di-hosting di Vercel atau layanan hosting statis lainnya tanpa proses build.

## Fitur

- **Sampul pembuka** dengan tombol "Open the storybook" yang aktif setelah gambar bab pertama selesai dimuat.
- **Tujuh bab cerita**, masing-masing berupa lukisan cat air berlapis (`far`, `mid`, `near`) yang bergerak dengan efek kedalaman 3D saat di-scroll:
  1. *Once Upon a Time*
  2. *The Princess*
  3. *The Promise*
  4. *Blessed by Family*
  5. *A Royal Procession*
  6. *The Garden of Lights*
  7. *Happily Ever After*
- **Transisi antarbab** melalui karangan bunga (wreath) yang menjadi "pintu" ke bab berikutnya.
- **Bingkai panggung** dengan tirai dan valance yang bergerak dinamis, serta efek kilau (sparkles) pada canvas.
- **Kontrol zoom** dan mode **Play story** untuk memutar cerita otomatis.
- **Musik latar** dengan efek fade-in/fade-out dan tombol on/off.
- **Halaman penutup** berisi detail acara (Akad Nikah & Resepsi) serta lokasi.
- **Formulir RSVP** dengan validasi (Bootstrap), penyimpanan jawaban di `localStorage`, dan opsi pengiriman ke endpoint eksternal.
- **Aksesibilitas**: mendukung navigasi keyboard, label ARIA, dan menghormati pengaturan `prefers-reduced-motion` (efek 3D dimatikan).

## Teknologi

| Bagian | Teknologi |
| --- | --- |
| Tampilan | HTML5, CSS3, [Bootstrap 5.3.8](https://getbootstrap.com/) (via CDN) |
| Interaksi | JavaScript murni (tanpa framework) |
| Font | Google Fonts: Cinzel, Cormorant Garamond, Pinyon Script |
| Pengolahan aset | Python (OpenCV, NumPy, Pillow, ONNX Runtime + model Depth Anything V2) |
| Hosting | [Vercel](https://vercel.com/) |

## Struktur Proyek

```
pbp_wedding/
├── index.html              # Halaman utama (sampul, cerita, penutup, RSVP)
├── css/
│   └── style.css           # Seluruh gaya tampilan
├── js/
│   ├── main.js             # Logika cerita: scroll, zoom, tirai, musik, autoplay
│   └── rsvp.js             # Logika formulir RSVP
├── assets/
│   ├── scenes/<bab>/       # Lapisan gambar tiap bab (far/mid/near .webp)
│   ├── ornaments/          # Gambar tirai panggung
│   ├── textures/           # Tekstur kertas
│   └── song/song.mp3       # Musik latar
├── photos/                 # Foto asli sumber pembuatan scene
├── tools/
│   ├── build_scenes.py     # Mengubah foto menjadi lapisan cat air berdasarkan kedalaman
│   ├── build_ornaments.py  # Membuat gambar tirai panggung
│   └── requirements.txt    # Dependensi Python
├── vercel.json             # Konfigurasi Vercel
└── .vercelignore           # Folder yang tidak ikut di-deploy (tools/, photos/)
```

## Menjalankan Secara Lokal

Karena situs ini statis, cukup jalankan server lokal sederhana dari folder proyek (disarankan memakai server, bukan membuka file langsung, agar gambar dan audio dimuat dengan benar):

```bash
# Menggunakan Python
python -m http.server 8000

# atau menggunakan Node.js
npx serve .
```

Lalu buka `http://localhost:8000` di browser.

## Kontrol

| Aksi | Kontrol |
| --- | --- |
| Pindah bab | Scroll mouse / swipe, atau tombol panah, `Page Up`/`Page Down`, `Space` |
| Zoom ke bab berikutnya | Tombol **+** atau tombol zoom di layar |
| Zoom ke bab sebelumnya | Tombol **-** |
| Kembali ke bab pertama | Tombol **0** |
| Putar cerita otomatis | Tombol **Play story** |
| Musik on/off | Tombol musik di pojok layar |

## Membuat Ulang Aset Gambar

Gambar setiap bab dibuat dari foto di folder `photos/`. Skrip `build_scenes.py` memperkirakan kedalaman foto menggunakan model **Depth Anything V2 (small)**, lalu memotong foto menjadi beberapa lapisan dan memberinya efek cat air.

1. Instal dependensi Python:

   ```bash
   pip install -r tools/requirements.txt
   ```

2. Buat ulang semua scene (model akan diunduh otomatis ke `tools/.cache` pada saat pertama dijalankan):

   ```bash
   python tools/build_scenes.py
   ```

   Opsi tambahan:

   - `--only <id>` membuat satu scene saja, misalnya `--only bride`.
   - `--preview` menyimpan pratinjau masker ke `tools/.cache/preview`.

3. Buat ulang gambar tirai panggung:

   ```bash
   cd tools
   python build_ornaments.py
   ```

Daftar foto sumber dan titik potong lapisan untuk setiap bab bisa diubah pada variabel `SCENES` di `tools/build_scenes.py`. ID scene yang tersedia: `invitation`, `bride`, `vow`, `family`, `procession`, `aisle`, `stage`.

## Konfigurasi RSVP

Secara bawaan, jawaban RSVP hanya disimpan di `localStorage` browser tamu. Untuk mengirim jawaban ke server (misalnya Google Apps Script, Formspree, atau API sendiri), tambahkan atribut `data-endpoint` pada formulir di `index.html`:

```html
<form class="needs-validation" id="rsvpForm" data-endpoint="https://contoh.com/api/rsvp" novalidate>
```

Data dikirim dengan metode `POST` dalam format JSON, berisi kolom `name`, `phone`, `attending`, `guests`, `message`, dan `sentAt` (waktu pengiriman dalam format ISO).

## Deploy ke Vercel

1. Hubungkan repositori ini ke Vercel.
2. Biarkan **Framework Preset** pada *Other* (sudah diatur `"framework": null` di `vercel.json`).
3. Tidak perlu build command maupun output directory, karena Vercel langsung menyajikan file statis dari root proyek.

Folder `tools/` dan `photos/` tidak ikut di-deploy (diatur di `.vercelignore`).

## Detail Acara

- **Mempelai**: dr. Nadiya Dewi Kusnadi & Arga Wahyudi Muslim, S.Si
- **Akad Nikah**: Sabtu, 22 Juli 2023 (khusus keluarga)
- **Resepsi**: Sabtu, 22 Juli 2023, pukul 13.00 – 16.00 WIB
- **Lokasi**: Hotel Best Western Premier Panbil, Sissoding Ballroom Lantai 1, Batam
