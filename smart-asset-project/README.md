# Smart Asset Monitor

Aplikasi monitoring & rekap aset berbasis web (lokal).

## Menjalankan

1. Pastikan Python 3 terpasang.
2. Jalankan `start.bat` (Windows) atau:
   ```
   python server.py
   ```
3. Buka http://127.0.0.1:8000

Data disimpan di file `db.json` di folder project ini, sehingga seluruh folder bisa disalin ke laptop lain.

Tanpa server, aplikasi tetap bisa dibuka via `index.html`, namun data disimpan di IndexedDB browser.