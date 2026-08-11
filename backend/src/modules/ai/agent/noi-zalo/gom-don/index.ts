// SPDX-License-Identifier: AGPL-3.0-or-later
// MÁY GOM ĐƠN — orchestrator. Code cầm lái toàn bộ quy trình lên đơn:
//   tin NV → (map chọn bằng code | trích slot LLM) → đắp phiên →
//   buocTiepTheo → tra cứu song song / hỏi bằng template / tạo đơn.
//
// Spec: docs/superpowers/specs/2026-08-07-luong-len-don-slot-design.md
// Vì sao: 4 lần vá prompt trong tối 07/08 mà luồng vẫn hỏng kiểu mới —
// từ nay quy trình là code, bug mới = thêm kịch bản replay + sửa đúng một ngăn.
import { logger } from '../../../../../shared/utils/logger.js';
import type { ToolAwareGenerate } from '../../types.js';
import type { ToolCallLog } from '../../staff-agent.js';
import type { OdooClient } from '../../../odoo/client.js';
import { traKhachHang, dinhDangKhachHang } from '../../../odoo/tools/tra-khach-hang.js';
import { taoKhachHang, dinhDangTaoKhach, CHIA_BO_PHANH } from '../../../odoo/tools/tao-khach-hang.js';
import { traSanPham, dinhDangSanPham, boDau } from '../../../odoo/tools/tra-san-pham.js';
import { taoDonNhap, dinhDangTaoDon } from '../../../odoo/tools/tao-don-nhap.js';
import { suaDon, dinhDangSuaDon } from '../../../odoo/tools/sua-don.js';
// VAT: tra id account.tax theo % nhân viên nói. KHÔNG phải tool cho model —
// máy gom đơn gọi thẳng hàm, nên nó không có mặt trong registry (xem chú thích
// đầu tra-thue.ts). Đừng xoá vì "không thấy đăng ký ở đâu".
import { traThueBan } from '../../../odoo/tools/tra-thue.js';
import { guiHoaDon } from '../../../odoo/tools/gui-hoa-don.js';
import { IDEMPOTENCY_PREFIX } from '../../../odoo/idempotency.js';
import { linkXuLyDon, type HoaDonAnhClient, type AnhHoaDon } from '../../../odoo/hoa-don-anh.js';
import { laXacNhanNgan } from '../cam-xuc.js';
import { KHO, type PhienGom, type HanhDong, type DonSua } from './kieu.js';
import { buocTiepTheo } from './buoc-tiep-theo.js';
import { apDungChon } from './chon.js';
import { renderLoiNhan } from './loi-nhan.js';
import { trichSlot, type KetQuaTrich } from './trich-slot.js';
import { docPhien, luuPhien, xoaPhien, type DbPhienGomDon } from './phien-store.js';

/** "lên/tạo/đặt + đơn/hàng" ở đầu từ — 'sửa đơn'/'báo cáo đơn' KHÔNG kích máy. */
const NHAN_LENH_LEN_DON = /(?:^|\s)(?:lên|len|tạo|tao|đặt|dat)\s+(?:đơn|don|hàng|hang)\b/i;

/**
 * Lệnh SỬA đơn (spec 08/08): "sửa đơn…", "thêm 5 cáp vào đơn", "đổi thành 100".
 * Cố ý KHÔNG bắt "sửa chiết khấu" — việc đó vẫn của agent thường.
 */
const NHAN_LENH_SUA_DON =
  /(?:^|\s)(?:sửa|sua|thêm|them|bớt|bot|đổi|doi)\s+(?:\S+\s+){0,4}?(?:đơn|don)\b|(?:^|\s)(?:sửa|sua)\s+(?:đơn|don)\b/i;

/**
 * Bỏ khối quote-reply mà message-handler chèn (`[Trả lời tin: "…"] câu thật`).
 *
 * Bug thật 23:14 07/08: nhân viên QUOTE danh sách khách rồi gõ "5" — cả danh
 * sách bị nhét vào câu nên máy không map nổi lựa chọn, nhường agent thường và
 * mất cổng chốt. Câu CHỌN/LỆNH luôn nằm ở đuôi; phần quote chỉ giữ cho LLM
 * trích slot (nó cần ngữ cảnh "cái này").
 */
const boQuote = (cau: string): string =>
  cau.replace(/^\[Trả lời tin: "[\s\S]{0,220}?"\]\s*/, '');

/** Xưng hô đầu câu + đuôi lịch sự — bóc ra để lấy phần TÊN thật. */
const XUNG_HO_DAU = /^(?:anh|chị|chi|em|bác|bac|cô|co|chú|chu|ông|ong|bà|ba)\s+/i;
const DUOI_LICH_SU = /\s+(?:nhé|nhe|nha|nhá|ạ|đi|ơi|nè)\.?$/i;

/**
 * Câu trả lời của NV có phải TÊN KHÁCH RÕ HƠN từ khoá đang tra không?
 *
 * Bug thật 16:15 11/08: bot liệt 10 khách "Long", NV gõ "Anh Long Led" — LLM
 * trích lại cắt về "Long" → dapSlot thấy không đổi → không tra lại → bot lặp
 * nguyên danh sách vô hạn. Code phải tự nhận ra: câu NGẮN, CHỨA từ khoá cũ và
 * DÀI HƠN nó nghĩa là nhân viên đang nói rõ thêm tên — dùng nguyên câu (bỏ
 * xưng hô, bỏ đuôi lịch sự) làm từ khoá tra mới, không chờ LLM trích đúng.
 *
 * Cố ý HẸP: câu >6 từ (lệnh dài), không chứa từ khoá cũ ("9999", "ko thấy"),
 * hay y hệt từ khoá cũ → trả null, đi đường khác. Thà bỏ sót còn hơn tra bừa.
 */
export function tachTenRoHon(cau: string, tuKhoaCu: string): string | null {
  let s = cau.trim();
  for (let i = 0; i < 3; i++) s = s.replace(DUOI_LICH_SU, '').trim();
  s = s.replace(XUNG_HO_DAU, '').trim();
  if (!s || s.split(/\s+/).length > 6) return null;
  const sMoi = boDau(s);
  if (!/[a-z]/.test(sMoi)) return null; // toàn số/ký hiệu — không phải tên
  const cu = boDau(tuKhoaCu.trim());
  if (!cu || sMoi === cu || !sMoi.includes(cu)) return null;
  return s;
}

/**
 * Chữ nhân viên nói về kho → id kho thật. Trả null khi không chắc.
 *
 * Map ở CODE, không để model tự điền id: model bịa số là bịa nơi xuất hàng.
 * Nhận cả mã ("HCM", "TT", "KB") lẫn tên ("Hồ Chí Minh", "trung tâm", "kho B")
 * vì nhân viên gõ kiểu nào cũng có.
 */
export function mapKho(noi: string): number | null {
  const s = boDau(noi).replace(/\bkho\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  if (!s) return null;
  for (const k of KHO) {
    const ma = boDau(k.ma);
    const ten = boDau(k.ten);
    // Khớp mã đứng RIÊNG một từ ("hcm", "tt", "kb") hoặc tên chứa nhau.
    if (s.split(' ').includes(ma) || s === ten || ten.includes(s) || s.includes(ten)) return k.id;
  }
  return null;
}

export interface GomDonDeps {
  prisma: DbPhienGomDon;
  odoo: Pick<OdooClient, 'searchRead' | 'execute'>;
  generate: ToolAwareGenerate;
  /** null = môi trường không render được ảnh — vẫn gửi text + link. */
  anhClient: HoaDonAnhClient | null;
  odooUrl: string;
  guiTin: (text: string) => Promise<void>;
  guiAnhHoaDon: (anh: AnhHoaDon) => Promise<void>;
  ghiLog: (l: ToolCallLog) => void;
}

/** Đắp kết quả trích LLM vào phiên. Trả true nếu phiên có thay đổi nội dung. */
function dapSlot(p: PhienGom, trich: KetQuaTrich): boolean {
  let doi = false;
  if (trich.khach && !p.khachDaChot) {
    const moi = boDau(trich.khach);
    if (!p.khachTuKhoa || boDau(p.khachTuKhoa) !== moi) {
      // Đổi khách giữa chừng → làm lại phần khách từ đầu, bỏ ứng viên cũ.
      p.khachTuKhoa = trich.khach;
      delete p.khachUngVien;
      delete p.khachUngVienConNua;
      delete p.khachKhongThay;
      doi = true;
    }
  }
  if (trich.khachMoi && !p.khachDaChot) {
    // "khách mới" TRỐNG (không kèm tên): lấy tên đã nhắc ở lượt trước. Bug thật
    // 17:08 10/08 — bot hỏi chọn trong 10 anh Chiến, nhân viên đáp đúng hai chữ
    // "khách mới"; bắt gõ lại tên là vô lý vì họ vừa nói xong ở lượt trên.
    const ten = trich.khachMoi.ten || p.khachTuKhoa || '';
    if (ten) {
      p.khachMoi = { ...trich.khachMoi, ten };
      // Đã chốt là khách MỚI thì danh sách ứng viên cũ vô nghĩa — giữ lại thì
      // buoc-tiep-theo còn thấy `khachUngVien` và hỏi chọn tiếp.
      delete p.khachUngVien;
      delete p.khachKhongThay;
      // NV đưa tên khách mới → dùng luôn làm từ khoá tra (biết đâu đã có sẵn).
      if (!p.khachTuKhoa) p.khachTuKhoa = ten;
      doi = true;
    }
  }
  // BỎ DÒNG (spec 10/08) — chạy TRƯỚC khi thêm: "bỏ 300 thanh led tỏa rồi lên
  // đơn" vừa bỏ vừa nhắc tên món, không xử trước thì nó lại được thêm vào.
  for (const bo of trich.boDong ?? []) {
    const truoc = p.dong.length;
    p.dong = p.dong.filter((x) =>
      !(boDau(x.tuKhoa).includes(boDau(bo)) || boDau(bo).includes(boDau(x.tuKhoa))
        || (x.daChot && boDau(x.daChot.ten).includes(boDau(bo)))));
    if (p.dong.length !== truoc) doi = true;
  }
  for (const d of trich.dong ?? []) {
    // Món vừa bị bỏ trong CHÍNH câu này thì đừng thêm lại.
    if ((trich.boDong ?? []).some((b) => boDau(d.sp).includes(boDau(b)) || boDau(b).includes(boDau(d.sp)))) continue;
    // Dòng TẶNG không bao giờ gộp vào dòng BÁN, kể cả cùng SP: "10 cái ovp k2
    // giá 2300k tặng 1 cái" là hai dòng khác nhau trên đơn. Gộp thì đơn còn
    // đúng 1 cái giá 0đ — mất 10 cái đang bán.
    const cu = p.dong.find(
      (x) => Boolean(x.tang) === Boolean(d.tang)
        && (boDau(x.tuKhoa) === boDau(d.sp) || (x.daChot && boDau(x.daChot.ten).includes(boDau(d.sp)))),
    );
    if (cu) {
      if (d.sl != null && cu.sl !== d.sl) { cu.sl = d.sl; doi = true; }
      // Giá MỚI khác giá cũ → cái gật cho giá lệch trước đó hết hiệu lực.
      // Nhân viên xác nhận "8đ đúng rồi" xong lại báo "2đ" thì phải hỏi lại,
      // không được mượn cái gật cũ (hàng rào 11/08).
      if (d.gia != null && cu.donGia !== d.gia) {
        cu.donGia = d.gia; doi = true;
        delete p.giaLechDaXacNhan;
      }
      if (d.chietKhau != null && cu.chietKhau !== d.chietKhau) { cu.chietKhau = d.chietKhau; doi = true; }
    } else {
      p.dong.push({
        tuKhoa: d.sp, sl: d.sl ?? null,
        ...(d.gia != null ? { donGia: d.gia } : {}),
        ...(d.chietKhau != null ? { chietKhau: d.chietKhau } : {}),
        ...(d.tang ? { tang: true } : {}),
      });
      doi = true;
    }
  }
  // Chiết khấu nói TÁCH RIÊNG một câu ("triết khấu 8% nữa em" — ca thật
  // 03:24:53 11/08) thì áp cho MỌI dòng đang gom: nhân viên nói cho cả đơn.
  //
  // KHÁC HẲN chiết khấu đi liền sau một sản phẩm (`dong[].chietKhau`), thứ chỉ
  // thuộc riêng sản phẩm đó — sửa 11/08 sau khi thấy câu thật
  // "100 thẻ v7512 giá 230k triết khấu 8%. 10 ovp k2 giá 2300k tặng 1 cái":
  // luật cũ áp 8% sang cả ovp k2, bớt nhầm 1.840.000đ.
  //
  // Dòng TẶNG được miễn: chiết khấu trên 0đ vẫn là 0đ, ghi vào chỉ làm bẩn đơn.
  const ckChung = trich.chietKhauDon;
  if (ckChung != null) {
    for (const x of p.dong) {
      if (x.tang) continue;
      if (x.chietKhau !== ckChung) { x.chietKhau = ckChung; doi = true; }
    }
  }
  // KHO nhân viên nói trong câu ("kho HCM") → map mã/tên sang id qua bảng KHO.
  // Map ở CODE chứ không tin số model tự bịa: sai kho là xuất hàng sai nơi.
  //
  // Đây là ĐƯỜNG DUY NHẤT đặt kho từ 11/08: máy không hỏi kho nữa (anh Quốc
  // "không cần hỏi nhân viên luôn"), nên kho chỉ đổi khi NV chủ động nói.
  if (trich.kho) {
    const moi = mapKho(trich.kho);
    if (moi != null) {
      if (p.khoId !== moi) { p.khoId = moi; doi = true; }
      if (p.khoKhongRo) { delete p.khoKhongRo; doi = true; }
    } else if (p.khoKhongRo !== trich.kho) {
      // Không map được ("kho Đà Nẵng") → GIỮ LẠI để tóm tắt báo rõ. Nuốt im
      // thì NV tưởng xuất kho họ nói, thực tế Odoo lấy TT.
      p.khoKhongRo = trich.kho;
      doi = true;
    }
  }

  // Câu chỉ có SL ("10 cái") — LLM được dặn gắn vào món đang thiếu; nếu nó trả
  // dòng trùng tên món cũ thì nhánh trên đã xử. Không tự đoán gì thêm ở đây.
  return doi;
}

/** Field đọc từ sale.order khi tìm đơn để sửa. */
const FIELDS_DON_SUA = ['id', 'name', 'state', 'amount_total', 'create_date'];

/**
 * Tìm đơn NHÁP để sửa. Nói mã → đúng đơn đó; không nói → mọi đơn nháp của
 * CHÍNH hội thoại này (khoá idempotency), mới nhất trước.
 *
 * Không bao giờ với sang đơn ngoài hội thoại khi NV không nói mã — cùng lý do
 * với xuat_hoa_don: sửa nhầm đơn người khác là dữ liệu bẩn khó dò.
 */
async function timDonNhap(
  deps: GomDonDeps,
  conversationId: string,
  maDon?: string,
): Promise<DonSua[]> {
  const loc = (rows: Array<Record<string, unknown>>): DonSua[] =>
    rows
      .filter((r) => ['draft', 'sent'].includes(String(r.state ?? '')))
      .map((r) => ({ id: Number(r.id), ma: String(r.name ?? ''), tong: Number(r.amount_total ?? 0) }));

  if (maDon) {
    const r = await deps.odoo.searchRead<Record<string, unknown>>(
      'sale.order', [['name', '=', maDon]], FIELDS_DON_SUA, { limit: 1 },
    );
    return loc(r);
  }
  const r = await deps.odoo.searchRead<Record<string, unknown>>(
    'sale.order',
    [['client_order_ref', 'like', `${IDEMPOTENCY_PREFIX}:${conversationId}:%`]],
    FIELDS_DON_SUA,
    { limit: 5, order: 'create_date desc' },
  );
  return loc(r);
}

/** Chạy các tra cứu của hành động tra_cuu SONG SONG, đắp kết quả vào phiên. */
async function chayTraCuu(
  deps: GomDonDeps,
  p: PhienGom,
  hd: Extract<HanhDong, { loai: 'tra_cuu' }>,
  ctx: { conversationId: string; maDon?: string },
): Promise<void> {
  const viec: Array<Promise<void>> = [];
  if (hd.don) {
    viec.push((async () => {
      const ds = await timDonNhap(deps, ctx.conversationId, ctx.maDon);
      if (ds.length === 1) p.donSua = ds[0];
      else if (ds.length > 1) p.donUngVien = ds;
      else p.donKhongThay = true;
    })());
  }
  if (hd.khach) {
    viec.push((async () => {
      const t0 = Date.now();
      const kq = await traKhachHang({ odoo: deps.odoo }, { ten: hd.khach });
      deps.ghiLog({
        toolName: 'tra_khach_hang', input: { ten: hd.khach }, output: dinhDangKhachHang(kq),
        thanhCong: true, durationMs: Date.now() - t0, iteration: 0,
      });
      if (kq.trangThai === 'tim_thay') {
        p.khachDaChot = { id: kq.khach.id, ten: kq.khach.ten, ma: kq.khach.ma, dienThoai: kq.khach.dienThoai };
        delete p.khachUngVienConNua;
      } else if (kq.trangThai === 'nhieu_ket_qua' && kq.tuChot) {
        // TỰ CHỐT khi có người khớp GẦN NGUYÊN VĂN và áp đảo hẳn (21:56 11/08).
        //
        // Ca thật: NV gõ "a Long led" → 8 khách, nhưng chỉ "Anh Long Led"
        // (KH000117) khớp nguyên văn, 7 người kia chỉ tình cờ trùng chữ "Long"
        // hoặc "Led" rời rạc ("Led Kim Long", "Led Hoàng Long"). Bắt chọn giữa
        // 8 cái tên trong đó 7 cái khác hẳn là làm phiền vô ích.
        //
        // Luật quyết định nằm trong xepHangKhach() — nó ĐÒI không còn ai "cùng
        // kiểu tên" mới cho chốt, nên ca bẫy "Cảnh tam kỳ" vẫn rơi xuống nhánh
        // hỏi bên dưới. Chốt nhầm khách nguy hiểm hơn bắt chọn.
        p.khachDaChot = {
          id: kq.tuChot.id, ten: kq.tuChot.ten, ma: kq.tuChot.ma, dienThoai: kq.tuChot.dienThoai,
        };
        // Đánh dấu để tóm tắt NÓI RÕ đã tự lấy ai — tuyệt đối không chốt im lặng.
        p.khachTuChot = true;
        delete p.khachUngVienConNua;
      } else if (kq.trangThai === 'nhieu_ket_qua') {
        p.khachUngVien = kq.danhSach;
        // Chạm trần → danh sách CHƯA ĐỦ, loi-nhan phải nói rõ (bug 16:15 11/08).
        if (kq.conNua) p.khachUngVienConNua = true;
        else delete p.khachUngVienConNua;
      } else {
        p.khachKhongThay = true;
        delete p.khachUngVienConNua;
      }
    })());
  }
  for (const tuKhoa of hd.sp) {
    const dong = p.dong.find((d) => boDau(d.tuKhoa) === boDau(tuKhoa) && !d.daChot && !d.ungVien && !d.khongThay);
    if (!dong) continue;
    viec.push((async () => {
      const t0 = Date.now();
      const list = await traSanPham({ odoo: deps.odoo }, { ten: tuKhoa });
      deps.ghiLog({
        toolName: 'tra_san_pham', input: { ten: tuKhoa }, output: dinhDangSanPham(list, tuKhoa),
        thanhCong: true, durationMs: Date.now() - t0, iteration: 0,
      });
      if (list.length === 1) dong.daChot = { id: list[0].id, ten: list[0].ten, gia: list[0].gia };
      else if (list.length > 1) dong.ungVien = list;
      else dong.khongThay = true;
    })());
  }
  await Promise.all(viec);

  // KHÔNG tra tồn theo kho ở đây nữa (bỏ 11/08 cùng câu hỏi kho).
  //
  // Vòng tra `tra_ton_kho` từng chạy chỗ này chỉ để biết hàng có nằm nhiều kho
  // không, tức chỉ phục vụ câu hỏi kho. Anh Quốc bỏ câu hỏi đó ("mặc định là
  // lấy kho TT nhé, không cần hỏi nhân viên luôn") nên vòng tra thành vô dụng —
  // và nó tốn một round-trip Odoo cho MỖI dòng hàng của MỌI đơn lên.
}

/** Tạo đơn + gửi báo giá (ảnh khi có, link luôn luôn) cho nhân viên. */
async function taoDonVaBaoGia(
  deps: GomDonDeps,
  p: PhienGom,
  input: { orgId: string; conversationId: string; seq: number },
  /**
   * Lượt này đã BỎ một phiên gom dở để bắt đầu việc mới → phải báo.
   *
   * Trước 11/08 câu báo đó luôn đi kèm một hành động NÓI (tóm tắt/hỏi), nên nó
   * nằm ở nhánh render cuối. Bỏ bước chốt thì lượt đè phiên có thể đi thẳng ra
   * đơn — im lặng ở đây là nhân viên không biết đơn nháp cũ đã bị bỏ.
   */
  daBoPhienCu = false,
): Promise<'xong' | 'loi'> {
  const dong = p.dong
    .filter((d) => d.daChot && d.sl != null)
    .map((d) => ({
      san_pham_id: d.daChot!.id,
      so_luong: d.sl!,
      // Giá NV báo thắng giá hệ thống (anh Quốc chốt 10/08).
      ...(d.donGia ? { don_gia: d.donGia } : {}),
      // Chiết khấu nói ngay lúc lên đơn (11/08) — không bắt nhắc lượt thứ hai.
      ...(d.chietKhau ? { chiet_khau: d.chietKhau } : {}),
      // Hàng tặng (11/08): tool ghi giá 0đ + gắn "(tặng)" vào tên dòng.
      ...(d.tang ? { tang: true } : {}),
    }));
  const t0 = Date.now();
  const donVao = {
    khach_hang_id: p.khachDaChot!.id, dong, y_dinh: 'moi' as const, ten_khach: p.khachDaChot!.ten,
    // Không chốt kho → KHÔNG gửi field, Odoo tự lấy kho mặc định (đúng 291/300 đơn).
    ...(p.khoId != null ? { kho_id: p.khoId } : {}),
    // VAT: chỉ gửi khi TRA ĐƯỢC id thật trong account.tax. Tra không ra
    // (vatKhongTra) thì lên đơn KHÔNG thuế — nhưng tóm tắt đã báo rõ cho nhân
    // viên trước đó, không im lặng.
    ...(p.vatThueId != null ? { thue_id: p.vatThueId } : {}),
  };
  const kq = await taoDonNhap(
    {
      odoo: deps.odoo, conversationId: input.conversationId, seq: input.seq, choPhepDatGia: true,
      // Nhân viên đã trả lời câu hỏi giá lệch ở máy gom đơn rồi → đừng bắt họ
      // xác nhận lần thứ hai ở cổng tool. Hỏi hai lần cho cùng một con số là
      // kiểu bot "điếc" mà hàng rào này sinh ra để tránh.
      ...(p.giaLechDaXacNhan ? { xacNhanGiaLech: true } : {}),
    },
    donVao,
  );
  deps.ghiLog({
    toolName: 'tao_don_nhap',
    input: { khach_hang_id: p.khachDaChot!.id, dong, ten_khach: p.khachDaChot!.ten },
    output: dinhDangTaoDon(kq, true),
    thanhCong: kq.trangThai !== 'loi', durationMs: Date.now() - t0, iteration: 0,
  });

  if (kq.trangThai === 'loi') {
    await deps.guiTin(`Không tạo được đơn: ${kq.lyDo}`);
    return 'loi'; // giữ phiên — NV sửa thông tin rồi chốt lại được
  }
  if (kq.trangThai === 'da_ton_tai') {
    await deps.guiTin(`Đơn này đã tạo trước đó rồi: ${kq.maDon}. Link xử lý: ${linkXuLyDon(deps.odooUrl, kq.donId)}`);
    return 'xong';
  }

  const tong = kq.tongTien.toLocaleString('vi-VN');
  // Ảnh báo giá: cố gắng render, hỏng thì vẫn phải có text + link (nếp
  // luong-nhan-vien: "gửi link DÙ ảnh lỗi").
  let daGuiAnh = false;
  if (deps.anhClient) {
    try {
      const hd = await guiHoaDon(
        { odoo: deps.odoo, anhClient: deps.anhClient, odooUrl: deps.odooUrl },
        { don_id: kq.donId },
      );
      if (hd?.anh) { await deps.guiAnhHoaDon(hd.anh); daGuiAnh = true; }
    } catch (err) {
      logger.warn({ err, donId: kq.donId }, '[gom-don] render/gửi ảnh báo giá lỗi (vẫn gửi link)');
    }
  }
  // TÓM TẮT ĐI KÈM TIN BÁO ĐƠN (11/08).
  //
  // Bỏ bước hỏi chốt thì tóm tắt mất chỗ đứng cũ — nhưng KHÔNG được mất luôn.
  // Nhân viên vẫn phải thấy bot hiểu gì: khách nào (kèm mã KH), từng dòng
  // hàng, giá họ báo khi lệch giá hệ thống, chiết khấu, tặng kèm, VAT, tổng.
  // Chỉ đổi thời điểm soát: trước đây soát rồi mới gật cho ghi; giờ ghi rồi
  // soát — đơn là đơn NHÁP, thấy sai thì nói "sửa đơn" là máy sửa ngay.
  //
  // Gộp vào MỘT tin thay vì gửi hai: hai tin liên tiếp trên Zalo dễ bị đọc
  // nhảy cóc, mà đây là một chuyện duy nhất — "đây là đơn em hiểu, và em đã
  // lên nó rồi".
  await deps.guiTin(
    `${daBoPhienCu ? 'Em bỏ đơn đang gom dở nhé.\n' : ''}` +
    `${renderLoiNhan({ loai: 'tom_tat_don' }, p)}\n` +
    `Em đã lên đơn nháp ${kq.maDon} cho ${p.khachDaChot!.ten}, tổng ${tong}đ.` +
    `${daGuiAnh ? ' Báo giá ở ảnh trên.' : ''} Link xử lý: ${linkXuLyDon(deps.odooUrl, kq.donId)}` +
    '\nSai chỗ nào anh/chị nhắn "sửa đơn ..." em sửa ngay ạ.',
  );
  return 'xong';
}

/**
 * Sửa đơn nháp: gọi tool suaDon rồi báo bằng SỐ THẬT (tool đọc lại từ Odoo),
 * kèm ảnh báo giá mới. Không hỏi chốt — mọi nhập nhằng đã chặn ở bước trước.
 */
async function suaDonVaBao(deps: GomDonDeps, p: PhienGom): Promise<'xong' | 'loi'> {
  const don = p.donSua!;
  // Tool phân biệt "đổi SL của SP đã có" với "thêm dòng mới" — nhưng nó tự dò
  // theo product_id: SP chưa có trong đơn thì `doi` tự thành thêm. Nên gom hết
  // vào `doi` là đúng cho cả hai ca, khỏi đoán trước đơn đang có gì.
  const doi = p.dong
    .filter((d) => d.daChot && d.sl != null)
    .map((d) => ({
      san_pham_id: d.daChot!.id,
      so_luong: d.sl!,
      // Bug 17:41 10/08: quên dòng này nên hoá đơn ghi 1đ/thanh thay vì giá NV báo.
      ...(d.donGia ? { don_gia: d.donGia } : {}),
      // Cùng lý do với giá: sửa một đường mà quên đường kia là lỗi lặp 3 lần.
      ...(d.chietKhau ? { chiet_khau: d.chietKhau } : {}),
      // Lần thứ TƯ của cùng bài học: hàng tặng phải chạy cả đường sửa đơn.
      ...(d.tang ? { tang: true } : {}),
      // Lần thứ NĂM: VAT cũng phải chạy cả đường sửa. Ca thật "đơn này xuất
      // VAT nữa em" sau khi đơn đã lên — vá mỗi đường tạo là bỏ sót ca này.
      ...(p.vatThueId != null ? { thue_id: p.vatThueId } : {}),
    }));
  const t0 = Date.now();
  const vaoSua = {
    don_id: don.id, doi,
    // Chỉ đổi kho khi NV nói rõ — không nói thì giữ nguyên kho đơn đang có.
    ...(p.khoId != null ? { kho_id: p.khoId } : {}),
  };
  const kq = await suaDon({ odoo: deps.odoo }, vaoSua);
  deps.ghiLog({
    toolName: 'sua_don', input: vaoSua,
    output: dinhDangSuaDon(kq), thanhCong: kq.ok,
    durationMs: Date.now() - t0, iteration: 0,
  });

  if (!kq.ok) {
    await deps.guiTin(`Không sửa được đơn ${don.ma}: ${kq.lyDo ?? 'Odoo từ chối'}`);
    return 'loi'; // giữ phiên — NV sửa thông tin rồi thử lại
  }

  const mon = p.dong
    .filter((d) => d.daChot && d.sl != null)
    .map((d) => `${d.sl} × ${d.daChot!.ten}`)
    .join(', ');
  await deps.guiTin(
    `Đã sửa đơn ${kq.maDon}: ${mon}. ` +
    `Tổng ${(kq.tongTruoc ?? 0).toLocaleString('vi-VN')}đ → ${(kq.tongSau ?? 0).toLocaleString('vi-VN')}đ. ` +
    `Link: ${linkXuLyDon(deps.odooUrl, kq.donId)}`,
  );

  // Ảnh báo giá MỚI — nhân viên cần thấy đơn sau khi sửa, như lúc lên đơn.
  if (deps.anhClient) {
    try {
      const hd = await guiHoaDon(
        { odoo: deps.odoo, anhClient: deps.anhClient, odooUrl: deps.odooUrl },
        { don_id: kq.donId },
      );
      if (hd?.anh) await deps.guiAnhHoaDon(hd.anh);
    } catch (err) {
      logger.warn({ err, donId: kq.donId }, '[gom-don] gửi ảnh sau sửa đơn lỗi (đã có text)');
    }
  }
  return 'xong';
}

/**
 * Xử một tin nhân viên qua máy gom đơn.
 * Trả `true` = máy đã nhận (đã gửi trả lời); `false` = không phải việc của máy
 * (không phải lệnh lên đơn / digression giữa phiên) — caller đưa agent thường.
 */
export async function xuLyGomDon(
  deps: GomDonDeps,
  input: {
    orgId: string; conversationId: string; seq: number; cau: string;
    /**
     * UID Zalo người gửi — ghi vào `phien.hoiUid` để lượt sau nhận ra "người
     * này đang được bot hỏi", khỏi bắt tag lại trong nhóm (bug 17:08 10/08).
     */
    senderUid?: string | null;
  },
): Promise<boolean> {
  // Câu để MAP/nhận lệnh là phần đuôi sau khối quote; câu đầy đủ (kèm quote)
  // chỉ dành cho LLM trích slot — nó cần ngữ cảnh "cái này".
  const cauChon = boQuote(input.cau);

  // MỘT cửa ghi phiên. Mọi đường ghi đều qua đây nên `hoiUid` không thể sót ở
  // một nhánh — bài học từ 3 lần vá một đường quên các đường còn lại.
  const ghiPhien = async (p: PhienGom): Promise<void> => {
    p.hoiUid = input.senderUid ?? null;
    await luuPhien(deps.prisma, {
      orgId: input.orgId, conversationId: input.conversationId, phien: p,
    });
  };

  let phien = await docPhien(deps.prisma, input.conversationId);
  const laLenhSua = NHAN_LENH_SUA_DON.test(cauChon);
  const regexLen = NHAN_LENH_LEN_DON.test(cauChon);

  // ── CỬA VÀO: regex CHỈ là lối tắt, LLM mới là người quyết ──────────────────
  //
  // Bug thật 22:09 10/08: "lên cho anh Huấn khách mới 10 nguồn NB nhé" — regex
  // đòi "lên"+"đơn" dính nhau nên trượt, máy không chạy, rơi xuống LLM tự do
  // và mất luôn luật "giá NV báo thắng giá hệ thống" → bot hỏi vặn giá 170k.
  //
  // Anh Quốc: "sao lòng vòng thế nhỉ????, có mỗi việc lên đơn". Đúng — vá
  // regex từng chữ ("lên đơn", "lên cho", "bán cho"…) thì thiếu mãi. LLM giỏi
  // hiểu câu chữ, code giỏi giữ luật; để mỗi bên làm việc của mình.
  //
  // Regex khớp → vào thẳng, KHỎI tốn lượt LLM cho ca thường gặp nhất.
  // Regex trượt và chưa có phiên → HỎI LLM một lượt: "đây có phải lệnh lên đơn
  // không". Nó nói không thì nhường agent thường như cũ.
  let trich: KetQuaTrich = {};
  let daHoiLlm = false;
  if (!phien && !regexLen && !laLenhSua) {
    trich = await trichSlot(deps.generate, input.cau, null);
    daHoiLlm = true;
    if (!trich.lenDon) return false;
  }

  const laLenhLen = regexLen || trich.lenDon === true;

  // ĐƯỜNG THOÁT 1 — lệnh LÊN ĐƠN MỚI đè phiên đang gom (spec 10/08).
  //
  // Bug demo 17:22 10/08: phiên dính SP giá 1đ, nhân viên gõ "lên đơn cho anh
  // Hoàng 10 cái nguồn NB" — khách KHÁC HẲN — mà bot vẫn trả đơn anh Vấn kèm
  // đúng câu lỗi cũ. Nói "lên đơn cho <người khác>" là bắt đầu việc mới, không
  // phải nói tiếp việc cũ. Phiên cũ bỏ đi, báo cho nhân viên biết.
  let daBoPhienCu = false;
  if (phien && laLenhLen && phien.che !== 'sua') {
    await xoaPhien(deps.prisma, input.conversationId);
    phien = null;
    daBoPhienCu = true;
  }

  // 1. Map lựa chọn bằng CODE trước — "1a"/mã KH/SĐT không tốn lượt LLM nào.
  const daChon = phien ? apDungChon(phien, cauChon) : false;
  // Đã hỏi LLM ở cửa vào thì DÙNG LẠI kết quả — đừng gọi lần hai cho cùng câu.
  if (!daChon && !daHoiLlm) trich = await trichSlot(deps.generate, input.cau, phien);

  if (trich.huy && phien) {
    await xoaPhien(deps.prisma, input.conversationId);
    await deps.guiTin('Em huỷ đơn đang gom rồi ạ. Cần lên lại anh/chị cứ nhắn nhé.');
    return true;
  }
  // Digression: câu không liên quan đơn → nhường agent thường, phiên GIỮ NGUYÊN.
  //
  // NHƯNG lệnh LÊN ĐƠN RÕ RÀNG thì model KHÔNG có quyền phủ quyết (sửa 11/08).
  //
  // Ca thật 15:06→15:35 11/08 (nhóm Test-AI) — 28 phút, 8 lượt nhắc lại cho một
  // đơn đáng ra xong trong 1 lượt:
  //
  //   15:06:59  NV : "lên đơn cho chị phương ali 4 bóng lixin 4000k trung tính
  //                   trong nhà 500 bóng giá 2800 nhé"
  //   15:07:29  bot: "Dạ em đã chuyển việc lên đơn ... sang bộ phận sale xử lý ạ"
  //
  // Câu đó có ĐỦ khách + SP + SL + giá và KHỚP `NHAN_LENH_LEN_DON`. Cửa vào
  // (f99b06ac) định là "regex khớp → vào thẳng", nhưng regex chỉ giúp bỏ qua
  // lượt hỏi `lenDon`; xuống tới đây model vẫn cướp được lượt bằng ngoaiLe=true.
  // Nó rất dễ trả như vậy: prompt trích slot dạy "hoá đơn là ngoaiLe", còn câu
  // này thì dài và nhiễu ("4 bóng ... 500 bóng"). Bốn câu "lên đơn ..." trong ca
  // (15:06, 15:14, 15:20, 15:31) đều khớp regex và đều bị nhường như thế.
  //
  // Rơi xuống agent tự do là mất luật "giá NV báo thắng giá hệ thống" → bot quay
  // ra đòi giá chính thức rồi hứa "đã chuyển sale" 5 lần, dù chính sale đang
  // ngồi trong nhóm hỏi nó. Máy gom đơn vào cuộc lúc 15:32 thì đơn lên sau 3'.
  //
  // Luật: câu tự nó mang dấu hiệu lệnh lên đơn (regex) thì "không liên quan đơn
  // hàng" là câu trả lời TỰ MÂU THUẪN — bỏ qua, code cầm lái tiếp. Hàng rào HẸP
  // có chủ ý: chỉ cứu khi regex khớp, câu báo cáo/tồn kho vẫn nhường như cũ.
  if (!daChon && trich.ngoaiLe && !regexLen && !laLenhSua) return false;

  // Chế phiên: câu có dấu hiệu sửa (regex HOẶC model trích sua=true) → 'sua'.
  // Phiên đã mở giữ nguyên chế của nó — đang gom đơn mới mà nói "thêm 5 cáp"
  // là thêm vào đơn ĐANG GOM, không phải sửa đơn cũ.
  phien ??= {
    khachTuKhoa: null,
    dong: [],
    ...(laLenhSua || trich.sua ? { che: 'sua' as const } : {}),
  };
  const doiNoiDung = dapSlot(phien, trich);

  // ── VAT: nối `trich.vat` với danh mục thuế Odoo (sửa 11/08/2026) ────────
  //
  // ĐÂY LÀ CHỖ TỪNG ĐỨT. Đo prod 486 lượt gọi tool 04→11/08: `tra-thue.ts` 0
  // lần chạy. Không phải vì model không chọn tool (nó KHÔNG phải tool cho model,
  // và không cần phải là) — mà vì `dapSlot` chưa bao giờ đọc `trich.vat`, nên
  // `traThueBan()` không ai gọi. Bốn mảnh VAT (trích slot / tra thuế / tóm tắt /
  // ghi tax_id) đều có và đều có test xanh, chỉ thiếu đúng đoạn dây này — tính
  // năng VAT commit hôm nay chưa từng chạy một lần nào.
  //
  // Đặt NGOÀI `dapSlot` vì tra thuế là I/O sang Odoo, còn `dapSlot` là hàm
  // thuần đắp slot — giữ nó thuần thì test replay khỏi phải dựng Odoo giả.
  if (trich.vat != null && phien.vatPhanTram !== trich.vat) {
    phien.vatPhanTram = trich.vat;
    delete phien.vatThueId;
    delete phien.vatKhongTra;

    const thue = await traThueBan({ odoo: deps.odoo }, trich.vat);
    if (thue) {
      phien.vatThueId = thue.id;
    } else {
      // KHÔNG im lặng bỏ thuế: NV tưởng đơn có VAT mà hoá đơn ra không có là
      // sai sổ sách, lúc phát hiện thì đã xuất mất rồi. Cờ này khiến tóm tắt
      // báo rõ "hệ thống không có mức VAT đó".
      phien.vatKhongTra = true;
    }
  }

  // KHÔNG còn khối "đang chờ trả lời kho": máy không hỏi kho nữa nên không có
  // câu trả lời nào để chờ. Nhân viên nói kho thì `dapSlot` (qua trích slot +
  // mapKho) nhận, ở bất kỳ lượt nào.

  // ĐANG CHỜ TRẢ LỜI GIÁ LỆCH (hàng rào 11/08, bug 10:09:33).
  //
  // Máy vừa hỏi "anh/chị báo 8đ nhưng hệ thống 230.000đ — giá đúng là bao
  // nhiêu?". Hai kiểu trả lời:
  //   - báo giá MỚI ("230k") → dapSlot ở trên đã ghi đè donGia và xoá cờ; giá
  //     mới lại đi qua hàng rào một lần nữa, đúng như vậy.
  //   - khẳng định giá cũ ("đúng rồi", "ok", "giá đó chuẩn") → gật cho CHÍNH
  //     con số đó, ghi theo họ. Luật 10/08 không đổi: giá NV báo thắng giá hệ
  //     thống — hàng rào chỉ đòi hỏi lại MỘT lần, không có quyền phủ quyết.
  //
  // Bắt cờ TRƯỚC khi gọi buocTiepTheo để nhân viên không phải trả lời hai lượt.
  if (phien.daHoiGiaLech && !phien.giaLechDaXacNhan && trich.dong?.every((d) => d.gia == null) !== false) {
    if (trich.xacNhan || laXacNhanNgan(cauChon)) phien.giaLechDaXacNhan = true;
  }

  // ĐƯỜNG THOÁT 4 (bug 16:15 11/08): đang chờ chọn khách mà câu không map được
  // và LLM trích không đem lại từ khoá mới → thử chính CÂU của NV: nếu là "tên
  // rõ hơn" ("Anh Long Led" khi đang tra "Long") thì tra lại bằng tên đó.
  if (!daChon && phien.khachUngVien && !phien.khachDaChot && phien.khachTuKhoa) {
    const tenRoHon = tachTenRoHon(cauChon, phien.khachTuKhoa);
    if (tenRoHon) {
      phien.khachTuKhoa = tenRoHon;
      delete phien.khachUngVien;
      delete phien.khachUngVienConNua;
      delete phien.khachKhongThay;
    }
  }

  // KHÔNG còn khối "đổi nội dung thì huỷ cái gật cũ": bỏ bước chốt (11/08) thì
  // không còn cái gật nào để huỷ. Đơn không bao giờ nằm chờ giữa lúc tóm tắt và
  // lúc ghi nữa — đủ slot là ghi ngay trong chính lượt đó.

  // 2. Vòng quyết định: tra cứu chạy xong thì hỏi lại bộ não lần nữa.
  //    Trần 3 vòng: tra_cuu chỉ có thể xảy ra 1 lần cho mỗi loạt từ khoá mới,
  //    vòng sau chắc chắn ra hành động nói/tạo — trần chỉ là hàng rào lập trình sai.
  let hd = buocTiepTheo(phien);
  for (let i = 0; hd.loai === 'tra_cuu' && i < 3; i++) {
    await chayTraCuu(deps, phien, hd, {
      conversationId: input.conversationId,
      ...(trich.maDon ? { maDon: trich.maDon } : {}),
    });
    hd = buocTiepTheo(phien);
  }

  // TẠO KHÁCH MỚI (bug 3 demo 10/08) — tra không ra mà NV đã cho tên thì tạo
  // rồi chạy tiếp NGAY trong lượt này, không bắt nhân viên nhắc lại lần nữa.
  if (hd.loai === 'tao_khach') {
    const t0 = Date.now();
    const km = phien.khachMoi!;
    const kq = await taoKhachHang(
      { odoo: deps.odoo },
      {
        ten: km.ten,
        ...(km.sdt ? { dien_thoai: km.sdt } : {}),
        ...(km.diaChi ? { dia_chi: km.diaChi } : {}),
        // Tới nhánh này nghĩa là NHÂN VIÊN đã nói rõ "khách mới" — bỏ phanh
        // chặn trùng tên, nếu không bot từ chối tạo rồi bắt chọn lại trong
        // danh sách người cũ, đúng vòng lặp của bug 17:08 10/08.
        bo_phanh_trung_ten: true,
        [CHIA_BO_PHANH]: true as const,
      },
    );
    deps.ghiLog({
      toolName: 'tao_khach_hang', input: km, output: dinhDangTaoKhach(kq),
      thanhCong: kq.trangThai === 'ok', durationMs: Date.now() - t0, iteration: 0,
    });
    if (kq.trangThai === 'ok') {
      phien.khachDaChot = { id: kq.khach.id, ten: kq.khach.ten, ma: kq.khach.ma, dienThoai: km.sdt ?? null };
      delete phien.khachKhongThay;
      delete phien.khachMoi;
      hd = buocTiepTheo(phien);
    } else {
      await deps.guiTin(`Em chưa tạo được khách mới: ${kq.lyDo}`);
      await ghiPhien(phien);
      return true;
    }
  }

  // Chế SỬA: đủ rõ thì ghi THẲNG, không cổng chốt (anh Quốc chốt 08/08).
  if (hd.loai === 'sua_don') {
    const kq = await suaDonVaBao(deps, phien);
    if (kq === 'xong') await xoaPhien(deps.prisma, input.conversationId);
    else await ghiPhien(phien);
    return true;
  }

  if (hd.loai === 'tao_don') {
    // KHÔNG còn cổng xác nhận ở đây (bỏ 11/08). Anh Quốc, nguyên văn: "tôi
    // muốn bỏ luôn cái bước chốt đơn này được không?, nếu mọi thứ đã rõ ràng
    // thì lên đơn báo giá luôn" — và khi được hỏi có giữ ngoại lệ nào không:
    // "Bỏ hoàn toàn, không hỏi gì nữa".
    //
    // Đủ slot = lên đơn. Tóm tắt vẫn in, nhưng nằm trong tin BÁO ĐƠN ĐÃ LÊN
    // (xem taoDonVaBaoGia) chứ không phải một lượt chờ gật riêng.
    const kq = await taoDonVaBaoGia(deps, phien, input, daBoPhienCu);
    if (kq === 'xong') {
      await xoaPhien(deps.prisma, input.conversationId);
      return true;
    }
    // ĐƯỜNG THOÁT 3 — tạo đơn LỖI hai lần liên tiếp thì bỏ phiên.
    // Bug demo 10/08: lỗi lặp 5 lần liền, nhân viên gõ gì cũng ra một câu.
    phien.soLanLoi = (phien.soLanLoi ?? 0) + 1;
    if (phien.soLanLoi >= 2) {
      await xoaPhien(deps.prisma, input.conversationId);
      await deps.guiTin(
        'Em bỏ đơn đang gom rồi ạ — nó bị kẹt. Anh/chị lên lại từ đầu giúp em nhé.',
      );
      return true;
    }
    await ghiPhien(phien);
    return true;
  }

  // 3. Hành động nói: render template, cập nhật cờ, lưu phiên.
  const loiBao = daBoPhienCu ? 'Em bỏ đơn đang gom dở nhé.\n' : '';
  let tin = loiBao + renderLoiNhan(hd, phien);
  // GUARD CHỐNG LẶP NGUYÊN VĂN (bug 16:15 11/08): gửi lại y hệt tin trước là
  // bot "điếc" — NV gõ gì cũng nhận một tường chữ. Trùng thì đổi thành câu
  // ngắn chỉ rõ các đường thoát. So với tin ĐÃ GỬI gần nhất nên hai lượt liên
  // tiếp không bao giờ giống hệt nhau.
  if (tin === phien.tinCuoi) {
    tin =
      `Em vẫn chưa khớp được "${cauChon.slice(0, 80)}" với lựa chọn nào ạ. ` +
      'Anh/chị chọn SỐ THỨ TỰ trong danh sách trên, gõ SĐT hoặc mã KH của khách, ' +
      'nói "khách mới" nếu khách chưa có, hoặc "huỷ" để làm lại giúp em.';
  }
  phien.tinCuoi = tin;
  await deps.guiTin(tin);
  // Đánh dấu vừa hỏi giá lệch: câu kế của NV là câu trả lời cho chính nó.
  phien.daHoiGiaLech = hd.loai === 'hoi_gia_lech';
  if (hd.loai === 'khong_thay') {
    // Đã báo không thấy — dọn phần hỏng để NV gõ lại từ khoá khác.
    if (phien.khachKhongThay) { phien.khachTuKhoa = null; delete phien.khachKhongThay; }
    phien.dong = phien.dong.filter((d) => !d.khongThay);
  }
  await ghiPhien(phien);
  return true;
}
