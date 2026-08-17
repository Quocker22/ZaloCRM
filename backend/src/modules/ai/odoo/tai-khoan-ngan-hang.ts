// SPDX-License-Identifier: AGPL-3.0-or-later
// TÀI KHOẢN NHẬN TIỀN cho VietQR — đọc từ ODOO (res.partner.bank của công ty),
// không còn env AI_QR_* (anh Quốc 17/08: "trong odoo cũng có setup ngân hàng
// rồi, khiển bot lấy danh sách ngân hàng và stk trong odoo luôn").
//
// Odoo KHÔNG lưu mã BIN VietQR (đo prod 17/08: res.bank.bic chỉ ghi "TPBank"/
// "Agribank"/"Vietcombank" dạng chữ, không field nào tên bin/napas). Sinh QR
// cần BIN số theo chuẩn NAPAS → bảng map tên/bic → BIN nằm ở đây (danh mục
// công khai, ổn định, thêm ngân hàng mới = thêm một dòng).
//
// CHỌN TÀI KHOẢN NÀO khi công ty có nhiều: Odoo không có cờ "mặc định" trên
// res.partner.bank → lấy tài khoản active có SEQUENCE/ID nhỏ nhất (dòng đầu
// danh sách trên Odoo). Muốn đổi TK nhận tiền: kéo lên đầu / archive cái cũ
// trên Odoo — không cần deploy. Cache 5 phút; Odoo lỗi → dùng cache cũ; chưa
// có cache → null (bot bỏ qua QR, không sinh QR sai).
import type { OdooClient } from './client.js';
import { logger } from '../../../shared/utils/logger.js';

/** BIN NAPAS theo tên/bic ngân hàng (thường + không dấu, khớp chứa). */
const BIN_NGAN_HANG: Array<{ khop: RegExp; bin: string; ten: string }> = [
  { khop: /tpbank|tien phong/i, bin: '970423', ten: 'TPBank' },
  { khop: /agribank|nong nghiep/i, bin: '970405', ten: 'Agribank' },
  { khop: /vietcombank|ngoai thuong|\bvcb\b/i, bin: '970436', ten: 'Vietcombank' },
  { khop: /techcombank|ky thuong|\btcb\b/i, bin: '970407', ten: 'Techcombank' },
  { khop: /vietinbank|cong thuong/i, bin: '970415', ten: 'VietinBank' },
  { khop: /\bbidv\b|dau tu va phat trien/i, bin: '970418', ten: 'BIDV' },
  { khop: /\bmb\b|mbbank|quan doi/i, bin: '970422', ten: 'MB Bank' },
  { khop: /\bacb\b|a chau/i, bin: '970416', ten: 'ACB' },
  { khop: /sacombank|sai gon thuong tin/i, bin: '970403', ten: 'Sacombank' },
  { khop: /\bvpbank\b|viet nam thinh vuong/i, bin: '970432', ten: 'VPBank' },
  { khop: /\bhdbank\b/i, bin: '970437', ten: 'HDBank' },
  { khop: /\bshb\b|sai gon ha noi/i, bin: '970443', ten: 'SHB' },
  { khop: /\bvib\b|quoc te/i, bin: '970441', ten: 'VIB' },
  { khop: /\bmsb\b|hang hai/i, bin: '970426', ten: 'MSB' },
  { khop: /\bocb\b|phuong dong/i, bin: '970448', ten: 'OCB' },
  { khop: /\bseabank\b|dong nam a/i, bin: '970440', ten: 'SeABank' },
  { khop: /\blpbank\b|lienviet|buu dien lien viet/i, bin: '970449', ten: 'LPBank' },
  { khop: /\beximbank\b|xuat nhap khau/i, bin: '970431', ten: 'Eximbank' },
  { khop: /nam a/i, bin: '970428', ten: 'Nam A Bank' },
  { khop: /\btimo\b|ban viet|bvbank/i, bin: '970454', ten: 'BVBank' },
];

const boDau = (s: string): string =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');

/** Tra BIN từ tên ngân hàng + bic Odoo. Không khớp → null (không đoán). */
export function binTuTenNganHang(ten: string, bic?: string): string | null {
  const chuoi = boDau(`${ten} ${bic ?? ''}`);
  const hit = BIN_NGAN_HANG.find((b) => b.khop.test(chuoi));
  return hit ? hit.bin : null;
}

export interface TaiKhoanNhanTien {
  bankBin: string;
  accountNo: string;
  accountName?: string;
  tenNganHang: string;
}

interface Cache { tk: TaiKhoanNhanTien | null; luc: number }
let cache: Cache | null = null;
const TTL_MS = 5 * 60_000;

/** Test/ops: xoá cache. */
export function xoaCacheTaiKhoan(): void { cache = null; }

/**
 * Tài khoản nhận tiền mặc định của công ty trên Odoo — dòng đầu danh sách
 * (sequence, id) còn active và ngân hàng tra được BIN.
 */
export async function taiKhoanNhanTien(
  odoo: Pick<OdooClient, 'searchRead'>,
): Promise<TaiKhoanNhanTien | null> {
  if (cache && Date.now() - cache.luc < TTL_MS) return cache.tk;
  try {
    const [cty] = await odoo.searchRead<Record<string, unknown>>(
      'res.company', [], ['id', 'partner_id'], { limit: 1 },
    );
    const partnerId = Array.isArray(cty?.partner_id) ? Number(cty.partner_id[0]) : 0;
    if (!partnerId) throw new Error('không đọc được partner công ty');
    const ds = await odoo.searchRead<Record<string, unknown>>(
      'res.partner.bank',
      [['partner_id', '=', partnerId], ['active', '=', true]],
      ['id', 'acc_number', 'acc_holder_name', 'bank_id', 'sequence'],
      { limit: 20, order: 'sequence asc, id asc' },
    );
    let tk: TaiKhoanNhanTien | null = null;
    for (const d of ds) {
      const bankId = Array.isArray(d.bank_id) ? Number(d.bank_id[0]) : 0;
      const tenNh = Array.isArray(d.bank_id) ? String(d.bank_id[1]) : '';
      let bic = '';
      if (bankId) {
        const [nh] = await odoo.searchRead<Record<string, unknown>>(
          'res.bank', [['id', '=', bankId]], ['bic'], { limit: 1 },
        );
        bic = String(nh?.bic ?? '');
      }
      const bin = binTuTenNganHang(tenNh, bic);
      const so = String(d.acc_number ?? '').replace(/\s+/g, '');
      if (bin && so) {
        tk = {
          bankBin: bin, accountNo: so, tenNganHang: tenNh,
          ...(d.acc_holder_name ? { accountName: String(d.acc_holder_name) } : {}),
        };
        break;
      }
      logger.warn({ acc: so, nganHang: tenNh }, '[tk-ngan-hang] bỏ qua TK: không tra được BIN — thêm vào BIN_NGAN_HANG');
    }
    cache = { tk, luc: Date.now() };
    if (!tk) logger.warn('[tk-ngan-hang] công ty chưa có TK ngân hàng tra được BIN trên Odoo — bot bỏ qua QR');
    return tk;
  } catch (err) {
    logger.warn({ err }, '[tk-ngan-hang] đọc TK từ Odoo lỗi — dùng cache cũ/không QR');
    return cache?.tk ?? null;
  }
}
