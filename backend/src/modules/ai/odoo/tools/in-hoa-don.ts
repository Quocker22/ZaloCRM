// SPDX-License-Identifier: AGPL-3.0-or-later
// Tool in_hoa_don — IN hoá đơn ra máy in ở shop (HP LaserJet Pro 4003, IPP).
//
// CHỈ ĐỌC Odoo + tạo job vào hàng đợi `print_jobs` — KHÔNG in thẳng trong
// lượt chat: máy in ở LAN shop qua cầu Tailscale, có thể chậm/tắt, không được
// giữ chân nhân viên. Cron may-in nhặt job in, in bù khi máy in sống lại.
//
// KHÁC xuat_hoa_don: cái đó GHI Odoo (xác nhận đơn + vào sổ lấy số). Tool này
// chỉ in tờ giấy của hoá đơn ĐÃ vào sổ. Đơn chưa có hoá đơn → chỉ đường sang
// xuat_hoa_don, không tự ý xuất (ghi ERP phải là quyết định rõ ràng của NV).
import type { OdooClient } from '../client.js';
import type { ToolDefinition } from '../../agent/types.js';
import { IDEMPOTENCY_PREFIX } from '../idempotency.js';
import { REPORT_HOA_DON, type KetQuaXuatHoaDon } from './xuat-hoa-don.js';
import { HAU_TO_KHONG_GIA, type ThamSoThemJob } from '../../may-in/hang-doi-in.js';
import { traKhachHang, laMaKh, type KhachHang } from './tra-khach-hang.js';
import { tenKhopKhach } from './tao-don-nhap.js';

/**
 * Xếp job vào hàng in — caller đã buộc sẵn prisma + orgId vào closure
 * (registry không biết orgId, nơi gọi runStaffAgent mới biết).
 */
export type ThemJobInHoaDon = (p: Omit<ThamSoThemJob, 'orgId'>) => Promise<void>;

export interface InHoaDonDeps {
  odoo: Pick<OdooClient, 'searchRead'>;
  /** Nói trống ("in hoá đơn") → lấy đơn mới nhất của hội thoại này. */
  conversationId?: string;
  themJob: ThemJobInHoaDon;
  /**
   * Xuất hoá đơn kế toán (vào sổ) khi đơn CHƯA có hoá đơn. In = đã bán →
   * phải ghi nhận trong Odoo trước khi in (anh Quyết 26/08). Idempotent sẵn
   * trong xuatHoaDon: đơn đã có hoá đơn thì trả lại cái cũ, không xuất đôi.
   */
  xuatHoaDon: (input: { don_id?: number; ma_don?: string }) => Promise<KetQuaXuatHoaDon>;
  /**
   * NGUYÊN CÂU nhân viên nhắn — caller (staff-agent) đưa vào, KHÔNG qua LLM,
   * nên model không bịa được. Là hàng rào cuối: thứ NV nêu đích danh trong
   * câu (tên khách/mã) phải nằm trên đơn sắp in. Xem `kiemCauNvKhopDon`.
   */
  cauNv?: string;
}

/**
 * Từ ĐỆM của câu "in đơn": bỏ đi rồi phần còn lại chính là thứ NV NÊU ĐÍCH
 * DANH (tên khách, mã). Không phải bảng tên khách — chỉ là bộ từ của chính
 * cái lệnh in ("in", "lại", "không giá"…) và xưng hô.
 */
const TU_DEM_IN = new Set([
  'in', 'don', 'hoa', 'bill', 'lai', 'nay', 'do', 'vua', 'tao', 'xong', 'khong', 'ko', 'co', 'gia',
  'cho', 'em', 'anh', 'chi', 'a', 'c', 'e', 'toi', 'minh', 'giup', 'voi', 'ra', 'may', 'ban', 'ho',
  'nhe', 'nha', 'di', 'luon', 'cua', 'va', 've', 'the', 'roi', 'kho', 'soan', 'hang', 'to', 'giay',
  'lan', 'tiep', 'xem', 'dung', 'ok', 'oke', 'vang', 'da', 'uh', 'u', 'thoi',
  'bot', 'tieu', 'ma', 'nelia', 'them', 'nua',
]);

/** Chuẩn để so: bỏ dấu, chỉ giữ chữ số và khoảng trắng. */
function chuanSo(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * HÀNG RÀO CUỐI (ca 10:36 26/08): NV "in đơn QC bách phát không in giá",
 * model đoán ma_don=S15274 (đơn Tấn Anh) và KHÔNG truyền khach → hàng rào
 * chủ đơn theo `khach` không có gì để so. Câu NV thì không đoán được: mọi
 * thứ NV nêu đích danh (sau khi bỏ từ đệm) phải xuất hiện trên đơn — tên
 * khách, mã đơn, số hoá đơn. Không nêu gì ("in đơn", "in lại") → cho qua.
 * Trả lý do từ chối, hoặc null nếu khớp.
 */
export function kiemCauNvKhopDon(
  cauNv: string,
  don: { maDon: string; soHoaDon?: string; tenKhach: string },
): string | null {
  // Bỏ khối trích tin được trả lời ("[Trả lời tin: "…"] đúng, in đơn …") —
  // tên trong tin cũ không phải thứ NV đang nêu.
  const cau = cauNv.replace(/^\s*\[[^\]]*\]\s*/, '').replace(/@\S+/g, ' ');
  const cs = chuanSo(cau);
  if (!cs) return null;
  const maDon = chuanSo(don.maDon);
  const soHd = chuanSo(don.soHoaDon ?? '');
  // Nêu đúng mã đơn / số hoá đơn → chính là đơn đó, khỏi so tên.
  if (maDon && cs.includes(maDon)) return null;
  if (soHd && cs.includes(soHd)) return null;
  const neu = cs.split(' ').filter((t) => t.length >= 2 && !/^\d+$/.test(t) && !TU_DEM_IN.has(t));
  if (neu.length === 0) return null;
  const tren = ` ${chuanSo(don.tenKhach)} ${maDon} ${soHd} `;
  const lech = neu.filter((t) => !tren.includes(t));
  if (lech.length === 0) return null;
  return (
    `Nhân viên nêu "${lech.join(' ')}" nhưng đơn ${don.maDon} là của "${don.tenKhach}" — không khớp, em KHÔNG in. ` +
    `Gọi lại với khach="${neu.join(' ')}" (bỏ ma_don/so_hoa_don) để in đúng đơn của khách đó.`
  );
}

export type KetQuaInHoaDon =
  | {
      trangThai: 'da_xep_hang';
      soHoaDon: string;
      maDon: string;
      tenKhach: string;
      tongTien: number;
      /** true = in có giá (NV nói rõ); mặc định in KHÔNG giá (anh Quyết 26/08). */
      coGia: boolean;
    }
  | { trangThai: 'loi'; lyDo: string };

const FIELDS_DON = ['id', 'name', 'state', 'amount_total', 'partner_id', 'invoice_ids'];
const FIELDS_HD = ['id', 'name', 'state', 'amount_total', 'move_type', 'partner_id'];

/** Tìm đơn theo id → mã → đơn mới nhất của hội thoại (cùng nếp xuat_hoa_don). */
async function timDon(
  deps: InHoaDonDeps,
  input: { don_id?: number; ma_don?: string; khach?: string },
): Promise<Record<string, unknown> | null> {
  if (input.don_id) {
    const r = await deps.odoo.searchRead<Record<string, unknown>>(
      'sale.order', [['id', '=', input.don_id]], FIELDS_DON, { limit: 1 },
    );
    if (r.length > 0) return r[0];
  }
  const ma = input.ma_don?.trim();
  if (ma) {
    const r = await deps.odoo.searchRead<Record<string, unknown>>(
      'sale.order', [['name', '=', ma]], FIELDS_DON, { limit: 1 },
    );
    if (r.length > 0) return r[0];
  }
  if (!input.don_id && !ma && input.khach?.trim()) return null; // đường khách xử lý riêng
  if (!input.don_id && !ma && deps.conversationId?.trim()) {
    const r = await deps.odoo.searchRead<Record<string, unknown>>(
      'sale.order',
      [['client_order_ref', 'like', `${IDEMPOTENCY_PREFIX}:${deps.conversationId.trim()}:%`]],
      FIELDS_DON,
      { limit: 1, order: 'create_date desc' },
    );
    if (r.length > 0) return r[0];
  }
  return null;
}

/**
 * IN THEO KHÁCH (ca thật 10:36 + 10:40-10:49 26/08): "in đơn QC bách phát",
 * "in đơn anh Linh Hà Tĩnh", "in đơn KH000129". Tool không có đường này nên
 * model ĐOÁN mã đơn từ hội thoại cũ → in S15274 (Tấn Anh) thay vì S15281
 * (QC Bách Phát), in S15286 (Tubione) lần 3 thay vì S15285 (anh Linh), rồi
 * còn `doc_odoo partner_id=129` vì tưởng mã KH là id.
 *
 * Trả `{ khach }` để caller còn kiểm chủ đơn; trả `{ loi }` khi mơ hồ — trùng
 * tên thì liệt kê cho NV chọn, TUYỆT ĐỐI không in bừa (giấy in nhầm cho kho
 * soạn hàng = giao nhầm hàng).
 */
async function timKhach(
  deps: InHoaDonDeps,
  khach: string,
): Promise<{ khach: KhachHang } | { loi: string }> {
  const kh = khach.trim();
  // MÃ KHÁCH (ref) — Odoo có ref mang đuôi phân loại ("KH000129-SACDL") nên
  // "KH000129" tra `=ilike` không ra; tra chứa rồi giữ ref BẮT ĐẦU bằng mã.
  if (laMaKh(kh)) {
    const rows = await deps.odoo.searchRead<Record<string, unknown>>(
      'res.partner', [['ref', 'ilike', kh]], ['id', 'name', 'ref', 'phone', 'mobile'], { limit: 5 },
    );
    const khop = rows.filter((r) => String(r.ref ?? '').toLowerCase().startsWith(kh.toLowerCase()));
    if (khop.length === 1) {
      const r = khop[0];
      return {
        khach: {
          id: Number(r.id), ten: String(r.name ?? ''), ma: r.ref ? String(r.ref) : null,
          dienThoai: (r.phone ? String(r.phone) : null) ?? (r.mobile ? String(r.mobile) : null), congNo: 0,
        },
      };
    }
    if (khop.length === 0) return { loi: `Không có khách nào mang mã ${kh}.` };
  }
  const kq = await traKhachHang({ odoo: deps.odoo }, laMaKh(kh) ? { ma: kh } : { ten: kh });
  if (kq.trangThai === 'tim_thay') return { khach: kq.khach };
  if (kq.trangThai === 'nhieu_ket_qua' && kq.tuChot) return { khach: kq.tuChot };
  if (kq.trangThai === 'nhieu_ket_qua') {
    const ds = kq.danhSach.slice(0, 6).map((k) => `${k.ten}${k.ma ? ` [${k.ma}]` : ''}`).join('; ');
    return { loi: `Có nhiều khách khớp "${kh}": ${ds}${kq.conNua ? '; …' : ''}. Hỏi NV chọn đúng khách (mã KH hoặc tên đầy đủ) rồi gọi lại — ĐỪNG tự chọn.` };
  }
  return { loi: `Không tìm thấy khách "${kh}" trong Odoo.` };
}

/** Đơn MỚI NHẤT đã xác nhận của khách — "in đơn <khách>" nghĩa là đơn vừa lên. */
async function donMoiNhatCuaKhach(deps: InHoaDonDeps, khach: KhachHang): Promise<Record<string, unknown> | null> {
  const r = await deps.odoo.searchRead<Record<string, unknown>>(
    'sale.order',
    [['partner_id', '=', khach.id], ['state', 'in', ['sale', 'done']]],
    FIELDS_DON,
    { limit: 1, order: 'date_order desc, id desc' },
  );
  return r[0] ?? null;
}

export async function inHoaDon(
  deps: InHoaDonDeps,
  input: {
    so_hoa_don?: string; ma_don?: string; don_id?: number; khach?: string;
    co_gia?: boolean;
  },
): Promise<KetQuaInHoaDon> {
  const coGia = input.co_gia === true;
  const duoi = coGia ? '' : HAU_TO_KHONG_GIA;
  try {
    let hoaDon: Record<string, unknown> | null = null;
    let maDon = '';
    let tenKhach = '';

    // Khách NV nêu tên — vừa là đường tìm đơn, vừa là HÀNG RÀO chủ đơn.
    const khachNeu = input.khach?.trim() ?? '';
    let khachTimDuoc: KhachHang | null = null;
    if (khachNeu && !input.so_hoa_don?.trim()) {
      const kq = await timKhach(deps, khachNeu);
      if ('loi' in kq) return { trangThai: 'loi', lyDo: kq.loi };
      khachTimDuoc = kq.khach;
    }

    // Đường 1: nhân viên đưa thẳng số hoá đơn (INV/2026/00042).
    const soHd = input.so_hoa_don?.trim();
    if (soHd) {
      const r = await deps.odoo.searchRead<Record<string, unknown>>(
        'account.move',
        [['name', '=', soHd], ['move_type', '=', 'out_invoice']],
        FIELDS_HD,
        { limit: 1 },
      );
      hoaDon = r[0] ?? null;
    }

    // Đường 2: qua đơn bán → hoá đơn mới nhất chưa huỷ của đơn.
    if (!hoaDon) {
      let don = await timDon(deps, input);
      const theoMaDon = Boolean(input.don_id || input.ma_don?.trim());
      if (!don && khachTimDuoc && !theoMaDon) {
        don = await donMoiNhatCuaKhach(deps, khachTimDuoc);
        if (!don) {
          return { trangThai: 'loi', lyDo: `Khách ${khachTimDuoc.ten} chưa có đơn nào đã xác nhận trên Odoo — không có gì để in.` };
        }
      }
      if (!don && !soHd) {
        return {
          trangThai: 'loi',
          lyDo: 'Không tìm thấy đơn/hoá đơn. Truyền khach (tên/mã KH), so_hoa_don (INV/...), ma_don (S13811) hoặc don_id; để trống nếu vừa làm đơn trong hội thoại này.',
        };
      }
      if (don) {
        maDon = String(don.name ?? '');
        tenKhach = Array.isArray(don.partner_id) ? String(don.partner_id[1] ?? '') : '';
        // HÀNG RÀO CHỦ ĐƠN: model đưa ma_don/don_id mà đơn đó không phải của
        // khách NV nêu → từ chối. Ca 10:36 26/08: NV "in đơn QC bách phát",
        // model in S15274 của Tấn Anh rồi bot còn bịa "đã in đơn QC Bách Phát".
        if (khachNeu && theoMaDon) {
          const chuDon = Array.isArray(don.partner_id) ? Number(don.partner_id[0]) : NaN;
          const cungChu = (khachTimDuoc && khachTimDuoc.id === chuDon) || tenKhopKhach(khachNeu, tenKhach);
          if (!cungChu) {
            return {
              trangThai: 'loi',
              lyDo: `Đơn ${maDon} là của "${tenKhach}", KHÔNG phải của khách "${khachNeu}" — em không in. Gọi lại CHỈ với khach="${khachNeu}" (bỏ ma_don) để in đơn mới nhất của đúng khách.`,
            };
          }
        }
        // Hàng rào chủ đơn cho đơn đích danh (trước khi xuất/in).
        if (deps.cauNv && !khachNeu) {
          const ly = kiemCauNvKhopDon(deps.cauNv, { maDon, tenKhach });
          if (ly) return { trangThai: 'loi', lyDo: ly };
        }
        const ids = Array.isArray(don.invoice_ids) ? don.invoice_ids.map(Number) : [];
        if (ids.length === 0) {
          // IN = ĐÃ BÁN (anh Quyết 26/08): đơn chưa có hoá đơn → TỰ XUẤT hoá
          // đơn (vào sổ: tính doanh số, trừ tồn) rồi in. Không còn in tờ đơn
          // nháp — mọi tờ giấy ra máy in đều đã được Odoo ghi nhận.
          // xuatHoaDon idempotent: đơn đã có hoá đơn thì trả lại cái cũ.
          const kqX = await deps.xuatHoaDon({ ma_don: maDon });
          if (kqX.trangThai === 'loi') {
            return { trangThai: 'loi', lyDo: `Không xuất được hoá đơn để in: ${kqX.lyDo}` };
          }
          await deps.themJob({
            conversationId: deps.conversationId,
            hoaDonId: kqX.hoaDonId,
            soHoaDon: kqX.soHoaDon,
            report: `${REPORT_HOA_DON}${duoi}`,
          });
          return {
            trangThai: 'da_xep_hang', soHoaDon: kqX.soHoaDon, maDon: kqX.maDon,
            tenKhach: kqX.tenKhach, tongTien: kqX.tongTien, coGia,
          };
        }
        const hds = await deps.odoo.searchRead<Record<string, unknown>>(
          'account.move',
          [['id', 'in', ids], ['move_type', '=', 'out_invoice'], ['state', '!=', 'cancel']],
          FIELDS_HD,
          { limit: 1, order: 'id desc' },
        );
        hoaDon = hds[0] ?? null;
      }
    }

    if (!hoaDon) {
      return { trangThai: 'loi', lyDo: `Không tìm thấy hoá đơn${soHd ? ` ${soHd}` : ''}.` };
    }

    let soHoaDon = String(hoaDon.name ?? '');
    let hoaDonId = Number(hoaDon.id);
    let tongTien = Number(hoaDon.amount_total ?? 0);
    if (!tenKhach && Array.isArray(hoaDon.partner_id)) tenKhach = String(hoaDon.partner_id[1] ?? '');
    if (deps.cauNv && !khachNeu) {
      const ly = kiemCauNvKhopDon(deps.cauNv, { maDon, soHoaDon, tenKhach });
      if (ly) return { trangThai: 'loi', lyDo: ly };
    }

    // Hoá đơn còn NHÁP (chưa vào sổ) → TỰ VÀO SỔ rồi in. In = đã bán, phải
    // ghi nhận (anh Quyết 26/08). xuatHoaDon idempotent: đã posted thì trả cũ.
    if (String(hoaDon.state) !== 'posted') {
      const kqX = maDon
        ? await deps.xuatHoaDon({ ma_don: maDon })
        : await deps.xuatHoaDon({ don_id: hoaDonId });
      if (kqX.trangThai === 'loi') {
        return { trangThai: 'loi', lyDo: `Không xuất được hoá đơn để in: ${kqX.lyDo}` };
      }
      soHoaDon = kqX.soHoaDon;
      hoaDonId = kqX.hoaDonId;
      tongTien = kqX.tongTien;
      if (kqX.maDon) maDon = kqX.maDon;
      if (kqX.tenKhach) tenKhach = kqX.tenKhach;
    }

    await deps.themJob({
      conversationId: deps.conversationId,
      hoaDonId,
      soHoaDon,
      // MẶC ĐỊNH KHÔNG GIÁ (anh Quyết 10:08 26/08: "in đơn đều là in đơn không
      // giá") — tờ in cho kho soạn hàng; NV nói rõ "in có giá" mới in giá.
      report: `${REPORT_HOA_DON}${duoi}`,
    });
    return { trangThai: 'da_xep_hang', soHoaDon, maDon, tenKhach, tongTien, coGia };
  } catch (err) {
    return { trangThai: 'loi', lyDo: err instanceof Error ? err.message : String(err) };
  }
}

export const inHoaDonDefinition: ToolDefinition = {
  name: 'in_hoa_don',
  description:
    'IN hoá đơn ra MÁY IN ở shop (tờ giấy thật). ' +
    'GỌI KHI nhân viên nói: "in đơn X", "in hoá đơn", "in bill đơn S13811". ' +
    'IN = ĐÃ BÁN: đơn CHƯA có hoá đơn thì tool TỰ XUẤT hoá đơn (vào sổ Odoo: tính doanh số, ' +
    'trừ tồn) rồi in — không bao giờ in tờ giấy mà hệ thống chưa ghi nhận. ' +
    'KHÁC xuat_hoa_don: xuat_hoa_don CHỈ ghi sổ; in_hoa_don ghi sổ (nếu chưa) RỒI in giấy. ' +
    'NV nói TÊN/MÃ KHÁCH ("in đơn QC bách phát", "in đơn anh Linh Hà Tĩnh", "in đơn KH000129") → ' +
    'truyền khach=đúng chữ đó, tool tự lấy đơn MỚI NHẤT của khách. ĐỪNG đoán ma_don từ hội thoại cũ, ' +
    'ĐỪNG tra doc_odoo/kham_pha_odoo (KH000129 là mã khách, không phải id). ' +
    'Có mã đơn/số hoá đơn thì truyền so_hoa_don hoặc ma_don; nói trống → tự lấy đơn mới nhất của hội thoại. ' +
    'MẶC ĐỊNH in KHÔNG GIÁ (tờ cho kho soạn hàng): "in đơn X", "in đơn X không giá", ' +
    '"in không in giá" → KHÔNG truyền co_gia. Chỉ khi nhân viên nói rõ "in có giá"/"in giá" → co_gia=true. ' +
    'ĐỪNG đi tìm bảng/cột nào về "in giá" bằng kham_pha_odoo — tool này lo hết. ' +
    'Tool chỉ XẾP HÀNG in — máy in tắt thì job chờ, máy bật lại là in.',
  inputSchema: {
    type: 'object',
    properties: {
      so_hoa_don: { type: 'string', description: 'Số hoá đơn dạng INV/2026/00042.' },
      ma_don: { type: 'string', description: 'Mã đơn dạng S13811 — tool tự tìm hoá đơn của đơn.' },
      don_id: { type: 'integer', description: 'id đơn hàng, lấy từ kết quả tao_don_nhap.' },
      khach: {
        type: 'string',
        description: 'Tên hoặc mã khách ĐÚNG như NV nói ("QC bách phát", "anh Linh Hà Tĩnh", "KH000129") → in đơn mới nhất của khách. Luôn truyền khi NV nêu tên khách, kể cả khi đã đoán được ma_don (tool kiểm chủ đơn).',
      },
      co_gia: {
        type: 'boolean',
        description: 'true CHỈ khi nhân viên nói rõ "in có giá"/"in giá". Không nói gì hoặc nói "không giá" → bỏ trống (mặc định không giá).',
      },
    },
    required: [],
  },
  mutates: true,
};

export function dinhDangInHoaDon(kq: KetQuaInHoaDon): string {
  if (kq.trangThai === 'loi') return `Không in được hoá đơn: ${kq.lyDo}`;
  const tien = kq.tongTien.toLocaleString('vi-VN');
  const gia = kq.coGia ? 'bản CÓ GIÁ' : 'bản KHÔNG GIÁ (chỉ tên hàng + số lượng)';
  const don = kq.maDon ? ` (đơn ${kq.maDon})` : '';
  return (
    `Đã xếp hàng in hoá đơn ${kq.soHoaDon}${don} · ${kq.tenKhach} · ${tien}đ — ${gia}. ` +
    'Máy in ở shop sẽ nhả trong ít giây; nếu máy in đang tắt thì job chờ, bật lại là in.'
  );
}
