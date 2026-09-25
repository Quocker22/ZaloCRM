// SPDX-License-Identifier: AGPL-3.0-or-later
// Khoá các sửa của vòng giám sát 2 (25/09) ở HÀNG ĐỢI. Prisma giả ở đây THỰC
// THI where/orderBy/take như Postgres (kể cả NULL trong NOT IN) — prismaGia của
// vòng 1 bỏ qua `take` nên đã không bắt được lỗi đói giữa chi nhánh (N1).
import { describe, it, expect, vi } from 'vitest';
import {
  chayMotLuotIn,
  dieuKienLoaiTruMay,
  type PrismaHangDoiIn,
  type JobIn,
  type SuKienHangDoi,
  type DepsChayLuot,
} from '../../../src/modules/ai/may-in/hang-doi-in.js';
import { updateManyGia } from './prisma-gia-hang-doi.js';
import { LoiIpp, LoiKhongRo } from '../../../src/modules/ai/may-in/ipp-client.js';
import { AgentRegistry } from '../../../src/modules/ai/may-in/agent-registry.js';

const HN = 'tokHN_aaaaaaaaaaaaaaaa';
const HCM = 'tokHCM_bbbbbbbbbbbbbbb';

/** Đánh giá where kiểu Prisma trên một dòng — đủ cho các dạng hàng đợi dùng. SQL NULL: `NOT IN` với NULL = loại. */
function khop(j: Record<string, any>, w: Record<string, any> | undefined): boolean {
  if (!w) return true;
  return Object.entries(w).every(([k, v]) => {
    if (k === 'AND') return (v as any[]).every((c) => khop(j, c));
    if (k === 'OR') return (v as any[]).some((c) => khop(j, c));
    const gt = j[k];
    if (v === null) return gt === null || gt === undefined;
    if (typeof v !== 'object' || v instanceof Date) return gt === v;
    if ('in' in v) return gt !== null && gt !== undefined && v.in.includes(gt);
    if ('notIn' in v) return gt !== null && gt !== undefined && !v.notIn.includes(gt);
    if ('not' in v) return v.not === null ? gt !== null && gt !== undefined : gt !== v.not;
    if ('lt' in v) return gt < v.lt;
    throw new Error(`khop: chưa hỗ trợ ${k}=${JSON.stringify(v)}`);
  });
}

function prismaThat(dong: Array<Partial<JobIn>>) {
  let dem = 0;
  const hang: JobIn[] = dong.map((h) => {
    dem += 1;
    return {
      id: h.id ?? `pj${dem}`, orgId: 'org1', conversationId: null, hoaDonId: 7000 + dem,
      soHoaDon: `INV/2026/0300${String(dem).padStart(2, '0')}`, report: 'r', trangThai: 'cho_in', lanThu: 0,
      ippJobId: null, loiCuoi: null, agentToken: HN,
      createdAt: new Date(Date.UTC(2026, 8, 25, 1, 0, dem)), ...h,
    } as JobIn;
  });
  const prisma: PrismaHangDoiIn = {
    printJob: {
      create: vi.fn(async () => ({})),
      findMany: vi.fn(async ({ where, take }) =>
        hang
          .filter((j) => khop(j as any, where as any))
          .sort((a: any, b: any) => a.createdAt - b.createdAt)
          .slice(0, take ?? Infinity)
          .map((j) => ({ ...j }))),
      updateMany: updateManyGia(hang),
    },
  };
  return { prisma, hang };
}

function cauDaoCua(reg: AgentRegistry, macDinh = HN): NonNullable<DepsChayLuot['cauDao']> {
  const t = (a: string | null) => a ?? macDinh;
  return {
    xet: (a) => reg.xetCauDao(t(a)),
    ngat: (a, ma, lyDo) => reg.ngatCauDao(t(a), ma, lyDo),
    daThu: (a) => reg.daGuiThu(t(a)),
    dangGiu: () => reg.dangGiu().flatMap((x) => (x === macDinh ? [x, null] : [x])),
  };
}

const taiPdf = async () => Buffer.from('%PDF-1.4');
const inOk = () => vi.fn(async () => ({ jobId: null, phanHoi: {} as never, daInXong: true }));

describe('N1 — máy HN đang giữ không được làm máy HCM đói', () => {
  it('12 hoá đơn HN đang giữ + 1 hoá đơn HCM tạo SAU → HCM được in ngay lượt đầu', async () => {
    const reg = new AgentRegistry();
    reg.ngatCauDao(HN, 'het_giay', 'Hết giấy');
    const { prisma, hang } = prismaThat([
      ...Array.from({ length: 12 }, () => ({ agentToken: HN })),
      { id: 'hcm', agentToken: HCM },
    ]);
    const inPdf = inOk();
    await chayMotLuotIn({ prisma, client: { inPdf, traTrangThaiJob: vi.fn() }, taiPdf, cauDao: cauDaoCua(reg) });
    expect(inPdf).toHaveBeenCalledTimes(1);
    expect(hang.find((j) => j.id === 'hcm')!.trangThai).toBe('da_in');
    expect(hang.filter((j) => j.agentToken === HN).every((j) => j.trangThai === 'cho_in' && j.lanThu === 0)).toBe(true);
  });

  it('máy MẶC ĐỊNH đang giữ → job agentToken NULL cũng bị loại; máy khác giữ → job NULL vẫn chạy', async () => {
    for (const [dangGiu, nullChay] of [[HN, false], [HCM, true]] as const) {
      const reg = new AgentRegistry();
      reg.ngatCauDao(dangGiu, 'het_giay', 'x');
      const { prisma, hang } = prismaThat([{ id: 'null', agentToken: null }]);
      await chayMotLuotIn({ prisma, client: { inPdf: inOk(), traTrangThaiJob: vi.fn() }, taiPdf, cauDao: cauDaoCua(reg) });
      expect(hang[0].trangThai === 'da_in').toBe(nullChay);
    }
  });

  it('dieuKienLoaiTruMay — ba dạng điều kiện, giữ đúng NULL', () => {
    expect(dieuKienLoaiTruMay([])).toBeNull();
    expect(dieuKienLoaiTruMay([null])).toEqual({ agentToken: { not: null } });
    expect(dieuKienLoaiTruMay([HN])).toEqual({ OR: [{ agentToken: null }, { agentToken: { notIn: [HN] } }] });
    expect(dieuKienLoaiTruMay([HN, null])).toEqual({ agentToken: { notIn: [HN] } });
  });

  it('hoá đơn mới tạo lúc máy đang giữ vẫn có dòng "nhận lệnh" + "đang chờ" (mỗi job một lần)', async () => {
    const reg = new AgentRegistry();
    reg.ngatCauDao(HN, 'het_giay', 'x');
    const { prisma } = prismaThat([{ id: 'a' }, { id: 'b' }]);
    const suKien: SuKienHangDoi[] = [];
    const deps: DepsChayLuot = {
      prisma, client: { inPdf: inOk(), traTrangThaiJob: vi.fn() }, taiPdf,
      layTenKhach: async () => 'Anh Lộc', nhatKy: (e) => suKien.push(e), cauDao: cauDaoCua(reg),
    };
    await chayMotLuotIn(deps);
    await chayMotLuotIn(deps);
    const cho = suKien.filter((e) => e.loai === 'cho_may_in');
    expect(cho.map((e) => e.job.id).sort()).toEqual(['a', 'b']);
    // Đường "giữ" không chờ Odoo (tới 50 job/lượt; Odoo treo = lượt treo) — chỉ tên đã nhớ.
    expect(cho[0].tenKhach).toBeNull();
    expect(suKien.filter((e) => e.loai === 'nhan_job')).toHaveLength(2);
  });
});

describe('lượt thử không bị nuốt', () => {
  it('tới lượt thử mà Odoo lỗi → lượt sau VẪN được thử (không phải chờ thêm 3 phút)', async () => {
    let bayGio = 1_000_000;
    const reg = new AgentRegistry({ bayGio: () => bayGio });
    reg.ngatCauDao(HN, 'het_giay', 'x');
    bayGio += 3 * 60_000;
    const { prisma, hang } = prismaThat([{}]);
    const inPdf = inOk();
    let odooHong = true;
    const deps: DepsChayLuot = {
      prisma, client: { inPdf, traTrangThaiJob: vi.fn() },
      taiPdf: async () => { if (odooHong) throw new Error('Odoo 502'); return Buffer.from('%PDF'); },
      cauDao: cauDaoCua(reg),
    };
    await chayMotLuotIn(deps);
    expect(inPdf).not.toHaveBeenCalled();
    expect(reg.xetCauDao(HN)).toBe('thu');
    odooHong = false;
    await chayMotLuotIn(deps);
    expect(inPdf).toHaveBeenCalledTimes(1);
    expect(hang[0].trangThai).toBe('da_in');
  });

  it('job thử hỏng vì máy in → ngắt lại (không ghi tam_giu lần hai), lượt thử kế sau 3 phút', async () => {
    let bayGio = 1_000_000;
    const reg = new AgentRegistry({ bayGio: () => bayGio });
    reg.ngatCauDao(HN, 'het_giay', 'x');
    bayGio += 3 * 60_000;
    const { prisma } = prismaThat([{}, {}]);
    const suKien: SuKienHangDoi[] = [];
    const inPdf = vi.fn(async () => { throw new LoiIpp('Hết giấy', true, undefined, 'het_giay'); });
    await chayMotLuotIn({ prisma, client: { inPdf, traTrangThaiJob: vi.fn() }, taiPdf, nhatKy: (e) => suKien.push(e), cauDao: cauDaoCua(reg) });
    expect(inPdf).toHaveBeenCalledTimes(1);
    expect(suKien.filter((e) => e.loai === 'tam_giu')).toHaveLength(0);
    expect(reg.xetCauDao(HN)).toBe('giu');
  });
});

describe('V4 — app offline: không tải PDF, không ghi "gửi xuống máy in"', () => {
  it('coMay=false → giữ cho_in, lanThu+1, dòng app_offline_thu_lai; Odoo không bị gọi', async () => {
    const { prisma, hang } = prismaThat([{}]);
    const tai = vi.fn(taiPdf);
    const suKien: SuKienHangDoi[] = [];
    const inPdf = inOk();
    await chayMotLuotIn({
      prisma, client: { inPdf, traTrangThaiJob: vi.fn() }, taiPdf: tai,
      coMay: () => false, nhatKy: (e) => suKien.push(e),
    });
    expect(tai).not.toHaveBeenCalled();
    expect(inPdf).not.toHaveBeenCalled();
    expect(hang[0]).toMatchObject({ trangThai: 'cho_in', lanThu: 1, loiCuoi: 'App máy in chưa kết nối' });
    expect(suKien.map((e) => e.loai)).toEqual(['nhan_job', 'app_offline_thu_lai']);
  });
});

describe('vòng 2 — câu hướng dẫn khong_ro theo "còn trong hàng đợi"; lỗi chung chung vẫn tiêu lượt', () => {
  async function mot(err: Error): Promise<{ hang: JobIn[]; suKien: SuKienHangDoi[] }> {
    const { prisma, hang } = prismaThat([{}]);
    const suKien: SuKienHangDoi[] = [];
    await chayMotLuotIn({ prisma, client: { inPdf: vi.fn(async () => { throw err; }), traTrangThaiJob: vi.fn() }, taiPdf, nhatKy: (e) => suKien.push(e) });
    return { hang, suKien };
  }

  it('còn trong hàng đợi → "sẽ tự in ra … app theo dõi" ; không còn → "có thể nằm trong bộ nhớ máy in … chỉ in lại nếu vẫn không thấy ra"', async () => {
    const con = (await mot(new LoiKhongRo('Hết giấy', 'het_giay', true))).suKien.find((e) => e.loai === 'khong_ro')!;
    expect(con.noiDung).toContain('còn trong hàng đợi máy in — sẽ tự in ra sau khi khắc phục, app theo dõi và báo khi in xong — KHÔNG in lại');
    expect(con.chiTiet).toEqual({ suCo: 'het_giay', conTrongHangDoi: true });
    const mat = (await mot(new LoiKhongRo('Hết giấy', 'het_giay', false))).suKien.find((e) => e.loai === 'khong_ro')!;
    expect(mat.noiDung).toContain('có thể đang nằm trong bộ nhớ máy in');
    expect(mat.noiDung).not.toContain('KHÔNG in lại');
  });

  it('`loi_may_in` (lỗi chung chung / BLOCKED_DEVQ) TIÊU lượt thử — không lặp "gỡ → gửi lại" mãi', async () => {
    const { hang } = await mot(new LoiIpp('Máy in báo lỗi', true, undefined, 'loi_may_in'));
    expect(hang[0].lanThu).toBe(1);
    const { hang: h2 } = await mot(new LoiIpp('Hết giấy', true, undefined, 'het_giay'));
    expect(h2[0].lanThu).toBe(0);
  });
});
