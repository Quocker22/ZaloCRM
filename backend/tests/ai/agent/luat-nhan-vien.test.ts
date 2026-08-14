// SPDX-License-Identifier: AGPL-3.0-or-later
// LUẬT NHÂN VIÊN DẶN — trí nhớ dài hạn của bot (12/08).
//
// Anh Quốc: "cảm giác nó tù tù... không linh động" → "làm cái memory luật
// nhân viên dặn đi". "Nhớ là khách X luôn giảm 5%" nói MỘT lần phải áp cho
// mọi lượt sau.
//
// Tái dùng AiGuideline vai='nhanvien' (schema có sẵn, chưa ai nối) — không
// migration, UI guideline sẵn có tự thấy luật.
import { describe, it, expect, vi } from 'vitest';
import {
  napLuatNhanVien, khoiLuatChoPrompt, ghiLuat, quenLuat, type PrismaLuatNv,
} from '../../../src/modules/ai/agent/luat-nhan-vien.js';
import { logger } from '../../../src/shared/utils/logger.js';

function fakePrisma(hang: Array<{ id: string; ten: string; condition: string; action: string; mucDo: string }>) {
  const daTao: unknown[] = [];
  const daTat: string[][] = [];
  return {
    daTao, daTat,
    prisma: {
      aiGuideline: {
        findMany: vi.fn(async () => hang),
        create: vi.fn(async (args: { data: { ten: string } }) => {
          daTao.push(args.data);
          return { id: 'x', ten: args.data.ten };
        }),
        updateMany: vi.fn(async (args: { where: { id: { in: string[] } } }) => {
          daTat.push(args.where.id.in);
          return { count: args.where.id.in.length };
        }),
      },
    } as unknown as PrismaLuatNv,
  };
}

const luat = (id: string, action: string, condition = 'mọi tình huống', mucDo = 'thuong') =>
  ({ id, ten: `nv-${id}`, condition, action, mucDo });

describe('napLuatNhanVien — nạp trong trần, không bao giờ làm bot câm', () => {
  it('luật thường ra đúng nội dung; luật có phạm vi kèm "(khi: ...)"', async () => {
    const { prisma } = fakePrisma([
      luat('1', 'Khách Led Kim Long luôn chiết khấu 5%', 'khách Led Kim Long'),
      luat('2', 'Đơn nào cũng báo lại tổng tiền bằng chữ'),
    ]);

    const ra = await napLuatNhanVien(prisma, 'o1');

    expect(ra).toEqual([
      'Khách Led Kim Long luôn chiết khấu 5% (khi: khách Led Kim Long)',
      'Đơn nào cũng báo lại tổng tiền bằng chữ',
    ]);
  });

  it('vượt trần 900 ký tự → cắt và LOG, không phình prompt âm thầm', async () => {
    const dai = 'x'.repeat(120);
    const { prisma } = fakePrisma(Array.from({ length: 20 }, (_, i) => luat(String(i), dai)));
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);

    const ra = await napLuatNhanVien(prisma, 'o1');

    expect(ra.length).toBeLessThan(20);
    expect(ra.join('').length).toBeLessThanOrEqual(900);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('DB nổ → [] chứ không ném — luật là gia vị, không phải xương sống', async () => {
    const prisma = {
      aiGuideline: { findMany: vi.fn(async () => { throw new Error('db chết'); }) },
    } as unknown as PrismaLuatNv;
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);

    await expect(napLuatNhanVien(prisma, 'o1')).resolves.toEqual([]);
    warn.mockRestore();
  });
});

describe('khoiLuatChoPrompt — khối chèn vào ngữ cảnh', () => {
  it('có luật → khối nêu rõ "LÀM THEO, trừ khi tin mới nói khác"', () => {
    const khoi = khoiLuatChoPrompt(['Khách X giảm 5%']);

    expect(khoi).toContain('Luật nhân viên đã dặn');
    expect(khoi).toContain('tin mới nói khác');
    expect(khoi).toContain('- Khách X giảm 5%');
  });

  it('không luật → chuỗi rỗng, userMessage không dính khối trống', () => {
    expect(khoiLuatChoPrompt([])).toBe('');
  });
});

describe('ghiLuat — chống rác từ model', () => {
  it('ghi luật hợp lệ → tạo bản ghi vai nhanvien kèm nguồn hội thoại', async () => {
    const { prisma, daTao } = fakePrisma([]);

    const kq = await ghiLuat(prisma, {
      orgId: 'o1', noiDung: 'Khách quen thì đừng hỏi kho', conversationId: 'c9',
    });

    expect(kq.ok).toBe(true);
    expect(daTao[0]).toMatchObject({
      vai: 'nhanvien', action: 'Khách quen thì đừng hỏi kho', condition: 'mọi tình huống',
    });
    expect(JSON.stringify(daTao[0])).toContain('c9');
  });

  it('luật rỗng / dài quá 200 ký tự → từ chối có lý do, KHÔNG ghi', async () => {
    const { prisma, daTao } = fakePrisma([]);

    expect((await ghiLuat(prisma, { orgId: 'o1', noiDung: '  ' })).ok).toBe(false);
    const daiQua = await ghiLuat(prisma, { orgId: 'o1', noiDung: 'y'.repeat(250) });
    expect(daiQua.ok).toBe(false);
    expect(daiQua.loi).toContain('200');
    expect(daTao).toHaveLength(0);
  });
});

describe('quenLuat — tắt mềm, đọc lại cho người soát', () => {
  it('khớp từ khoá → tắt đúng các luật đó, trả nội dung đã tắt', async () => {
    const { prisma, daTat } = fakePrisma([
      luat('a', 'Khách Led Kim Long luôn chiết khấu 5%'),
      luat('b', 'Đơn nào cũng báo tổng bằng chữ'),
    ]);

    const kq = await quenLuat(prisma, { orgId: 'o1', tuKhoa: 'chiết khấu' });

    expect(kq.ok).toBe(true);
    expect(kq.daTat).toEqual(['Khách Led Kim Long luôn chiết khấu 5%']);
    expect(daTat[0]).toEqual(['a']);
  });

  it('từ khoá <3 ký tự hoặc không khớp gì → từ chối, không tắt bừa', async () => {
    const { prisma, daTat } = fakePrisma([luat('a', 'Khách X giảm 5%')]);

    expect((await quenLuat(prisma, { orgId: 'o1', tuKhoa: 'ab' })).ok).toBe(false);
    expect((await quenLuat(prisma, { orgId: 'o1', tuKhoa: 'không tồn tại' })).ok).toBe(false);
    expect(daTat).toHaveLength(0);
  });
});

describe('an toàn phân vai — luồng khách KHÔNG có tool luật', () => {
  it('buildStaffRegistry không cấp luatStore → không đăng ký ghi_luat/quen_luat', async () => {
    // Khách mà dặn được luật cho bot là prompt injection có ghi vào DB. Tool
    // chỉ hiện khi caller (luồng nhân viên) cấp store — kiểm bằng source:
    // đăng ký nằm trong `if (deps.luatStore)`.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../../../src/modules/ai/agent/staff-agent.ts', import.meta.url), 'utf8');

    expect(src).toMatch(/if \(deps\.luatStore\) \{/);
    // customer-agent không được đụng tới ghi_luat.
    const srcKhach = readFileSync(
      new URL('../../../src/modules/ai/agent/customer-agent.ts', import.meta.url), 'utf8');
    expect(srcKhach).not.toContain('ghi_luat');
  });
});

describe('apLuatChietKhau — máy gom đơn ăn luật bằng CODE (ca thật 20:32 12/08)', () => {
  // Luật vừa ghi xong, lên đơn ngay cho đúng khách đó mà S13839 ra KHÔNG
  // chiết khấu — luật chỉ đến agent thường, máy gom đơn không đọc prompt.
  const phienMau = () => ({
    khachTuKhoa: 'Led Kim Long',
    khachDaChot: { id: 88, ma: 'KH001564', ten: 'Led Kim Long', dienThoai: null },
    dong: [
      { tuKhoa: 'nguồn nb', sl: 10 },
      { tuKhoa: 'quà', sl: 1, tang: true },
    ],
    viecId: 1,
  });
  const LUAT = ['Khách Led Kim Long luôn chiết khấu 5% (khi: khách Led Kim Long)'];

  it('khách khớp luật → dòng thường ăn 5%, dòng TẶNG miễn, cờ chốt một lần', async () => {
    const { apLuatChietKhau } = await import('../../../src/modules/ai/agent/noi-zalo/gom-don/index.js');
    const p = phienMau() as never as Parameters<typeof apLuatChietKhau>[0];

    expect(apLuatChietKhau(p, LUAT)).toBe(true);
    expect(p.dong[0].chietKhau).toBe(5);
    expect(p.dong[1].chietKhau).toBeUndefined();
    expect(p.daApLuatCk).toBe(true);
    // Lượt sau gọi lại → không áp lần hai (NV xoá tay thì máy không điền lại).
    p.dong[0].chietKhau = undefined as never;
    expect(apLuatChietKhau(p, LUAT)).toBe(false);
  });

  it('NV đã nói chiết khấu 8% trong phiên → số của NV THẮNG, luật không đè', async () => {
    const { apLuatChietKhau } = await import('../../../src/modules/ai/agent/noi-zalo/gom-don/index.js');
    const p = phienMau() as never as Parameters<typeof apLuatChietKhau>[0];
    p.dong[0].chietKhau = 8;

    apLuatChietKhau(p, LUAT);

    expect(p.dong[0].chietKhau).toBe(8);
  });

  it('khách KHÁC luật → không áp một đồng nào', async () => {
    const { apLuatChietKhau } = await import('../../../src/modules/ai/agent/noi-zalo/gom-don/index.js');
    const p = phienMau() as never as Parameters<typeof apLuatChietKhau>[0];
    p.khachDaChot = { id: 9, ma: 'KH9', ten: 'Anh Hoàng', dienThoai: null } as never;

    expect(apLuatChietKhau(p, LUAT)).toBe(false);
    expect(p.dong[0].chietKhau).toBeUndefined();
  });

  it('chưa chốt khách / luật không có % / luật rỗng → đứng yên', async () => {
    const { apLuatChietKhau } = await import('../../../src/modules/ai/agent/noi-zalo/gom-don/index.js');
    const chuaChot = { ...phienMau(), khachDaChot: undefined } as never as Parameters<typeof apLuatChietKhau>[0];
    expect(apLuatChietKhau(chuaChot, LUAT)).toBe(false);

    const p = phienMau() as never as Parameters<typeof apLuatChietKhau>[0];
    expect(apLuatChietKhau(p, ['Khách Led Kim Long thích giao buổi sáng'])).toBe(false);
    expect(apLuatChietKhau(p, [])).toBe(false);
    expect(apLuatChietKhau(p, undefined)).toBe(false);
  });
});

describe('A4 (14/08) — trần 900: luật nạp NGUYÊN VẸN hoặc bỏ hẳn, không bao giờ cắt đôi', () => {
  it('luật không vừa trần → bỏ nguyên luật; các luật đã nạp giữ đủ từng chữ', async () => {
    const daiVua = 'x'.repeat(180); // ~5 luật là chạm trần 900
    const { prisma } = fakePrisma([
      luat('1', `luật một ${daiVua}`),
      luat('2', `luật hai ${daiVua}`),
      luat('3', `luật ba ${daiVua}`),
      luat('4', `luật bốn ${daiVua}`),
      luat('5', `luật năm ${daiVua}`),
      luat('6', `luật sáu ${daiVua}`),
    ]);

    const ra = await napLuatNhanVien(prisma, 'o1');

    // Không dòng nào bị cắt giữa chừng: mỗi dòng trả ra phải là NGUYÊN VĂN
    // một luật trong kho (nửa luật hại hơn không có luật).
    const nguyenVan = new Set(['một', 'hai', 'ba', 'bốn', 'năm', 'sáu'].map((t) => `luật ${t} ${daiVua}`));
    for (const dong of ra) expect(nguyenVan.has(dong)).toBe(true);
    // Tổng nằm trong trần và có ít nhất một luật bị bỏ nguyên con.
    expect(ra.join('').length).toBeLessThanOrEqual(900);
    expect(ra.length).toBeGreaterThan(0);
    expect(ra.length).toBeLessThan(6);
  });
});
