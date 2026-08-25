// SPDX-License-Identifier: AGPL-3.0-or-later
// Tool doanh_so_khach_theo_thang (25/08) — anh Quyết: "thống kê doanh số khách
// hàng, biểu đồ cột theo dõi khách qua từng tháng".
import { describe, it, expect, vi } from 'vitest';
import {
  cacThang, doanhSoKhachTheoThang, dinhDangDoanhSoKhach,
} from '../../../src/modules/ai/odoo/tools/doanh-so-khach.js';

const BAY_GIO = new Date('2026-08-25T08:00:00Z'); // 15:00 25/08/2026 VN

describe('cacThang — các tháng lịch VN kết thúc ở tháng hiện tại', () => {
  it('6 tháng tới 08/2026 → 03..08, mỗi tháng đủ ngày đầu-cuối', () => {
    const ds = cacThang(6, BAY_GIO);
    expect(ds.map((t) => t.nhan)).toEqual(['03/2026', '04/2026', '05/2026', '06/2026', '07/2026', '08/2026']);
    expect(ds[0]).toMatchObject({ tu: '2026-03-01', den: '2026-03-31' });
    expect(ds[5]).toMatchObject({ tu: '2026-08-01', den: '2026-08-31' });
  });
  it('qua năm: 12 tháng tới 02/2026 → bắt đầu 03/2025', () => {
    const ds = cacThang(12, new Date('2026-02-10T00:00:00Z'));
    expect(ds[0].nhan).toBe('03/2025');
    expect(ds[11].nhan).toBe('02/2026');
  });
  it('00:30 VN ngày 1/9 (17:30 UTC 31/8) vẫn tính là tháng 9', () => {
    expect(cacThang(1, new Date('2026-08-31T17:30:00Z'))[0].nhan).toBe('09/2026');
  });
});

/** Odoo giả: doanh thu theo tháng cho khách 117; read_group nhận domain, trả sum. */
function odooGia(theoThang: Record<string, { tien: number; sohd: number }>, tenKhach = 'Anh Long Led') {
  const goi: unknown[][] = [];
  return {
    goi,
    odoo: {
      searchRead: vi.fn(async (model: string) => (model === 'res.partner' ? [{ id: 117, name: tenKhach }] : [])),
      execute: vi.fn(async (_m: string, _f: string, args: unknown[]) => {
        goi.push(args);
        const domain = args[0] as Array<[string, string, string]>;
        const tu = domain.find((d) => d[0] === 'invoice_date' && d[1] === '>=')?.[2] ?? '';
        const den = domain.find((d) => d[0] === 'invoice_date' && d[1] === '<=')?.[2] ?? '';
        // Cả kỳ (tu tháng đầu → den tháng cuối) → cộng mọi tháng trong khoảng.
        let tien = 0, sohd = 0;
        for (const [k, v] of Object.entries(theoThang)) {
          const [mm, yyyy] = k.split('/');
          const ngay = `${yyyy}-${mm}-15`;
          if (ngay >= tu && ngay <= den) { tien += v.tien; sohd += v.sohd; }
        }
        return [{ amount_total: tien, __count: sohd }];
      }),
    },
  };
}

describe('doanhSoKhachTheoThang', () => {
  it('6 tháng mặc định: đủ 6 dòng, tháng không bán = 0, tổng lấy từ Odoo (truy vấn riêng)', async () => {
    const { odoo, goi } = odooGia({ '06/2026': { tien: 23_460_000, sohd: 1 }, '08/2026': { tien: 3_950_000, sohd: 1 } });
    const kq = await doanhSoKhachTheoThang({ odoo: odoo as never, bayGio: BAY_GIO }, { khach_hang_id: 117, ten_khach: 'Long Led' });
    expect(kq.trangThai).toBe('ok');
    if (kq.trangThai !== 'ok') return;
    expect(kq.thang).toHaveLength(6);
    expect(kq.thang.map((t) => t.tien)).toEqual([0, 0, 0, 23_460_000, 0, 3_950_000]);
    expect(kq.tong).toBe(27_410_000);
    expect(kq.thangCaoNhat?.nhan).toBe('06/2026');
    // 6 tháng + 1 cả kỳ = 7 read_group; domain LUÔN có out_invoice + posted (giống web).
    expect(goi).toHaveLength(7);
    for (const args of goi) {
      const domain = JSON.stringify(args[0]);
      expect(domain).toContain('out_invoice');
      expect(domain).toContain('posted');
    }
  });

  it('tên NV nhắc không khớp khách của id → TỪ CHỐI (chống báo nhầm người)', async () => {
    const { odoo } = odooGia({}, 'Anh Long Led');
    const kq = await doanhSoKhachTheoThang({ odoo: odoo as never, bayGio: BAY_GIO }, { khach_hang_id: 117, ten_khach: 'Vấn Đà Nẵng' });
    expect(kq.trangThai).toBe('loi');
  });

  it('so_thang kẹp 1..12', async () => {
    const { odoo } = odooGia({});
    const kq = await doanhSoKhachTheoThang({ odoo: odoo as never, bayGio: BAY_GIO }, { khach_hang_id: 117, so_thang: 40 });
    expect(kq.trangThai === 'ok' && kq.thang.length).toBe(12);
  });

  it('dinhDang: nêu định nghĩa hoá đơn đã vào sổ + dặn không tự cộng', async () => {
    const { odoo } = odooGia({ '08/2026': { tien: 3_950_000, sohd: 1 } });
    const kq = await doanhSoKhachTheoThang({ odoo: odoo as never, bayGio: BAY_GIO }, { khach_hang_id: 117, so_thang: 2 });
    const s = dinhDangDoanhSoKhach(kq, true);
    expect(s).toContain('HOÁ ĐƠN ĐÃ VÀO SỔ');
    expect(s).toContain('3.950.000đ');
    expect(s).toContain('BIỂU ĐỒ CỘT');
  });
});
