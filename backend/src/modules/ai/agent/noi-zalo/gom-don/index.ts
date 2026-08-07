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
import { traSanPham, dinhDangSanPham, boDau } from '../../../odoo/tools/tra-san-pham.js';
import { taoDonNhap, dinhDangTaoDon } from '../../../odoo/tools/tao-don-nhap.js';
import { guiHoaDon } from '../../../odoo/tools/gui-hoa-don.js';
import { linkXuLyDon, type HoaDonAnhClient, type AnhHoaDon } from '../../../odoo/hoa-don-anh.js';
import { laXacNhanNgan } from '../cam-xuc.js';
import type { PhienGom, HanhDong } from './kieu.js';
import { buocTiepTheo } from './buoc-tiep-theo.js';
import { apDungChon } from './chon.js';
import { renderLoiNhan } from './loi-nhan.js';
import { trichSlot, type KetQuaTrich } from './trich-slot.js';
import { docPhien, luuPhien, xoaPhien, type DbPhienGomDon } from './phien-store.js';

/** "lên/tạo/đặt + đơn/hàng" ở đầu từ — 'sửa đơn'/'báo cáo đơn' KHÔNG kích máy. */
const NHAN_LENH_LEN_DON = /(?:^|\s)(?:lên|len|tạo|tao|đặt|dat)\s+(?:đơn|don|hàng|hang)\b/i;

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
      delete p.khachKhongThay;
      doi = true;
    }
  }
  for (const d of trich.dong ?? []) {
    const cu = p.dong.find(
      (x) => boDau(x.tuKhoa) === boDau(d.sp) || (x.daChot && boDau(x.daChot.ten).includes(boDau(d.sp))),
    );
    if (cu) {
      if (d.sl != null && cu.sl !== d.sl) { cu.sl = d.sl; doi = true; }
    } else {
      p.dong.push({ tuKhoa: d.sp, sl: d.sl ?? null });
      doi = true;
    }
  }
  // Câu chỉ có SL ("10 cái") — LLM được dặn gắn vào món đang thiếu; nếu nó trả
  // dòng trùng tên món cũ thì nhánh trên đã xử. Không tự đoán gì thêm ở đây.
  return doi;
}

/** Chạy các tra cứu của hành động tra_cuu SONG SONG, đắp kết quả vào phiên. */
async function chayTraCuu(
  deps: GomDonDeps,
  p: PhienGom,
  hd: Extract<HanhDong, { loai: 'tra_cuu' }>,
): Promise<void> {
  const viec: Array<Promise<void>> = [];
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
      } else if (kq.trangThai === 'nhieu_ket_qua') {
        p.khachUngVien = kq.danhSach;
      } else {
        p.khachKhongThay = true;
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
}

/** Tạo đơn + gửi báo giá (ảnh khi có, link luôn luôn) cho nhân viên. */
async function taoDonVaBaoGia(
  deps: GomDonDeps,
  p: PhienGom,
  input: { orgId: string; conversationId: string; seq: number },
): Promise<'xong' | 'loi'> {
  const dong = p.dong
    .filter((d) => d.daChot && d.sl != null)
    .map((d) => ({ san_pham_id: d.daChot!.id, so_luong: d.sl! }));
  const t0 = Date.now();
  const kq = await taoDonNhap(
    { odoo: deps.odoo, conversationId: input.conversationId, seq: input.seq },
    { khach_hang_id: p.khachDaChot!.id, dong, y_dinh: 'moi', ten_khach: p.khachDaChot!.ten },
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
  await deps.guiTin(
    `Đã lên đơn nháp ${kq.maDon} cho ${p.khachDaChot!.ten}, tổng ${tong}đ.` +
    `${daGuiAnh ? ' Báo giá ở ảnh trên.' : ''} Link xử lý: ${linkXuLyDon(deps.odooUrl, kq.donId)}`,
  );
  return 'xong';
}

/**
 * Xử một tin nhân viên qua máy gom đơn.
 * Trả `true` = máy đã nhận (đã gửi trả lời); `false` = không phải việc của máy
 * (không phải lệnh lên đơn / digression giữa phiên) — caller đưa agent thường.
 */
export async function xuLyGomDon(
  deps: GomDonDeps,
  input: { orgId: string; conversationId: string; seq: number; cau: string },
): Promise<boolean> {
  let phien = await docPhien(deps.prisma, input.conversationId);
  if (!phien && !NHAN_LENH_LEN_DON.test(input.cau)) return false;

  // 1. Map lựa chọn bằng CODE trước — "1a"/mã KH/SĐT không tốn lượt LLM nào.
  const daChon = phien ? apDungChon(phien, input.cau) : false;
  let trich: KetQuaTrich = {};
  if (!daChon) trich = await trichSlot(deps.generate, input.cau, phien);

  if (trich.huy && phien) {
    await xoaPhien(deps.prisma, input.conversationId);
    await deps.guiTin('Em huỷ đơn đang gom rồi ạ. Cần lên lại anh/chị cứ nhắn nhé.');
    return true;
  }
  // Digression: câu không liên quan đơn → nhường agent thường, phiên GIỮ NGUYÊN.
  if (!daChon && trich.ngoaiLe) return false;

  phien ??= { khachTuKhoa: null, dong: [] };
  const doiNoiDung = dapSlot(phien, trich);
  if ((daChon || doiNoiDung) && phien.daHoiChot) {
    // Nội dung đơn thay đổi sau khi đã hỏi chốt → phải tóm tắt lại, không được
    // lấy cái gật cũ áp cho đơn mới.
    phien.daHoiChot = false;
  }

  // 2. Vòng quyết định: tra cứu chạy xong thì hỏi lại bộ não lần nữa.
  //    Trần 3 vòng: tra_cuu chỉ có thể xảy ra 1 lần cho mỗi loạt từ khoá mới,
  //    vòng sau chắc chắn ra hành động nói/tạo — trần chỉ là hàng rào lập trình sai.
  let hd = buocTiepTheo(phien);
  for (let i = 0; hd.loai === 'tra_cuu' && i < 3; i++) {
    await chayTraCuu(deps, phien, hd);
    hd = buocTiepTheo(phien);
  }

  if (hd.loai === 'tao_don') {
    const xacNhan = trich.xacNhan || laXacNhanNgan(input.cau);
    if (!xacNhan) {
      // Đủ slot nhưng NV chưa gật (câu là bổ sung thông tin) → nhắc lại tóm tắt.
      await deps.guiTin(renderLoiNhan({ loai: 'tom_tat_cho_chot' }, phien));
      phien.daHoiChot = true;
      await luuPhien(deps.prisma, { orgId: input.orgId, conversationId: input.conversationId, phien });
      return true;
    }
    const kq = await taoDonVaBaoGia(deps, phien, input);
    if (kq === 'xong') await xoaPhien(deps.prisma, input.conversationId);
    else await luuPhien(deps.prisma, { orgId: input.orgId, conversationId: input.conversationId, phien });
    return true;
  }

  // 3. Hành động nói: render template, cập nhật cờ, lưu phiên.
  await deps.guiTin(renderLoiNhan(hd, phien));
  phien.daHoiChot = hd.loai === 'tom_tat_cho_chot';
  if (hd.loai === 'khong_thay') {
    // Đã báo không thấy — dọn phần hỏng để NV gõ lại từ khoá khác.
    if (phien.khachKhongThay) { phien.khachTuKhoa = null; delete phien.khachKhongThay; }
    phien.dong = phien.dong.filter((d) => !d.khongThay);
  }
  await luuPhien(deps.prisma, { orgId: input.orgId, conversationId: input.conversationId, phien });
  return true;
}
