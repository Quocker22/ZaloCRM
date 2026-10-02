// SPDX-License-Identifier: AGPL-3.0-or-later
// Sự kiện in BỀN (docs/78 C1, Codex P0-3) trên Postgres THẬT:
//   • mỗi lần print_jobs ĐỔI trạng thái ⇒ đúng MỘT dòng print_su_kien (tạo job, mọi nhánh hàng đợi, dọn mồ côi, kết quả
//     trễ, phục hồi sau khởi động lại, huỷ, bỏ theo dõi), tu/sang đúng, org đọc từ dòng job;
//   • UPDATE có điều kiện không đổi dòng nào ⇒ KHÔNG có sự kiện (huỷ chen giữa, kết quả trễ sau huỷ, hai bên giành nhau);
//   • sự cố máy in (`su-co`, `tam_giu`) ⇒ print_su_co, không lưu token.
// Chạy: CO_DB_TEST=1 DATABASE_URL=<db test đã migrate> npm run test:db
import { it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { describeCanDb } from './helpers/can-db.js';
import { prisma } from '../src/shared/database/prisma-client.js';
import {
  themJobIn, chayMotLuotIn, donJobMoCoi, MAX_LAN_THU, MS_JOB_MO_COI, TRANG_THAI_JOB,
  type PrismaHangDoiIn, type ClientMayIn, type DepsChayLuot,
} from '../src/modules/ai/may-in/hang-doi-in.js';
import { capNhatJobCoSuKien, ghiSuCoIn, donSuKienDaNhan, type PrismaSuKienIn, type PrismaSuCoIn } from '../src/modules/ai/may-in/su-kien-in.js';
import { capNhatJobTreThat } from '../src/modules/ai/may-in/agent-ws.js';
import { huyLenhIn, boTheoDoi, type PrismaHangDoiHuy } from '../src/modules/ai/may-in/huy-lenh-in.js';
import { LoiIpp, LoiKhongRo } from '../src/modules/ai/may-in/ipp-client.js';
import { JOB_STATE } from '../src/modules/ai/may-in/giao-thuc-ipp.js';

const ORG = 'test-psk-org';
const ORG2 = 'test-psk-org2';
const TOKEN = 'test-psk-token-bi-mat-0123456789';
const p = prisma as unknown as PrismaHangDoiIn;

async function donDep() {
  // Mọi job trong DB test là của file này (cron nhặt toàn bảng) — dọn theo org.
  await prisma.printSuKien.deleteMany({ where: { orgId: { in: [ORG, ORG2] } } });
  await prisma.printSuCo.deleteMany({ where: { orgId: { in: [ORG, ORG2] } } });
  await prisma.printJob.deleteMany({ where: { orgId: { in: [ORG, ORG2] } } });
  await prisma.printAgent.deleteMany({ where: { orgId: { in: [ORG, ORG2] } } });
}

async function taoJob(o: { org?: string; trangThai?: string; lanThu?: number; ippJobId?: number | null; updatedAt?: Date } = {}) {
  // Dựng job ở ĐÚNG trạng thái cần ngay lúc INSERT — UPDATE trạng thái để dựng sẽ sinh sự kiện (trigger UPDATE, tự rà Codex
  // v1 #4) và làm bẩn phần kiểm. Dòng tạo (tu null) bị `suKien` bỏ.
  if (!o.trangThai && o.lanThu === undefined && o.ippJobId === undefined) {
    await themJobIn(p, { orgId: o.org ?? ORG, hoaDonId: 1, soHoaDon: `INV/${Math.random().toString(36).slice(2, 8)}`, report: 'r' });
  } else {
    await prisma.printJob.create({ data: {
      orgId: o.org ?? ORG, hoaDonId: 1, soHoaDon: `INV/${Math.random().toString(36).slice(2, 8)}`, report: 'r',
      trangThai: o.trangThai ?? 'cho_in', lanThu: o.lanThu ?? 0, ippJobId: o.ippJobId ?? null,
    } });
  }
  const job = await prisma.printJob.findFirstOrThrow({ where: { orgId: o.org ?? ORG }, orderBy: { createdAt: 'desc' } });
  if (o.updatedAt) await prisma.$executeRaw`UPDATE print_jobs SET updated_at = ${o.updatedAt} WHERE id = ${job.id}`;
  return job.id;
}

/** Sự kiện của job, BỎ dòng tạo (null → cho_in) — dòng tạo kiểm riêng. */
async function suKien(jobId: string, boTao = true) {
  const r = await prisma.printSuKien.findMany({ where: { jobId }, orderBy: { id: 'asc' } });
  return r
    .filter((e) => !boTao || e.tuTrangThai !== null)
    .map((e) => ({ tu: e.tuTrangThai, sang: e.sangTrangThai, ma: e.maLoi, org: e.orgId, nhan: e.botNhanLuc }));
}

function client(kq: Partial<Awaited<ReturnType<ClientMayIn['inPdf']>>> | Error, jobState: number | null = null): ClientMayIn {
  return {
    inPdf: async () => {
      if (kq instanceof Error) throw kq;
      return { jobId: null, phanHoi: {} as never, ...kq };
    },
    traTrangThaiJob: async () => ({ jobState, phanHoi: {} as never }),
  };
}

function deps(c: ClientMayIn, them: Partial<DepsChayLuot> = {}): DepsChayLuot {
  return { prisma: p, client: c, taiPdf: async () => Buffer.from('%PDF'), ...them };
}

describeCanDb('print_su_kien / print_su_co — sự kiện in bền (DB)', () => {
  beforeAll(async () => {
    await donDep();
    await prisma.organization.upsert({ where: { id: ORG }, create: { id: ORG, name: 'PSK' }, update: {} });
    await prisma.organization.upsert({ where: { id: ORG2 }, create: { id: ORG2, name: 'PSK2' }, update: {} });
  });
  afterAll(async () => {
    await donDep();
    await prisma.organization.deleteMany({ where: { id: { in: [ORG, ORG2] } } });
    await prisma.$disconnect();
  });
  beforeEach(donDep);

  it('tạo job qua CRM (themJobIn) ⇒ đúng một sự kiện null → cho_in, cùng org, chưa nhận', async () => {
    const id = await taoJob();
    expect(await suKien(id, false)).toEqual([{ tu: null, sang: 'cho_in', ma: null, org: ORG, nhan: null }]);
  });

  it('INSERT print_jobs bằng SQL THÔ (bot psycopg / in lại tay) ⇒ trigger ghi đúng MỘT sự kiện tạo', async () => {
    // Đúng câu lệnh bot chạy (lednelia-agent cong_cu_tools.py `_ghi_job_in`) — không đi qua Prisma.
    await prisma.$executeRaw`INSERT INTO print_jobs (id, org_id, conversation_id, hoa_don_id, so_hoa_don, report, agent_token, trang_thai, lan_thu, created_at, updated_at)
      VALUES ('psk-raw-1', ${ORG}, NULL, 7, 'INV/RAW1', 'r', NULL, 'cho_in', 0, now(), now())`;
    expect(await suKien('psk-raw-1', false)).toEqual([{ tu: null, sang: 'cho_in', ma: null, org: ORG, nhan: null }]);
    // Trạng thái lạ (ngoài CHECK của print_su_kien) KHÔNG được làm hỏng việc tạo job — chỉ không có sự kiện.
    await prisma.$executeRaw`INSERT INTO print_jobs (id, org_id, hoa_don_id, so_hoa_don, report, trang_thai, lan_thu, updated_at)
      VALUES ('psk-raw-2', ${ORG}, 8, 'INV/RAW2', 'r', 'trang_thai_la', 0, now())`;
    expect(await prisma.printJob.count({ where: { id: 'psk-raw-2' } })).toBe(1);
    expect(await suKien('psk-raw-2', false)).toEqual([]);
  });

  it('trigger ghi `luc` theo giờ UTC như Prisma — đúng cả khi phiên DB đặt múi giờ khác (không lệch 7 giờ)', async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL TimeZone = 'Asia/Ho_Chi_Minh'`;
      await tx.$executeRaw`INSERT INTO print_jobs (id, org_id, hoa_don_id, so_hoa_don, report, trang_thai, lan_thu, updated_at)
        VALUES ('psk-raw-tz', ${ORG}, 9, 'INV/TZ', 'r', 'cho_in', 0, now())`;
    });
    const e = await prisma.printSuKien.findFirstOrThrow({ where: { jobId: 'psk-raw-tz' } });
    expect(Math.abs(e.luc.getTime() - Date.now())).toBeLessThan(60_000);
  });

  it('app in xong (kênh đồng bộ): cho_in → dang_gui → da_in, mỗi bước MỘT sự kiện', async () => {
    const id = await taoJob();
    await chayMotLuotIn(deps(client({ daInXong: true })));
    expect(await suKien(id)).toEqual([
      { tu: 'cho_in', sang: 'dang_gui', ma: null, org: ORG, nhan: null },
      { tu: 'dang_gui', sang: 'da_in', ma: null, org: ORG, nhan: null },
    ]);
  });

  it('IPP: dang_gui → da_gui, lượt sau xác minh completed ⇒ da_in; job khác canceled ⇒ loi', async () => {
    const a = await taoJob();
    await chayMotLuotIn(deps(client({ jobId: 41 })));
    expect((await suKien(a)).map((e) => e.sang)).toEqual(['dang_gui', 'da_gui']);
    await chayMotLuotIn(deps(client({}, JOB_STATE.completed)));
    expect((await suKien(a)).at(-1)).toMatchObject({ tu: 'da_gui', sang: 'da_in' });

    const b = await taoJob({ trangThai: 'khong_ro', ippJobId: 42 });
    await chayMotLuotIn(deps(client({}, JOB_STATE.canceled)));
    expect(await suKien(b)).toEqual([{ tu: 'khong_ro', sang: 'loi', ma: 'may_in_huy_job', org: ORG, nhan: null }]);
  });

  it('các nhánh lỗi: quá lượt ⇒ loi, app offline / Odoo hỏng ⇒ cho_in (thử lại), không rõ ⇒ khong_ro, IPP từ chối ⇒ cho_in', async () => {
    const quaLuot = await taoJob({ lanThu: MAX_LAN_THU });
    await chayMotLuotIn(deps(client({ daInXong: true })));
    expect(await suKien(quaLuot)).toEqual([{ tu: 'cho_in', sang: 'loi', ma: 'qua_lan_thu', org: ORG, nhan: null }]);

    const offline = await taoJob();
    await chayMotLuotIn(deps(client({ daInXong: true }), { coMay: () => false }));
    expect(await suKien(offline)).toEqual([{ tu: 'cho_in', sang: 'cho_in', ma: 'app_offline', org: ORG, nhan: null }]);
    await prisma.printJob.update({ where: { id: offline }, data: { trangThai: 'loi' } }); // ra khỏi lượt sau

    const odoo = await taoJob();
    await chayMotLuotIn(deps(client({ daInXong: true }), { taiPdf: async () => { throw new Error('odoo 502'); } }));
    expect(await suKien(odoo)).toEqual([{ tu: 'cho_in', sang: 'cho_in', ma: 'odoo_pdf', org: ORG, nhan: null }]);
    await prisma.printJob.update({ where: { id: odoo }, data: { trangThai: 'loi' } });

    const khongRo = await taoJob();
    await chayMotLuotIn(deps(client(new LoiKhongRo('app im', 'het_gio_cho'))));
    expect(await suKien(khongRo)).toEqual([
      { tu: 'cho_in', sang: 'dang_gui', ma: null, org: ORG, nhan: null },
      { tu: 'dang_gui', sang: 'khong_ro', ma: 'het_gio_cho', org: ORG, nhan: null },
    ]);

    const tuChoi = await taoJob();
    await chayMotLuotIn(deps(client(new LoiIpp('hết giấy', true, undefined, 'het_giay'))));
    expect((await suKien(tuChoi)).at(-1)).toEqual({ tu: 'dang_gui', sang: 'cho_in', ma: 'het_giay', org: ORG, nhan: null });
  });

  it('huỷ CHEN GIỮA lúc tải PDF ⇒ claim count 0 ⇒ chỉ sự kiện da_huy, KHÔNG có dang_gui/da_in', async () => {
    const id = await taoJob();
    const ghiNhatKy = vi.fn();
    const taiPdf = async () => {
      await huyLenhIn({ loai: 'org', orgId: ORG }, [id], { loai: 'crm', ten: 'Chủ' }, {
        prisma: prisma as unknown as PrismaHangDoiHuy, registry: { layCauDao: () => null, coAgent: () => false }, ghiNhatKy, tokenMacDinh: null,
      });
      return Buffer.from('%PDF');
    };
    const inPdf = vi.fn();
    await chayMotLuotIn({ prisma: p, client: { inPdf, traTrangThaiJob: vi.fn() } as unknown as ClientMayIn, taiPdf });
    expect(inPdf).not.toHaveBeenCalled();
    expect(await suKien(id)).toEqual([{ tu: 'cho_in', sang: 'da_huy', ma: null, org: ORG, nhan: null }]);
  });

  it('UPDATE có điều kiện không khớp ⇒ 0, không sự kiện; hai bên giành cùng job ⇒ đúng MỘT sự kiện', async () => {
    const id = await taoJob({ trangThai: 'da_huy' });
    const n = await capNhatJobCoSuKien(prisma as unknown as PrismaSuKienIn, {
      id, where: { id, trangThai: 'cho_in' }, data: { trangThai: 'dang_gui' },
    });
    expect(n).toBe(0);
    expect(await suKien(id)).toEqual([]);

    const tranh = await taoJob();
    const kq = await Promise.all([1, 2, 3].map(() => capNhatJobCoSuKien(prisma as unknown as PrismaSuKienIn, {
      id: tranh, where: { id: tranh, trangThai: 'cho_in' }, data: { trangThai: 'dang_gui' },
    })));
    expect(kq.sort()).toEqual([0, 0, 1]);
    expect(await suKien(tranh)).toEqual([{ tu: 'cho_in', sang: 'dang_gui', ma: null, org: ORG, nhan: null }]);
  });

  it('kết quả TRỄ: khong_ro → da_in một sự kiện; sau khi bị huỷ/bỏ theo dõi ⇒ không đổi, không sự kiện', async () => {
    const id = await taoJob({ trangThai: 'khong_ro' });
    expect(await capNhatJobTreThat(id, { trangThai: 'da_in' }, null)).toBe(1);
    expect(await suKien(id)).toEqual([{ tu: 'khong_ro', sang: 'da_in', ma: null, org: ORG, nhan: null }]);

    const thuLai = await taoJob({ trangThai: 'khong_ro', lanThu: 1 });
    expect(await capNhatJobTreThat(thuLai, { trangThai: 'thu_lai', tangLanThu: true }, 'Hết giấy', { maLoi: 'het_giay' })).toBe(1);
    expect(await suKien(thuLai)).toEqual([{ tu: 'khong_ro', sang: 'cho_in', ma: 'het_giay', org: ORG, nhan: null }]);
    expect((await prisma.printJob.findUniqueOrThrow({ where: { id: thuLai } })).lanThu).toBe(2);

    // Bỏ theo dõi (khong_ro → bo_qua) rồi kết quả trễ tới.
    const bo = await taoJob({ trangThai: 'khong_ro' });
    const kqBo = await boTheoDoi({ loai: 'org', orgId: ORG }, [bo], { loai: 'crm', ten: 'Chủ' }, {
      prisma: prisma as unknown as PrismaHangDoiHuy, registry: { layCauDao: () => null, coAgent: () => false }, ghiNhatKy: vi.fn(), tokenMacDinh: null,
    });
    expect(kqBo[0].ok).toBe(true);
    expect(await capNhatJobTreThat(bo, { trangThai: 'da_in' }, null)).toBe(0);
    expect(await suKien(bo)).toEqual([{ tu: 'khong_ro', sang: 'bo_qua', ma: null, org: ORG, nhan: null }]);

    // Huỷ (cho_in → da_huy) rồi kết quả trễ `loi` tới (kể cả cho phép dang_gui) ⇒ không đổi.
    const huy = await taoJob();
    await huyLenhIn({ loai: 'org', orgId: ORG }, [huy], { loai: 'crm', ten: 'Chủ' }, {
      prisma: prisma as unknown as PrismaHangDoiHuy, registry: { layCauDao: () => null, coAgent: () => false }, ghiNhatKy: vi.fn(), tokenMacDinh: null,
    });
    expect(await capNhatJobTreThat(huy, { trangThai: 'loi' }, 'x', { choPhepDangGui: true })).toBe(0);
    expect(await suKien(huy)).toEqual([{ tu: 'cho_in', sang: 'da_huy', ma: null, org: ORG, nhan: null }]);
  });

  it('huỷ lặp / bỏ theo dõi lặp ⇒ vẫn MỘT sự kiện; huỷ ngoài phạm vi org ⇒ không sự kiện', async () => {
    const d = { prisma: prisma as unknown as PrismaHangDoiHuy, registry: { layCauDao: () => null, coAgent: () => false }, ghiNhatKy: vi.fn(), tokenMacDinh: null };
    const id = await taoJob();
    await huyLenhIn({ loai: 'org', orgId: ORG }, [id, id], { loai: 'crm', ten: 'Chủ' }, d);
    expect(await suKien(id)).toHaveLength(1);
    const khac = await taoJob({ org: ORG2 });
    const kq = await huyLenhIn({ loai: 'org', orgId: ORG }, [khac], { loai: 'crm', ten: 'Chủ' }, d);
    expect(kq[0].ok).toBe(false);
    expect(await suKien(khac)).toEqual([]);
    expect((await suKien(khac, false))[0]).toMatchObject({ org: ORG2, sang: 'cho_in' });
  });

  it('phục hồi sau khởi động lại: job mồ côi dang_gui nhận kết quả trễ ⇒ tu = dang_gui (đọc từ dòng đã khoá)', async () => {
    const id = await taoJob({ trangThai: 'dang_gui' });
    expect(await capNhatJobTreThat(id, { trangThai: 'da_in' }, null, { choPhepDangGui: true })).toBe(1);
    expect(await suKien(id)).toEqual([{ tu: 'dang_gui', sang: 'da_in', ma: null, org: ORG, nhan: null }]);
  });

  it('dọn mồ côi: dang_gui quá hạn ⇒ khong_ro (mo_coi); job mới ⇒ không đụng', async () => {
    const cu = await taoJob({ trangThai: 'dang_gui', updatedAt: new Date(Date.now() - MS_JOB_MO_COI - 60_000) });
    const moi = await taoJob({ trangThai: 'dang_gui' });
    expect(await donJobMoCoi({ prisma: p })).toBe(1);
    expect(await suKien(cu)).toEqual([{ tu: 'dang_gui', sang: 'khong_ro', ma: 'mo_coi', org: ORG, nhan: null }]);
    expect(await suKien(moi)).toEqual([]);
  });

  it('cầu dao ngắt khi app báo hết giấy ⇒ print_su_co tam_giu (bền) — một lần mỗi lần ngắt mới', async () => {
    await prisma.printAgent.create({ data: { orgId: ORG, ten: 'Máy HN', token: TOKEN, warehouseIds: [2] } });
    const a = await taoJob();
    await prisma.printJob.update({ where: { id: a }, data: { agentToken: TOKEN } });
    let ngat = 0;
    await chayMotLuotIn(deps(client(new LoiIpp('hết giấy', true, undefined, 'het_giay')), {
      cauDao: { xet: () => 'gui', ngat: () => ({ moi: ngat++ === 0 }) },
      ghiSuCo: (sc) => ghiSuCoIn(sc),
    }));
    const sc = await prisma.printSuCo.findMany({ where: { orgId: ORG } });
    expect(sc).toHaveLength(1);
    expect(sc[0]).toMatchObject({ maSuCo: 'tam_giu', maGoc: 'het_giay', mayInTen: 'Máy HN', printJobId: a, botNhanLuc: null });
    expect(JSON.stringify(sc[0], (_k, v) => (typeof v === "bigint" ? String(v) : v))).not.toContain(TOKEN);
  });

  it('ghiSuCoIn: su-co của app ⇒ một dòng, che token trong chi tiết; không biết org ⇒ không ghi, không ném', async () => {
    await prisma.printAgent.create({ data: { orgId: ORG, ten: 'Máy HCM', token: TOKEN, warehouseIds: [3] } });
    expect(await ghiSuCoIn({ maSuCo: 'ket_giay', agentToken: TOKEN, chiTiet: `khay 2 ${TOKEN}` })).toBe('da_luu');
    const r = await prisma.printSuCo.findFirstOrThrow({ where: { orgId: ORG } });
    expect(r).toMatchObject({ maSuCo: 'ket_giay', mayInTen: 'Máy HCM', maGoc: null });
    expect(r.chiTiet).toContain('khay 2');
    expect(r.chiTiet).not.toContain(TOKEN);
    expect(await ghiSuCoIn({ maSuCo: 'het_giay', agentToken: 'token-la' }, { orgMacDinh: () => null })).toBe('khong_luu');
  });

  it('gộp theo (máy, mã) trong 10 phút: lặp ⇒ một dòng (kể cả không có job); hồi phục chen giữa ⇒ ghi lại; quá 10 phút ⇒ ghi lại; máy khác ⇒ riêng', async () => {
    await prisma.printAgent.create({ data: { orgId: ORG, ten: 'Máy HN', token: TOKEN, warehouseIds: [2] } });
    await prisma.printAgent.create({ data: { orgId: ORG, ten: 'Máy HCM', token: `${TOKEN}-hcm`, warehouseIds: [3] } });
    expect(await ghiSuCoIn({ maSuCo: 'het_giay', agentToken: TOKEN })).toBe('da_luu');
    expect(await ghiSuCoIn({ maSuCo: 'het_giay', agentToken: TOKEN, printJobId: 'j2' })).toBe('trung');
    expect(await ghiSuCoIn({ maSuCo: 'het_giay', agentToken: `${TOKEN}-hcm` })).toBe('da_luu');
    expect(await ghiSuCoIn({ maSuCo: 'ket_giay', agentToken: TOKEN })).toBe('da_luu'); // mã khác ⇒ riêng
    // Hồi phục rồi hết giấy lại ⇒ sự cố MỚI.
    expect(await ghiSuCoIn({ maSuCo: 'het_su_co', maGoc: 'het_giay', agentToken: TOKEN })).toBe('da_luu');
    expect(await ghiSuCoIn({ maSuCo: 'het_su_co', maGoc: 'het_giay', agentToken: TOKEN })).toBe('trung'); // hồi phục lặp
    expect(await ghiSuCoIn({ maSuCo: 'het_giay', agentToken: TOKEN })).toBe('da_luu');
    // Quá 10 phút không có hồi phục ⇒ ghi lại (không chặn mãi).
    await prisma.$executeRaw`UPDATE print_su_co SET luc = luc - interval '11 minutes' WHERE org_id = ${ORG}`;
    expect(await ghiSuCoIn({ maSuCo: 'het_giay', agentToken: TOKEN })).toBe('da_luu');
    const hn = await prisma.printSuCo.findMany({ where: { orgId: ORG, mayInTen: 'Máy HN' }, orderBy: { id: 'asc' } });
    expect(hn.map((r) => r.maSuCo)).toEqual(['het_giay', 'ket_giay', 'het_su_co', 'het_giay', 'het_giay']);
    // Ghi song song cùng (máy, mã) ⇒ đúng MỘT dòng (khoá advisory).
    await prisma.printSuCo.deleteMany({ where: { orgId: ORG } });
    const kq = await Promise.all([1, 2, 3, 4].map(() => ghiSuCoIn({ maSuCo: 'mo_nap', agentToken: TOKEN })));
    expect(kq.filter((k) => k === 'da_luu')).toHaveLength(1);
    expect(await prisma.printSuCo.count({ where: { orgId: ORG, maSuCo: 'mo_nap' } })).toBe(1);
  });

  it('nhom_su_co: su-co het_giay, tam_giu (ma_goc het_giay) và hồi phục của nó là MỘT sự cố', async () => {
    await prisma.printAgent.create({ data: { orgId: ORG, ten: 'Máy HN', token: TOKEN, warehouseIds: [2] } });
    await ghiSuCoIn({ maSuCo: 'het_giay', agentToken: TOKEN });
    await ghiSuCoIn({ maSuCo: 'tam_giu', maGoc: 'het_giay', agentToken: TOKEN, printJobId: 'j1' });
    await ghiSuCoIn({ maSuCo: 'tiep_tuc_in', maGoc: 'het_giay', agentToken: TOKEN });
    await ghiSuCoIn({ maSuCo: 'tam_giu', maGoc: null, agentToken: TOKEN }); // app không trả lời
    const r = await prisma.printSuCo.findMany({ where: { orgId: ORG }, orderBy: { id: 'asc' } });
    expect(r.map((x) => [x.maSuCo, x.nhomSuCo])).toEqual([
      ['het_giay', 'het_giay'], ['tam_giu', 'het_giay'], ['tiep_tuc_in', 'het_giay'], ['tam_giu', 'khong_ro'],
    ]);
  });

  it('ghiSuCoIn: lỗi DB lần đầu ⇒ chờ 200 ms rồi thử lại một lần; vẫn lỗi ⇒ loi_db (CHƯA lưu — khác khong_luu), không ném', async () => {
    const cho = vi.fn(async () => undefined);
    let lan = 0;
    const gia = {
      printAgent: { findUnique: async () => null },
      printSuCo: { create: async () => { if (lan++ === 0) throw new Error('chập'); return {}; } },
    };
    expect(await ghiSuCoIn({ maSuCo: 'het_giay', orgId: ORG }, { prisma: gia, cho })).toBe('da_luu');
    expect(cho).toHaveBeenCalledWith(200);
    const hong = { ...gia, printSuCo: { create: async () => { throw new Error('chết'); } } };
    expect(await ghiSuCoIn({ maSuCo: 'het_giay', orgId: ORG }, { prisma: hong, cho })).toBe('loi_db');
  });

  // ── Codex v1 #4: MỌI đổi trạng thái sinh sự kiện ở DB (trigger UPDATE), không chỉ đường qua helper ──
  it('UPDATE trạng thái bằng SQL THÔ (tay/script) ⇒ đúng MỘT sự kiện, tu/sang đúng, không ma_loi', async () => {
    const id = await taoJob();
    await prisma.$executeRaw`UPDATE print_jobs SET trang_thai = 'da_huy' WHERE id = ${id}`;
    expect(await suKien(id)).toEqual([{ tu: 'cho_in', sang: 'da_huy', ma: null, org: ORG, nhan: null }]);
    // Không đổi trạng thái (chỉ cột khác / gán lại đúng giá trị cũ, không mã) ⇒ KHÔNG có sự kiện.
    await prisma.$executeRaw`UPDATE print_jobs SET lan_thu = lan_thu + 1 WHERE id = ${id}`;
    await prisma.$executeRaw`UPDATE print_jobs SET trang_thai = 'da_huy' WHERE id = ${id}`;
    expect(await suKien(id)).toHaveLength(1);
  });

  it('mã CŨ (updateMany trơn, không qua helper — bản image lùi) ⇒ sự kiện vẫn có, ma_loi null', async () => {
    const id = await taoJob();
    expect((await prisma.printJob.updateMany({ where: { id, trangThai: 'cho_in' }, data: { trangThai: 'dang_gui' } })).count).toBe(1);
    expect(await suKien(id)).toEqual([{ tu: 'cho_in', sang: 'dang_gui', ma: null, org: ORG, nhan: null }]);
  });

  it('helper: mỗi lần đổi đúng MỘT sự kiện kèm ma_loi (kể cả thử lại cho_in → cho_in); ma_loi không rò sang giao dịch sau', async () => {
    const id = await taoJob();
    const ps = prisma as unknown as PrismaSuKienIn;
    expect(await capNhatJobCoSuKien(ps, { id, where: { id, trangThai: 'cho_in' }, data: { trangThai: 'cho_in', lanThu: 1 }, maLoi: 'app_offline' })).toBe(1);
    expect(await capNhatJobCoSuKien(ps, { id, where: { id, trangThai: 'cho_in' }, data: { trangThai: 'dang_gui' } })).toBe(1);
    expect(await capNhatJobCoSuKien(ps, { id, where: { id, trangThai: 'dang_gui' }, data: { trangThai: 'khong_ro' }, maLoi: 'het_gio_cho' })).toBe(1);
    // UPDATE trơn ngay sau (giao dịch khác, có thể cùng kết nối) ⇒ KHÔNG mang mã của lần trước.
    await prisma.$executeRaw`UPDATE print_jobs SET trang_thai = 'loi' WHERE id = ${id}`;
    expect(await suKien(id)).toEqual([
      { tu: 'cho_in', sang: 'cho_in', ma: 'app_offline', org: ORG, nhan: null },
      { tu: 'cho_in', sang: 'dang_gui', ma: null, org: ORG, nhan: null },
      { tu: 'dang_gui', sang: 'khong_ro', ma: 'het_gio_cho', org: ORG, nhan: null },
      { tu: 'khong_ro', sang: 'loi', ma: null, org: ORG, nhan: null },
    ]);
  });

  it('UPDATE trạng thái bị ROLLBACK ⇒ sự kiện cũng mất (cùng giao dịch)', async () => {
    const id = await taoJob();
    await expect(prisma.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE print_jobs SET trang_thai = 'da_huy' WHERE id = ${id}`;
      throw new Error('huỷ giao dịch');
    })).rejects.toThrow('huỷ giao dịch');
    expect(await suKien(id)).toEqual([]);
    expect((await prisma.printJob.findUniqueOrThrow({ where: { id } })).trangThai).toBe('cho_in');
  });

  // ── Codex v1 #6: hàm trigger không bị bảng TẠM cùng tên bắt mất dòng ──
  it('bảng TẠM tên print_su_kien của người gọi KHÔNG bắt được dòng của trigger (tạo + đổi trạng thái)', async () => {
    const id = 'psk-temp-1';
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`CREATE TEMP TABLE print_su_kien (LIKE public.print_su_kien INCLUDING DEFAULTS) ON COMMIT DROP`);
      await tx.$executeRawUnsafe(`SET LOCAL search_path = pg_temp, public`);
      await tx.$executeRaw`INSERT INTO print_jobs (id, org_id, hoa_don_id, so_hoa_don, report, trang_thai, lan_thu, updated_at)
        VALUES (${id}, ${ORG}, 9, 'INV/TEMP', 'r', 'cho_in', 0, now())`;
      await tx.$executeRaw`UPDATE print_jobs SET trang_thai = 'da_huy' WHERE id = ${id}`;
      const tam = (await tx.$queryRawUnsafe(`SELECT count(*)::int AS n FROM pg_temp.print_su_kien`)) as Array<{ n: number }>;
      expect(tam[0].n).toBe(0);
    });
    expect(await suKien(id, false)).toEqual([
      { tu: null, sang: 'cho_in', ma: null, org: ORG, nhan: null },
      { tu: 'cho_in', sang: 'da_huy', ma: null, org: ORG, nhan: null },
    ]);
  });

  it('hàm trigger: SECURITY DEFINER + search_path cố định (pg_catalog, public, pg_temp) + bảng ghi đủ schema', async () => {
    const r = (await prisma.$queryRaw`
      SELECT p.proname, p.prosecdef, p.proconfig, pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_trigger t ON t.tgfoid = p.oid
      WHERE t.tgrelid = 'public.print_jobs'::regclass AND NOT t.tgisinternal AND t.tgname LIKE 'print_jobs_su_kien%'`) as Array<{
      proname: string; prosecdef: boolean; proconfig: string[] | null; def: string;
    }>;
    expect(r.length).toBeGreaterThanOrEqual(2); // AFTER INSERT + AFTER UPDATE OF trang_thai
    for (const f of r) {
      expect(f.prosecdef).toBe(true);
      expect(f.proconfig).toEqual(['search_path=pg_catalog, public, pg_temp']);
      expect(f.def).toContain('public.print_su_kien');
    }
  });

  // ── Codex v1 #5: `luc` là timestamptz — đúng dù múi giờ phiên DB là Asia/Ho_Chi_Minh ──
  it('cột luc/bot_nhan_luc của print_su_kien + print_su_co là timestamptz', async () => {
    const r = (await prisma.$queryRaw`
      SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE table_name IN ('print_su_kien', 'print_su_co') AND column_name IN ('luc', 'bot_nhan_luc')
      ORDER BY table_name, column_name`) as Array<{ table_name: string; column_name: string; data_type: string }>;
    expect(r).toHaveLength(4);
    for (const c of r) expect(c.data_type).toBe('timestamp with time zone');
  });

  it('múi giờ MẶC ĐỊNH của DB = Asia/Ho_Chi_Minh: client CRM vẫn phiên UTC; helper + trigger ghi luc đúng giờ thật; cửa sổ gộp 10 phút đúng', async () => {
    const { PrismaClient } = await import('@prisma/client');
    const { taoAdapterPg } = await import('../src/shared/database/prisma-client.js');
    const db = (await prisma.$queryRaw`SELECT current_database() AS d`) as Array<{ d: string }>;
    const cachGiay = async (where: 'su_kien' | 'su_co') => {
      const r = (where === 'su_kien'
        ? await prisma.$queryRaw`SELECT extract(epoch FROM now() - max(luc))::float8 AS s FROM print_su_kien WHERE org_id = ${ORG} AND tu_trang_thai IS NOT NULL`
        : await prisma.$queryRaw`SELECT extract(epoch FROM now() - max(luc))::float8 AS s FROM print_su_co WHERE org_id = ${ORG}`) as Array<{ s: number }>;
      return Math.abs(r[0].s);
    };
    await prisma.$executeRawUnsafe(`ALTER DATABASE "${db[0].d}" SET timezone = 'Asia/Ho_Chi_Minh'`);
    // Client MỚI (kết nối mới nhận mặc định HCM của DB) dựng ĐÚNG như client của CRM.
    const crm = new PrismaClient({ adapter: taoAdapterPg(process.env.DATABASE_URL!) });
    try {
      const tz = (await crm.$queryRaw`SHOW timezone`) as Array<{ TimeZone: string }>;
      expect(tz[0].TimeZone).toBe('UTC');
      // Đường helper (trigger UPDATE) qua client CRM.
      const id = await taoJob();
      expect(await capNhatJobCoSuKien(crm as unknown as PrismaSuKienIn, {
        id, where: { id, trangThai: 'cho_in' }, data: { trangThai: 'dang_gui' },
      })).toBe(1);
      expect(await cachGiay('su_kien')).toBeLessThan(60);
      const e = await crm.printSuKien.findFirstOrThrow({ where: { jobId: id, tuTrangThai: 'cho_in' } });
      expect(Math.abs(e.luc.getTime() - Date.now())).toBeLessThan(60_000);
      // Sự cố: ghi + gộp + quá cửa sổ.
      const d = { prisma: crm as unknown as PrismaSuCoIn };
      expect(await ghiSuCoIn({ maSuCo: 'het_giay', orgId: ORG }, d)).toBe('da_luu');
      expect(await cachGiay('su_co')).toBeLessThan(60);
      expect(await ghiSuCoIn({ maSuCo: 'het_giay', orgId: ORG }, d)).toBe('trung');
      await prisma.$executeRaw`UPDATE print_su_co SET luc = luc - interval '11 minutes' WHERE org_id = ${ORG}`;
      expect(await ghiSuCoIn({ maSuCo: 'het_giay', orgId: ORG }, d)).toBe('da_luu');
    } finally {
      await crm.$disconnect();
      await prisma.$executeRawUnsafe(`ALTER DATABASE "${db[0].d}" RESET timezone`);
    }
  });

  it('writer SQL thô trong phiên Asia/Ho_Chi_Minh (bot psycopg / SQL tay): DEFAULT luc + trigger đúng giờ thật; CRM coi là trong cửa sổ', async () => {
    await prisma.printJob.deleteMany({ where: { id: 'psk-hcm-raw' } });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL TimeZone = 'Asia/Ho_Chi_Minh'`;
      await tx.$executeRaw`INSERT INTO print_jobs (id, org_id, hoa_don_id, so_hoa_don, report, trang_thai, lan_thu, updated_at)
        VALUES ('psk-hcm-raw', ${ORG}, 9, 'INV/HCM', 'r', 'cho_in', 0, now())`;
      await tx.$executeRaw`UPDATE print_jobs SET trang_thai = 'da_huy' WHERE id = 'psk-hcm-raw'`;
      await tx.$executeRaw`INSERT INTO print_su_co (org_id, ma_su_co, nhom_su_co) VALUES (${ORG}, 'ket_giay', 'ket_giay')`;
    });
    const r = (await prisma.$queryRaw`
      SELECT max(abs(extract(epoch FROM now() - luc)))::float8 AS s FROM (
        SELECT luc FROM print_su_kien WHERE job_id = 'psk-hcm-raw' UNION ALL SELECT luc FROM print_su_co WHERE org_id = ${ORG}) x`) as Array<{ s: number }>;
    expect(r[0].s).toBeLessThan(60);
    expect(await ghiSuCoIn({ maSuCo: 'ket_giay', orgId: ORG })).toBe('trung');
  });

  it('TRANG_THAI_JOB (TypeScript) == danh sách CHECK print_su_kien_sang_trang_thai_check trên DB', async () => {
    const r = (await prisma.$queryRaw`
      SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'print_su_kien_sang_trang_thai_check'`) as Array<{ d: string }>;
    expect(r).toHaveLength(1);
    const trenDb = [...r[0].d.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(trenDb).toEqual([...TRANG_THAI_JOB].sort());
  });

  it('dọn 30 ngày: chỉ xoá dòng BOT ĐÃ NHẬN và cũ hơn 30 ngày (print_su_kien + print_su_co); chưa nhận thì giữ', async () => {
    const cu = new Date(Date.now() - 31 * 24 * 3600 * 1000);
    const moi = new Date();
    const id = await taoJob();
    await prisma.printSuKien.createMany({ data: [
      { orgId: ORG, jobId: id, sangTrangThai: 'da_in', luc: cu, botNhanLuc: cu },       // xoá
      { orgId: ORG, jobId: id, sangTrangThai: 'loi', luc: cu, botNhanLuc: null },       // giữ — bot chưa nhận
      { orgId: ORG, jobId: id, sangTrangThai: 'da_gui', luc: moi, botNhanLuc: moi },    // giữ — mới
    ] });
    await prisma.printSuCo.createMany({ data: [
      { orgId: ORG, maSuCo: 'het_giay', nhomSuCo: 'het_giay', luc: cu, botNhanLuc: cu }, // xoá
      { orgId: ORG, maSuCo: 'ket_giay', nhomSuCo: 'ket_giay', luc: cu, botNhanLuc: null }, // giữ
    ] });
    expect(await donSuKienDaNhan(30)).toEqual({ suKien: 1, suCo: 1 });
    expect((await prisma.printSuKien.findMany({ where: { jobId: id } })).map((e) => e.sangTrangThai).sort()).toEqual(['cho_in', 'da_gui', 'loi']);
    expect((await prisma.printSuCo.findMany({ where: { orgId: ORG } })).map((e) => e.maSuCo)).toEqual(['ket_giay']);
  });
});
