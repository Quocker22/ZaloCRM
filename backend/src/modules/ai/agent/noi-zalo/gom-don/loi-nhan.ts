// SPDX-License-Identifier: AGPL-3.0-or-later
// Lời gửi nhân viên của máy gom đơn — TEMPLATE TẤT ĐỊNH, không LLM soạn.
// Cùng phiên → cùng chữ. Không markdown (Zalo hiện thô). Đánh số khớp chon.ts:
// khách 1..n, SP a..z.
import type { PhienGom, HanhDong } from './kieu.js';

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
  const thanhTien = (d: PhienGom['dong'][number]) => {
    const g = (d.sl ?? 0) * giaCua(d);
    return d.chietKhau ? g * (1 - d.chietKhau / 100) : g;
  };
  const dong = p.dong
    .filter((d) => d.daChot && d.sl != null)
    .map((d) => {
      const lech = d.donGia && d.daChot && d.donGia !== d.daChot.gia && d.daChot.gia > NGUONG_AO
        ? ` (giá anh/chị báo ${tien(d.donGia)}, hệ thống ${tien(d.daChot.gia)})`
        : d.donGia ? ` (giá anh/chị báo ${tien(d.donGia)})` : '';
      const ck = d.chietKhau ? ` − CK ${d.chietKhau}%` : '';
      return `${d.sl} × ${d.daChot!.ten}${ck} = ${tien(thanhTien(d))}${lech}`;
    });
  const tong = p.dong.reduce((t, d) => t + (d.daChot && d.sl != null ? thanhTien(d) : 0), 0);
  return [
    `Đơn cho ${p.khachDaChot?.ten}${p.khachDaChot?.ma ? ` (${p.khachDaChot.ma})` : ''}:`,
    ...dong,
    `Tổng: ${tien(tong)}. Em chốt lên đơn nhé?`,
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
    case 'tom_tat_cho_chot': return tomTat(p);
    case 'hoi_thieu': return hoiThieu(hd.thieu, p);
    case 'hoi_gia':
      return (
        `Sản phẩm ${hd.sp.map((x) => `"${x}"`).join(', ')} chưa có giá trong hệ thống ạ. ` +
        'Anh/chị báo giá giúp em (vd: 13k/thanh), hoặc nhắn "bỏ ' +
        `${hd.sp[0]?.split(' ').slice(0, 3).join(' ') ?? 'món này'}" để em lên đơn phần còn lại.`
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
