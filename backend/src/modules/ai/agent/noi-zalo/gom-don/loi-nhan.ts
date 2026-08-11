// SPDX-License-Identifier: AGPL-3.0-or-later
// Lời gửi nhân viên của máy gom đơn — TEMPLATE TẤT ĐỊNH, không LLM soạn.
// Cùng phiên → cùng chữ. Không markdown (Zalo hiện thô). Đánh số khớp chon.ts:
// khách 1..n, SP a..z.
import { KHO, type PhienGom, type HanhDong } from './kieu.js';

const tien = (n: number) => `${n.toLocaleString('vi-VN')}đ`;
const chuCai = (i: number) => String.fromCharCode(97 + i);
/** Dưới ngưỡng này coi là 'chưa có giá' — khớp NGUONG_GIA_AO của tra-san-pham. */
const NGUONG_AO = 10;

function danhSachChon(p: PhienGom): string {
  const phan: string[] = [];
  if (p.khachUngVien?.length) {
    phan.push(
      `Có ${p.khachUngVien.length} khách tên "${p.khachTuKhoa}":`,
      ...p.khachUngVien.map(
        (k, i) => `${i + 1}) ${k.ten}${k.ma ? ` · ${k.ma}` : ''}${k.dienThoai ? ` · ${k.dienThoai}` : ''}`,
      ),
    );
    // Tra cứu chạm trần → danh sách CHƯA ĐỦ, phải nói rõ. Cắt im lặng làm
    // nhân viên tưởng hệ thống không có khách đó (bug 16:15 11/08: "ủa tại sao
    // không tìm thấy anh Long led???" — anh ấy nằm ngoài 10 người đầu).
    if (p.khachUngVienConNua) {
      phan.push('Danh sách CHƯA ĐỦ — còn khách trùng khác. Không thấy đúng người, anh/chị gõ tên đầy đủ hơn hoặc SĐT giúp em.');
    }
  }
  for (const d of p.dong) {
    if (!d.ungVien?.length) continue;
    phan.push(
      `"${d.tuKhoa}" có ${d.ungVien.length} loại:`,
      ...d.ungVien.map((s, i) =>
        `${chuCai(i)}) ${s.ten} · ${s.gia > NGUONG_AO ? tien(s.gia) : 'chưa có giá'}`),
    );
  }
  const canSo = Boolean(p.khachUngVien?.length);
  const canChu = p.dong.some((d) => d.ungVien?.length);
  const goiY = canSo && canChu ? 'vd: 1a' : canSo ? 'vd: 1' : 'vd: a';
  phan.push(`Anh/chị chọn giúp em (${goiY}) ạ.`);
  return phan.join('\n');
}

function tomTat(p: PhienGom): string {
  // Giá NV báo THẮNG giá hệ thống (10/08) — nhưng phải NÓI RÕ khi lệch, để NV
  // tự kiểm chứ không âm thầm ghi số khác cái họ nghĩ.
  const giaCua = (d: PhienGom['dong'][number]) => d.donGia ?? d.daChot?.gia ?? 0;
  // Thành tiền SAU chiết khấu (11/08). Ca thật 03:24:35: nhân viên đã nói
  // "triết khấu 8%" ngay từ đầu mà tóm tắt vẫn ghi 23.000.000đ thay vì
  // 21.160.000đ — họ tưởng bot bỏ sót nên phải nhắc lại một lượt nữa.
  // Dòng TẶNG luôn 0đ — không tính vào tiền, và phải HIỆN RÕ chữ "tặng" để
  // nhân viên soát được (đo prod: 34 dòng 0đ hiện có lẫn cả phụ kiện, không ai
  // phân biệt nổi).
  const thanhTien = (d: PhienGom['dong'][number]) => {
    if (d.tang) return 0;
    const g = (d.sl ?? 0) * giaCua(d);
    return d.chietKhau ? g * (1 - d.chietKhau / 100) : g;
  };
  const dong = p.dong
    .filter((d) => d.daChot && d.sl != null)
    .map((d) => {
      if (d.tang) return `${d.sl} × ${d.daChot!.ten} — TẶNG (0đ)`;
      const lech = d.donGia && d.daChot && d.donGia !== d.daChot.gia && d.daChot.gia > NGUONG_AO
        ? ` (giá anh/chị báo ${tien(d.donGia)}, hệ thống ${tien(d.daChot.gia)})`
        : d.donGia ? ` (giá anh/chị báo ${tien(d.donGia)})` : '';
      const ck = d.chietKhau ? ` − CK ${d.chietKhau}%` : '';
      return `${d.sl} × ${d.daChot!.ten}${ck} = ${tien(thanhTien(d))}${lech}`;
    });
  const tong = p.dong.reduce((t, d) => t + (d.daChot && d.sl != null ? thanhTien(d) : 0), 0);
  // ── VAT (11/08) ─────────────────────────────────────────────────────────
  // Nhân viên phải THẤY thuế và tổng SAU thuế ngay ở tin chốt: cùng lý do với
  // chiết khấu (ca 03:24:35 11/08 — tóm tắt ghi số chưa trừ CK nên NV tưởng bot
  // bỏ sót, phải nhắc thêm một lượt).
  //
  // Số ở đây là ƯỚC LƯỢNG để nhân viên soát; số THẬT do Odoo tính khi tạo đơn
  // (bot không tự tính tiền — luật cũ). Hai số khớp nhau vì cùng công thức
  // phần trăm, nhưng nguồn sự thật vẫn là Odoo.
  const dongVat: string[] = [];
  let tongCuoi = tong;
  if (p.vatKhongTra && p.vatPhanTram != null) {
    // Tra danh mục không ra mức này (prod chỉ có 0/4/8/10%) → BÁO, đừng im lặng
    // lên đơn không thuế rồi để nhân viên phát hiện sau khi đã xuất hoá đơn.
    dongVat.push(
      `⚠ Hệ thống KHÔNG có mức VAT ${p.vatPhanTram}% — em chưa gắn thuế được. ` +
      'Anh/chị chọn mức khác (8% hoặc 10%) hoặc lên đơn không VAT rồi sửa tay trên Odoo.',
    );
  } else if (p.vatPhanTram != null && p.vatThueId != null) {
    const tienThue = tong * (p.vatPhanTram / 100);
    tongCuoi = tong + tienThue;
    dongVat.push(`VAT ${p.vatPhanTram}% = ${tien(Math.round(tienThue))}`);
  }
  // KHO chỉ hiện khi nhân viên ĐÃ NÓI kho.
  //
  // Máy không hỏi kho nữa (anh Quốc 11/08), nên 97% đơn chạy bằng kho mặc định
  // TT — in "Kho xuất: Chi nhánh trung tâm" lên mọi đơn là thêm một dòng nhiễu
  // cho 291/300 đơn, đúng thứ phiền mà quyết định này muốn bỏ.
  //
  // Nhưng khi họ ĐÃ nói kho thì PHẢI hiện: đó là lúc cần soát bot có nghe đúng
  // không, và cũng là 3% đơn mà chọn sai kho gây xuất hàng sai nơi.
  const tenKho = p.khoId != null ? KHO.find((k) => k.id === p.khoId)?.ten : undefined;
  // Nói kho mà máy không nhận ra → báo NGAY trong tóm tắt, kèm danh sách kho có
  // thật. Im lặng thì nhân viên tưởng đã xuất kho họ nói, thực tế đơn ra TT.
  const canhKho = p.khoKhongRo
    ? `Em không có kho nào tên "${p.khoKhongRo}" ạ — đơn này em để kho mặc định (${KHO[0].ten}). ` +
      `Kho hiện có: ${KHO.map((k) => k.ten).join(', ')}.`
    : undefined;
  // Có VAT thì phải hiện CẢ tiền hàng LẪN tổng sau thuế — chỉ đưa một số thì
  // nhân viên không biết con số nào là cái khách phải trả.
  //
  // KHÔNG còn "Em chốt lên đơn nhé?" (bỏ 11/08). Anh Quốc: "tôi muốn bỏ luôn
  // cái bước chốt đơn này được không?, nếu mọi thứ đã rõ ràng thì lên đơn báo
  // giá luôn". Tóm tắt giữ nguyên NỘI DUNG, chỉ đổi THÌ: câu hỏi → câu kể.
  // Mã đơn + link do `taoDonVaBaoGia` nối vào ngay sau khối này.
  const dongTong = dongVat.length > 0 && tongCuoi !== tong
    ? [`Tiền hàng: ${tien(tong)}`, ...dongVat, `Tổng: ${tien(Math.round(tongCuoi))}.`]
    : [...dongVat, `Tổng: ${tien(tong)}.`];
  return [
    `Đơn cho ${p.khachDaChot?.ten}${p.khachDaChot?.ma ? ` (${p.khachDaChot.ma})` : ''}:`,
    ...dong,
    ...(tenKho ? [`Kho xuất: ${tenKho}`] : []),
    ...(canhKho ? [canhKho] : []),
    ...dongTong,
  ].join('\n');
}

/** Chế sửa: liệt kê đơn nháp cho NV chọn — mã + tổng để nhận ra ngay đơn nào. */
function danhSachDon(p: PhienGom): string {
  const ds = p.donUngVien ?? [];
  return [
    `Cuộc này có ${ds.length} đơn nháp:`,
    ...ds.map((d, i) => `${i + 1}) ${d.ma} · ${tien(d.tong)}`),
    'Anh/chị sửa đơn nào ạ? (gõ số hoặc mã đơn)',
  ].join('\n');
}

function hoiThieu(thieu: 'khach' | 'sp' | 'sl', p: PhienGom): string {
  const laSua = p.che === 'sua';
  if (thieu === 'khach') return 'Đơn này lên cho khách nào ạ? (tên, SĐT hoặc mã KH)';
  if (thieu === 'sp') {
    return laSua
      ? `Đơn ${p.donSua?.ma ?? ''} sửa gì ạ? (tên hàng cần thêm hoặc đổi số lượng)`.replace('  ', ' ')
      : 'Anh/chị cần lên hàng gì ạ? (tên sản phẩm, có số lượng càng tốt)';
  }
  const thieuSl = p.dong.filter((d) => d.sl == null && d.daChot).map((d) => d.daChot!.ten);
  const ten = thieuSl.length > 0 ? thieuSl.join(', ') : p.dong.map((d) => d.tuKhoa).join(', ');
  return `Anh/chị lấy mấy cái ${ten} ạ?`;
}

function khongThay(hd: Extract<HanhDong, { loai: 'khong_thay' }>): string {
  const phan: string[] = [];
  if (hd.khach) phan.push(`Em không tìm thấy khách "${hd.khach}".`);
  if (hd.sp.length > 0) phan.push(`Em không tìm thấy sản phẩm: ${hd.sp.map((s) => `"${s}"`).join(', ')}.`);
  phan.push('Anh/chị gõ lại tên khác (hoặc SĐT/mã KH với khách) giúp em ạ.');
  return phan.join(' ');
}

/** Render MỘT tin gửi nhân viên cho một hành động. `tra_cuu`/`tao_don` không render ở đây. */
export function renderLoiNhan(hd: HanhDong, p: PhienGom): string {
  switch (hd.loai) {
    case 'hoi_chon': return danhSachChon(p);
    case 'hoi_chon_don': return danhSachDon(p);
    case 'tom_tat_don': return tomTat(p);
    case 'hoi_thieu': return hoiThieu(hd.thieu, p);
    case 'hoi_gia':
      return (
        `Sản phẩm ${hd.sp.map((x) => `"${x}"`).join(', ')} chưa có giá trong hệ thống ạ. ` +
        'Anh/chị báo giá giúp em (vd: 13k/thanh), hoặc nhắn "bỏ ' +
        `${hd.sp[0]?.split(' ').slice(0, 3).join(' ') ?? 'món này'}" để em lên đơn phần còn lại.`
      );
    case 'hoi_gia_lech':
      // Nêu THẲNG cả hai con số rồi hỏi — không tự sửa, không im lặng bỏ qua.
      // Ca thật 10:09:33 11/08: bot đã in đúng hai số này ("8đ" vs "230.000đ")
      // mà vẫn rủ chốt; giờ hai số đó thành CÂU HỎI chứ không phải chú thích.
      //
      // Tuyệt đối KHÔNG kèm "Em chốt lên đơn nhé?" trong tin này: hỏi mà vẫn
      // rủ gật thì nhân viên gõ "ok" là lại đúng cái bug cũ.
      return (
        hd.lech
          .map((x) =>
            `Anh/chị báo giá ${tien(x.giaNv)} cho "${x.ten}" nhưng hệ thống để ${tien(x.giaHt)} ` +
            '— lệch nhiều quá ạ.')
          .join('\n') +
        '\nAnh/chị xác nhận giúp em giá đúng là bao nhiêu ạ? (nhắn lại giá, hoặc "đúng rồi" nếu giá đó chuẩn)'
      );
    case 'khong_thay': return khongThay(hd);
    case 'khong_thay_don':
      return 'Em không thấy đơn nháp nào trong cuộc này để sửa ạ. Anh/chị cho em mã đơn (vd S13820), hoặc mình lên đơn mới nhé?';
    default:
      // tra_cuu/tao_don là hành động chạy, không phải lời nói — gọi tới đây là
      // orchestrator sai luồng, ném để test bắt ngay chứ không gửi tin rỗng.
      throw new Error(`renderLoiNhan không nhận hành động ${hd.loai}`);
  }
}
