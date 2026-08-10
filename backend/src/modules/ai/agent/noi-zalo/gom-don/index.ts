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
import { suaDon, dinhDangSuaDon } from '../../../odoo/tools/sua-don.js';
import { guiHoaDon } from '../../../odoo/tools/gui-hoa-don.js';
import { IDEMPOTENCY_PREFIX } from '../../../odoo/idempotency.js';
import { linkXuLyDon, type HoaDonAnhClient, type AnhHoaDon } from '../../../odoo/hoa-don-anh.js';
import { laXacNhanNgan } from '../cam-xuc.js';
import type { PhienGom, HanhDong, DonSua } from './kieu.js';
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
    const cu = p.dong.find(
      (x) => boDau(x.tuKhoa) === boDau(d.sp) || (x.daChot && boDau(x.daChot.ten).includes(boDau(d.sp))),
    );
    if (cu) {
      if (d.sl != null && cu.sl !== d.sl) { cu.sl = d.sl; doi = true; }
      if (d.gia != null && cu.donGia !== d.gia) { cu.donGia = d.gia; doi = true; }
    } else {
      p.dong.push({ tuKhoa: d.sp, sl: d.sl ?? null, ...(d.gia != null ? { donGia: d.gia } : {}) });
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
    .map((d) => ({
      san_pham_id: d.daChot!.id,
      so_luong: d.sl!,
      // Giá NV báo thắng giá hệ thống (anh Quốc chốt 10/08).
      ...(d.donGia ? { don_gia: d.donGia } : {}),
    }));
  const t0 = Date.now();
  const kq = await taoDonNhap(
    { odoo: deps.odoo, conversationId: input.conversationId, seq: input.seq, choPhepDatGia: true },
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
    }));
  const t0 = Date.now();
  const kq = await suaDon({ odoo: deps.odoo }, { don_id: don.id, doi });
  deps.ghiLog({
    toolName: 'sua_don', input: { don_id: don.id, doi },
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
  input: { orgId: string; conversationId: string; seq: number; cau: string },
): Promise<boolean> {
  // Câu để MAP/nhận lệnh là phần đuôi sau khối quote; câu đầy đủ (kèm quote)
  // chỉ dành cho LLM trích slot — nó cần ngữ cảnh "cái này".
  const cauChon = boQuote(input.cau);

  let phien = await docPhien(deps.prisma, input.conversationId);
  const laLenhSua = NHAN_LENH_SUA_DON.test(cauChon);
  const laLenhLen = NHAN_LENH_LEN_DON.test(cauChon);
  if (!phien && !laLenhLen && !laLenhSua) return false;

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
  let trich: KetQuaTrich = {};
  if (!daChon) trich = await trichSlot(deps.generate, input.cau, phien);

  if (trich.huy && phien) {
    await xoaPhien(deps.prisma, input.conversationId);
    await deps.guiTin('Em huỷ đơn đang gom rồi ạ. Cần lên lại anh/chị cứ nhắn nhé.');
    return true;
  }
  // Digression: câu không liên quan đơn → nhường agent thường, phiên GIỮ NGUYÊN.
  if (!daChon && trich.ngoaiLe) return false;

  // Chế phiên: câu có dấu hiệu sửa (regex HOẶC model trích sua=true) → 'sua'.
  // Phiên đã mở giữ nguyên chế của nó — đang gom đơn mới mà nói "thêm 5 cáp"
  // là thêm vào đơn ĐANG GOM, không phải sửa đơn cũ.
  phien ??= {
    khachTuKhoa: null,
    dong: [],
    ...(laLenhSua || trich.sua ? { che: 'sua' as const } : {}),
  };
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
    await chayTraCuu(deps, phien, hd, {
      conversationId: input.conversationId,
      ...(trich.maDon ? { maDon: trich.maDon } : {}),
    });
    hd = buocTiepTheo(phien);
  }

  // Chế SỬA: đủ rõ thì ghi THẲNG, không cổng chốt (anh Quốc chốt 08/08).
  if (hd.loai === 'sua_don') {
    const kq = await suaDonVaBao(deps, phien);
    if (kq === 'xong') await xoaPhien(deps.prisma, input.conversationId);
    else await luuPhien(deps.prisma, { orgId: input.orgId, conversationId: input.conversationId, phien });
    return true;
  }

  if (hd.loai === 'tao_don') {
    // Kiểm trên câu đã bỏ quote: "[Trả lời tin: …] chốt" phải nhận là xác nhận.
    const xacNhan = trich.xacNhan || laXacNhanNgan(cauChon);
    if (!xacNhan) {
      // Đủ slot nhưng NV chưa gật (câu là bổ sung thông tin) → nhắc lại tóm tắt.
      await deps.guiTin(renderLoiNhan({ loai: 'tom_tat_cho_chot' }, phien));
      phien.daHoiChot = true;
      await luuPhien(deps.prisma, { orgId: input.orgId, conversationId: input.conversationId, phien });
      return true;
    }
    const kq = await taoDonVaBaoGia(deps, phien, input);
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
    await luuPhien(deps.prisma, { orgId: input.orgId, conversationId: input.conversationId, phien });
    return true;
  }

  // 3. Hành động nói: render template, cập nhật cờ, lưu phiên.
  const loiBao = daBoPhienCu ? 'Em bỏ đơn đang gom dở nhé.\n' : '';
  await deps.guiTin(loiBao + renderLoiNhan(hd, phien));
  phien.daHoiChot = hd.loai === 'tom_tat_cho_chot';
  if (hd.loai === 'khong_thay') {
    // Đã báo không thấy — dọn phần hỏng để NV gõ lại từ khoá khác.
    if (phien.khachKhongThay) { phien.khachTuKhoa = null; delete phien.khachKhongThay; }
    phien.dong = phien.dong.filter((d) => !d.khongThay);
  }
  await luuPhien(deps.prisma, { orgId: input.orgId, conversationId: input.conversationId, phien });
  return true;
}
