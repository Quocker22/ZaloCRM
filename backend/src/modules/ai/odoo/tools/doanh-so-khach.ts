// SPDX-License-Identifier: AGPL-3.0-or-later
// Tool: DOANH SỐ MỘT KHÁCH THEO TỪNG THÁNG — kèm biểu đồ cột (25/08/2026).
//
// Anh Quyết: "nhờ con AI thống kê doanh số khách hàng… lập dạng biểu đồ cột
// để theo dõi khách qua từng tháng". Web "Báo cáo › Tổng quan" (action 524)
// chỉ xếp hạng top khách TRONG MỘT KỲ, không có chuỗi theo tháng của MỘT
// khách — tool này lấp đúng chỗ đó.
//
// ĐỊNH NGHĨA DOANH THU = GIỐNG WEB (đo code incokit_dashboard_overview 25/08):
// account.move, move_type='out_invoice', state='posted' — HOÁ ĐƠN ĐÃ VÀO SỔ,
// KHÔNG trừ phiếu trả. Bot và web phải ra CÙNG một số, không thì NV cãi nhau.
//
// ODOO CỘNG, CODE KHÔNG TỰ TÍNH TỔNG: mỗi tháng một read_group (Odoo sum), tổng
// cả kỳ cũng hỏi Odoo một lần riêng — không .reduce() các tháng lại (luật
// cứng từ bao-cao-tong-quan.ts). Tối đa 12 tháng = 13 truy vấn nhẹ.
//
// CHỈ LUỒNG NHÂN VIÊN — doanh thu không bao giờ mở cho khách (nếp 06/08).
import type { OdooClient } from '../client.js';
import type { ToolDefinition } from '../../agent/types.js';
import { tenKhopKhach } from './tao-don-nhap.js';

const SO_THANG_MAC_DINH = 6;
const SO_THANG_TOI_DA = 12;

export interface DoanhSoThang {
  /** "MM/YYYY" */
  nhan: string;
  tu: string;
  den: string;
  tien: number;
  soHoaDon: number;
}

export type KetQuaDoanhSoKhach =
  | {
      trangThai: 'ok';
      khach: { id: number; ten: string };
      thang: DoanhSoThang[];
      /** Tổng cả kỳ — Odoo tính, không phải cộng các tháng. */
      tong: number;
      tongHoaDon: number;
      thangCaoNhat: DoanhSoThang | null;
    }
  | { trangThai: 'loi'; lyDo: string };

export interface DoanhSoKhachDeps {
  odoo: Pick<OdooClient, 'searchRead' | 'execute'>;
  /** Giờ hiện tại — inject để test tất định. */
  bayGio?: Date;
}

export interface VaoDoanhSoKhach {
  khach_hang_id: number;
  ten_khach?: string;
  so_thang?: number;
}

/** Các tháng lịch VN, kết thúc ở tháng hiện tại, cũ → mới. */
export function cacThang(soThang: number, bayGio: Date): Array<{ nhan: string; tu: string; den: string }> {
  const vn = new Date(bayGio.getTime() + 7 * 3600_000);
  const y = vn.getUTCFullYear();
  const m = vn.getUTCMonth(); // 0-based
  const ra: Array<{ nhan: string; tu: string; den: string }> = [];
  for (let i = soThang - 1; i >= 0; i--) {
    const dau = new Date(Date.UTC(y, m - i, 1));
    const cuoi = new Date(Date.UTC(y, m - i + 1, 0));
    const p = (n: number): string => String(n).padStart(2, '0');
    ra.push({
      nhan: `${p(dau.getUTCMonth() + 1)}/${dau.getUTCFullYear()}`,
      tu: dau.toISOString().slice(0, 10),
      den: cuoi.toISOString().slice(0, 10),
    });
  }
  return ra;
}

function domainHoaDon(khachId: number, tu: string, den: string): unknown[] {
  return [
    ['move_type', '=', 'out_invoice'],
    ['state', '=', 'posted'],
    ['partner_id', '=', khachId],
    ['invoice_date', '>=', tu],
    ['invoice_date', '<=', den],
  ];
}

async function odooCong(
  odoo: DoanhSoKhachDeps['odoo'],
  domain: unknown[],
): Promise<{ tien: number; soHoaDon: number }> {
  const rows = await odoo.execute<Array<Record<string, unknown>>>(
    'account.move', 'read_group', [domain, ['amount_total:sum'], []], { lazy: true },
  );
  const r = Array.isArray(rows) ? rows[0] : undefined;
  return {
    tien: Number(r?.amount_total ?? 0) || 0,
    soHoaDon: Number(r?.__count ?? r?.account_move_count ?? 0) || 0,
  };
}

export async function doanhSoKhachTheoThang(
  deps: DoanhSoKhachDeps,
  input: VaoDoanhSoKhach,
): Promise<KetQuaDoanhSoKhach> {
  const khachId = Number(input.khach_hang_id);
  if (!Number.isInteger(khachId) || khachId <= 0) {
    return { trangThai: 'loi', lyDo: 'khach_hang_id không hợp lệ. Dùng tra_khach_hang để lấy id đúng.' };
  }
  // Cùng hàng rào với tao_don_nhap: id phải có thật và KHỚP tên NV nhắc — model
  // lấy id từ danh sách cũ trong lịch sử là báo doanh số nhầm người.
  const partner = await deps.odoo.searchRead<Record<string, unknown>>(
    'res.partner', [['id', '=', khachId]], ['id', 'name'], { limit: 1 },
  );
  if (partner.length === 0) {
    return { trangThai: 'loi', lyDo: `Không có khách id=${khachId}. Dùng tra_khach_hang, ĐỪNG bịa id.` };
  }
  const tenThat = String(partner[0].name ?? '');
  const tenNhac = (input.ten_khach ?? '').trim();
  if (tenNhac && !tenKhopKhach(tenNhac, tenThat)) {
    return {
      trangThai: 'loi',
      lyDo: `Khách id=${khachId} là "${tenThat}", không khớp "${tenNhac}". Gọi tra_khach_hang với đúng tên/mã KH để lấy id.`,
    };
  }

  const soThang = Math.min(SO_THANG_TOI_DA, Math.max(1, Math.round(Number(input.so_thang) || SO_THANG_MAC_DINH)));
  const bayGio = deps.bayGio ?? new Date();
  const ds = cacThang(soThang, bayGio);

  const thang: DoanhSoThang[] = [];
  for (const t of ds) {
    const c = await odooCong(deps.odoo, domainHoaDon(khachId, t.tu, t.den));
    thang.push({ ...t, tien: c.tien, soHoaDon: c.soHoaDon });
  }
  const caKy = await odooCong(deps.odoo, domainHoaDon(khachId, ds[0].tu, ds[ds.length - 1].den));
  const thangCaoNhat = thang.reduce<DoanhSoThang | null>(
    (best, t) => (t.tien > 0 && (!best || t.tien > best.tien) ? t : best), null,
  );
  return {
    trangThai: 'ok',
    khach: { id: khachId, ten: tenThat },
    thang,
    tong: caKy.tien,
    tongHoaDon: caKy.soHoaDon,
    thangCaoNhat,
  };
}

const tien = (n: number): string => `${Math.round(n).toLocaleString('vi-VN')}đ`;

/** Text cho model — số lấy nguyên từ kết quả, dặn rõ ảnh đã gửi kèm. */
export function dinhDangDoanhSoKhach(kq: KetQuaDoanhSoKhach, coAnh: boolean): string {
  if (kq.trangThai === 'loi') return `Không thống kê được: ${kq.lyDo}`;
  const dong = kq.thang.map((t) => `- ${t.nhan}: ${tien(t.tien)} (${t.soHoaDon} hoá đơn)`).join('\n');
  const tb = kq.thang.length > 0 ? kq.tong / kq.thang.length : 0;
  return (
    `Doanh số khách ${kq.khach.ten} (KH id=${kq.khach.id}) — ${kq.thang.length} tháng, ` +
    `tính theo HOÁ ĐƠN ĐÃ VÀO SỔ (giống báo cáo Tổng quan trên web, chưa trừ trả hàng):\n` +
    `${dong}\n` +
    `Tổng cả kỳ: ${tien(kq.tong)} · ${kq.tongHoaDon} hoá đơn · trung bình ${tien(tb)}/tháng` +
    (kq.thangCaoNhat ? ` · cao nhất ${kq.thangCaoNhat.nhan} (${tien(kq.thangCaoNhat.tien)})` : ' · chưa có hoá đơn nào trong kỳ') +
    (coAnh ? '\nẢNH BIỂU ĐỒ CỘT đã được gửi kèm tự động — nhắc nhân viên xem ảnh, ĐỪNG tự vẽ bảng dài.' : '') +
    '\nTrả lời NGẮN: tổng, trung bình, tháng cao nhất, nhận xét tăng/giảm. Số lấy Y NGUYÊN ở trên, không tự cộng lại.'
  );
}

export const doanhSoKhachDefinition: ToolDefinition = {
  name: 'doanh_so_khach_theo_thang',
  description:
    'THỐNG KÊ DOANH SỐ của MỘT KHÁCH HÀNG theo TỪNG THÁNG, kèm ẢNH BIỂU ĐỒ CỘT. ' +
    'GỌI KHI: "doanh số khách X 6 tháng qua", "biểu đồ doanh số anh Long Led", ' +
    '"khách Vấn mua bao nhiêu mỗi tháng", "theo dõi khách X qua từng tháng". ' +
    'BƯỚC 1 luôn là tra_khach_hang để có khach_hang_id. ' +
    'Doanh số = hoá đơn đã vào sổ (giống báo cáo Tổng quan trên web). ' +
    'KHÔNG dùng cho tổng doanh thu cả shop (dùng bao_cao_tong_quan) hay công nợ (xuat_cong_no).',
  inputSchema: {
    type: 'object',
    properties: {
      khach_hang_id: { type: 'integer', description: 'id khách, lấy từ tra_khach_hang' },
      ten_khach: { type: 'string', description: 'Tên khách nhân viên nhắc — LUÔN truyền để đối chiếu' },
      so_thang: {
        type: 'integer',
        description: 'Số tháng gần nhất, tính cả tháng này. Mặc định 6, tối đa 12. "năm nay"/"12 tháng" → 12, "quý" → 3.',
      },
    },
    required: ['khach_hang_id'],
  },
};
