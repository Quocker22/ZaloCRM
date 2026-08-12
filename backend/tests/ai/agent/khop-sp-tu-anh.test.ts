// SPDX-License-Identifier: AGPL-3.0-or-later
// KHỚP SẢN PHẨM TỪ ẢNH — P1 ba tầng (12/08).
//
// Đo 30 ngày prod: gần MỌI ca đơn-từ-ảnh chết ở "Em không tìm thấy sản phẩm"
// trong khi một nửa số hàng CÓ THẬT dưới tên khác:
//   ảnh "RY3-800W"          → catalog "Nguồn 12V800W đổ keo... RY3-12V800WYR"
//   ảnh "Led hắt 3 bóng 6313" → catalog "3 Bóng Saso 6313" (4 màu)
// Ba tầng: (1) tách token gạch nối, (2) nới theo MÃ MODEL khi mọi đường rỗng,
// (3) alias học được từ lựa chọn của nhân viên.
import { describe, it, expect, vi } from 'vitest';
import { tuKhoaTraSp, traSanPham, type SanPhamList } from '../../../src/modules/ai/odoo/tools/tra-san-pham.js';
import { traAliasSp, ghiAliasSp, type PrismaSpAlias } from '../../../src/modules/ai/agent/sp-alias.js';
import { ilike, khopDomain } from '../odoo/ilike-gia.js';
import { logger } from '../../../src/shared/utils/logger.js';

// ─── TẦNG 1 — tách token gạch nối ───────────────────────────────────────────
describe('tuKhoaTraSp — gạch nối là ranh giới từ (P1.1)', () => {
  it('"RY3-800W" → ["RY3","800W"] — mỗi mảnh AND riêng', () => {
    expect(tuKhoaTraSp('RY3-800W')).toEqual(['RY3', '800W']);
  });

  it('"M-10000K-12V-12D 930mm" → tách hết mảnh có nghĩa', () => {
    expect(tuKhoaTraSp('M-10000K-12V-12D 930mm')).toEqual(['10000K', '12V', '12D', '930mm']);
  });

  it('token thuần chữ có gạch KHÔNG tách — chỉ tách khi có số', () => {
    expect(tuKhoaTraSp('full-out 260516')).toEqual(['full-out', '260516']);
  });

  it('hành vi cũ giữ nguyên: "nguồn NB 12V400W" không đổi', () => {
    expect(tuKhoaTraSp('nguồn NB 12V400W')).toEqual(['nguồn', 'NB', '12V400W']);
  });
});

// ─── TẦNG 2 — nới theo mã model ─────────────────────────────────────────────
/** Odoo giả với catalog thu nhỏ từ ca thật. */
function fakeOdoo() {
  const products = [
    // 50 SP NHIỄU khớp chữ "3" — mô phỏng đúng bệnh prod: nới-OR trả toàn
    // nhiễu trong trần limit*4, hàng đúng (Saso 6313) rớt ra ngoài, chỉ còn
    // đường nới-theo-mã cứu được.
    ...Array.from({ length: 50 }, (_, i) => ({
      id: 5000 + i, name: `Led 3 bóng nhiễu ${i}`, default_code: false as const,
      list_price: 2000, uom_id: [2, 'Bóng'] as [number, string],
    })),
    { id: 1946, name: 'Nguồn 12V800W đổ keo ngoài trời RY3-12V800WYR', default_code: false, list_price: 250000, uom_id: [1, 'Cái'] },
    { id: 1780, name: '3 bóng Saso 6313 đỏ (bóng)', default_code: '6313 đỏ', list_price: 1000, uom_id: [2, 'Bóng'] },
    { id: 1781, name: '3 bóng Saso 6313 xanh lá (bóng)', default_code: '6313 xanh lá', list_price: 1000, uom_id: [2, 'Bóng'] },
    { id: 19, name: 'Nguồn HK4-12V400W (cái)', default_code: 'SP000930', list_price: 195000, uom_id: [1, 'Cái'] },
  ];
  const searchRead = vi.fn(async (_m: string, domain: unknown[], _f: unknown, opts?: { limit?: number }) =>
    products
      .filter((p) => khopDomain(domain, (dk) => {
        if (dk[0] === 'name' && dk[1] === 'ilike') return ilike(`%${String(dk[2])}%`, p.name);
        if (dk[0] === 'default_code' && dk[1] === 'ilike') return typeof p.default_code === 'string' && ilike(`%${String(dk[2])}%`, p.default_code);
        if (dk[0] === 'list_price' && dk[1] === '>') return p.list_price > Number(dk[2]);
        if (dk[0] === 'list_price' && dk[1] === '<=') return p.list_price <= Number(dk[2]);
        return true;
      }))
      .slice(0, opts?.limit ?? 10));
  return { searchRead };
}

describe('traSanPham — nới theo MÃ khi mọi đường rỗng (P1.2)', () => {
  it('ca thật "RY3-800W": tách gạch → AND khớp thẳng RY3-12V800WYR', async () => {
    const kq = await traSanPham({ odoo: fakeOdoo() as never }, { ten: 'RY3-800W' });

    expect(kq).toHaveLength(1);
    expect(kq[0].id).toBe(1946);
  });

  it('ca thật "Led hắt 3 bóng 6313": chữ "hắt" không tên nào có → nới theo mã 6313 → ra Saso, cờ ganDung', async () => {
    const kq = await traSanPham({ odoo: fakeOdoo() as never }, { ten: 'Led hắt 3 bóng 6313' }) as SanPhamList;

    expect(kq.length).toBeGreaterThanOrEqual(2);
    expect(kq.every((p) => p.ten.includes('6313'))).toBe(true);
    expect(kq.ganDung).toBe(true);
  });

  it('khớp thẳng (không nới) → ganDung không bật, hành vi cũ nguyên vẹn', async () => {
    const kq = await traSanPham({ odoo: fakeOdoo() as never }, { ten: 'Saso 6313 đỏ' }) as SanPhamList;

    expect(kq).toHaveLength(1);
    expect(kq.ganDung).toBeFalsy();
  });

  it('mã hoàn toàn không tồn tại → vẫn rỗng, không bịa', async () => {
    const kq = await traSanPham({ odoo: fakeOdoo() as never }, { ten: 'NB-6V200W' });

    expect(kq).toHaveLength(0);
  });
});

// ─── TẦNG 3 — alias học được ────────────────────────────────────────────────
function fakeAliasDb() {
  const kho = new Map<string, { productId: number; demDung: number }>();
  return {
    kho,
    prisma: {
      spAlias: {
        findUnique: vi.fn(async ({ where }: { where: { orgId_tenGoi: { tenGoi: string } } }) =>
          kho.get(where.orgId_tenGoi.tenGoi) ?? null),
        upsert: vi.fn(async ({ where, create, update }: {
          where: { orgId_tenGoi: { tenGoi: string } };
          create: { productId: number };
          update: { productId: number };
        }) => {
          const cu = kho.get(where.orgId_tenGoi.tenGoi);
          kho.set(where.orgId_tenGoi.tenGoi,
            cu ? { productId: update.productId, demDung: cu.demDung + 1 }
               : { productId: create.productId, demDung: 1 });
          return {};
        }),
      },
    } as unknown as PrismaSpAlias,
  };
}

describe('sp-alias — học một lần, khớp mãi (P1.3)', () => {
  it('ghi rồi tra lại → ra đúng productId, không phân biệt dấu/hoa thường', async () => {
    const { prisma } = fakeAliasDb();

    await ghiAliasSp(prisma, { orgId: 'o1', tuKhoa: 'Led hắt 3 bóng 6313', productId: 1780, tenSp: '3 bóng Saso 6313 đỏ' });

    expect(await traAliasSp(prisma, 'o1', 'led hat 3 bong 6313')).toBe(1780);
    expect(await traAliasSp(prisma, 'o1', 'LED HẮT 3 BÓNG 6313')).toBe(1780);
  });

  it('NV chọn khác lần trước → alias ĐÈ theo lựa chọn mới', async () => {
    const { prisma, kho } = fakeAliasDb();

    await ghiAliasSp(prisma, { orgId: 'o1', tuKhoa: 'hắt 6313', productId: 1780, tenSp: 'đỏ' });
    await ghiAliasSp(prisma, { orgId: 'o1', tuKhoa: 'hắt 6313', productId: 1781, tenSp: 'xanh lá' });

    expect(await traAliasSp(prisma, 'o1', 'hắt 6313')).toBe(1781);
    expect(kho.get('hat 6313')?.demDung).toBe(2);
  });

  it('tên gọi <3 ký tự → không học (alias vô nghĩa); DB nổ → null, không ném', async () => {
    const { prisma, kho } = fakeAliasDb();
    await ghiAliasSp(prisma, { orgId: 'o1', tuKhoa: 'ab', productId: 1, tenSp: 'x' });
    expect(kho.size).toBe(0);

    const hong = {
      spAlias: { findUnique: vi.fn(async () => { throw new Error('db chết'); }) },
    } as unknown as PrismaSpAlias;
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    expect(await traAliasSp(hong, 'o1', 'hắt 6313')).toBeNull();
    warn.mockRestore();
  });
});

// ─── P2 — lời dặn đọc ảnh BẢNG có cột ───────────────────────────────────────
describe('loiDanDocAnh — ảnh BẢNG có cột (P2)', () => {
  it('dặn nhận diện cột tên/SL/giá và BỎ cột không liên quan', async () => {
    const { loiDanDocAnh } = await import('../../../src/modules/ai/agent/noi-zalo/doc-anh.js');
    const dan = loiDanDocAnh('');

    expect(dan).toMatch(/BẢNG có cột/);
    expect(dan).toMatch(/DIỄN GIẢI/);
    expect(dan).toMatch(/STT|bút toán/);
    expect(dan).toMatch(/thành tiền/);
  });
});

describe('mã SỐ THUẦN khớp tuyệt đối — số lô không nuốt mã SP (siết 22:06)', () => {
  it('"P5 Full Out 260727" KHÔNG được gợi "Led 2 bóng 2607" (260727 ⊃ 2607 là trùng hợp)', async () => {
    const odoo = fakeOdoo();
    // fakeOdoo không có SP 2607 — thêm test riêng với catalog có 2607:
    const products = [
      { id: 1056, name: 'Led 2 bóng 2607 màu Trắng (thanh)', default_code: '2607-12V-W', list_price: 1000, uom_id: [2, 'Thanh'] },
    ];
    const odoo2 = {
      searchRead: vi.fn(async (_m: string, domain: unknown[], _f: unknown, opts?: { limit?: number }) =>
        products.filter((p) => khopDomain(domain, (dk) => {
          if (dk[0] === 'name' && dk[1] === 'ilike') return ilike(`%${String(dk[2])}%`, p.name);
          if (dk[0] === 'default_code' && dk[1] === 'ilike') return ilike(`%${String(dk[2])}%`, p.default_code);
          if (dk[0] === 'list_price' && dk[1] === '>') return p.list_price > Number(dk[2]);
          if (dk[0] === 'list_price' && dk[1] === '<=') return p.list_price <= Number(dk[2]);
          return true;
        })).slice(0, opts?.limit ?? 10)),
    };
    void odoo;

    const kq = await traSanPham({ odoo: odoo2 as never }, { ten: 'P5 Full Out 260727' });

    expect(kq).toHaveLength(0);
  });

  it('chiều hợp lệ giữ nguyên: mã chữ+số "Nb12v100w" vẫn khớp SP "NB 12V100w"', async () => {
    const products = [
      { id: 1040, name: 'Nguồn NB Ngoài Trời 12V100W (cái)', default_code: 'NB 12V100w', list_price: 78000, uom_id: [1, 'Cái'] },
    ];
    const odoo = {
      searchRead: vi.fn(async (_m: string, domain: unknown[], _f: unknown, opts?: { limit?: number }) =>
        products.filter((p) => khopDomain(domain, (dk) => {
          if (dk[0] === 'name' && dk[1] === 'ilike') return ilike(`%${String(dk[2])}%`, p.name);
          if (dk[0] === 'default_code' && dk[1] === 'ilike') return ilike(`%${String(dk[2])}%`, p.default_code);
          if (dk[0] === 'list_price' && dk[1] === '>') return p.list_price > Number(dk[2]);
          if (dk[0] === 'list_price' && dk[1] === '<=') return p.list_price <= Number(dk[2]);
          return true;
        })).slice(0, opts?.limit ?? 10)),
    };

    const kq = await traSanPham({ odoo: odoo as never }, { ten: 'Nb12v100w' });

    expect(kq).toHaveLength(1);
    expect(kq[0].id).toBe(1040);
  });
});

describe('hàng đợi tuần tự theo hội thoại (vá race 22:06)', () => {
  it('hai lượt cùng hội thoại chạy NỐI ĐUÔI; hội thoại khác vẫn song song', async () => {
    const { xepHangHoiThoai } = await import('../../../src/modules/ai/agent/noi-zalo/luong-nhan-vien.js');
    const dau: string[] = [];
    const cham = (nhan: string, ms: number) => async () => {
      dau.push(`vao:${nhan}`);
      await new Promise((r) => setTimeout(r, ms));
      dau.push(`ra:${nhan}`);
      return nhan;
    };

    const [a, b, c] = await Promise.all([
      xepHangHoiThoai('conv-1', cham('anh', 30)),
      xepHangHoiThoai('conv-1', cham('text', 5)),
      xepHangHoiThoai('conv-2', cham('khac', 5)),
    ]);

    expect([a, b, c]).toEqual(['anh', 'text', 'khac']);
    // conv-1: text chỉ được VÀO sau khi ảnh RA — không chồng nhau.
    expect(dau.indexOf('ra:anh')).toBeLessThan(dau.indexOf('vao:text'));
    // conv-2 không phải chờ conv-1.
    expect(dau.indexOf('ra:khac')).toBeLessThan(dau.indexOf('ra:anh'));
  });

  it('lượt trước NÉM LỖI không chặn lượt sau', async () => {
    const { xepHangHoiThoai } = await import('../../../src/modules/ai/agent/noi-zalo/luong-nhan-vien.js');

    await expect(xepHangHoiThoai('conv-loi', async () => { throw new Error('nổ'); })).rejects.toThrow('nổ');
    await expect(xepHangHoiThoai('conv-loi', async () => 'song')).resolves.toBe('song');
  });
});
