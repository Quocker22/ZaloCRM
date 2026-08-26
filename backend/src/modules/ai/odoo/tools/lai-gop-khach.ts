// SPDX-License-Identifier: AGPL-3.0-or-later
// LÃI GỘP THEO KHÁCH — anh Quyết 26/08/2026: "pm chỉ tính được lợi nhuận gộp
// [theo sản phẩm] chứ chưa phân tích được từng khách… muốn Tiểu Mã tính lợi
// nhuận từng khách mang lại cho công ty dựa theo sản phẩm bán ra cho khách".
//
// ═══ CÔNG THỨC = TRANG "BÁO CÁO LÃI GỘP" TRÊN WEB ════════════════════════
// Chép từ incokit_pos/wizards/profit_report.py (đọc trên .45 ngày 26/08):
//   - đơn bán sale.order state in (sale, done), lọc theo date_order, kho, NV bán
//   - dòng có product_id, không phải dòng ghi chú/tiêu đề (display_type rỗng)
//   - doanh thu = price_subtotal (CHƯA thuế)
//   - giá vốn   = (purchase_price || standard_price hiện tại của SP) × product_uom_qty
//     purchase_price chốt lúc xác nhận đơn; đơn cũ chuyển từ KiotViet = 0 nên
//     web rơi về standard_price hiện tại — ta làm y hệt để số KHỚP web.
//   - lãi gộp = doanh thu − giá vốn. CHƯA trừ vận chuyển & chi phí khác (anh
//     Quyết biết và chấp nhận).
// Web chỉ gom theo SẢN PHẨM; tool này gom theo KHÁCH (và theo tháng, theo SP
// trong một khách). Odoo không read_group được "purchase_price × qty" nên phải
// cộng ở code — khác nếp `doanh_so_khach` (Odoo cộng), nhưng chính web cũng
// cộng từng dòng bằng Python, nên đây mới là cách cho ra cùng một số.
//
// Khác biệt CỐ Ý với web: web so date_order (datetime UTC) với ngày thuần nên
// ngày cuối kỳ chỉ tính tới 00:00 UTC; ta lấy trọn ngày theo giờ VN. Lệch vài
// đơn ở mép kỳ, nêu trong text để NV khỏi thắc mắc.
import type { OdooClient } from '../client.js';
import type { ToolDefinition } from '../../agent/types.js';
import { tenKhopKhach } from './tao-don-nhap.js';
import {
  chonKy, MO_TA_KY, MO_TA_TU_NGAY, MO_TA_DEN_NGAY, type DauVaoKy, type Ky,
} from '../ky-thoi-gian.js';

/** Trần dòng đơn đọc một lần — 1 tháng shop ~5.000 dòng; chạm trần thì báo cắt. */
const TRAN_DONG = 20_000;
const TOP_KHACH_MAC_DINH = 10;
const TOP_KHACH_TOI_DA = 30;
const TOP_SP = 8;

export interface DongLaiGop {
  id: number;
  ten: string;
  doanhThu: number;
  giaVon: number;
  lai: number;
  /** Số đơn (khách) hoặc số lượng bán (sản phẩm). */
  soLuong: number;
}

export interface LaiGopThang {
  /** "MM/YYYY" */
  nhan: string;
  doanhThu: number;
  giaVon: number;
  lai: number;
  soDon: number;
}

export type KetQuaLaiGopKhach =
  | {
      trangThai: 'ok';
      cheDo: 'mot_khach';
      ky: Ky;
      boLoc: { kho?: string; nvBan?: string };
      khach: { id: number; ten: string };
      tong: { doanhThu: number; giaVon: number; lai: number; soDon: number };
      thang: LaiGopThang[];
      sanPham: DongLaiGop[];
      /** Số dòng có giá vốn = 0 cả hai nguồn — lãi bị thổi lên, phải nói. */
      dongKhongVon: number;
      biCat: boolean;
    }
  | {
      trangThai: 'ok';
      cheDo: 'xep_hang';
      ky: Ky;
      boLoc: { kho?: string; nvBan?: string };
      tong: { doanhThu: number; giaVon: number; lai: number; soDon: number; soKhach: number };
      khach: DongLaiGop[];
      dongKhongVon: number;
      biCat: boolean;
    }
  | { trangThai: 'loi'; lyDo: string };

export interface LaiGopKhachDeps {
  odoo: Pick<OdooClient, 'searchRead'>;
  bayGio?: Date;
}

export interface VaoLaiGopKhach extends DauVaoKy {
  khach_hang_id?: number;
  ten_khach?: string;
  kho?: string;
  nv_ban?: string;
  top?: number;
}

/** 'YYYY-MM-DD' (ngày VN) → mốc datetime UTC Odoo, đầu ngày và cuối ngày. */
export function mocUtc(ngayVn: string, cuoiNgay: boolean): string {
  const d = new Date(`${ngayVn}T00:00:00Z`);
  const ms = d.getTime() - 7 * 3600_000 + (cuoiNgay ? 86_400_000 - 1000 : 0);
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

/** Tháng VN "MM/YYYY" của một datetime UTC Odoo ("2026-08-25 03:10:00"). */
export function thangVn(dateOrderUtc: string): string {
  const d = new Date(`${dateOrderUtc.replace(' ', 'T')}Z`);
  const vn = new Date(d.getTime() + 7 * 3600_000);
  return `${String(vn.getUTCMonth() + 1).padStart(2, '0')}/${vn.getUTCFullYear()}`;
}

interface DongOdoo {
  id: number;
  order_id: [number, string] | false;
  order_partner_id: [number, string] | false;
  product_id: [number, string] | false;
  product_uom_qty: number;
  price_subtotal: number;
  purchase_price?: number;
  display_type?: string | false;
}

/** Tên → id kho / NV bán. Không thấy → lỗi rõ, đừng lặng lẽ bỏ lọc (số sẽ sai to). */
async function timIdTheoTen(
  odoo: LaiGopKhachDeps['odoo'], model: string, ten: string,
): Promise<{ ids: number[]; tenThat: string } | null> {
  const rows = await odoo.searchRead<{ id: number; name: string }>(
    model, [['name', 'ilike', ten]], ['id', 'name'], { limit: 5 },
  );
  if (rows.length === 0) return null;
  return { ids: rows.map((r) => r.id), tenThat: rows.map((r) => r.name).join(', ') };
}

export async function laiGopKhach(
  deps: LaiGopKhachDeps,
  input: VaoLaiGopKhach,
): Promise<KetQuaLaiGopKhach> {
  const ky = chonKy(input, deps.bayGio ?? new Date(), 'thang_nay');

  // ── Khách (chế độ một khách): id phải thật và khớp tên NV nhắc ──────────
  let khach: { id: number; ten: string } | null = null;
  if (input.khach_hang_id != null) {
    const id = Number(input.khach_hang_id);
    if (!Number.isInteger(id) || id <= 0) {
      return { trangThai: 'loi', lyDo: 'khach_hang_id không hợp lệ. Dùng tra_khach_hang để lấy id đúng.' };
    }
    const p = await deps.odoo.searchRead<{ id: number; name: string }>(
      'res.partner', [['id', '=', id]], ['id', 'name'], { limit: 1 },
    );
    if (p.length === 0) return { trangThai: 'loi', lyDo: `Không có khách id=${id}. Dùng tra_khach_hang, ĐỪNG bịa id.` };
    const tenNhac = (input.ten_khach ?? '').trim();
    if (tenNhac && !tenKhopKhach(tenNhac, p[0].name)) {
      return { trangThai: 'loi', lyDo: `Khách id=${id} là "${p[0].name}", không khớp "${tenNhac}". Gọi tra_khach_hang với đúng tên/mã KH.` };
    }
    khach = { id, ten: p[0].name };
  }

  // ── Bộ lọc kho / NV bán như web ─────────────────────────────────────────
  const domain: unknown[] = [
    ['order_id.state', 'in', ['sale', 'done']],
    ['order_id.date_order', '>=', mocUtc(ky.tu, false)],
    ['order_id.date_order', '<=', mocUtc(ky.den, true)],
    ['product_id', '!=', false],
    ['display_type', '=', false],
  ];
  const boLoc: { kho?: string; nvBan?: string } = {};
  if (input.kho?.trim()) {
    const k = await timIdTheoTen(deps.odoo, 'stock.warehouse', input.kho.trim());
    if (!k) return { trangThai: 'loi', lyDo: `Không có kho tên "${input.kho}". Bỏ tham số kho để tính tất cả kho.` };
    domain.push(['order_id.warehouse_id', 'in', k.ids]);
    boLoc.kho = k.tenThat;
  }
  if (input.nv_ban?.trim()) {
    const u = await timIdTheoTen(deps.odoo, 'res.users', input.nv_ban.trim());
    if (!u) return { trangThai: 'loi', lyDo: `Không có NV bán tên "${input.nv_ban}". Bỏ tham số nv_ban để tính tất cả.` };
    domain.push(['order_id.user_id', 'in', u.ids]);
    boLoc.nvBan = u.tenThat;
  }
  if (khach) domain.push(['order_partner_id', '=', khach.id]);

  const dong = await deps.odoo.searchRead<DongOdoo>(
    'sale.order.line', domain,
    ['order_id', 'order_partner_id', 'product_id', 'product_uom_qty', 'price_subtotal', 'purchase_price', 'display_type'],
    { limit: TRAN_DONG },
  );
  const biCat = dong.length >= TRAN_DONG;

  // ── Giá vốn dự phòng: standard_price hiện tại cho dòng purchase_price = 0 ─
  const spThieuVon = [...new Set(dong.filter((d) => !d.purchase_price && d.product_id).map((d) => (d.product_id as [number, string])[0]))];
  const vonHienTai = new Map<number, number>();
  for (let i = 0; i < spThieuVon.length; i += 500) {
    const rows = await deps.odoo.searchRead<{ id: number; standard_price: number }>(
      'product.product', [['id', 'in', spThieuVon.slice(i, i + 500)]], ['id', 'standard_price'], { limit: 500 },
    );
    for (const r of rows) vonHienTai.set(r.id, Number(r.standard_price) || 0);
  }

  // ── Cộng ────────────────────────────────────────────────────────────────
  const theoKhach = new Map<number, DongLaiGop & { don: Set<number> }>();
  const theoSp = new Map<number, DongLaiGop>();
  const donKhach = new Map<number, number>(); // order id → partner id (đếm đơn)
  let dongKhongVon = 0;
  let tongDt = 0, tongVon = 0;
  for (const d of dong) {
    if (!d.product_id || !d.order_partner_id || !d.order_id) continue;
    const [pid, pten] = d.product_id;
    const [kid, kten] = d.order_partner_id;
    const qty = Number(d.product_uom_qty) || 0;
    const donGiaVon = Number(d.purchase_price) || vonHienTai.get(pid) || 0;
    if (donGiaVon === 0 && qty > 0) dongKhongVon += 1;
    const dt = Number(d.price_subtotal) || 0;
    const von = donGiaVon * qty;
    tongDt += dt; tongVon += von;
    donKhach.set(d.order_id[0], kid);

    const k = theoKhach.get(kid) ?? { id: kid, ten: kten, doanhThu: 0, giaVon: 0, lai: 0, soLuong: 0, don: new Set<number>() };
    k.doanhThu += dt; k.giaVon += von; k.lai = k.doanhThu - k.giaVon; k.don.add(d.order_id[0]); k.soLuong = k.don.size;
    theoKhach.set(kid, k);

    if (khach) {
      const s = theoSp.get(pid) ?? { id: pid, ten: pten, doanhThu: 0, giaVon: 0, lai: 0, soLuong: 0 };
      s.doanhThu += dt; s.giaVon += von; s.lai = s.doanhThu - s.giaVon; s.soLuong += qty;
      theoSp.set(pid, s);
    }
  }
  const soDon = donKhach.size;

  if (khach) {
    // Theo tháng: cần date_order của từng đơn của khách (ít đơn, đọc riêng).
    const donIds = [...donKhach.keys()];
    const ngayDon = new Map<number, string>();
    for (let i = 0; i < donIds.length; i += 500) {
      const rows = await deps.odoo.searchRead<{ id: number; date_order: string }>(
        'sale.order', [['id', 'in', donIds.slice(i, i + 500)]], ['id', 'date_order'], { limit: 500 },
      );
      for (const r of rows) ngayDon.set(r.id, r.date_order);
    }
    const thangMap = new Map<string, LaiGopThang & { don: Set<number> }>();
    for (const d of dong) {
      if (!d.product_id || !d.order_id) continue;
      const ngay = ngayDon.get(d.order_id[0]);
      if (!ngay) continue;
      const nhan = thangVn(ngay);
      const qty = Number(d.product_uom_qty) || 0;
      const von = (Number(d.purchase_price) || vonHienTai.get(d.product_id[0]) || 0) * qty;
      const dt = Number(d.price_subtotal) || 0;
      const t = thangMap.get(nhan) ?? { nhan, doanhThu: 0, giaVon: 0, lai: 0, soDon: 0, don: new Set<number>() };
      t.doanhThu += dt; t.giaVon += von; t.lai = t.doanhThu - t.giaVon; t.don.add(d.order_id[0]); t.soDon = t.don.size;
      thangMap.set(nhan, t);
    }
    const thang = [...thangMap.values()]
      .sort((a, b) => a.nhan.slice(3).localeCompare(b.nhan.slice(3)) || a.nhan.localeCompare(b.nhan))
      .map(({ don: _d, ...t }) => t);
    const sanPham = [...theoSp.values()].sort((a, b) => b.lai - a.lai).slice(0, TOP_SP);
    return {
      trangThai: 'ok', cheDo: 'mot_khach', ky, boLoc, khach,
      tong: { doanhThu: tongDt, giaVon: tongVon, lai: tongDt - tongVon, soDon },
      thang, sanPham, dongKhongVon, biCat,
    };
  }

  const top = Math.min(TOP_KHACH_TOI_DA, Math.max(1, Math.round(Number(input.top) || TOP_KHACH_MAC_DINH)));
  const xep = [...theoKhach.values()].sort((a, b) => b.lai - a.lai).slice(0, top).map(({ don: _d, ...k }) => k);
  return {
    trangThai: 'ok', cheDo: 'xep_hang', ky, boLoc,
    tong: { doanhThu: tongDt, giaVon: tongVon, lai: tongDt - tongVon, soDon, soKhach: theoKhach.size },
    khach: xep, dongKhongVon, biCat,
  };
}

const tien = (n: number): string => `${Math.round(n).toLocaleString('vi-VN')}đ`;
const pct = (lai: number, dt: number): string => (dt > 0 ? `${((100 * lai) / dt).toFixed(1).replace('.', ',')}%` : '—');
const ngayVn = (s: string): string => s.split('-').reverse().join('/');

function dongBoLoc(kq: { ky: Ky; boLoc: { kho?: string; nvBan?: string } }): string {
  const loc = [kq.boLoc.kho ? `kho ${kq.boLoc.kho}` : '', kq.boLoc.nvBan ? `NV bán ${kq.boLoc.nvBan}` : ''].filter(Boolean);
  return `${ngayVn(kq.ky.tu)} – ${ngayVn(kq.ky.den)}${loc.length ? ` · ${loc.join(' · ')}` : ''}`;
}

const CHU_THICH =
  'Lãi gộp = doanh thu chưa thuế − giá vốn (cùng công thức trang "Báo cáo lãi gộp" trên web); ' +
  'CHƯA trừ vận chuyển và chi phí khác.';

export function dinhDangLaiGopKhach(kq: KetQuaLaiGopKhach, coAnh: boolean): string {
  if (kq.trangThai === 'loi') return `Không tính được lãi gộp: ${kq.lyDo}`;
  const canhBao =
    (kq.dongKhongVon > 0 ? `\nLƯU Ý: ${kq.dongKhongVon} dòng hàng chưa có giá vốn (vốn = 0) nên lãi ở đó bị tính cao hơn thật.` : '') +
    (kq.biCat ? '\nLƯU Ý: kỳ quá dài, dữ liệu bị cắt ở 20.000 dòng — thu hẹp kỳ để đủ số.' : '');
  const duoi =
    (coAnh ? '\nẢNH BIỂU ĐỒ đã gửi kèm tự động — nhắc nhân viên xem ảnh, ĐỪNG tự vẽ bảng dài.' : '') +
    '\nTrả lời NGẮN, số lấy Y NGUYÊN ở trên, không tự cộng lại. Nêu câu chú thích về vận chuyển/chi phí khác một lần.';

  if (kq.cheDo === 'mot_khach') {
    const t = kq.tong;
    const thang = kq.thang.length > 1
      ? `\nTheo tháng:\n${kq.thang.map((m) => `- ${m.nhan}: DT ${tien(m.doanhThu)} · lãi ${tien(m.lai)} (${pct(m.lai, m.doanhThu)}) · ${m.soDon} đơn`).join('\n')}`
      : '';
    const sp = kq.sanPham.length > 0
      ? `\nSản phẩm đóng góp lãi nhiều nhất:\n${kq.sanPham.map((s, i) => `${i + 1}. ${s.ten}: SL ${s.soLuong.toLocaleString('vi-VN')} · DT ${tien(s.doanhThu)} · lãi ${tien(s.lai)} (${pct(s.lai, s.doanhThu)})`).join('\n')}`
      : '';
    return (
      `Lãi gộp khách ${kq.khach.ten} (KH id=${kq.khach.id}) · ${dongBoLoc(kq)}:\n` +
      `Doanh thu ${tien(t.doanhThu)} · giá vốn ${tien(t.giaVon)} · LÃI GỘP ${tien(t.lai)} (${pct(t.lai, t.doanhThu)}) · ${t.soDon} đơn` +
      thang + sp + `\n${CHU_THICH}` + canhBao + duoi
    );
  }

  const t = kq.tong;
  const ds = kq.khach.map((k, i) => `${i + 1}. ${k.ten}: lãi ${tien(k.lai)} (${pct(k.lai, k.doanhThu)}) · DT ${tien(k.doanhThu)} · ${k.soLuong} đơn`).join('\n');
  return (
    `Xếp hạng khách theo LÃI GỘP · ${dongBoLoc(kq)} · toàn shop: DT ${tien(t.doanhThu)} · lãi ${tien(t.lai)} (${pct(t.lai, t.doanhThu)}) · ${t.soDon} đơn · ${t.soKhach} khách\n` +
    (ds || 'Không có đơn nào trong kỳ.') + `\n${CHU_THICH}` + canhBao + duoi
  );
}

export const laiGopKhachDefinition: ToolDefinition = {
  name: 'lai_gop_khach',
  description:
    'LÃI GỘP (lợi nhuận gộp) THEO KHÁCH HÀNG, cùng công thức "Báo cáo lãi gộp" trên web nhưng gom theo khách. ' +
    'Hai cách dùng: (1) MỘT khách: "lãi gộp khách X tháng này", "khách Duân ledway lời bao nhiêu quý này", ' +
    '"lợi nhuận anh Vinh mang lại theo từng sản phẩm" → BƯỚC 1 tra_khach_hang lấy khach_hang_id, truyền kèm ten_khach; ' +
    'trả tổng, theo tháng (kỳ dài), và sản phẩm đóng góp lãi nhiều nhất. ' +
    '(2) XẾP HẠNG: "khách nào lãi nhất tháng này", "top 10 khách lợi nhuận cao nhất năm nay" → KHÔNG truyền khach_hang_id. ' +
    'Có bộ lọc kho / NV bán như web. Kèm ẢNH BIỂU ĐỒ. ' +
    'Lãi gộp = doanh thu chưa thuế − giá vốn; CHƯA trừ vận chuyển/chi phí khác. ' +
    'KHÔNG dùng cho doanh số thuần (doanh_so_khach_theo_thang) hay công nợ (xuat_cong_no).',
  inputSchema: {
    type: 'object',
    properties: {
      khach_hang_id: { type: 'integer', description: 'id khách từ tra_khach_hang. Bỏ trống = xếp hạng nhiều khách.' },
      ten_khach: { type: 'string', description: 'Tên khách nhân viên nhắc — LUÔN truyền cùng khach_hang_id để đối chiếu.' },
      ky: { type: 'string', description: `${MO_TA_KY} Bỏ trống = tháng này.` },
      tu_ngay: { type: 'string', description: MO_TA_TU_NGAY },
      den_ngay: { type: 'string', description: MO_TA_DEN_NGAY },
      kho: { type: 'string', description: 'Tên kho để lọc (vd "Trung tâm", "Hồ Chí Minh"). Bỏ trống = tất cả kho.' },
      nv_ban: { type: 'string', description: 'Tên NV bán để lọc. Bỏ trống = tất cả.' },
      top: { type: 'integer', description: 'Chế độ xếp hạng: số khách liệt kê. Mặc định 10, tối đa 30.' },
    },
    required: [],
  },
};
