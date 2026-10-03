// SPDX-License-Identifier: AGPL-3.0-or-later
// Lịch sử in "Đã in" / "Đã huỷ" (lich-su-in.ts + GET /lich-su, /lich-su/dem):
//   - cửa sổ 30 ngày theo updated_at (lúc in xong / lúc huỷ), KHÔNG theo created_at;
//   - "Đã huỷ" CHỈ da_huy — bo_qua ("Bỏ khỏi hàng đợi") không bao giờ bị gọi là huỷ;
//   - xếp mới kết thúc trước, con trỏ ổn định khi trùng mili-giây, tổng chỉ ở trang đầu;
//   - tên khách từ print_logs (không Odoo), tên máy chỉ của CHÍNH org, không lộ token;
//   - lọc máy: máy mặc định gồm job agent_token NULL; máy lạ/org khác → rỗng;
//   - route: CHỈ owner/admin, org LUÔN từ phiên, tham số sai → 400.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  phanTichThamSoLichSu, taoWhereLichSu, timLichSuIn, demLichSuIn, mocDauLichSu, SO_NGAY_LICH_SU,
  type PrismaLichSu, type ThamSoLichSu,
} from '../../../src/modules/ai/may-in/lich-su-in.js';
import { ThamSoSai } from '../../../src/modules/ai/may-in/nhat-ky.js';
import { traLichSu, traDemLichSu } from '../../../src/modules/ai/may-in/print-agent-routes.js';
import { khopWhere } from './prisma-gia-hang-doi.js';

type Dong = Record<string, any>;

const BAY_GIO = Date.parse('2026-09-26T08:00:00.000Z');
const NGAY = 24 * 3600 * 1000;
const TOKEN_HN = 'token-may-ha-noi-0123456789abcdef';
const TOKEN_HCM = 'token-may-hcm-0123456789abcdef';
const TOKEN_ORG_KHAC = 'token-org-khac-0123456789abcdef';

const truoc = (ms: number) => new Date(BAY_GIO - ms);

function job(id: string, them: Dong = {}): Dong {
  return {
    id, orgId: 'o1', soHoaDon: `INV/${id}`, trangThai: 'da_in', loiCuoi: null, agentToken: TOKEN_HN,
    createdAt: truoc(2 * 3600_000), updatedAt: truoc(3600_000), ...them,
  };
}

/** Sắp xếp theo `orderBy` kiểu Prisma (mảng hoặc một object), Date/chuỗi đều so được. */
function sapTheo(orderBy: unknown) {
  const cac = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []) as Array<Record<string, 'asc' | 'desc'>>;
  return (a: Dong, b: Dong) => {
    for (const o of cac) {
      const [k, huong] = Object.entries(o)[0];
      const x = a[k] instanceof Date ? a[k].getTime() : a[k];
      const y = b[k] instanceof Date ? b[k].getTime() : b[k];
      if (x === y) continue;
      return (x < y ? -1 : 1) * (huong === 'desc' ? -1 : 1);
    }
    return 0;
  };
}

function prismaGia(jobs: Dong[], opts: { logs?: Dong[]; may?: Dong[]; logLoi?: boolean } = {}) {
  const logs = opts.logs ?? [];
  const may = opts.may ?? [
    { id: 'mHN', orgId: 'o1', ten: 'Máy HN', token: TOKEN_HN },
    { id: 'mHCM', orgId: 'o1', ten: 'Máy HCM', token: TOKEN_HCM },
    { id: 'mKhac', orgId: 'o2', ten: 'Máy org khác', token: TOKEN_ORG_KHAC },
  ];
  const p = {
    printJob: {
      findMany: vi.fn(async (a: { where: Dong; orderBy?: unknown; take?: number; select?: Dong }) =>
        jobs.filter((j) => khopWhere(j, a.where)).sort(sapTheo(a.orderBy)).slice(0, a.take ?? Infinity).map((j) => ({ ...j }))),
      count: vi.fn(async (a: { where: Dong }) => jobs.filter((j) => khopWhere(j, a.where)).length),
    },
    printLog: {
      findMany: vi.fn(async (a: Dong) => {
        if (opts.logLoi) throw new Error('relation "print_logs" does not exist');
        return logs.filter((l) => khopWhere(l, a.where)).sort(sapTheo(a.orderBy)).map((l) => ({ ...l }));
      }),
    },
    printAgent: {
      findMany: vi.fn(async (a: Dong) => may.filter((m) => khopWhere(m, a.where)).map((m) => ({ ...m }))),
      findFirst: vi.fn(async (a: Dong) => {
        const m = may.find((x) => khopWhere(x, a.where));
        return m ? { ...m } : null;
      }),
    },
  };
  return p as typeof p & PrismaLichSu;
}

const thamSo = (them: Partial<ThamSoLichSu> = {}): ThamSoLichSu => ({
  trangThai: 'da_in', mayInId: null, truoc: null, gioiHan: 50, ...them,
});
const deps = (p: PrismaLichSu, tokenMacDinh: string | null = TOKEN_HN) => ({ prisma: p, tokenMacDinh, bayGio: () => BAY_GIO });

describe('phanTichThamSoLichSu', () => {
  it('trangThai BẮT BUỘC và chỉ da_in | da_huy (bo_qua, loi… → 400)', () => {
    for (const sai of [undefined, '', 'bo_qua', 'loi', 'cho_in', 'da_in,da_huy', ['da_in']]) {
      expect(() => phanTichThamSoLichSu({ trangThai: sai })).toThrow(ThamSoSai);
    }
    expect(phanTichThamSoLichSu({ trangThai: 'da_huy' })).toEqual({ trangThai: 'da_huy', mayInId: null, truoc: null, gioiHan: 50 });
  });

  it('gioiHan kẹp 1..200 (rác → 50); mayInId cắt 100 ký tự; con trỏ "<ISO>|<id>"', () => {
    expect(phanTichThamSoLichSu({ trangThai: 'da_in', gioiHan: '999' }).gioiHan).toBe(200);
    expect(phanTichThamSoLichSu({ trangThai: 'da_in', gioiHan: '0' }).gioiHan).toBe(1);
    expect(phanTichThamSoLichSu({ trangThai: 'da_in', gioiHan: 'abc' }).gioiHan).toBe(50);
    expect(phanTichThamSoLichSu({ trangThai: 'da_in', mayInId: 'x'.repeat(300) }).mayInId).toHaveLength(100);
    expect(phanTichThamSoLichSu({ trangThai: 'da_in', truoc: '2026-09-25T10:00:00.000Z|j9' }).truoc)
      .toEqual({ luc: new Date('2026-09-25T10:00:00.000Z'), id: 'j9' });
    expect(() => phanTichThamSoLichSu({ trangThai: 'da_in', truoc: 'rac' })).toThrow(ThamSoSai);
  });

  it('(giám sát vòng 2) con trỏ ở TƯƠNG LAI quá 1 ngày (vd năm 99999 → trước đây 500) → 400; trong vòng 1 ngày thì nhận', () => {
    for (const xa of ['+099999-01-01T00:00:00.000Z|j1', '2026-09-27T08:00:00.001Z|j1', '9999-12-31T00:00:00.000Z|j1']) {
      expect(() => phanTichThamSoLichSu({ trangThai: 'da_in', truoc: xa }, BAY_GIO), xa).toThrow(ThamSoSai);
    }
    expect(phanTichThamSoLichSu({ trangThai: 'da_in', truoc: '2026-09-27T08:00:00.000Z|j1' }, BAY_GIO).truoc!.id).toBe('j1');
  });
});

describe('taoWhereLichSu', () => {
  it('org + trạng thái + updated_at ≥ mốc (+ máy) (+ con trỏ: cận trên updated_at ≤ luc RIÊNG + phân xử (updated_at, id))', () => {
    const tu = new Date('2026-08-27T08:00:00.000Z');
    expect(taoWhereLichSu('o1', 'da_in', tu, null, null)).toEqual({
      AND: [{ orgId: 'o1' }, { trangThai: 'da_in' }, { updatedAt: { gte: tu } }],
    });
    const luc = new Date('2026-09-25T00:00:00.000Z');
    expect(taoWhereLichSu('o1', 'da_huy', tu, { agentToken: 'x' }, { luc, id: 'j5' })).toEqual({
      AND: [
        { orgId: 'o1' }, { trangThai: 'da_huy' }, { updatedAt: { gte: tu } }, { agentToken: 'x' },
        // Đứng ngoài OR → Postgres dùng làm cận trên của index (trang 2+ không quét lại từ đầu cửa sổ)
        { updatedAt: { lte: luc } },
        { OR: [{ updatedAt: { lt: luc } }, { updatedAt: luc, id: { lt: 'j5' } }] },
      ],
    });
  });

  it('mốc đầu cửa sổ = bây giờ − 30 ngày (cùng hạn giữ nhật ký)', () => {
    expect(SO_NGAY_LICH_SU).toBe(30);
    expect(mocDauLichSu(BAY_GIO).toISOString()).toBe('2026-08-27T08:00:00.000Z');
  });
});

describe('timLichSuIn — "Đã in"', () => {
  it('CHỈ da_in của org trong 30 ngày THEO updated_at; mới in trước; tổng ở trang đầu', async () => {
    const p = prismaGia([
      job('moi', { updatedAt: truoc(60_000) }),
      job('cu', { updatedAt: truoc(29 * NGAY) }),
      job('qua-han', { updatedAt: truoc(30 * NGAY + 60_000) }),
      // Tạo 40 ngày trước, HÔM QUA mới in xong (kết quả trễ) → VẪN hiện: mốc là lúc in.
      job('tao-lau-in-muon', { createdAt: truoc(40 * NGAY), updatedAt: truoc(NGAY) }),
      job('org-khac', { orgId: 'o2', agentToken: TOKEN_ORG_KHAC }),
      job('cho', { trangThai: 'cho_in' }),
      job('loi', { trangThai: 'loi' }),
      job('huy', { trangThai: 'da_huy' }),
      job('bo', { trangThai: 'bo_qua' }),
    ]);
    const kq = await timLichSuIn('o1', thamSo(), deps(p));
    expect(kq.items.map((m) => m.id)).toEqual(['moi', 'tao-lau-in-muon', 'cu']);
    expect(kq.tong).toBe(3);
    expect(kq.tiepTheo).toBeNull();
    expect(kq.tu).toBe('2026-08-27T08:00:00.000Z');
    expect(kq.capNhat).toBe('2026-09-26T08:00:00.000Z');
    expect(kq.items[1]).toMatchObject({
      soHoaDon: 'INV/tao-lau-in-muon', trangThai: 'da_in',
      tao: truoc(40 * NGAY).toISOString(), ketThuc: truoc(NGAY).toISOString(), lyDo: null,
    });
  });

  it('phân trang con trỏ: không mất/lặp dòng khi nhiều lệnh kết thúc CÙNG mili-giây; trang sau không COUNT', async () => {
    const cung = truoc(5 * 60_000);
    const jobs = ['a', 'b', 'c', 'd', 'e'].map((id) => job(id, { updatedAt: cung }));
    jobs.push(job('f', { updatedAt: truoc(10 * 60_000) }));
    const p = prismaGia(jobs);
    const dau = await timLichSuIn('o1', thamSo({ gioiHan: 2 }), deps(p));
    expect(dau.items.map((m) => m.id)).toEqual(['e', 'd']);
    expect(dau.tong).toBe(6);
    expect(dau.tiepTheo).toBe(`${cung.toISOString()}|d`);
    const thay: string[] = dau.items.map((m) => m.id);
    let con = dau.tiepTheo;
    let dem = 0;
    while (con) {
      const [luc, id] = con.split('|');
      const trang = await timLichSuIn('o1', thamSo({ gioiHan: 2, truoc: { luc: new Date(luc), id } }), deps(p));
      expect(trang.tong).toBeNull();
      thay.push(...trang.items.map((m) => m.id));
      con = trang.tiepTheo;
      expect(++dem).toBeLessThan(10);
    }
    expect(thay).toEqual(['e', 'd', 'c', 'b', 'a', 'f']);
    expect(p.printJob.count).toHaveBeenCalledTimes(1);
  });

  it('(giám sát vòng 2) con trỏ CŨ HƠN mốc đầu cửa sổ (năm 0001, hay cửa sổ vừa trượt qua) → trang rỗng, KHÔNG truy vấn DB', async () => {
    const p = prismaGia([job('a')]);
    for (const luc of [new Date('0001-01-01T00:00:00.000Z'), new Date(mocDauLichSu(BAY_GIO).getTime() - 1)]) {
      const kq = await timLichSuIn('o1', thamSo({ truoc: { luc, id: 'x' } }), deps(p));
      expect(kq).toMatchObject({ items: [], tiepTheo: null, tong: null });
    }
    expect(p.printJob.findMany).not.toHaveBeenCalled();
    expect(p.printJob.count).not.toHaveBeenCalled();
  });

  it('tên khách = dòng print_logs MỚI NHẤT có tên của cùng job VÀ cùng org (không gọi Odoo); nhật ký lỗi → vẫn trả danh sách', async () => {
    const logs = [
      { printJobId: 'j1', orgId: 'o1', tenKhach: 'Anh Lộc (tên cũ)', createdAt: truoc(3 * 3600_000) },
      { printJobId: 'j1', orgId: 'o1', tenKhach: 'Anh Lộc Beco', createdAt: truoc(3600_000) },
      { printJobId: 'j1', orgId: 'o1', tenKhach: null, createdAt: truoc(60_000) },
      // (giám sát vòng 2) dòng MỚI HƠN cùng print_job_id nhưng của org khác → không bao giờ dùng
      { printJobId: 'j1', orgId: 'o2', tenKhach: 'Khách của org khác', createdAt: truoc(1000) },
      { printJobId: 'j2', orgId: 'o2', tenKhach: 'Khách của org khác', createdAt: truoc(1000) },
    ];
    const p = prismaGia([job('j1'), job('j2')], { logs });
    const kq = await timLichSuIn('o1', thamSo(), deps(p));
    expect(Object.fromEntries(kq.items.map((m) => [m.id, m.tenKhach]))).toEqual({ j1: 'Anh Lộc Beco', j2: null });
    expect(p.printLog.findMany.mock.calls[0][0].where).toMatchObject({ orgId: { in: ['o1'] } });
    const loi = await timLichSuIn('o1', thamSo(), deps(prismaGia([job('j1')], { logs, logLoi: true })));
    expect(loi.items.map((m) => [m.id, m.tenKhach])).toEqual([['j1', null]]);
  });

  it('tên máy: theo token (CHỈ máy của org); NULL = máy mặc định env; máy env không có dòng → "Máy mặc định (env)"; KHÔNG lộ token', async () => {
    const jobs = [
      job('hn', { agentToken: TOKEN_HN, updatedAt: truoc(1000) }),
      job('hcm', { agentToken: TOKEN_HCM, updatedAt: truoc(2000) }),
      job('null', { agentToken: null, updatedAt: truoc(3000) }),
      // job o1 mà token lại trùng máy của org KHÁC (cấu hình sai) → không lộ tên máy đó
      job('lech', { agentToken: TOKEN_ORG_KHAC, updatedAt: truoc(4000) }),
    ];
    const kq = await timLichSuIn('o1', thamSo(), deps(prismaGia(jobs)));
    expect(kq.items.map((m) => [m.id, m.mayInId, m.mayInTen])).toEqual([
      ['hn', 'mHN', 'Máy HN'], ['hcm', 'mHCM', 'Máy HCM'], ['null', 'mHN', 'Máy HN'], ['lech', null, null],
    ]);
    const env = await timLichSuIn('o1', thamSo(), deps(prismaGia([job('null', { agentToken: null })], { may: [] })));
    expect(env.items[0]).toMatchObject({ mayInId: null, mayInTen: 'Máy mặc định (env)' });
    const chu = JSON.stringify([kq, env]);
    for (const t of [TOKEN_HN, TOKEN_HCM, TOKEN_ORG_KHAC]) expect(chu).not.toContain(t);
  });

  it('lọc máy: máy MẶC ĐỊNH gồm job agent_token NULL; máy khác chỉ job của nó; máy lạ / của org khác → rỗng, tong 0', async () => {
    const jobs = [
      job('hn', { agentToken: TOKEN_HN, updatedAt: truoc(1000) }),
      job('null', { agentToken: null, updatedAt: truoc(2000) }),
      job('hcm', { agentToken: TOKEN_HCM, updatedAt: truoc(3000) }),
    ];
    const p = prismaGia(jobs);
    expect((await timLichSuIn('o1', thamSo({ mayInId: 'mHN' }), deps(p))).items.map((m) => m.id)).toEqual(['hn', 'null']);
    const hcm = await timLichSuIn('o1', thamSo({ mayInId: 'mHCM' }), deps(p));
    expect(hcm.items.map((m) => m.id)).toEqual(['hcm']);
    expect(hcm.tong).toBe(1);
    for (const id of ['mKhac', 'khong-co']) {
      const r = await timLichSuIn('o1', thamSo({ mayInId: id }), deps(p));
      expect(r).toMatchObject({ items: [], tiepTheo: null, tong: 0 });
    }
    // Hệ thuần IPP (không có máy mặc định env): lọc máy HN KHÔNG kéo theo job NULL.
    expect((await timLichSuIn('o1', thamSo({ mayInId: 'mHN' }), deps(p, null))).items.map((m) => m.id)).toEqual(['hn']);
  });
});

describe('timLichSuIn — "Đã huỷ"', () => {
  it('CHỈ da_huy — bo_qua ("Bỏ khỏi hàng đợi", không biết đã in chưa) KHÔNG BAO GIỜ nằm ở đây; kèm người huỷ, token đã che', async () => {
    const jobs = [
      job('huy-crm', { trangThai: 'da_huy', loiCuoi: 'Đã huỷ bởi ZaloCRM (Chị Hoa)', updatedAt: truoc(1000) }),
      job('huy-app', { trangThai: 'da_huy', loiCuoi: `Đã huỷ bởi app máy in (PC-HN ${TOKEN_HN})`, updatedAt: truoc(2000) }),
      job('huy-cu', { trangThai: 'da_huy', loiCuoi: 'Đã huỷ bởi ZaloCRM (A)', updatedAt: truoc(31 * NGAY) }),
      job('bo', { trangThai: 'bo_qua', loiCuoi: 'Bỏ khỏi hàng đợi bởi ZaloCRM (X) — không biết đã in hay chưa' }),
      job('in', { trangThai: 'da_in' }),
    ];
    const kq = await timLichSuIn('o1', thamSo({ trangThai: 'da_huy' }), deps(prismaGia(jobs)));
    expect(kq.items.map((m) => [m.id, m.trangThai, m.lyDo])).toEqual([
      ['huy-crm', 'da_huy', 'Đã huỷ bởi ZaloCRM (Chị Hoa)'],
      ['huy-app', 'da_huy', 'Đã huỷ bởi app máy in (PC-HN …)'],
    ]);
    expect(kq.tong).toBe(2);
    expect(JSON.stringify(kq)).not.toContain(TOKEN_HN);
  });
});

describe('demLichSuIn — số trên hai thẻ', () => {
  it('đếm da_in / da_huy của CẢ org (mọi máy) trong 30 ngày; bo_qua không tính là huỷ', async () => {
    const jobs = [
      job('i1'), job('i2', { agentToken: TOKEN_HCM }), job('i3', { agentToken: null }),
      job('i-cu', { updatedAt: truoc(31 * NGAY) }), job('i-khac', { orgId: 'o2' }),
      job('h1', { trangThai: 'da_huy' }), job('b1', { trangThai: 'bo_qua' }), job('l1', { trangThai: 'loi' }),
    ];
    expect(await demLichSuIn('o1', deps(prismaGia(jobs)))).toEqual({
      daIn: 3, daHuy: 1, tu: '2026-08-27T08:00:00.000Z', capNhat: '2026-09-26T08:00:00.000Z',
    });
  });
});

describe('GET /lich-su, /lich-su/dem (traLichSu, traDemLichSu)', () => {
  const ADMIN = { orgId: 'o1', role: 'admin' };
  const trangRong = { items: [], tiepTheo: null, tong: 0, tu: 'x', capNhat: 'y' };

  it('member → 403 CHI_ADMIN (không truy vấn); tham số sai → 400 THAM_SO_SAI', async () => {
    const tim = vi.fn(async () => trangRong);
    expect(await traLichSu({ orgId: 'o1', role: 'member' }, { trangThai: 'da_in' }, { tim })).toEqual({ code: 403, body: { error: 'CHI_ADMIN' } });
    const sai = await traLichSu(ADMIN, { trangThai: 'bo_qua' }, { tim });
    expect(sai).toMatchObject({ code: 400, body: { error: 'THAM_SO_SAI' } });
    expect(await traLichSu(ADMIN, { trangThai: 'da_in', truoc: 'rac' }, { tim })).toMatchObject({ code: 400 });
    expect(tim).not.toHaveBeenCalled();
  });

  it('owner/admin → 200; org LUÔN từ phiên (orgId trong query bị bỏ qua)', async () => {
    const tim = vi.fn(async () => trangRong);
    const kq = await traLichSu({ orgId: 'o1', role: 'owner' }, { trangThai: 'da_huy', mayInId: 'mHN', orgId: 'o2' }, { tim });
    expect(kq).toEqual({ code: 200, body: trangRong });
    expect(tim).toHaveBeenCalledWith('o1', { trangThai: 'da_huy', mayInId: 'mHN', truoc: null, gioiHan: 50 });
  });

  it('/lich-su/dem: member → 403; admin → số của org trong phiên', async () => {
    const dem = vi.fn(async (orgId: string) => ({ daIn: 5, daHuy: 1, tu: orgId, capNhat: 'y' }));
    expect((await traDemLichSu({ orgId: 'o1', role: 'member' }, { dem })).code).toBe(403);
    expect(dem).not.toHaveBeenCalled();
    expect(await traDemLichSu(ADMIN, { dem })).toEqual({ code: 200, body: { daIn: 5, daHuy: 1, tu: 'o1', capNhat: 'y' } });
  });
});

describe('migration index lịch sử', () => {
  it('chỉ THÊM index (IF NOT EXISTS), đúng tên Prisma sinh từ @@index trong schema', () => {
    const sql = readFileSync(new URL('../../../prisma/migrations/20260926150000_print_jobs_lich_su_idx/migration.sql', import.meta.url), 'utf8');
    const lenh = sql.split('\n').filter((d) => !d.trim().startsWith('--')).join('\n');
    expect(lenh).toMatch(/CREATE INDEX IF NOT EXISTS "print_jobs_org_id_trang_thai_updated_at_idx"\s+ON "print_jobs"\("org_id", "trang_thai", "updated_at" DESC\);/);
    expect(lenh).not.toMatch(/\b(DROP|ALTER|DELETE|UPDATE|INSERT|TRUNCATE)\b/i);
    const schema = readFileSync(new URL('../../../prisma/schema.prisma', import.meta.url), 'utf8');
    expect(schema).toContain('@@index([orgId, trangThai, updatedAt(sort: Desc)])');
  });
});
