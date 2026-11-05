window.UserGuideModule = (function() {
    const screenshotPath = 'assets/user-guide/';
    const pages = [
        {
            section: 'Buku panduan digital',
            title: 'Smart BARA 7.10 HZ',
            lead: 'Panduan operasional untuk mengelola periode, data, rekonsiliasi, anggaran, dan analisa dalam satu alur kerja.',
            points: [
                'Pilih bab melalui daftar isi atau tombol navigasi.',
                'Ikuti urutan kerja dari pemilihan periode hingga pemeriksaan hasil.',
                'Gunakan screenshot sebagai referensi tampilan aplikasi.'
            ],
            note: 'Panduan ini mengikuti tampilan dan alur Smart BARA yang tersedia saat ini.',
            image: 'dashboard.png',
            imageAlt: 'Dashboard utama Smart BARA'
        },
        {
            section: 'Mulai di sini',
            title: 'Daftar isi & alur kerja',
            lead: 'Gunakan urutan dasar ini untuk menjaga data tetap konsisten dari awal sampai laporan.',
            points: [
                'Login dengan akun yang diberikan administrator.',
                'Pilih periode dan departemen yang akan dikerjakan.',
                'Upload atau periksa data, lalu lakukan rekonsiliasi.',
                'Perbarui Budget Plan dan Anggaran Masa Depan.',
                'Tinjau dashboard, detail akun, dan ekspor laporan.'
            ],
            note: 'Perubahan periode dan filter departemen memengaruhi data yang sedang ditampilkan.',
            image: 'dashboard.png',
            imageAlt: 'Dashboard dan pemilih periode'
        },
        {
            section: '01 · Akses',
            title: 'Login, peran, dan hak akses',
            lead: 'Akses modul dan tindakan ditentukan oleh peran akun yang diberikan administrator.',
            points: [
                'Masuk menggunakan email dan password Smart BARA.',
                'Viewer dapat melihat data; Tim dapat mengelola data sesuai izin; SPV melakukan pengawasan; Superadmin mengelola pengguna dan pengaturan global.',
                'Jika menu atau tombol tidak tersedia, minta administrator memeriksa peran dan akses departemen.',
                'Keluar dari aplikasi pada perangkat bersama setelah pekerjaan selesai.'
            ],
            note: 'Pengaturan AI Budget dan beberapa konfigurasi global hanya tersedia untuk Superadmin.',
            image: 'dashboard.png',
            imageAlt: 'Header dashboard dengan departemen dan periode aktif'
        },
        {
            section: '02 · Dashboard',
            title: 'Pilih periode dan baca KPI',
            lead: 'Periksa periode serta departemen sebelum mengambil keputusan atau mengubah data.',
            points: [
                'Pilih periode pada header, lalu pastikan nama periode yang aktif sudah benar.',
                'Pilih departemen atau mode gabungan sesuai kebutuhan analisa.',
                'Budget Plan menunjukkan pagu 12 bulan; Finance menunjukkan debit dikurangi kredit; Rekonsil menunjukkan nilai yang sudah disesuaikan.',
                'Klik kartu KPI untuk melihat rincian sumber dan rumusnya.'
            ],
            note: 'Hindari membandingkan dataset dengan cakupan periode atau departemen yang berbeda.',
            image: 'dashboard.png',
            imageAlt: 'KPI dan ringkasan Dashboard Smart BARA'
        },
        {
            section: '03 · Impor data',
            title: 'Upload Excel dan validasi',
            lead: 'Preview sebelum impor membantu memastikan file dan cakupan data sudah tepat.',
            points: [
                'Buka Upload Excel Multi Dept dan pilih file .xlsx atau .xls.',
                'Pilih jenis data: Upload Laporan atau Upload Budget.',
                'Pilih mode tambahkan ke data yang sudah ada atau timpa seluruh data departemen sesuai tujuan impor.',
                'Periksa jumlah baris, periode, dan ringkasan perubahan sebelum menekan tombol update.',
                'Setelah impor, periksa dashboard dan status sinkronisasi.'
            ],
            note: 'Jangan menutup halaman sebelum status sinkronisasi selesai.',
            image: 'upload.png',
            imageAlt: 'Modal Upload Laporan Excel Multi Departemen'
        },
        {
            section: '04 · Rekonsiliasi',
            title: 'Periksa Finance dan Rekonsil',
            lead: 'Rekonsiliasi membandingkan transaksi Finance dengan nilai rekonsil manual dan penyesuaian.',
            points: [
                'Pastikan periode dan departemen yang aktif sesuai dengan data yang diperiksa.',
                'Bandingkan Total Finance, Rekonsil Manual, dan Selisih per departemen.',
                'Lengkapi akun manual, proyek manual, nilai penyesuaian, dan catatan jika diperlukan.',
                'Gunakan status Match atau selisih untuk menentukan baris yang perlu ditinjau.',
                'Riwayat perubahan menyediakan jejak audit atas koreksi.'
            ],
            note: 'Rekonsil tercatat adalah nilai aktual periode berjalan; proyeksi 12 bulan merupakan angka annualisasi yang berbeda.',
            image: 'rekonsil.png',
            imageAlt: 'Ringkasan Finance dan Rekonsil Manual per Departemen'
        },
        {
            section: '05 · Budget Plan',
            title: 'Kelola Budget Plan akun',
            lead: 'Budget Plan menyimpan pagu per akun dan departemen untuk sebaran Januari sampai Desember.',
            points: [
                'Periksa nama akun, departemen, dan nominal pada setiap bulan.',
                'Gunakan pencarian akun atau departemen untuk menemukan baris yang ingin ditinjau.',
                'Tambah atau ubah anggaran melalui kontrol yang tersedia dan periksa total tahunan.',
                'Tarik budget periode lain hanya setelah memastikan periode sumber dan tujuan benar.'
            ],
            note: 'Budget Plan adalah salah satu pilihan basis pembanding pada analisa kenaikan anggaran.',
            image: 'budget-plan.png',
            imageAlt: 'Tabel Budget Plan akun dengan alokasi bulanan'
        },
        {
            section: '06 · Proyeksi',
            title: 'Anggaran Masa Depan',
            lead: 'Rencana masa depan disusun per departemen, akun, proyek UP, dan bulan.',
            points: [
                'Kepala akun menampilkan ringkasan nominal; klik untuk membuka daftar proyek di bawahnya.',
                'Ubah asumsi kenaikan pada input per baris. Nominal rencana dan analisa ikut diperbarui.',
                'Range global membatasi kenaikan dan penurunan semua baris; pengaturan default adalah +20% dan -20%.',
                'Tombol Refresh Aktual membentuk ulang baseline dari data rekonsil periode aktif.',
                'Periksa total grup, total bulanan, dan total keseluruhan setelah perubahan.'
            ],
            note: 'Pengaturan range global hanya dapat diubah Superadmin. Menonaktifkannya memulihkan proyeksi yang dibatasi.',
            image: 'budget-future.png',
            imageAlt: 'Kontrol range global dan KPI Anggaran Masa Depan'
        },
        {
            section: '07 · Analisa',
            title: 'Analisa kenaikan per akun',
            lead: 'Analisa membandingkan nominal masa depan dengan basis sebelumnya yang dapat dipilih.',
            points: [
                'Pilih Budget Plan untuk membandingkan dengan pagu yang sedang berjalan.',
                'Pilih Rekonsil · Proyeksi Aktual 12 Bulan untuk membandingkan dengan baseline rekonsil yang dianualisasi.',
                'Nominal sebelumnya, selisih, persentase tiap akun, dan rumus total akan mengikuti pilihan sumber.',
                'Tinjau alasan kenaikan terhadap volume, kontrak, tarif, aset, atau kebutuhan operasional sebelum menyetujui rencana.'
            ],
            note: 'Periksa label sumber di slide sebelum membaca persentase kenaikan.',
            image: 'budget-future.png',
            imageAlt: 'Rincian akun, proyek, asumsi, dan nominal masa depan'
        },
        {
            section: '08 · Penutupan',
            title: 'Ekspor dan pemecahan masalah',
            lead: 'Selesaikan pemeriksaan sebelum membagikan laporan atau PDF kepada pihak lain.',
            points: [
                'Pastikan periode, departemen, total, dan status sinkronisasi sudah benar.',
                'Gunakan Export Excel atau Export PPT sesuai kebutuhan laporan.',
                'Jika data terlihat lama, muat ulang halaman dan periksa periode yang aktif.',
                'Jika total berbeda, pastikan cakupan departemen dan sumber pembanding sama.',
                'Jika tombol tidak tersedia, minta Superadmin memeriksa role dan izin akun.'
            ],
            note: 'Simpan PDF panduan ini untuk onboarding; gunakan halaman User Guide untuk navigasi interaktif.',
            image: 'dashboard.png',
            imageAlt: 'Dashboard sebagai pemeriksaan akhir periode'
        }
    ];

    let currentPage = 0;
    let elements = {};

    const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);

    function renderShell(root) {
        root.innerHTML = `
            <div class="mx-auto w-full max-w-7xl space-y-4">
                <section class="glass-panel flex flex-wrap items-end justify-between gap-4 rounded-2xl border border-white/10 bg-gradient-to-r from-slate-900 via-slate-900/90 to-teal-950/40 p-5 shadow-xl sm:p-6">
                    <div class="max-w-3xl">
                        <span class="badge badge-teal mb-2">Buku panduan digital · Smart BARA 7.10 HZ</span>
                        <h1 class="m-0 text-2xl font-black text-white sm:text-3xl">Panduan Pengguna</h1>
                        <p class="mb-0 mt-2 text-sm leading-6 text-slate-300">Buku saku berhalaman untuk alur kerja Smart BARA, lengkap dengan screenshot dan unduhan PDF.</p>
                    </div>
                    <div class="flex items-center gap-2">
                        <span id="ebookPdfStatus" class="text-xs text-slate-400" aria-live="polite"></span>
                        <button id="ebookDownloadPdf" type="button" class="btn btn-primary whitespace-nowrap">↓ Unduh PDF</button>
                    </div>
                </section>
                <div class="grid grid-cols-1 items-start gap-4 xl:grid-cols-[250px_minmax(0,1fr)]">
                    <aside class="glass-panel rounded-xl border border-white/10 p-3 xl:sticky xl:top-4">
                        <div class="flex items-center justify-between px-2 py-2">
                            <h2 class="m-0 text-xs font-black uppercase tracking-wide text-slate-300">Daftar isi</h2>
                            <span class="text-[10px] text-slate-500">${pages.length} halaman</span>
                        </div>
                        <nav id="ebookToc" class="mt-1 grid grid-cols-2 gap-1 xl:grid-cols-1" aria-label="Daftar isi ebook"></nav>
                    </aside>
                    <section class="min-w-0 space-y-3" aria-label="Pembaca ebook">
                        <article id="ebookPage" class="ebook-paper overflow-hidden rounded-xl border border-white/10 bg-slate-900 shadow-2xl" aria-live="polite">
                            <div class="h-1 w-full bg-gradient-to-r from-teal-400 via-cyan-300 to-amber-300"></div>
                            <div class="grid grid-cols-1 gap-6 p-5 sm:p-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                                <div class="min-w-0">
                                    <div class="flex items-center justify-between gap-3">
                                        <p id="ebookSection" class="m-0 text-[10px] font-bold uppercase tracking-[0.18em] text-teal-300"></p>
                                        <span id="ebookPageNumber" class="whitespace-nowrap text-[10px] font-bold text-slate-500"></span>
                                    </div>
                                    <h2 id="ebookTitle" class="mb-0 mt-3 text-2xl font-black leading-tight text-white sm:text-3xl"></h2>
                                    <p id="ebookLead" class="mb-0 mt-3 text-sm leading-6 text-slate-300"></p>
                                    <h3 class="mb-2 mt-6 text-xs font-black uppercase tracking-wide text-slate-400">Langkah dan panduan</h3>
                                    <ol id="ebookPoints" class="m-0 space-y-3 pl-5 text-sm leading-6 text-slate-200"></ol>
                                    <p id="ebookNote" class="mb-0 mt-5 rounded-lg border-l-2 border-amber-400 bg-amber-500/5 px-3 py-2 text-xs leading-5 text-amber-100"></p>
                                </div>
                                <figure id="ebookFigure" class="m-0 min-w-0 self-start">
                                    <div class="overflow-hidden rounded-lg border border-white/10 bg-slate-950/70">
                                        <img id="ebookScreenshot" class="block h-auto max-h-[58vh] w-full object-contain" alt="">
                                    </div>
                                    <figcaption id="ebookCaption" class="mt-2 text-[10px] leading-4 text-slate-500"></figcaption>
                                </figure>
                            </div>
                            <footer class="flex items-center justify-between border-t border-white/10 px-5 py-3 text-[10px] text-slate-500 sm:px-8">
                                <span>SMART BARA · PANDUAN OPERASIONAL</span>
                                <span id="ebookFooterPage"></span>
                            </footer>
                        </article>
                        <div class="glass-panel flex flex-wrap items-center gap-3 rounded-xl border border-white/10 p-3">
                            <button id="ebookPrevious" type="button" class="btn btn-secondary" aria-label="Halaman sebelumnya">← Sebelumnya</button>
                            <input id="ebookPageRange" type="range" min="1" max="${pages.length}" value="1" class="min-w-32 flex-1 accent-teal-400" aria-label="Pilih halaman ebook">
                            <span id="ebookPageCount" class="min-w-16 text-center text-xs font-bold tabular-nums text-slate-300"></span>
                            <button id="ebookNext" type="button" class="btn btn-primary" aria-label="Halaman berikutnya">Selanjutnya →</button>
                        </div>
                    </section>
                </div>
            </div>
        `;

        elements = {
            toc: root.querySelector('#ebookToc'),
            section: root.querySelector('#ebookSection'),
            pageNumber: root.querySelector('#ebookPageNumber'),
            title: root.querySelector('#ebookTitle'),
            lead: root.querySelector('#ebookLead'),
            points: root.querySelector('#ebookPoints'),
            note: root.querySelector('#ebookNote'),
            figure: root.querySelector('#ebookFigure'),
            screenshot: root.querySelector('#ebookScreenshot'),
            caption: root.querySelector('#ebookCaption'),
            footer: root.querySelector('#ebookFooterPage'),
            range: root.querySelector('#ebookPageRange'),
            count: root.querySelector('#ebookPageCount'),
            previous: root.querySelector('#ebookPrevious'),
            next: root.querySelector('#ebookNext'),
            download: root.querySelector('#ebookDownloadPdf'),
            status: root.querySelector('#ebookPdfStatus')
        };
    }

    function renderToc() {
        elements.toc.innerHTML = pages.map((page, index) => `
            <button type="button" data-ebook-page="${index}" class="flex min-h-10 items-center gap-2 rounded-lg border border-transparent px-2.5 py-2 text-left text-xs text-slate-400 transition hover:border-white/10 hover:bg-white/5 hover:text-white ${index === currentPage ? 'border-teal-400/30 bg-teal-500/10 text-teal-100' : ''}" aria-current="${index === currentPage ? 'page' : 'false'}">
                <span class="w-5 shrink-0 font-mono text-[10px] text-slate-500">${String(index + 1).padStart(2, '0')}</span>
                <span class="min-w-0 truncate">${escapeHtml(page.title)}</span>
            </button>
        `).join('');
    }

    function renderPage(index) {
        currentPage = Math.max(0, Math.min(pages.length - 1, index));
        const page = pages[currentPage];
        elements.section.textContent = page.section;
        elements.pageNumber.textContent = `${String(currentPage + 1).padStart(2, '0')} / ${pages.length}`;
        elements.title.textContent = page.title;
        elements.lead.textContent = page.lead;
        elements.points.innerHTML = page.points.map(point => `<li class="pl-1">${escapeHtml(point)}</li>`).join('');
        elements.note.textContent = page.note;
        elements.figure.classList.toggle('hidden', !page.image);
        if (page.image) {
            elements.screenshot.src = `${screenshotPath}${page.image}`;
            elements.screenshot.alt = page.imageAlt || page.title;
            elements.caption.textContent = page.imageAlt || page.title;
        }
        elements.footer.textContent = `${currentPage + 1} / ${pages.length}`;
        elements.range.value = currentPage + 1;
        elements.count.textContent = `${currentPage + 1} / ${pages.length}`;
        elements.previous.disabled = currentPage === 0;
        elements.next.disabled = currentPage === pages.length - 1;
        renderToc();
    }

    function bindEvents(root) {
        elements.toc.addEventListener('click', event => {
            const button = event.target.closest('[data-ebook-page]');
            if (button) renderPage(Number(button.dataset.ebookPage));
        });
        elements.previous.addEventListener('click', () => renderPage(currentPage - 1));
        elements.next.addEventListener('click', () => renderPage(currentPage + 1));
        elements.range.addEventListener('input', () => renderPage(Number(elements.range.value) - 1));
        elements.download.addEventListener('click', downloadPdf);
        document.addEventListener('keydown', event => {
            if (event.altKey || event.ctrlKey || event.metaKey) return;
            if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(document.activeElement?.tagName)) return;
            if (event.key === 'ArrowLeft') renderPage(currentPage - 1);
            if (event.key === 'ArrowRight') renderPage(currentPage + 1);
        });
    }

    function loadImageData(path) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = image.naturalWidth;
                canvas.height = image.naturalHeight;
                canvas.getContext('2d').drawImage(image, 0, 0);
                resolve({ data: canvas.toDataURL('image/jpeg', 0.84), width: image.naturalWidth, height: image.naturalHeight });
            };
            image.onerror = () => reject(new Error(`Screenshot ${path} gagal dimuat.`));
            image.src = path;
        });
    }

    async function downloadPdf() {
        elements.download.disabled = true;
        elements.status.textContent = 'Menyiapkan PDF...';
        try {
            await window.SmartBaraConfig.ensureLibrary('jspdf');
            const JsPdf = window.jspdf.jsPDF;
            const pdf = new JsPdf({ orientation: 'p', unit: 'mm', format: 'a4', compress: true });
            const pageWidth = 210;
            const pageHeight = 297;
            const margin = 16;

            for (let index = 0; index < pages.length; index += 1) {
                if (index > 0) pdf.addPage();
                const page = pages[index];
                pdf.setFillColor(248, 250, 252);
                pdf.rect(0, 0, pageWidth, pageHeight, 'F');
                pdf.setFillColor(13, 148, 136);
                pdf.rect(0, 0, pageWidth, 5, 'F');
                pdf.setTextColor(15, 23, 42);
                pdf.setFont('helvetica', 'bold');
                pdf.setFontSize(8);
                pdf.text('SMART BARA 7.10 HZ  /  USER GUIDE', margin, 15);
                pdf.setTextColor(13, 148, 136);
                pdf.setFontSize(8);
                pdf.text(page.section.toUpperCase(), margin, 24);

                pdf.setTextColor(15, 23, 42);
                pdf.setFont('helvetica', 'bold');
                pdf.setFontSize(index === 0 ? 25 : 21);
                const titleLines = pdf.splitTextToSize(page.title, pageWidth - margin * 2);
                pdf.text(titleLines, margin, 35);
                let y = 35 + titleLines.length * 9;

                pdf.setFont('helvetica', 'normal');
                pdf.setFontSize(10);
                pdf.setTextColor(71, 85, 105);
                const leadLines = pdf.splitTextToSize(page.lead, pageWidth - margin * 2);
                pdf.text(leadLines, margin, y);
                y += leadLines.length * 5 + 8;

                pdf.setFont('helvetica', 'bold');
                pdf.setFontSize(9);
                pdf.setTextColor(13, 148, 136);
                pdf.text('LANGKAH DAN PANDUAN', margin, y);
                y += 6;
                pdf.setFont('helvetica', 'normal');
                pdf.setFontSize(9);
                pdf.setTextColor(30, 41, 59);
                page.points.forEach((point, pointIndex) => {
                    const lines = pdf.splitTextToSize(`${pointIndex + 1}. ${point}`, pageWidth - margin * 2 - 4);
                    pdf.text(lines, margin + 2, y);
                    y += lines.length * 4.5 + 2;
                });

                const noteLines = pdf.splitTextToSize(`Catatan: ${page.note}`, pageWidth - margin * 2 - 8);
                const noteHeight = noteLines.length * 4.2 + 7;
                if (y + noteHeight > pageHeight - 25) y = pageHeight - noteHeight - 28;
                pdf.setFillColor(236, 253, 250);
                pdf.roundedRect(margin, y, pageWidth - margin * 2, noteHeight, 2, 2, 'F');
                pdf.setTextColor(15, 118, 110);
                pdf.setFontSize(8.5);
                pdf.text(noteLines, margin + 4, y + 5);
                y += noteHeight + 5;

                if (page.image) {
                    const screenshot = await loadImageData(`${screenshotPath}${page.image}`);
                    const maxWidth = pageWidth - margin * 2;
                    const maxHeight = pageHeight - y - 25;
                    if (maxHeight > 30) {
                        const scale = Math.min(maxWidth / screenshot.width, maxHeight / screenshot.height);
                        const imageWidth = screenshot.width * scale;
                        const imageHeight = screenshot.height * scale;
                        const imageX = (pageWidth - imageWidth) / 2;
                        pdf.setDrawColor(203, 213, 225);
                        pdf.roundedRect(imageX - 1, y - 1, imageWidth + 2, imageHeight + 2, 2, 2, 'S');
                        pdf.addImage(screenshot.data, 'JPEG', imageX, y, imageWidth, imageHeight, undefined, 'FAST');
                    }
                }

                pdf.setDrawColor(203, 213, 225);
                pdf.line(margin, pageHeight - 16, pageWidth - margin, pageHeight - 16);
                pdf.setFontSize(8);
                pdf.setTextColor(100, 116, 139);
                pdf.text('Smart BARA · Panduan Operasional', margin, pageHeight - 10);
                pdf.text(`${index + 1} / ${pages.length}`, pageWidth - margin, pageHeight - 10, { align: 'right' });
            }

            await pdf.save('Panduan-Smart-BARA-7.10-HZ.pdf', { returnPromise: true });
            elements.status.textContent = 'PDF berhasil diunduh';
        } catch (error) {
            console.error('Ebook PDF export error:', error);
            elements.status.textContent = `PDF gagal dibuat: ${error.message}`;
        } finally {
            elements.download.disabled = false;
        }
    }

    function init() {
        const root = document.getElementById('ebookRoot');
        if (!root) return;
        renderShell(root);
        bindEvents(root);
        renderPage(0);
    }

    return { init };
})();