// SPDX-License-Identifier: AGPL-3.0-or-later
// CẦM LÁI luồng nhân viên (nhánh feat/dieu-phoi-cam-lai, 27/08).
//
// Anh Quốc: "nếu còn dùng regex thì chắc chắn không phát triển được, phải
// triệt tiêu nó đi; các điều kiện if/else cứng cũng không ổn". Luật của file
// này, và của cả nhánh:
//
//   HIỂU Ý = việc của MODEL, làm trên OBJECT PHIÊN cố định (phien-don.ts).
//   Code KHÔNG đọc chữ NV gõ để đoán gì cả — không regex, không "câu này là
//   sửa / là chọn / là khách khác". NV gõ "3", "a", "2, a", "loại trong",
//   "sửa 30 bóng", "A quyết. 2 cái Fa 100w. Giá 0 đồng" — model đối chiếu
//   lịch sử + bằng chứng đã tra rồi điền object; code chỉ thấy object.
//
//   CODE làm 4 việc tất định:
//     1. gọi model (deepseek suy nghĩ riêng + tool tim_khach/tim_sp trả JSON có id)
//     2. KIỂM DỮ LIỆU: id model điền phải nằm trong bằng chứng đã tra (bịa → bỏ);
//        chưa có id → code tra bù (tất định), một kết quả rõ → điền, nhiều → hỏi chọn
//     3. chạy tool Odoo theo object (tạo khách, tạo đơn, sửa đơn) khi object ĐỦ
//     4. render tin từ object (câu hỏi ô thiếu, tóm tắt đơn) — render dữ liệu,
//        không phải đoán chữ
//
//   Không có hàng rào nào đọc chữ. Model sai → sửa prompt/object/vòng kiểm
//   chứng, KHÔNG thêm luật code.
import { logger } from '../../../../shared/utils/logger.js';
import type { OdooClient } from '../../odoo/client.js';
import type { ToolAwareGenerate, ToolDefinition } from '../types.js';
import { chayVongKiemChung } from '../harness/vong-kiem-chung.js';
import type { ToolCallLog } from '../staff-agent.js';
import { taoDonNhap, dinhDangTaoDon, type DongDon, type VaoTaoDon, type KetQuaTaoDon, type TaoDonDeps } from '../../odoo/tools/tao-don-nhap.js';
import { suaDon, dinhDangSuaDon, type DongSua, type KetQuaSuaDon } from '../../odoo/tools/sua-don.js';
import { taoKhachHang, dinhDangTaoKhach, CHIA_BO_PHANH, type KetQuaTaoKhach } from '../../odoo/tools/tao-khach-hang.js';
import { traThueBan } from '../../odoo/tools/tra-thue.js';
import { NGUONG_GIA_AO } from '../../odoo/tools/tra-san-pham.js';
import { guiHoaDon } from '../../odoo/tools/gui-hoa-don.js';
import { linkXuLyDon, type HoaDonAnhClient, type AnhHoaDon } from '../../odoo/hoa-don-anh.js';
import { dieuPhoiPhien, type DauVaoDieuPhoi, type KetQuaDieuPhoi, type YDinh } from './dieu-phoi.js';
import { type PhienDon, type DongHang, type OCanHoi, oConThieu, tomTatPhien, phienTrong, ghiDaHoi } from './phien-don.js';
type DongHangCoId = DongHang & { spId?: number };
import { boToolTim, bangChungTrong, hamTimOdoo, themBangChungKhach, themBangChungSp, tomTatBangChungPhien, type BangChungPhien, type HamTim } from './tool-tim.js';

export const TIMEOUT_LAI_MS = 45_000;

export interface DepsLai {
  odoo: Pick<OdooClient, 'searchRead' | 'execute'>;
  generate: ToolAwareGenerate;
  anhClient: HoaDonAnhClient | null;
  odooUrl: string;
  guiTin: (text: string) => Promise<void>;
  guiAnhHoaDon: (anh: AnhHoaDon) => Promise<void>;
  ghiLog: (l: ToolCallLog) => void;
  docPhien: (conversationId: string) => Promise<PhienDon>;
  luuPhien: (conversationId: string, p: PhienDon) => Promise<void>;
  xoaPhien: (conversationId: string) => Promise<void>;
  timeoutMs?: number;
  /** Soát số (SL/giá) bằng một lượt model riêng trước khi ghi Odoo — mặc định bật. */
  kiemSo?: boolean;
  /** Tiêm hàm tra/ghi (test thay bằng giả) — mặc định đi Odoo thật qua `odoo`. */
  tim?: HamTim;
  ghi?: {
    taoDon: (deps: TaoDonDeps, input: VaoTaoDon) => Promise<KetQuaTaoDon>;
    suaDon: (input: Parameters<typeof suaDon>[1]) => Promise<KetQuaSuaDon>;
    taoKhach: (input: { ten: string; sdt?: string }) => Promise<KetQuaTaoKhach>;
    dongDon: (donId: number) => Promise<number[]>;
  };
}

function hamTim(deps: Pick<DepsLai, 'odoo' | 'tim'>): HamTim { return deps.tim ?? hamTimOdoo({ odoo: deps.odoo }); }
function hamGhi(deps: DepsLai): NonNullable<DepsLai['ghi']> {
  return deps.ghi ?? {
    taoDon: (d, i) => taoDonNhap(d, i),
    suaDon: (i) => suaDon({ odoo: deps.odoo }, i),
    taoKhach: (i) => taoKhachHang({ odoo: deps.odoo }, { ten: i.ten, ...(i.sdt ? { dien_thoai: i.sdt } : {}), bo_phanh_trung_ten: true, [CHIA_BO_PHANH]: true }),
    dongDon: async (donId) => {
      const lines = await deps.odoo.searchRead<Record<string, unknown>>('sale.order.line', [['order_id', '=', donId]], ['product_id'], { limit: 60 });
      return lines.map((l) => Number(Array.isArray(l.product_id) ? l.product_id[0] : l.product_id));
    },
  };
}

export interface VaoLai {
  orgId: string;
  conversationId: string;
  seq: number;
  cau: string;
  lichSu: DauVaoDieuPhoi['lichSu'];
}

export interface KetQuaLai {
  /** true = lượt đã được xử (đã gửi tin). false = không phải việc đơn → agent thường. */
  nhan: boolean;
  yDinh?: YDinh;
  /** Tin đã gửi (để log/so sánh). */
  daGui?: string[];
  nguon: 'llm' | 'loi' | 'khong_viec';
  ms: number;
}

const DAN_LAI = [
  'BẠN ĐANG CẦM LÁI luồng nhân viên: object bạn ghi sẽ được máy dùng để TRA và GHI Odoo thật, nên:',
  '- Có tool tim_khach / tim_sp: PHẢI tra khách (tên/SĐT/mã) và TỪNG mặt hàng chưa có spId, ngay trong lượt này.',
  '  Tra khách bằng NGUYÊN CỤM NV gõ ("anh việt nguyễn xiển", "a long led") — tên Odoo hay kèm địa chỉ/biệt danh;',
  '  chỉ rút gọn ("việt") khi cụm đầy đủ không ra ai.',
  '  Gọi nhiều tool cùng lúc được. Kết quả đúng MỘT (không gần đúng) → điền id. Nhiều ứng viên → để id trống,',
  '  máy sẽ hỏi NV chọn; TRỪ khi chính tin NV đã nói rõ loại nào ("đầu trong", "24V", "Nelia") thì chọn đúng cái đó.',
  '- NV trả lời câu chọn của bot ("3", "a", "2, a", "cái thứ 2", "loại trong", "Nelia") → đối chiếu với danh sách bot',
  '  ĐÃ HỎI trong lịch sử / mục ĐÃ TRA ĐƯỢC rồi điền id tương ứng. Không tra lại, không hỏi lại.',
  '- id CHỈ được lấy từ kết quả tool hoặc mục ĐÃ TRA ĐƯỢC. Không bao giờ tự nghĩ ra id.',
  '- NV nêu KHÁCH KHÁC HẲN kèm hàng mới khi đang gom → đó là đơn mới: thay khách, dong = hàng trong tin mới.',
  '  Cùng người viết khác ("a Long" vs "Anh Long Led") thì không phải khách khác.',
  '- Sau khi đơn đã lên (xem ĐƠN VỪA LÊN), NV "sửa…/đổi số lượng…/thêm…/bỏ…" → y_dinh=sua_don, che=sua_don,',
  '  dong = danh sách SAU KHI SỬA (đủ mọi dòng còn lại). NV chỉ nhắc lại món đã có, hay gõ lại số đã chọn → y_dinh=xac_nhan.',
  '- "Giá 0 đồng"/"tặng"/"miễn phí" → tang=true. Số lượng chỉ lấy số NV NÓI (30b = 30 bóng; "x 5200" là giá).',
  '- Cụm ĐỨNG ĐẦU câu trước dấu ":" hoặc "/" hoặc "." ("Red Sun : 2607…", "Lộc led 88 / 30b…", "Qc T&T. 4 cái…") là',
  '  KHÁCH, không phải tên hàng. Tên hàng không được chứa tên khách.',
  '- Khi bot ĐANG CHỜ NV CHỌN (xem NGỮ CẢNH), tin NV là tên/biến thể tên một ứng viên ("fa 50w trắng", "loại Nelia",',
  '  "cái 140cm") → đó là CÂU CHỌN: điền id ứng viên khớp, y_dinh=dat_hang, không phải hoi_khac.',
  '- NV nêu THÔNG SỐ (140cm, 24V, 4000K, trắng/ấm) → chọn SP có ĐÚNG thông số đó; nhiều dòng khác thông số thì',
  '  phải ra spId KHÁC NHAU. Không chọn SP chung chung ("Cáp 16Pin") khi có SP cụ thể ("Cáp 16pin dài 140cm").',
  '- Khách mo_ho (trùng nhiều người) VẪN điền giaTri.ten nguyên văn NV gõ để máy liệt kê ứng viên cho NV chọn.',
  '- Tin NV khớp NGUYÊN VĂN (bỏ dấu, hoa/thường, khoảng trắng) tên một ứng viên đang chờ chọn ("fa 50w trắng" = "Fa 50W',
  '  Màu Trắng") → chọn ĐÚNG ứng viên đó, không tra lại, không hỏi lại.',
  '- Lệnh xuất/in hoá đơn, huỷ đơn theo mã, hỏi tồn, báo cáo, tán gẫu → y_dinh tương ứng (hoi_khac/hoi_ton/tan_gau),',
  '  không đổi ô; máy sẽ chuyển cho agent khác.',
  '- Cách NV viết số: "400b" = 400 bóng, "10c" = 10 cái, "30b … x 5200" = 30 bóng giá 5200, "x 140k" = giá 140.000.',
  '  "4 bóng lixin", "2 bóng 2607", "3b 6214" là TÊN HỌ HÀNG (Led 2/3/4 bóng), không phải số lượng.',
  '- Hai ứng viên cùng khớp tên NV gõ, chỉ khác ở chi tiết NV KHÔNG nhắc (SMD/COB, 12V/24V…) → để spId trống để hỏi.',
].join('\n');

/* ───────────────────────── soát số trước khi ghi (model, không regex) ───────────────────────── */

const ketLuanSoDefinition: ToolDefinition = {
  name: 'ket_luan_so',
  description: 'Kết luận số lượng / đơn giá / tặng của từng dòng có đúng con số NV nói không. LUÔN gọi tool này.',
  inputSchema: {
    type: 'object',
    properties: {
      ok: { type: 'boolean', description: 'true = mọi dòng đúng số NV nói' },
      dong: {
        type: 'array', description: 'CHỈ khi ok=false: danh sách dòng ĐÃ SỬA (giữ nguyên ten).',
        items: { type: 'object', properties: { ten: { type: 'string' }, soLuong: { type: 'number' }, donGia: { type: 'number' }, tang: { type: 'boolean' } }, required: ['ten', 'soLuong'] },
      },
      ly_do: { type: 'string' },
    },
    required: ['ok'],
  },
};
const SYSTEM_SOAT_SO = [
  'Bạn là người SOÁT SỐ cho bot lên đơn LED. Đọc TIN NHÂN VIÊN (và lịch sử) rồi kiểm từng dòng máy sắp ghi:',
  'số lượng và đơn giá có đúng CON SỐ nhân viên nói không. Chỉ soát số, không soát tên hàng.',
  'Cách NV viết: "400b" = 400 bóng; "10c" = 10 cái; "30b f30 … x 5200" = 30 bóng, giá 5200; "x 140k" = giá 140000;',
  '"1tr2" = 1200000; "Giá 0 đồng"/"tặng" = tặng. "4 bóng lixin"/"2 bóng 2607"/"3b 6214" là tên họ hàng, KHÔNG phải SL.',
  'Không có giá trong tin → giữ giá máy đã điền (có thể là giá hệ thống). Mọi dòng đúng → ok=true. Sai → ok=false + dong đã sửa.',
].join('\n');

export async function soatSoTruocKhiGhi(deps: Pick<DepsLai, 'generate' | 'ghiLog'>, vao: VaoLai, p: PhienDon): Promise<void> {
  const dong = p.dong.map((d) => ({ ten: d.ten, soLuong: d.soLuong.giaTri ?? null, donGia: d.donGia.trangThai === 'da_co' ? d.donGia.giaTri ?? null : null, tang: d.tang === true }));
  const lichSu = vao.lichSu.slice(-6).map((m) => `[${m.vai === 'bot' ? 'BOT' : 'NV'}] ${m.noiDung.slice(0, 300)}`).join('\n');
  const t0 = Date.now();
  try {
    const vong = await chayVongKiemChung({
      generate: deps.generate, system: SYSTEM_SOAT_SO,
      userMessage: `LỊCH SỬ:\n${lichSu || '(không)'}\n\nTIN NHÂN VIÊN: "${vao.cau.slice(0, 600)}"\n\nDÒNG MÁY SẮP GHI:\n${JSON.stringify(dong)}`,
      kiemChung: [], toolCuoi: ketLuanSoDefinition, toiDaVong: 1, timeoutMs: 15_000, maxTokens: 700,
    });
    const kl = vong.chot;
    deps.ghiLog({ toolName: 'soat_so', input: { dong }, output: JSON.stringify(kl ?? { lyDo: vong.lyDo }).slice(0, 600), thanhCong: kl != null, durationMs: Date.now() - t0, iteration: 0 });
    if (!kl || kl.ok === true || !Array.isArray(kl.dong)) return;
    for (const raw of kl.dong as Array<Record<string, unknown>>) {
      const d = p.dong.find((x) => x.ten.trim().toLowerCase() === String(raw.ten ?? '').trim().toLowerCase());
      if (!d) continue;
      if (typeof raw.soLuong === 'number' && raw.soLuong > 0 && raw.soLuong !== d.soLuong.giaTri) { d.soLuong = { trangThai: 'da_co', giaTri: raw.soLuong }; }
      if (typeof raw.donGia === 'number' && raw.donGia >= 0 && raw.donGia !== d.donGia.giaTri) { d.donGia = { trangThai: 'da_co', giaTri: raw.donGia }; }
      if (raw.tang === true) d.tang = true;
    }
    logger.warn({ lyDo: kl.ly_do, dong: p.dong.map((d) => `${d.ten}: ${d.soLuong.giaTri} × ${d.donGia.giaTri ?? 'ht'}`), conversationId: vao.conversationId }, '[lai] soát số đã sửa dòng trước khi ghi');
  } catch (err) {
    logger.warn({ err }, '[lai] soát số lỗi — ghi theo object đang có');
  }
}

/* ───────────────────────── kiểm dữ liệu (không đọc chữ) ───────────────────────── */

/** id model điền có nằm trong bằng chứng không — bịa thì bỏ id, giữ tên. */
export function doiChieuBangChung(p: PhienDon, bc: BangChungPhien): { khachBia: boolean; spBia: string[] } {
  let khachBia = false;
  const spBia: string[] = [];
  if (p.khach.trangThai === 'da_co' && p.khach.giaTri?.id != null) {
    const k = bc.khach.find((x) => x.id === p.khach.giaTri!.id);
    if (!k) { khachBia = true; delete p.khach.giaTri.id; }
    else { p.khach.giaTri.ten = k.ten; if (k.ma) p.khach.giaTri.maKh = k.ma; }
  }
  for (const d of p.dong) {
    if (d.spId == null) continue;
    const s = bc.sp.find((x) => x.id === d.spId);
    if (!s) { spBia.push(d.ten); delete d.spId; delete d.tenOdoo; delete d.giaOdoo; }
    else { d.tenOdoo = s.ten; d.giaOdoo = s.gia; }
  }
  // Hai dòng TÊN KHÁC NHAU mà cùng một spId (replay S8: 4 cỡ cáp → cùng "Cáp
  // 16Pin") = khớp ẩu → bỏ id cả nhóm, tra bù/hỏi lại. Kiểm dữ liệu, không đọc chữ.
  const theoId = new Map<number, DongHangCoId[]>();
  for (const d of p.dong) if (d.spId != null) theoId.set(d.spId, [...(theoId.get(d.spId) ?? []), d as DongHangCoId]);
  for (const nhom of theoId.values()) {
    if (nhom.length > 1 && new Set(nhom.map((d) => d.ten.trim().toLowerCase())).size > 1) {
      for (const d of nhom) { spBia.push(d.ten); delete d.spId; delete d.tenOdoo; delete d.giaOdoo; }
    }
  }
  return { khachBia, spBia };
}

/** Ứng viên trong bằng chứng khớp với tên đang gom — để render câu hỏi chọn (dữ liệu, không phải đoán). */
export interface UngVienConTreo {
  khach?: { ten: string; ds: BangChungPhien['khach']; conNua: boolean; khongThay: boolean };
  sp: Array<{ ten: string; ds: BangChungPhien['sp']; khongThay: boolean; ganDung: boolean }>;
}

/**
 * TRA BÙ tất định cho ô model chưa gắn id: khách da_co không id (không phải
 * khách mới) và dòng không spId. Một kết quả rõ ràng → điền; còn lại → giữ
 * ứng viên để hỏi. Đây là gọi tool theo dữ liệu object, không phải đoán chữ.
 */
export async function traBu(deps: Pick<DepsLai, 'odoo' | 'ghiLog' | 'tim'>, p: PhienDon, bc: BangChungPhien): Promise<UngVienConTreo> {
  const treo: UngVienConTreo = { sp: [] };
  const tim = hamTim(deps);
  // Khách chưa có id (da_co hoặc mo_ho) và không phải khách mới → dùng lần tra
  // gần nhất (model đã tra) hoặc tra mới theo ô; một người rõ / ứng viên áp
  // đảo (goiY = xepHangKhach) → điền; còn lại → danh sách cho NV chọn.
  const khachChuaId = (p.khach.trangThai === 'da_co' || p.khach.trangThai === 'mo_ho') && !p.khach.giaTri?.moi && p.khach.giaTri?.id == null;
  if (khachChuaId) {
    const g = p.khach.giaTri ?? { ten: '' };
    let r: Awaited<ReturnType<HamTim['khach']>> & { hoi: string };
    const cuoi = bc.traKhachCuoi;
    const coCauHoi = Boolean(g.ten || g.sdt || g.maKh);
    if (cuoi && (!coCauHoi || cuoi.hoi.trim().toLowerCase() === (g.ten ?? '').trim().toLowerCase())) {
      r = { ketQua: cuoi.ds.length === 1 ? 'mot' : cuoi.ds.length === 0 ? 'khong' : 'nhieu', khach: cuoi.ds, conNua: cuoi.conNua, ...(cuoi.goiY ? { goiY: cuoi.goiY } : {}), hoi: cuoi.hoi };
    } else if (coCauHoi) {
      const t0 = Date.now();
      const kq = await tim.khach({ ...(g.ten ? { ten: g.ten } : {}), ...(g.sdt ? { sdt: g.sdt } : {}), ...(g.maKh ? { ma: g.maKh } : {}) });
      themBangChungKhach(bc, kq.khach);
      bc.traKhachCuoi = { hoi: g.ten ?? g.sdt ?? g.maKh ?? '', ds: kq.khach, conNua: kq.conNua, ...(kq.goiY ? { goiY: kq.goiY } : {}) };
      deps.ghiLog({ toolName: 'tim_khach', input: g, output: JSON.stringify(kq).slice(0, 600), thanhCong: true, durationMs: Date.now() - t0, iteration: 0 });
      r = { ...kq, hoi: g.ten ?? '' };
    } else {
      r = { ketQua: 'khong', khach: [], conNua: false, hoi: '' };
    }
    if (r.ketQua === 'mot' || (r.ketQua === 'nhieu' && r.goiY != null && r.khach.some((k) => k.id === r.goiY))) {
      const chon = r.ketQua === 'mot' ? r.khach[0] : r.khach.find((k) => k.id === r.goiY)!;
      p.khach = { trangThai: 'da_co', giaTri: { ...g, id: chon.id, ten: chon.ten, ...(chon.ma ? { maKh: chon.ma } : {}) } };
    } else if (r.hoi || r.khach.length > 0) {
      treo.khach = { ten: g.ten || r.hoi, ds: r.khach, conNua: r.conNua, khongThay: r.ketQua === 'khong' };
    }
  }
  for (const d of p.dong) {
    if (d.spId != null) continue;
    const t0 = Date.now();
    const r = await tim.sp({ ten: d.ten });
    themBangChungSp(bc, r.sp);
    deps.ghiLog({ toolName: 'tim_sp', input: { ten: d.ten }, output: JSON.stringify(r).slice(0, 600), thanhCong: true, durationMs: Date.now() - t0, iteration: 0 });
    if (r.sp.length === 1 && !r.ganDung) {
      d.spId = r.sp[0].id; d.tenOdoo = r.sp[0].ten; d.giaOdoo = r.sp[0].gia;
    } else {
      treo.sp.push({ ten: d.ten, ds: r.sp, khongThay: r.sp.length === 0, ganDung: r.ganDung });
    }
  }
  return treo;
}

/** SP chưa có giá hệ thống mà NV chưa báo giá, không tặng → ô giá thành mo_ho (dữ liệu, không đoán). */
export function danhDauGiaThieu(p: PhienDon): void {
  for (const d of p.dong) {
    if (d.tang || d.spId == null) continue;
    const giaHt = d.giaOdoo ?? 0;
    if (d.donGia.trangThai !== 'da_co' && giaHt <= NGUONG_GIA_AO && d.donGia.trangThai !== 'tu_choi') {
      d.donGia = { trangThai: 'mo_ho', ghiChu: 'hệ thống chưa có giá' };
    }
  }
}

/** Object đủ để ghi Odoo chưa — thuần dữ liệu. */
export function duDeGhi(p: PhienDon, treo: UngVienConTreo): boolean {
  if (p.che !== 'dat_hang' && p.che !== 'sua_don') return false;
  if (p.khach.trangThai !== 'da_co' || !p.khach.giaTri) return false;
  if (p.khach.giaTri.id == null && !p.khach.giaTri.moi) return false;
  if (p.dong.length === 0 || treo.sp.length > 0 || treo.khach) return false;
  return p.dong.every((d) => d.spId != null && d.soLuong.trangThai === 'da_co' && (d.soLuong.giaTri ?? 0) > 0
    && (d.tang || d.donGia.trangThai === 'da_co' || d.donGia.trangThai === 'tu_choi' || (d.giaOdoo ?? 0) > NGUONG_GIA_AO));
}

/* ───────────────────────── render tin từ object ───────────────────────── */

const tien = (n: number): string => n.toLocaleString('vi-VN');

export function soanCauHoi(p: PhienDon, treo: UngVienConTreo, canHoi: OCanHoi[]): string {
  const doan: string[] = [];
  if (treo.khach) {
    const k = treo.khach;
    if (k.khongThay) doan.push(`Em không tìm thấy khách "${k.ten}" ạ. Anh/chị cho em SĐT hoặc mã KH, hoặc nói "khách mới" để em tạo.`);
    else {
      const ds = k.ds.slice(0, 10).map((x, i) => `${i + 1}) ${x.ten}${x.ma ? ` · ${x.ma}` : ''}${x.sdt ? ` · ${x.sdt}` : ''}`).join('\n');
      doan.push(`Có ${k.ds.length}${k.conNua ? '+' : ''} khách tên "${k.ten}":\n${ds}\n${k.conNua ? 'Danh sách CHƯA ĐỦ — không thấy đúng người, anh/chị gõ tên đầy đủ hơn hoặc SĐT.\n' : ''}Anh/chị chọn giúp em (vd: 1) ạ.`);
    }
  }
  for (const s of treo.sp.slice(0, 2)) {
    if (s.khongThay) doan.push(`Em không tìm thấy "${s.ten}" trong hệ thống ạ. Anh/chị gõ tên khác (đúng tên trên Odoo) hoặc "tạo mới ${s.ten}" giúp em.`);
    else {
      const ds = s.ds.slice(0, 8).map((x, i) => `${String.fromCharCode(97 + i)}) ${x.ten}${x.gia > NGUONG_GIA_AO ? ` · ${tien(x.gia)}đ` : ' · chưa có giá'}`).join('\n');
      doan.push(`"${s.ten}" có ${s.ds.length} loại${s.ganDung ? ' gần giống' : ''}:\n${ds}\nAnh/chị chọn giúp em (vd: a) ạ.`);
    }
  }
  if (doan.length === 0) {
    for (const c of canHoi.slice(0, 2)) {
      if (c.o === 'khach') doan.push(c.trangThai === 'mo_ho' && c.ghiChu ? `Khách là ai ạ? (${c.ghiChu})` : 'Đơn này lên cho khách nào ạ? (tên, SĐT hoặc mã KH)');
      else if (c.o === 'dong') doan.push('Anh/chị cần lên hàng gì ạ? (tên sản phẩm + số lượng)');
      else if (c.o === 'soLuong') doan.push(`Anh/chị lấy mấy cái ${c.dong ?? ''} ạ?${c.ghiChu ? ` (${c.ghiChu})` : ''}`);
      else if (c.o === 'donGia') doan.push(`${c.dong ?? 'Món này'}: ${c.ghiChu ?? 'giá chưa rõ'} — anh/chị báo giá giúp em (vd: 13k/cái) ạ.`);
      else doan.push(`Anh/chị cho em biết ${c.o} ạ.${c.ghiChu ? ` (${c.ghiChu})` : ''}`);
    }
  }
  return doan.join('\n\n');
}

function dongDon(p: PhienDon): DongDon[] {
  return p.dong.map((d) => ({
    san_pham_id: d.spId!,
    so_luong: d.soLuong.giaTri!,
    ...(d.tang ? { tang: true } : d.donGia.trangThai === 'da_co' && d.donGia.giaTri != null ? { don_gia: d.donGia.giaTri } : {}),
    ...(d.chietKhauPhanTram ? { chiet_khau: d.chietKhauPhanTram } : {}),
  }));
}

export function tomTatDon(p: PhienDon, maDon: string, tong: number, link: string, laSua: boolean): string {
  const k = p.khach.giaTri!;
  const dong = p.dong.map((d) => {
    const sl = d.soLuong.giaTri ?? 0;
    const gia = d.tang ? 0 : d.donGia.trangThai === 'da_co' && d.donGia.giaTri != null ? d.donGia.giaTri : (d.giaOdoo ?? 0);
    const nhan = d.tang ? ' — TẶNG (0đ)' : d.donGia.trangThai === 'da_co' && d.donGia.giaTri != null && d.donGia.giaTri !== d.giaOdoo ? ` (giá anh/chị báo ${tien(d.donGia.giaTri)}đ${(d.giaOdoo ?? 0) > NGUONG_GIA_AO ? `, hệ thống ${tien(d.giaOdoo!)}đ` : ''})` : '';
    return `${sl} × ${d.tenOdoo ?? d.ten} = ${tien(sl * gia)}đ${nhan}${d.chietKhauPhanTram ? ` · CK ${d.chietKhauPhanTram}%` : ''}`;
  }).join('\n');
  const phu = p.phuPhi.trangThai === 'da_co' && p.phuPhi.giaTri?.length ? '\n' + p.phuPhi.giaTri.map((x) => `+ ${x.ten}: ${tien(x.tien)}đ`).join('\n') : '';
  const vat = p.vatPhanTram.trangThai === 'da_co' && p.vatPhanTram.giaTri ? `\nVAT ${p.vatPhanTram.giaTri}%` : '';
  return `Đơn cho ${k.ten}${k.maKh ? ` (${k.maKh})` : ''}:\n${dong}${phu}${vat}\nTổng: ${tien(tong)}đ.\n` +
    `Em đã ${laSua ? 'sửa' : 'lên'} đơn nháp ${maDon} cho ${k.ten}, tổng ${tien(tong)}đ. Link xử lý: ${link}\n` +
    'Sai chỗ nào anh/chị nhắn "sửa đơn ..." em sửa ngay ạ.';
}

/* ───────────────────────── ghi Odoo theo object ───────────────────────── */

async function ghiOdoo(deps: DepsLai, vao: VaoLai, p: PhienDon): Promise<string[]> {
  const gui: string[] = [];
  const k = p.khach.giaTri!;
  // Khách mới → tạo (tool có lớp chống trùng riêng bằng dữ liệu Odoo).
  const ghi = hamGhi(deps);
  if (k.id == null && k.moi) {
    const t0 = Date.now();
    const kq = await ghi.taoKhach({ ten: k.ten, ...(k.sdt ? { sdt: k.sdt } : {}) });
    deps.ghiLog({ toolName: 'tao_khach_hang', input: { ten: k.ten, sdt: k.sdt }, output: dinhDangTaoKhach(kq), thanhCong: kq.trangThai === 'ok', durationMs: Date.now() - t0, iteration: 0 });
    if (kq.trangThai !== 'ok') { gui.push(`Em chưa tạo được khách "${k.ten}": ${kq.lyDo}`); return gui; }
    k.id = kq.khach.id; k.ten = kq.khach.ten; if (kq.khach.ma) k.maKh = kq.khach.ma; delete k.moi;
  }
  const thue = p.vatPhanTram.trangThai === 'da_co' && p.vatPhanTram.giaTri ? await traThueBan({ odoo: deps.odoo }, p.vatPhanTram.giaTri).catch(() => null) : null;
  const phuPhi = p.phuPhi.trangThai === 'da_co' && p.phuPhi.giaTri?.length ? p.phuPhi.giaTri.map((x) => ({ ten: x.ten, tien: x.tien })) : undefined;

  if (p.che === 'sua_don' && p.donVuaLen) {
    // Sửa: đối chiếu object với dòng đang có trên đơn (dữ liệu Odoo) → đổi / thêm.
    const coSan = new Set(await ghi.dongDon(p.donVuaLen.donId));
    const tatCa = dongDon(p).map((d) => ({ ...d }) as DongSua);
    const doi = tatCa.filter((d) => coSan.has(d.san_pham_id));
    const them = tatCa.filter((d) => !coSan.has(d.san_pham_id));
    const t0 = Date.now();
    const kq = await ghi.suaDon({ don_id: p.donVuaLen.donId, doi, them, ...(phuPhi ? { phu_phi: phuPhi } : {}) });
    deps.ghiLog({ toolName: 'sua_don', input: { don_id: p.donVuaLen.donId, doi, them }, output: dinhDangSuaDon(kq), thanhCong: kq.ok, durationMs: Date.now() - t0, iteration: 0 });
    if (!kq.ok) { gui.push(`Em chưa sửa được đơn ${p.donVuaLen.maDon}: ${kq.lyDo ?? ''}`); return gui; }
    gui.push(tomTatDon(p, kq.maDon, kq.tongSau ?? 0, linkXuLyDon(deps.odooUrl, kq.donId), true));
    p.donVuaLen = { ...p.donVuaLen, luc: new Date().toISOString() };
    p.che = 'khong';
    return gui;
  }

  const donVao: VaoTaoDon = {
    khach_hang_id: k.id!, dong: dongDon(p), y_dinh: 'moi', ten_khach: k.ten,
    ...(phuPhi ? { phu_phi: phuPhi } : {}),
    ...(thue ? { thue_id: thue.id } : {}),
  };
  const t0 = Date.now();
  const kq = await ghi.taoDon({ odoo: deps.odoo, conversationId: vao.conversationId, seq: vao.seq, choPhepDatGia: true, xacNhanGiaLech: true }, donVao);
  deps.ghiLog({ toolName: 'tao_don_nhap', input: donVao, output: dinhDangTaoDon(kq, true), thanhCong: kq.trangThai !== 'loi', durationMs: Date.now() - t0, iteration: 0 });
  if (kq.trangThai === 'loi') { gui.push(`Không tạo được đơn: ${kq.lyDo}`); return gui; }
  if (kq.trangThai === 'da_ton_tai') {
    gui.push(`Đơn này đã tạo trước đó rồi: ${kq.maDon}. Link xử lý: ${linkXuLyDon(deps.odooUrl, kq.donId)}`);
    p.donVuaLen = { donId: kq.donId, maDon: kq.maDon, tenKhach: k.ten, khachId: k.id!, luc: new Date().toISOString() };
    p.che = 'khong';
    return gui;
  }
  if (deps.anhClient) {
    try {
      const hd = await guiHoaDon({ odoo: deps.odoo, anhClient: deps.anhClient, odooUrl: deps.odooUrl }, { don_id: kq.donId });
      if (hd?.anh) await deps.guiAnhHoaDon(hd.anh);
    } catch (err) { logger.warn({ err, donId: kq.donId }, '[lai] ảnh báo giá lỗi (vẫn gửi link)'); }
  }
  gui.push(tomTatDon(p, kq.maDon, kq.tongTien, linkXuLyDon(deps.odooUrl, kq.donId), false));
  p.donVuaLen = { donId: kq.donId, maDon: kq.maDon, tenKhach: k.ten, khachId: k.id!, luc: new Date().toISOString() };
  p.che = 'khong';
  return gui;
}

/* ───────────────────────── một lượt ───────────────────────── */

const Y_DINH_VIEC_DON: YDinh[] = ['dat_hang', 'sua_don', 'nhap_hang', 'xac_nhan', 'huy'];

export async function laiLuotNhanVien(deps: DepsLai, vao: VaoLai): Promise<KetQuaLai> {
  const t0 = Date.now();
  const phienCu = await deps.docPhien(vao.conversationId);
  const bc = phienCu.bangChung ?? bangChungTrong();
  const dangHoi = phienCu.dangHoi;
  const moTaDangHoi = dangHoi
    ? ['BOT ĐANG CHỜ NV CHỌN (tin mới có thể là câu trả lời cho mục này):',
        ...(dangHoi.khach ? [`  khách "${dangHoi.khach.ten}": ${dangHoi.khach.ds.map((x, i) => `${i + 1}) id=${x.id} ${x.ten}`).join('; ')}`] : []),
        ...(dangHoi.sp ?? []).map((s) => `  hàng "${s.ten}": ${s.ds.map((x, i) => `${String.fromCharCode(97 + i)}) id=${x.id} ${x.ten}`).join('; ')}`),
      ].join('\n')
    : '';
  const nguCanh = [tomTatBangChungPhien(bc), moTaDangHoi, phienCu.donVuaLen ? `ĐƠN VỪA LÊN: ${phienCu.donVuaLen.maDon} cho ${phienCu.donVuaLen.tenKhach} (${phienCu.donVuaLen.luc.slice(11, 16)} UTC)` : ''].filter(Boolean).join('\n');

  const kq: KetQuaDieuPhoi = await dieuPhoiPhien(
    deps.generate,
    { phien: phienCu, cauMoi: vao.cau, lichSu: vao.lichSu, ...(nguCanh ? { nguCanh } : {}) },
    deps.timeoutMs ?? TIMEOUT_LAI_MS,
    { odoo: deps.odoo },
    {
      kiemChung: boToolTim(hamTim(deps), bc), toiDaVong: 3, maxTokens: 1500, systemThem: DAN_LAI, tranKetQua: 2500,
      ...(dangHoi ? { nhacSauTin: '→ XÉT TRƯỚC: tin này có phải câu trả lời cho mục "BOT ĐANG CHỜ NV CHỌN" không (số thứ tự, chữ cái, tên hay biến thể tên một ứng viên)? Nếu có: điền đúng id ứng viên đó, y_dinh=dat_hang, KHÔNG tra lại, KHÔNG coi là hỏi thông tin.' } : {}),
    },
  );
  deps.ghiLog({
    toolName: 'dieu_phoi_lai',
    input: { cau: vao.cau.slice(0, 300), phienCu: tomTatPhien(phienCu).slice(0, 600) },
    output: JSON.stringify({ nguon: kq.nguon, yDinh: kq.yDinh, che: kq.phien.che, soVong: kq.soVong, ms: kq.ms, luuY: kq.luuY, lyDo: kq.lyDo, phien: tomTatPhien(kq.phien).slice(0, 900) }),
    thanhCong: kq.nguon === 'llm', durationMs: kq.ms, iteration: 0,
  });
  if (kq.nguon === 'loi') {
    logger.warn({ lyDo: kq.lyDo, ms: kq.ms, conversationId: vao.conversationId }, '[lai] điều phối lỗi/chậm — nhường đường cũ');
    return { nhan: false, nguon: 'loi', ms: Date.now() - t0 };
  }

  const p = kq.phien;
  p.bangChung = bc;
  if (phienCu.donVuaLen && !p.donVuaLen) p.donVuaLen = phienCu.donVuaLen;

  if (kq.yDinh === 'huy') {
    await deps.xoaPhien(vao.conversationId);
    const t = 'Em huỷ đơn đang gom rồi ạ. Cần lên lại anh/chị cứ nhắn nhé.';
    await deps.guiTin(t);
    return { nhan: true, yDinh: kq.yDinh, daGui: [t], nguon: 'llm', ms: Date.now() - t0 };
  }
  // Gõ lại số/chữ đã chọn sau khi đơn đã lên → nhắc đơn, không đẩy sang agent (ca 16:25 27/08).
  if (kq.yDinh === 'xac_nhan' && p.donVuaLen && p.che !== 'sua_don' && p.che !== 'dat_hang') {
    delete p.dangHoi;
    await deps.luuPhien(vao.conversationId, p);
    const t = `Đơn ${p.donVuaLen.maDon} của ${p.donVuaLen.tenKhach} đã lên rồi ạ. Cần sửa gì anh/chị nhắn "sửa đơn ..." nhé.`;
    await deps.guiTin(t);
    return { nhan: true, yDinh: kq.yDinh, daGui: [t], nguon: 'llm', ms: Date.now() - t0 };
  }
  const laViecDon = Y_DINH_VIEC_DON.includes(kq.yDinh) && (p.che === 'dat_hang' || p.che === 'sua_don');
  if (!laViecDon) {
    await deps.luuPhien(vao.conversationId, p);
    return { nhan: false, yDinh: kq.yDinh, nguon: 'khong_viec', ms: Date.now() - t0 };
  }

  const bia = doiChieuBangChung(p, bc);
  if (bia.khachBia || bia.spBia.length) logger.warn({ bia, conversationId: vao.conversationId }, '[lai] model điền id không có trong bằng chứng — bỏ id');
  const treo = await traBu(deps, p, bc);
  // SOÁT SỐ ngay khi tin mới mang dòng hàng (trước cả khi hỏi): replay S1 lượt
  // 3 model bỏ mất "giá 150K" rồi máy đi hỏi giá — soát trước thì điền lại
  // được và khỏi hỏi. Chỉ soát khi lượt này model có đụng tới dòng.
  const modelDungDong = JSON.stringify(p.dong.map((d) => [d.ten, d.soLuong.giaTri, d.donGia.giaTri, d.tang])) !== JSON.stringify(phienCu.dong.map((d) => [d.ten, d.soLuong.giaTri, d.donGia.giaTri, d.tang]));
  if (deps.kiemSo !== false && p.dong.length > 0 && modelDungDong) await soatSoTruocKhiGhi(deps, vao, p);
  danhDauGiaThieu(p);

  const daGui: string[] = [];
  if (kq.yDinh === 'xac_nhan' && p.donVuaLen && p.che !== 'sua_don') {
    daGui.push(`Đơn ${p.donVuaLen.maDon} của ${p.donVuaLen.tenKhach} đã lên rồi ạ. Cần sửa gì anh/chị nhắn "sửa đơn ..." nhé.`);
  } else if (duDeGhi(p, treo)) {
    daGui.push(...await ghiOdoo(deps, vao, p));
  } else {
    const canHoi = oConThieu(p);
    const cau = soanCauHoi(p, treo, canHoi);
    for (const c of canHoi.slice(0, 2)) ghiDaHoi(p, c.o);
    daGui.push(cau || 'Anh/chị cho em thêm thông tin đơn này với ạ.');
  }
  // Nhớ bot đang chờ chọn gì (dữ liệu) — lượt sau model đối chiếu câu trả lời.
  p.dangHoi = (treo.khach && !treo.khach.khongThay) || treo.sp.some((s) => !s.khongThay)
    ? {
        ...(treo.khach && !treo.khach.khongThay ? { khach: { ten: treo.khach.ten, ds: treo.khach.ds.slice(0, 10).map((x) => ({ id: x.id, ten: x.ten })) } } : {}),
        ...(treo.sp.some((s) => !s.khongThay) ? { sp: treo.sp.filter((s) => !s.khongThay).map((s) => ({ ten: s.ten, ds: s.ds.slice(0, 8).map((x) => ({ id: x.id, ten: x.ten })) })) } : {}),
      }
    : undefined;
  if (!p.dangHoi) delete p.dangHoi;
  await deps.luuPhien(vao.conversationId, p);
  for (const t of daGui) await deps.guiTin(t);
  logger.info({ conversationId: vao.conversationId, yDinh: kq.yDinh, che: p.che, soVong: kq.soVong, ms: Date.now() - t0 }, '[lai] xong lượt');
  return { nhan: true, yDinh: kq.yDinh, daGui, nguon: 'llm', ms: Date.now() - t0 };
}

export { phienTrong };
