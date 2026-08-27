// SPDX-License-Identifier: AGPL-3.0-or-later
// Object phiên đơn dùng chung khách + NV (27/08) — hàm thuần: ô nào bắt buộc,
// hỏi ô nào tiếp, không hỏi lại ô đã có / đã từ chối / đã hỏi 2 lần.
import { describe, it, expect } from 'vitest';
import {
  phienTrong, oBatBuoc, oConThieu, duDeLenDon, ghiDaHoi, tomTatPhien, type PhienDon,
} from '../../../../src/modules/ai/agent/dieu-phoi/phien-don.js';
import { apCapNhat } from '../../../../src/modules/ai/agent/dieu-phoi/dieu-phoi.js';

function phienDatHang(vai: PhienDon['vai']): PhienDon {
  const p = phienTrong(vai);
  p.che = 'dat_hang';
  return p;
}

describe('oBatBuoc / oConThieu', () => {
  it('chưa có việc (che=khong) hay chỉ hỏi giá → không hỏi gì', () => {
    expect(oConThieu(phienTrong('khach'))).toEqual([]);
    const p = phienTrong('khach'); p.che = 'hoi_gia';
    expect(oConThieu(p)).toEqual([]);
  });

  it('khách đặt hàng từ trống → hỏi tối đa 2 ô, đúng thứ tự khách → hàng', () => {
    const p = phienDatHang('khach');
    expect(oBatBuoc(p)).toEqual(['khach', 'dong', 'soLuong', 'donGia', 'giaoHang', 'thanhToan']);
    expect(oConThieu(p).map((x) => x.o)).toEqual(['khach', 'dong']);
  });

  it('NV lên đơn: KHÔNG hỏi giao hàng/thanh toán; phụ phí/VAT/CK/kho không bao giờ bị hỏi', () => {
    const p = phienDatHang('nhanvien');
    expect(oBatBuoc(p)).toEqual(['khach', 'dong', 'soLuong', 'donGia']);
    p.khach = { trangThai: 'da_co', giaTri: { ten: 'anh Vũ Hải' } };
    p.dong = [{ ten: 'nguồn 12v400w DF', soLuong: { trangThai: 'da_co', giaTri: 8 }, donGia: { trangThai: 'da_co', giaTri: 180000 } }];
    expect(oConThieu(p)).toEqual([]);
    expect(duDeLenDon(p)).toBe(true);
  });

  it('ô MƠ HỒ được hỏi TRƯỚC ô thiếu, kèm tên dòng và lý do', () => {
    const p = phienDatHang('khach');
    p.khach = { trangThai: 'da_co', giaTri: { ten: 'QC Hoàng Nguyên' } };
    p.dong = [
      { ten: 'Vỏ Neon 6mm Xanh Ngọc', soLuong: { trangThai: 'da_co', giaTri: 20 }, donGia: { trangThai: 'mo_ho', ghiChu: 'ảnh 9.000 nhưng khách nói 8k' } },
      { ten: 'Led dây chữ S', soLuong: { trangThai: 'thieu' }, donGia: { trangThai: 'thieu' } },
    ];
    const ch = oConThieu(p);
    expect(ch[0]).toMatchObject({ o: 'donGia', trangThai: 'mo_ho', dong: 'Vỏ Neon 6mm Xanh Ngọc', ghiChu: 'ảnh 9.000 nhưng khách nói 8k' });
    expect(ch[1]).toMatchObject({ o: 'soLuong', trangThai: 'thieu', dong: 'Led dây chữ S' });
  });

  it('giá THIẾU không bị hỏi (lấy giá Odoo); ô tu_choi không hỏi; hỏi 2 lần rồi thì thôi', () => {
    const p = phienDatHang('khach');
    p.khach = { trangThai: 'da_co', giaTri: { ten: 'a Long' } };
    p.dong = [{ ten: 'led thanh 1m', soLuong: { trangThai: 'da_co', giaTri: 10 }, donGia: { trangThai: 'thieu' } }];
    p.thanhToan = { trangThai: 'tu_choi', ghiChu: 'khách bảo để sau' };
    expect(oConThieu(p).map((x) => x.o)).toEqual(['giaoHang']);
    ghiDaHoi(p, 'giaoHang'); ghiDaHoi(p, 'giaoHang');
    expect(oConThieu(p)).toEqual([]);
    expect(duDeLenDon(p)).toBe(false); // giaoHang vẫn thiếu — không đủ để lên đơn, để người
  });
});

describe('apCapNhat — áp output tool vào phiên (code giữ luật)', () => {
  it('ca thật 17:22 26/08 "a vũ hải 8 cái 12v400w Df x 180k lên đơn" → khách, 1 dòng SL 8 giá 180000, che dat_hang', () => {
    const { phien, yDinh } = apCapNhat(phienTrong('nhanvien'), {
      y_dinh: 'dat_hang', che: 'dat_hang',
      khach: { trangThai: 'da_co', giaTri: { ten: 'a vũ hải' } },
      dong: [{ ten: '12v400w Df', soLuong: { trangThai: 'da_co', giaTri: 8 }, donGia: { trangThai: 'da_co', giaTri: 180000 } }],
    });
    expect(yDinh).toBe('dat_hang');
    expect(phien.che).toBe('dat_hang');
    expect(phien.khach).toEqual({ trangThai: 'da_co', giaTri: { ten: 'a vũ hải' } });
    expect(phien.dong[0]).toMatchObject({ ten: '12v400w Df', soLuong: { giaTri: 8 }, donGia: { giaTri: 180000 } });
    expect(oConThieu(phien)).toEqual([]);
  });

  it('ô không nhắc tới thì GIỮ NGUYÊN; da_co mà không có giaTri hợp lệ = bịa → bỏ ô đó; spId code đã khớp được giữ khi tên không đổi', () => {
    const cu = phienDatHang('khach');
    cu.khach = { trangThai: 'da_co', giaTri: { ten: 'chị Yến', sdt: '0912345678' } };
    cu.dong = [{ ten: 'led thanh 1m', spId: 1026, soLuong: { trangThai: 'da_co', giaTri: 10 }, donGia: { trangThai: 'thieu' } }];
    const { phien } = apCapNhat(cu, {
      y_dinh: 'dat_hang', che: 'dat_hang',
      vatPhanTram: { trangThai: 'da_co' }, // bịa: không có số
      dong: [{ ten: 'led thanh 1m', soLuong: { trangThai: 'da_co', giaTri: 15 }, donGia: { trangThai: 'thieu' } }],
    });
    expect(phien.khach.giaTri?.sdt).toBe('0912345678');
    expect(phien.vatPhanTram).toEqual({ trangThai: 'thieu' });
    expect(phien.dong[0]).toMatchObject({ spId: 1026, soLuong: { giaTri: 15 } });
  });

  it('tu_choi giữ ghi chú, mo_ho không có ghi chú thì tự đặt; y_dinh lạ → hoi_khac; huy → che=khong', () => {
    const { phien, yDinh } = apCapNhat(phienDatHang('khach'), {
      y_dinh: 'bay_len_troi', che: 'dat_hang',
      thanhToan: { trangThai: 'tu_choi', ghiChu: 'để sau' },
      giaoHang: { trangThai: 'mo_ho' },
    });
    expect(yDinh).toBe('hoi_khac');
    expect(phien.thanhToan).toEqual({ trangThai: 'tu_choi', ghiChu: 'để sau' });
    expect(phien.giaoHang).toEqual({ trangThai: 'mo_ho', ghiChu: 'chưa rõ' });
    expect(apCapNhat(phien, { y_dinh: 'huy', che: 'dat_hang' }).phien.che).toBe('khong');
  });

  it('tomTatPhien không nổ với phiên trống và có đủ ô khi đầy', () => {
    expect(tomTatPhien(phienTrong('khach'))).toContain('hàng: (chưa có)');
    const p = phienDatHang('khach');
    p.dong = [{ ten: 'Vỏ Neon', soLuong: { trangThai: 'da_co', giaTri: 20 }, donGia: { trangThai: 'mo_ho', ghiChu: 'hai giá' }, donVi: 'm' }];
    p.giaoHang = { trangThai: 'da_co', giaTri: { cach: 'ship', diaChi: 'Lĩnh Nam' } };
    const t = tomTatPhien(p);
    expect(t).toContain('Vỏ Neon: 20 m · giá MƠ HỒ (hai giá)');
    expect(t).toContain('giao hàng: da_co');
  });
});
