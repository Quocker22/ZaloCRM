// Chụp trang "Bản đồ tin" (dữ liệu giả lập) ở đúng các trạng thái của ảnh tham chiếu go.noti.vn, rồi dựng
// so-sanh.html đặt hai ảnh cạnh nhau (28–33: trạng thái riêng của vòng 2, không có tham chiếu) + bảng số đo hình học (SPEC §3) đo từ DOM.
//
// Chạy (cần vite dev đang chạy ở frontend/):
//   cd frontend && npx vite --port 5291 &
//   PLAYWRIGHT_MODULE=<đường dẫn gói playwright> node visual/ban-do-tin/chup.mjs [--url http://localhost:5291] [--chi 01,02]
// CHROMIUM_PATH=<tệp chạy chromium> nếu bản trình duyệt của gói chưa tải.
// Không có PLAYWRIGHT_MODULE thì thử `import('playwright')` (vd `npx -p playwright@1.62 node visual/ban-do-tin/chup.mjs`).
// Ảnh tham chiếu: THAM_CHIEU_DIR (mặc định ../wt-thong-bao/docs/78-thong-bao-chu-dong/tham-chieu-noti/anh) — chỉ để
// so trong nội bộ, KHÔNG chép vào repo.
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DAY = dirname(fileURLToPath(import.meta.url));
const OUT = join(DAY, 'anh');
const thamSo = (ten, md) => { const i = process.argv.indexOf(ten); return i > 0 ? process.argv[i + 1] : md; };
const URL_GOC = thamSo('--url', 'http://localhost:5291') + '/visual/ban-do-tin/xem.html';
const CHI = thamSo('--chi', '')?.split(',').filter(Boolean);
const THAM_CHIEU = process.env.THAM_CHIEU_DIR
  ?? resolve(DAY, '../../../../../wt-thong-bao/docs/78-thong-bao-chu-dong/tham-chieu-noti/anh');

const pw = process.env.PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(join(process.env.PLAYWRIGHT_MODULE, 'index.mjs')).href)
  : await import('playwright');
const { chromium } = pw;

const MAY = { width: 1440, height: 900 };
const DT = { width: 390, height: 844 };
const KHOI = 'the_xem_truoc@nhom_goc';

/** id ảnh mình → [tệp tham chiếu, khổ, theme, hash, thao tác] */
const CANH = [
  ['01-desktop-light-default', MAY, 'light', '', null],
  ['02-desktop-light-selected', MAY, 'light', `#khoi=${KHOI}`, null],
  ['03-desktop-light-panel-row-hover', MAY, 'light', `#khoi=${KHOI}`, async (p) => { await p.hover('[data-panel] .bdt-lk >> nth=2'); }],
  ['04-desktop-light-block-hover', MAY, 'light', '', async (p) => { await p.hover(`[data-khoi="${KHOI}"]`); }],
  ['05-desktop-light-legend-filter', MAY, 'light', '#loai=ban_sao', null],
  ['06-desktop-light-phase-selected', MAY, 'light', '#pha=chot', null],
  ['07-desktop-light-row-selected', MAY, 'light', '#dich=g_kho', null],
  ['08-desktop-light-link-selected', MAY, 'light', `#lien-ket=dang_chot@nhom_goc~da_chot@nhom_goc`, null],
  ['09-desktop-light-all-groups-collapsed', MAY, 'light', '', async (p) => { await p.getByRole('button', { name: 'Thu gọn nhóm', exact: true }).click(); }],
  ['10-desktop-light-one-group-collapsed', MAY, 'light', '', async (p) => { await p.getByRole('button', { name: 'Thu gọn nhóm Nhóm theo chức năng' }).click(); }],
  ['11-desktop-light-zoom-120', MAY, 'light', '', async (p) => { await p.getByRole('button', { name: 'Phóng to' }).click(); }],
  ['12-desktop-light-zoom-min-67', MAY, 'light', '', async (p) => { for (let i = 0; i < 8; i++) { const b = p.getByRole('button', { name: 'Thu nhỏ' }); if (await b.isDisabled()) break; await b.click(); } }],
  ['13-desktop-light-help-dialog', MAY, 'light', '', async (p) => { await p.getByRole('button', { name: 'Hướng dẫn sử dụng' }).first().click(); }],
  ['14-desktop-light-search', MAY, 'light', '', async (p) => { await p.getByRole('combobox').fill('chot'); }],
  ['15-desktop-light-fullscreen', MAY, 'light', `#khoi=${KHOI}`, async (p) => { await p.click('[data-toan-man-hinh]'); }],
  ['16-desktop-light-fullscreen-noselect', MAY, 'light', `#khoi=${KHOI}`, async (p) => { await p.click('[data-toan-man-hinh]'); await p.keyboard.press('Escape'); }],
  ['17-desktop-light-tab-theo-pha', MAY, 'light', '', async (p) => { await p.click('[data-tab="theo_pha"]'); await p.getByRole('tab', { name: /P2/ }).click(); }],
  ['18-desktop-light-tab-lien-ket', MAY, 'light', '', async (p) => { await p.click('[data-tab="lien_ket"]'); }],
  ['19-desktop-light-tab-ghi-chu', MAY, 'light', '', async (p) => { await p.click('[data-tab="ghi_chu"]'); }],
  ['20-desktop-dark-default', MAY, 'dark', '', null],
  ['21-desktop-dark-selected', MAY, 'dark', `#khoi=${KHOI}`, null],
  ['22-mobile-dark-gate', DT, 'dark', '', null],
  ['23-mobile-dark-compact', DT, 'dark', '', async (p) => { await p.click('[data-rut-gon]'); }],
  ['24-mobile-dark-bottom-sheet', DT, 'dark', '', async (p) => { await p.click('[data-rut-gon]'); await p.click('[data-the] >> nth=0'); }],
  ['25-mobile-light-gate', DT, 'light', '', null],
  ['26-mobile-light-compact', DT, 'light', '', async (p) => { await p.click('[data-rut-gon]'); }],
  ['27-mobile-light-bottom-sheet', DT, 'light', '', async (p) => { await p.click('[data-rut-gon]'); await p.click('[data-the] >> nth=0'); }],
  // ── vòng 2 (API thật): không có ảnh tham chiếu tương ứng ──
  ['28-desktop-light-cuon-dinh', MAY, 'light', '', async (p) => { await p.evaluate(() => { const v = document.querySelector('.bdt-vung-xem'); v.scrollLeft = 520; v.scrollTop = 380; }); }],
  ['29-desktop-light-vua-khung', MAY, 'light', '', async (p) => { await p.click('[data-vua-khung]'); }],
  ['30-desktop-light-luat-bong', MAY, 'light', '#khoi=in_sau_chot@nhom_goc', null],
  ['31-desktop-light-crm-tu-dong', MAY, 'light', '#khoi=crm_lich_hen_nhac@crm_sale', null],
  ['32-desktop-light-chua-co-ban-do', MAY, 'light', '?trong=1', null],
  ['33-desktop-dark-cuon-dinh', MAY, 'dark', '', async (p) => { await p.evaluate(() => { const v = document.querySelector('.bdt-vung-xem'); v.scrollLeft = 520; v.scrollTop = 380; }); }],
];

/** Số đo DOM so với SPEC §3/§6 (toạ độ gốc — chia cho zoom). */
async function doHinh(p) {
  return p.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const r = (el) => el ? el.getBoundingClientRect() : null;
    const z = parseFloat(getComputedStyle(q('.bdt-ban-do') ?? document.body).zoom || '1') || 1;
    const k = r(q('.bdt-khoi')); const ph = r(q('.bdt-pha')); const pa = r(q('[data-panel]')); const tab = r(q('.bdt-tabs'));
    const tim = r(q('.bdt-tim input')); const kh = q('.bdt-khoi');
    return {
      zoom: +z.toFixed(3),
      khoi: k ? [+(k.width / z).toFixed(1), +(k.height / z).toFixed(1)] : null,
      khoi_bo_goc: kh ? getComputedStyle(kh).borderRadius : null,
      tieu_de_pha: ph ? [+(ph.width / z).toFixed(1), +(ph.height / z).toFixed(1)] : null,
      panel_rong: pa ? Math.round(pa.width) : null,
      thanh_tab_cao: tab ? Math.round(tab.height) : null,
      o_tim: tim ? [Math.round(tim.width), Math.round(tim.height)] : null,
      ban_do: q('.bdt-ban-do') ? [q('.bdt-ban-do').offsetWidth, q('.bdt-ban-do').offsetHeight] : null,
    };
  });
}

await mkdir(OUT, { recursive: true });
const trinh = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const doDuoc = {};
const thoiGian = {};
for (const [id, kho, theme, hash, lam] of CANH) {
  if (CHI?.length && !CHI.some((c) => id.startsWith(c))) continue;
  const ctx = await trinh.newContext({ viewport: kho, deviceScaleFactor: 1, colorScheme: theme });
  await ctx.addInitScript((t) => { try { localStorage.setItem('bdt-theme', t); localStorage.removeItem('bdt-tab'); sessionStorage.clear(); } catch {} }, theme);
  const p = await ctx.newPage();
  await p.goto(URL_GOC + hash);
  await p.waitForSelector('.bdt-tabs, [data-chua-co-ban-do]');
  await p.waitForTimeout(400);
  if (lam) await lam(p);
  await p.waitForTimeout(450);
  await p.screenshot({ path: join(OUT, `${id}.png`) });
  doDuoc[id] = await doHinh(p);
  if (id === '01-desktop-light-default') {
    // ngân sách ≤ 50 ms/click: đo bấm khối → khung vẽ kế tiếp
    const ms = await p.evaluate(async () => {
      // js = bấm → Vue vá xong DOM (tác vụ kế tiếp); khung = bấm → khung vẽ kế tiếp (gồm style/layout/paint)
      const ds = [...document.querySelectorAll('.bdt-khoi')].slice(0, 30);
      const js = [], khung = [];
      for (const el of ds) {
        const t = performance.now();
        el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 0));
        js.push(performance.now() - t);
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
        khung.push(performance.now() - t);
      }
      return { js, khung };
    });
    const tk = (a) => { const b = [...a].sort((x, y) => x - y); return { lon_nhat: +b[b.length - 1].toFixed(1), trung_vi: +b[Math.floor(b.length / 2)].toFixed(1) }; };
    thoiGian.bam_khoi_ms = { js: tk(ms.js), den_khung_ke: tk(ms.khung), url: URL_GOC };
  }
  await ctx.close();
  console.log('chụp', id);
}
await trinh.close();

// ── Báo cáo cạnh nhau ──
const coThamChieu = existsSync(THAM_CHIEU);
const tc = coThamChieu ? new Set(await readdir(THAM_CHIEU)) : new Set();
const SPEC = { khoi: '150 × 38, bo 8', tieu_de_pha: 'cao 26, rộng = cột', panel_rong: '368 (khổ 1440)', thanh_tab_cao: '42', o_tim: '320 × 36' };
const hang = CANH.filter(([id]) => existsSync(join(OUT, `${id}.png`))).map(([id]) => {
  const m = doDuoc[id] ?? {};
  const ref = tc.has(`${id}.png`) ? pathToFileURL(join(THAM_CHIEU, `${id}.png`)).href : null;
  return `<section><h2>${id}</h2><div class="hai">
  <figure><figcaption>Tham chiếu (go.noti.vn — chỉ so nội bộ)</figcaption>${ref ? `<img src="${ref}" loading="lazy">` : '<p class="thieu">không có ảnh tham chiếu ở máy này</p>'}</figure>
  <figure><figcaption>Bản đồ tin (của mình)</figcaption><img src="${relative(DAY, join(OUT, `${id}.png`))}" loading="lazy"></figure></div>
  ${Object.keys(m).length ? `<pre>${JSON.stringify(m)}</pre>` : ''}</section>`;
}).join('\n');
const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>So ảnh Bản đồ tin</title><style>
body{font:14px/1.5 Inter,system-ui,sans-serif;margin:24px;color:#101113;background:#f6f6f7}h1{font-size:20px}
section{background:#fff;border:1px solid #e7e7ea;border-radius:14px;padding:12px 16px;margin:0 0 18px}h2{font-size:14px;margin:0 0 8px}
.hai{display:grid;grid-template-columns:1fr 1fr;gap:12px}figure{margin:0}figcaption{font-size:12px;color:#5f6470;margin-bottom:4px}
img{width:100%;border:1px solid #e7e7ea;border-radius:8px}pre{font-size:11px;background:#f6f6f7;padding:6px 8px;border-radius:6px;white-space:pre-wrap}
table{border-collapse:collapse}td,th{border:1px solid #e7e7ea;padding:4px 8px;font-size:12.5px;text-align:left}.thieu{color:#e8590c}
</style></head><body><h1>So ảnh: Bản đồ tin ↔ tham chiếu go.noti.vn (1440×900 / 390×844)</h1>
<p>Bố cục/hình học phải khớp; nội dung khác (dữ liệu của mình: 9 pha × 18 hàng thay vì 6 × 19). Ảnh tham chiếu chỉ để so nội bộ, không đưa vào sản phẩm.</p>
<table><tr><th>số đo</th><th>SPEC</th><th>đo ở 01 (gốc, chia zoom)</th></tr>${Object.entries(SPEC).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td><td>${JSON.stringify(doDuoc['01-desktop-light-default']?.[k] ?? '—')}</td></tr>`).join('')}
<tr><td>bấm khối → khung kế tiếp</td><td>≤ 50 ms</td><td>${JSON.stringify(thoiGian.bam_khoi_ms ?? '—')}</td></tr></table>
${hang}</body></html>`;
await writeFile(join(DAY, 'so-sanh.html'), html);
await writeFile(join(DAY, 'so-do.json'), JSON.stringify({ do_duoc: doDuoc, thoi_gian: thoiGian }, null, 2));
console.log('xong →', join(DAY, 'so-sanh.html'));
