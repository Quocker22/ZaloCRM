// SPDX-License-Identifier: AGPL-3.0-or-later
// Hàng đợi in + huỷ lệnh in (huy-lenh-in.ts) — hợp đồng hàng đợi/huỷ v5.1 §8.2, §8.5, §8.6:
// huỷ CHỈ là DB có điều kiện (cho_in → da_huy), mọi nhánh kết quả, phạm vi REST (org) vs
// socket (chính máy đó), nhật ký một dòng mỗi yêu cầu kèm nguồn, bỏ theo dõi CHỈ khong_ro,
// hàng đợi hai nhóm + tên khách + tên máy (KHÔNG token) + tạm giữ/lý do.
import { describe, it, expect, vi } from 'vitest';
import {
  huyLenhIn,
  boTheoDoi,
  layHangDoi,
  NOI_DUNG_HUY,
  NOI_DUNG_BO_THEO_DOI,
  MS_CHUA_XAC_NHAN,
  type DepsHangDoi,
  type PhamViHangDoi,
} from '../../../src/modules/ai/may-in/huy-lenh-in.js';
import { mucDoCua, type MucNhatKy } from '../../../src/modules/ai/may-in/nhat-ky.js';
import type { CauDao } from '../../../src/modules/ai/may-in/agent-registry.js';
import { khopWhere, printJobGia } from './prisma-gia-hang-doi.js';

const HN = 'tokHN_bi_mat_khong_duoc_lo_9x7';   // máy mặc định (env)
const HCM = 'tokHCM_bi_mat_rat_dai_1234567';
const BAY_GIO = Date.parse('2026-09-25T12:00:00.000Z'); // 19:00 giờ VN
const CRM = { loai: 'crm', ten: 'Chị Hoa' } as const;
const ORG1: PhamViHangDoi = { loai: 'org', orgId: 'org1' };

type Dong = Record<string, any>;
let dem = 0;
function job(them: Dong = {}): Dong {
  dem += 1;
  return {
    id: `pj${dem}`, orgId: 'org1', soHoaDon: `INV/2026/0300${String(dem).padStart(2, '0')}`, trangThai: 'cho_in',
    lanThu: 0, loiCuoi: null, ippJobId: null, agentToken: HN,
    createdAt: new Date(BAY_GIO - 60 * 60_000 + dem * 1000), updatedAt: new Date(BAY_GIO - 60_000), ...them,
  };
}

function dung(jobs: Dong[], tuy: { logs?: Dong[]; agents?: Dong[]; cauDao?: Record<string, CauDao>; online?: string[]; tokenMacDinh?: string | null } = {}) {
  const hang = jobs;
  const pj = printJobGia(hang);
  const logs = tuy.logs ?? [];
  const agents = tuy.agents ?? [
    { id: 'mayHN', orgId: 'org1', ten: 'Máy HN', token: HN },
    { id: 'mayHCM', orgId: 'org1', ten: 'Máy HCM', token: HCM },
  ];
  const chon = (x: Dong, select?: Dong) => (select ? Object.fromEntries(Object.keys(select).map((k) => [k, x[k]])) : { ...x });
  const prisma = {
    printJob: pj,
    printLog: {
      findMany: vi.fn(async (a: Dong) => logs
        .filter((l) => khopWhere(l, a.where))
        .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())
        .map((l) => chon(l, a.select))),
      findFirst: vi.fn(async (a: Dong) => {
        const l = logs.find((x) => khopWhere(x, a.where));
        return l ? chon(l, a.select) : null;
      }),
    },
    printAgent: {
      findMany: vi.fn(async (a: Dong) => agents.filter((m) => khopWhere(m, a.where)).map((m) => chon(m, a.select))),
      findFirst: vi.fn(async (a: Dong) => {
        const m = agents.find((x) => khopWhere(x, a.where));
        return m ? chon(m, a.select) : null;
      }),
    },
  };
  const nhatKy: MucNhatKy[] = [];
  // Như singleton thật: `ghi` + `ghi.cho` (chờ ghi xong). Dòng ghi vào cả `logs` để lần tra sau thấy.
  const ghiNhatKy = Object.assign((m: MucNhatKy) => {
    nhatKy.push(m);
    logs.push({ printJobId: m.printJobId ?? null, loai: m.loai, tenKhach: m.tenKhach ?? null, createdAt: new Date() });
  }, {
    cho: vi.fn(async (m: MucNhatKy) => {
      ghiNhatKy(m);
      return true;
    }),
  });
  const baoDoiHangDoi = vi.fn();
  const registry = {
    layCauDao: (t: string) => tuy.cauDao?.[t] ?? null,
    coAgent: (t: string) => (tuy.online ?? [HN, HCM]).includes(t),
    baoDoiHangDoi,
  };
  const deps: DepsHangDoi = {
    prisma: prisma as never, ghiNhatKy, registry,
    tokenMacDinh: tuy.tokenMacDinh === undefined ? HN : tuy.tokenMacDinh, bayGio: () => BAY_GIO,
  };
  return { hang, pj, prisma, nhatKy, logs, baoDoiHangDoi, deps };
}

describe('huyLenhIn — cho_in → da_huy CÓ ĐIỀU KIỆN', () => {
  it('cho_in → ok, cach chua_gui, trạng thái da_huy; MỘT dòng nhật ký `da_huy` kèm nguồn + tên khách; báo snapshot máy đó', async () => {
    const j = job();
    const g = dung([j], { logs: [{ printJobId: j.id, tenKhach: 'Anh Lộc Beco', createdAt: new Date(BAY_GIO - 5000) }] });
    const kq = await huyLenhIn(ORG1, [j.id], CRM, g.deps);
    expect(kq).toEqual([{ id: j.id, soHoaDon: j.soHoaDon, ok: true, trangThaiMoi: 'da_huy', cach: 'chua_gui', noiDung: 'Đã huỷ — hoá đơn chắc chắn không in' }]);
    expect(g.hang[0]).toMatchObject({ trangThai: 'da_huy', loiCuoi: 'Đã huỷ bởi ZaloCRM (Chị Hoa)' });
    expect(g.pj.updateMany.mock.calls[0][0].where).toEqual({ AND: [{ id: j.id, trangThai: 'cho_in' }, { orgId: 'org1' }] });
    expect(g.nhatKy).toHaveLength(1);
    expect(g.nhatKy[0]).toMatchObject({
      loai: 'da_huy', orgId: 'org1', printJobId: j.id, soHoaDon: j.soHoaDon, tenKhach: 'Anh Lộc Beco', agentToken: HN,
      noiDung: `Đã huỷ lệnh in hoá đơn ${j.soHoaDon} — chắc chắn không in (nguồn: ZaloCRM (Chị Hoa))`,
      chiTiet: { nguon: 'crm', cach: 'chua_gui' },
    });
    expect(mucDoCua('da_huy')).toBe('thong_tin');
    expect(g.baoDoiHangDoi).toHaveBeenCalledWith(HN);
  });

  it('bấm hai lần / huỷ đồng thời → lần sau ok `da_huy_truoc`, KHÔNG ghi thêm dòng (không ghi đôi)', async () => {
    const j = job();
    const g = dung([j]);
    await huyLenhIn(ORG1, [j.id], CRM, g.deps);
    const lan2 = await huyLenhIn(ORG1, [j.id], { loai: 'crm', ten: 'Anh Quốc' }, g.deps);
    expect(lan2[0]).toMatchObject({ ok: true, cach: 'da_huy_truoc', trangThaiMoi: 'da_huy', noiDung: NOI_DUNG_HUY.daHuyTruoc });
    expect(g.nhatKy.map((m) => m.loai)).toEqual(['da_huy']);
  });

  const cacNhanh: Array<[string, string, string]> = [
    ['dang_gui', 'DANG_IN', NOI_DUNG_HUY.dangIn],
    ['da_gui', 'DANG_IN', NOI_DUNG_HUY.dangIn],
    ['khong_ro', 'CHUA_XAC_NHAN', NOI_DUNG_HUY.chuaXacNhan],
    ['da_in', 'DA_IN', NOI_DUNG_HUY.daIn],
    ['loi', 'DA_KET_THUC', NOI_DUNG_HUY.loi],
    ['bo_qua', 'DA_KET_THUC', NOI_DUNG_HUY.boQua],
  ];
  for (const [trangThai, loi, noiDung] of cacNhanh) {
    it(`${trangThai} → ok:false ${loi}, trạng thái GIỮ NGUYÊN, một dòng huy_that_bai (cảnh báo)`, async () => {
      const j = job({ trangThai });
      const g = dung([j]);
      const [kq] = await huyLenhIn(ORG1, [j.id], CRM, g.deps);
      expect(kq).toEqual({ id: j.id, soHoaDon: j.soHoaDon, ok: false, trangThaiMoi: trangThai, loi, noiDung });
      expect(g.hang[0].trangThai).toBe(trangThai);
      expect(g.nhatKy).toHaveLength(1);
      expect(g.nhatKy[0].loai).toBe('huy_that_bai');
      expect(g.nhatKy[0].noiDung).toMatch(new RegExp(`^Không huỷ được lệnh in hoá đơn ${j.soHoaDon.replace(/\//g, '\\/')}: .+ \\(nguồn: ZaloCRM \\(Chị Hoa\\)\\)$`));
      expect(g.nhatKy[0].chiTiet).toMatchObject({ nguon: 'crm', loi, trangThai });
      expect(mucDoCua('huy_that_bai')).toBe('canh_bao');
      // Không bao giờ nói "đã huỷ" khi không huỷ.
      expect(`${kq.noiDung} ${g.nhatKy[0].noiDung}`).not.toMatch(/Đã huỷ/);
    });
  }

  it('§8.2 nguyên văn: DANG_IN và CHUA_XAC_NHAN nói rõ việc cần làm', () => {
    expect(NOI_DUNG_HUY.dangIn).toBe('Hoá đơn đang được gửi/in ở máy in — không huỷ được nữa. Nếu không cần tờ này: bỏ tờ in ra.');
    expect(NOI_DUNG_HUY.chuaXacNhan).toContain('tắt máy in 10 giây (MỌI hoá đơn trong bộ nhớ máy sẽ mất)');
    expect(NOI_DUNG_HUY.chuaXacNhan).toContain("Rồi bấm 'Bỏ khỏi hàng đợi'.");
  });

  it('không tồn tại → KHONG_TIM_THAY (trangThaiMoi null), vẫn một dòng huy_that_bai mang org của người gọi', async () => {
    const g = dung([job()]);
    const [kq] = await huyLenhIn(ORG1, ['khongCo123'], CRM, g.deps);
    expect(kq).toEqual({ id: 'khongCo123', soHoaDon: null, ok: false, trangThaiMoi: null, loi: 'KHONG_TIM_THAY', noiDung: NOI_DUNG_HUY.khongTimThay });
    expect(g.nhatKy[0]).toMatchObject({ loai: 'huy_that_bai', orgId: 'org1', printJobId: null, chiTiet: { id: 'khongCo123' } });
    expect(g.baoDoiHangDoi).not.toHaveBeenCalled();
  });

  it('REST: job của ORG KHÁC → KHONG_TIM_THAY, job đó không đổi', async () => {
    const j = job({ orgId: 'org2' });
    const g = dung([j]);
    const [kq] = await huyLenhIn(ORG1, [j.id], CRM, g.deps);
    expect(kq.loi).toBe('KHONG_TIM_THAY');
    expect(g.hang[0].trangThai).toBe('cho_in');
  });

  it('nhiều id: tuần tự, kết quả ĐÚNG THỨ TỰ ids, mỗi id độc lập', async () => {
    const a = job(); const b = job({ trangThai: 'dang_gui' }); const c = job();
    const g = dung([a, b, c]);
    const kq = await huyLenhIn(ORG1, [c.id, 'lạ', b.id, a.id], CRM, g.deps);
    expect(kq.map((k) => [k.id, k.ok, k.loi ?? k.cach])).toEqual([
      [c.id, true, 'chua_gui'], ['lạ', false, 'KHONG_TIM_THAY'], [b.id, false, 'DANG_IN'], [a.id, true, 'chua_gui'],
    ]);
    expect(g.nhatKy.map((m) => m.loai)).toEqual(['da_huy', 'huy_that_bai', 'huy_that_bai', 'da_huy']);
  });

  it('đọc lại thấy job VỪA quay về cho_in (kết quả "thử lại" chen giữa) → thử huỷ lại, không trả DANG_IN oan', async () => {
    const j = job({ trangThai: 'dang_gui' });
    const g = dung([j]);
    const docGoc = g.pj.findFirst.getMockImplementation()!;
    g.pj.findFirst.mockImplementationOnce(async (a) => {
      g.hang[0].trangThai = 'cho_in'; // hàng đợi vừa ghi "thử lại"
      return docGoc(a);
    });
    const [kq] = await huyLenhIn(ORG1, [j.id], CRM, g.deps);
    expect(kq).toMatchObject({ ok: true, cach: 'chua_gui' });
    expect(g.hang[0].trangThai).toBe('da_huy');
    expect(g.pj.updateMany).toHaveBeenCalledTimes(2);
  });

  it('DB lỗi → NÉM (người gọi báo "chưa rõ"), không bịa kết quả', async () => {
    const g = dung([job()]);
    g.pj.updateMany.mockRejectedValueOnce(new Error('connection reset'));
    await expect(huyLenhIn(ORG1, ['pjx'], CRM, g.deps)).rejects.toThrow('connection reset');
  });
});

describe('huyLenhIn — phạm vi SOCKET: chỉ job của chính máy đó', () => {
  const mayHN: PhamViHangDoi = { loai: 'may', token: HN, tokenMacDinh: HN, orgMacDinh: 'org1' };
  const mayHCM: PhamViHangDoi = { loai: 'may', token: HCM, tokenMacDinh: HN, orgMacDinh: 'org1' };
  const APP = { loai: 'app', may: 'PC-SHOP-HCM' } as const;

  it('job của máy KHÁC → KHONG_TIM_THAY, job đó giữ cho_in', async () => {
    const j = job({ agentToken: HN });
    const g = dung([j]);
    const [kq] = await huyLenhIn(mayHCM, [j.id], APP, g.deps);
    expect(kq.loi).toBe('KHONG_TIM_THAY');
    expect(g.hang[0].trangThai).toBe('cho_in');
    expect(g.nhatKy[0]).toMatchObject({ loai: 'huy_that_bai', agentToken: HCM });
    expect(g.nhatKy[0].noiDung).toContain('(nguồn: app máy in (PC-SHOP-HCM))');
  });

  it('job của chính máy → ok; nguồn ghi "app máy in (<tên máy tính>)"', async () => {
    const j = job({ agentToken: HCM });
    const g = dung([j]);
    const [kq] = await huyLenhIn(mayHCM, [j.id], APP, g.deps);
    expect(kq.ok).toBe(true);
    expect(g.nhatKy[0].noiDung).toContain('(nguồn: app máy in (PC-SHOP-HCM))');
    expect(g.pj.updateMany.mock.calls[0][0].where).toEqual({ AND: [{ id: j.id, trangThai: 'cho_in' }, { agentToken: HCM }] });
  });

  it('agent_token NULL: CHỈ máy mặc định (token env) huỷ được; máy khác → KHONG_TIM_THAY', async () => {
    const j = job({ agentToken: null });
    const g = dung([j]);
    expect((await huyLenhIn(mayHCM, [j.id], APP, g.deps))[0].loi).toBe('KHONG_TIM_THAY');
    expect(g.hang[0].trangThai).toBe('cho_in');
    expect((await huyLenhIn(mayHN, [j.id], { loai: 'app', may: null }, g.deps))[0]).toMatchObject({ ok: true, cach: 'chua_gui' });
    expect(g.nhatKy[1].noiDung).toContain('(nguồn: app máy in (không rõ tên máy tính))');
    expect(g.baoDoiHangDoi).toHaveBeenCalledWith(HN); // NULL quy về máy mặc định
  });

  it('không có token env (hệ thuần IPP) → job NULL không thuộc máy nào', async () => {
    const j = job({ agentToken: null });
    const g = dung([j], { tokenMacDinh: null });
    const [kq] = await huyLenhIn({ loai: 'may', token: HN, tokenMacDinh: null, orgMacDinh: 'org1' }, [j.id], APP, g.deps);
    expect(kq.loi).toBe('KHONG_TIM_THAY');
  });

  it('agent_token NULL của ORG KHÁC org mặc định env → ngoài phạm vi máy mặc định (không xem, không huỷ)', async () => {
    const cua2 = job({ agentToken: null, orgId: 'org2' });
    const cua1 = job({ agentToken: null, orgId: 'org1' });
    const g = dung([cua2, cua1]);
    expect((await huyLenhIn(mayHN, [cua2.id], APP, g.deps))[0].loi).toBe('KHONG_TIM_THAY');
    expect(g.hang[0].trangThai).toBe('cho_in');
    expect((await layHangDoi(mayHN, {}, g.deps)).choIn.map((m) => m.id)).toEqual([cua1.id]);
    expect((await boTheoDoi(mayHN, [cua2.id], APP, g.deps))[0].ok).toBe(false);
  });

  it('thiếu org mặc định env → không job NULL nào thuộc phạm vi máy (không đoán org)', async () => {
    const j = job({ agentToken: null });
    const g = dung([j]);
    const [kq] = await huyLenhIn({ loai: 'may', token: HN, tokenMacDinh: HN, orgMacDinh: null }, [j.id], APP, g.deps);
    expect(kq.loi).toBe('KHONG_TIM_THAY');
  });
});

describe('boTheoDoi — CHỈ khong_ro → bo_qua, KHÔNG chặn việc in', () => {
  it('khong_ro → bo_qua ok; câu nói KHÔNG biết đã in hay chưa; một dòng bo_theo_doi (cảnh báo); không chữ "đã huỷ"', async () => {
    const j = job({ trangThai: 'khong_ro' });
    const g = dung([j]);
    const kq = await boTheoDoi(ORG1, [j.id], CRM, g.deps);
    expect(kq).toEqual([{ id: j.id, ok: true, noiDung: 'Đã bỏ khỏi hàng đợi — hệ thống KHÔNG biết hoá đơn đã in hay chưa' }]);
    expect(g.hang[0].trangThai).toBe('bo_qua');
    expect(g.nhatKy).toHaveLength(1);
    expect(g.nhatKy[0]).toMatchObject({
      loai: 'bo_theo_doi', printJobId: j.id,
      noiDung: `Bỏ theo dõi hoá đơn ${j.soHoaDon} — hệ thống KHÔNG biết đã in hay chưa, kiểm giấy trước khi in lại (nguồn: ZaloCRM (Chị Hoa))`,
    });
    expect(mucDoCua('bo_theo_doi')).toBe('canh_bao');
    expect(JSON.stringify([kq, g.nhatKy])).not.toMatch(/[Đđ]ã huỷ/);
    expect(g.baoDoiHangDoi).toHaveBeenCalledWith(HN);
  });

  it('cho_in → ok:false (dùng Huỷ), không đổi, không nhật ký', async () => {
    const j = job();
    const g = dung([j]);
    const [kq] = await boTheoDoi(ORG1, [j.id], CRM, g.deps);
    expect(kq.ok).toBe(false);
    expect(kq.noiDung).toBe(`${NOI_DUNG_BO_THEO_DOI.chiKhongRo} — lệnh này đang chờ in (dùng "Huỷ" để huỷ chắc chắn).`);
    expect(g.hang[0].trangThai).toBe('cho_in');
    expect(g.nhatKy).toEqual([]);
  });

  it('đã bỏ trước đó → ok (daBoTruoc), không ghi thêm; không tìm thấy / máy khác → ok:false', async () => {
    const a = job({ trangThai: 'bo_qua' }); const b = job({ trangThai: 'khong_ro', agentToken: HN });
    // Lần bỏ thật đã có dòng nhật ký của nó → lần lặp không ghi thêm.
    const g = dung([a, b], { logs: [{ printJobId: a.id, loai: 'bo_theo_doi', tenKhach: null, createdAt: new Date(BAY_GIO - 9000) }] });
    expect((await boTheoDoi(ORG1, [a.id], CRM, g.deps))[0]).toEqual({ id: a.id, ok: true, noiDung: NOI_DUNG_BO_THEO_DOI.daBoTruoc });
    expect((await boTheoDoi(ORG1, ['lạ'], CRM, g.deps))[0]).toEqual({ id: 'lạ', ok: false, noiDung: NOI_DUNG_BO_THEO_DOI.khongTimThay });
    expect((await boTheoDoi({ loai: 'may', token: HCM, tokenMacDinh: HN, orgMacDinh: 'org1' }, [b.id], { loai: 'app', may: 'X' }, g.deps))[0].ok).toBe(false);
    expect(g.hang[1].trangThai).toBe('khong_ro');
    expect(g.nhatKy).toEqual([]);
  });
});

describe('layHangDoi — hai nhóm, tên khách, tên máy (không token), tạm giữ + lý do', () => {
  it('choIn = cho_in ∪ dang_gui ∪ da_gui (cũ trước); chuaXacNhan = khong_ro trong 3 ngày; còn lại không hiện', async () => {
    const jobs = [
      job({ id: 'c', trangThai: 'cho_in', createdAt: new Date(BAY_GIO - 3000) }),
      job({ id: 'a', trangThai: 'dang_gui', createdAt: new Date(BAY_GIO - 9000) }),
      job({ id: 'b', trangThai: 'da_gui', createdAt: new Date(BAY_GIO - 6000) }),
      job({ id: 'k', trangThai: 'khong_ro', updatedAt: new Date(BAY_GIO - MS_CHUA_XAC_NHAN + 60_000) }),
      job({ id: 'kCu', trangThai: 'khong_ro', updatedAt: new Date(BAY_GIO - MS_CHUA_XAC_NHAN - 60_000) }),
      ...['da_in', 'loi', 'da_huy', 'bo_qua'].map((t) => job({ id: t, trangThai: t })),
    ];
    const g = dung(jobs);
    const hd = await layHangDoi(ORG1, {}, g.deps);
    expect(hd.choIn.map((m) => [m.id, m.nhom, m.huy])).toEqual([
      ['a', 'cho_in', 'khong'], ['b', 'cho_in', 'khong'], ['c', 'cho_in', 'chac_chan'],
    ]);
    expect(hd.chuaXacNhan.map((m) => [m.id, m.nhom, m.huy])).toEqual([['k', 'chua_xac_nhan', 'khong']]);
    expect(hd.capNhat).toBe(new Date(BAY_GIO).toISOString());
  });

  it('tên khách = dòng print_logs MỚI NHẤT có tên của cùng job; tên máy từ print_agents; KHÔNG BAO GIỜ trả token', async () => {
    const j1 = job({ agentToken: HCM }); const j2 = job({ agentToken: null }); const j3 = job({ agentToken: 'tokDaXoa_abcdefgh' });
    const logs = [
      { printJobId: j1.id, tenKhach: 'Tên cũ', createdAt: new Date(BAY_GIO - 9000) },
      { printJobId: j1.id, tenKhach: 'Anh Lộc Beco', createdAt: new Date(BAY_GIO - 5000) },
      { printJobId: j1.id, tenKhach: null, createdAt: new Date(BAY_GIO - 1000) },
    ];
    const g = dung([j1, j2, j3], { logs, agents: [{ id: 'mayHCM', orgId: 'org1', ten: 'Máy HCM', token: HCM }] });
    const hd = await layHangDoi(ORG1, {}, g.deps);
    const theoId = Object.fromEntries(hd.choIn.map((m) => [m.id, m]));
    expect(theoId[j1.id]).toMatchObject({ tenKhach: 'Anh Lộc Beco', mayInId: 'mayHCM', mayInTen: 'Máy HCM' });
    expect(theoId[j2.id]).toMatchObject({ tenKhach: null, mayInId: null, mayInTen: 'Máy mặc định (env)' });
    expect(theoId[j3.id]).toMatchObject({ mayInId: null, mayInTen: null });
    const chuoi = JSON.stringify(hd);
    for (const t of [HN, HCM, 'tokDaXoa_abcdefgh']) expect(chuoi).not.toContain(t);
  });

  it('tạm giữ: cho_in + cầu dao máy đó ngắt → "Tạm giữ — máy in Hết giấy (từ 18:45)"; máy khác không bị dính', async () => {
    const tu = new Date('2026-09-25T11:45:00.000Z');
    const cd: CauDao = { tu, ma: 'het_giay', lyDo: 'Hết giấy', thuSau: BAY_GIO + 60_000, lucNgat: tu.getTime() };
    const a = job({ agentToken: HN }); const b = job({ agentToken: HCM }); const c = job({ agentToken: HN, trangThai: 'dang_gui' });
    const g = dung([a, b, c], { cauDao: { [HN]: cd } });
    const hd = await layHangDoi(ORG1, {}, g.deps);
    const theoId = Object.fromEntries(hd.choIn.map((m) => [m.id, m]));
    expect(theoId[a.id]).toMatchObject({ tamGiu: true, lyDo: 'Tạm giữ — máy in Hết giấy (từ 18:45)' });
    expect(theoId[b.id]).toMatchObject({ tamGiu: false, lyDo: 'Chờ tới lượt in' });
    expect(theoId[c.id]).toMatchObject({ tamGiu: false, lyDo: 'Đang gửi xuống máy in' });
  });

  it('lý do: app không trả lời (cầu dao het_gio_cho) · app mất kết nối · đã thử lại (che token) · chưa xác nhận', async () => {
    const tu = new Date('2026-09-25T11:00:00.000Z');
    const a = job({ agentToken: HN });
    const b = job({ agentToken: HCM });
    const c = job({ agentToken: 'tokKhac_12345678', lanThu: 2, loiCuoi: 'Máy in báo lỗi — C:\\Temp\\tokKhac_12345678-1.pdf' });
    const d = job({ trangThai: 'khong_ro', loiCuoi: 'Kẹt giấy' });
    const e = job({ trangThai: 'da_gui' });
    const g = dung([a, b, c, d, e], {
      cauDao: { [HN]: { tu, ma: 'het_gio_cho', lyDo: 'x', thuSau: 0, lucNgat: 0 } }, online: [HN, 'tokKhac_12345678'],
    });
    const hd = await layHangDoi(ORG1, {}, g.deps);
    const ly = Object.fromEntries([...hd.choIn, ...hd.chuaXacNhan].map((m) => [m.id, m.lyDo]));
    expect(ly[a.id]).toBe('Tạm giữ — App máy in không trả lời (từ 18:00)');
    expect(ly[b.id]).toBe('Chờ app máy in kết nối lại');
    expect(ly[c.id]).toBe('Chờ gửi lại (đã thử 2/5 lần) — lần trước: Máy in báo lỗi — C:\\Temp\\…-1.pdf');
    expect(ly[d.id]).toBe('Chưa xác nhận đã in — có thể đang nằm trong máy in (Kẹt giấy)');
    expect(ly[e.id]).toBe('Đã gửi xuống máy in — chờ máy in xác nhận in xong');
  });

  it('lọc mayInId (REST): quy sang token; máy mặc định gồm cả job NULL; id lạ / org khác → rỗng', async () => {
    const a = job({ agentToken: HN }); const b = job({ agentToken: null }); const c = job({ agentToken: HCM });
    const g = dung([a, b, c], { agents: [
      { id: 'mayHN', orgId: 'org1', ten: 'Máy HN', token: HN },
      { id: 'mayHCM', orgId: 'org1', ten: 'Máy HCM', token: HCM },
      { id: 'mayOrg2', orgId: 'org2', ten: 'Máy org2', token: 'tokOrg2_xxxxxxxx' },
    ] });
    expect((await layHangDoi(ORG1, { mayInId: 'mayHN' }, g.deps)).choIn.map((m) => m.id)).toEqual([a.id, b.id]);
    expect((await layHangDoi(ORG1, { mayInId: 'mayHCM' }, g.deps)).choIn.map((m) => m.id)).toEqual([c.id]);
    expect((await layHangDoi(ORG1, { mayInId: 'mayLa' }, g.deps)).choIn).toEqual([]);
    expect((await layHangDoi(ORG1, { mayInId: 'mayOrg2' }, g.deps)).choIn).toEqual([]);
  });

  it('phạm vi máy (socket): chỉ job của chính máy; org khác cùng token cũng không lẫn job máy khác', async () => {
    const a = job({ agentToken: HN }); const b = job({ agentToken: null }); const c = job({ agentToken: HCM });
    const g = dung([a, b, c]);
    const hcm = await layHangDoi({ loai: 'may', token: HCM, tokenMacDinh: HN, orgMacDinh: 'org1' }, {}, g.deps);
    expect(hcm.choIn.map((m) => m.id)).toEqual([c.id]);
    const hn = await layHangDoi({ loai: 'may', token: HN, tokenMacDinh: HN, orgMacDinh: 'org1' }, {}, g.deps);
    expect(hn.choIn.map((m) => m.id)).toEqual([a.id, b.id]);
  });

  it('đọc tên khách lỗi (bảng nhật ký chưa có) → hàng đợi vẫn hiện, chỉ thiếu tên', async () => {
    const g = dung([job()]);
    g.prisma.printLog.findMany.mockRejectedValueOnce(Object.assign(new Error('no table'), { code: 'P2021' }));
    const hd = await layHangDoi(ORG1, {}, g.deps);
    expect(hd.choIn).toHaveLength(1);
    expect(hd.choIn[0].tenKhach).toBeNull();
  });
});

describe('tên máy (REST) — chỉ máy của CHÍNH org', () => {
  it('token trùng máy của org khác → không lộ tên/id máy đó', async () => {
    const j = job({ agentToken: 'tokOrg2_xxxxxxxx' });
    const g = dung([j], { agents: [{ id: 'mayOrg2', orgId: 'org2', ten: 'Máy org2', token: 'tokOrg2_xxxxxxxx' }] });
    const hd = await layHangDoi(ORG1, {}, g.deps);
    expect(hd.choIn[0]).toMatchObject({ mayInId: null, mayInTen: null });
    expect(g.prisma.printAgent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { token: { in: ['tokOrg2_xxxxxxxx'] }, orgId: 'org1' },
    }));
  });
});

describe('B5 — mỗi lần huỷ THẬT đúng một dòng `da_huy`, kể cả khi lần đầu mất nhật ký', () => {
  it('lỗi DB NGAY SAU khi huỷ đã commit (REST 500) → gửi lại được da_huy_truoc + GHI BÙ một dòng, nguồn = người huỷ thật', async () => {
    const j = job();
    const g = dung([j]);
    g.pj.findFirst.mockRejectedValueOnce(new Error('connection reset')); // sau updateMany đã đổi da_huy
    await expect(huyLenhIn(ORG1, [j.id], CRM, g.deps)).rejects.toThrow('connection reset');
    expect(g.hang[0].trangThai).toBe('da_huy');
    expect(g.nhatKy).toEqual([]);
    const [kq] = await huyLenhIn(ORG1, [j.id], { loai: 'crm', ten: 'Anh Quốc' }, g.deps);
    expect(kq).toMatchObject({ ok: true, cach: 'da_huy_truoc' });
    expect(g.nhatKy).toHaveLength(1);
    expect(g.nhatKy[0]).toMatchObject({
      loai: 'da_huy', printJobId: j.id,
      noiDung: `Đã huỷ lệnh in hoá đơn ${j.soHoaDon} — chắc chắn không in (nguồn: ZaloCRM (Chị Hoa))`,
      chiTiet: { nguon: 'crm', cach: 'chua_gui', ghiBu: true },
    });
    // gửi lại lần nữa → đã có dòng → không ghi thêm
    await huyLenhIn(ORG1, [j.id], CRM, g.deps);
    expect(g.nhatKy).toHaveLength(1);
  });

  it('nguồn ghi bù lấy từ lần huỷ thật (app máy in), không phải người gửi lại', async () => {
    const j = job({ trangThai: 'da_huy', loiCuoi: 'Đã huỷ bởi app máy in (PC-SHOP-HN)' });
    const g = dung([j]);
    await huyLenhIn(ORG1, [j.id], CRM, g.deps);
    expect(g.nhatKy[0].noiDung).toContain('(nguồn: app máy in (PC-SHOP-HN))');
    expect(g.nhatKy[0].chiTiet).toMatchObject({ nguon: 'app', ghiBu: true });
  });

  it('hai yêu cầu CÙNG id đồng thời (bấm đôi / CRM + app) → chạy nối tiếp: một ok chua_gui, một da_huy_truoc, ĐÚNG một dòng', async () => {
    const j = job();
    const g = dung([j]);
    const [a, b] = await Promise.all([
      huyLenhIn(ORG1, [j.id], CRM, g.deps),
      huyLenhIn({ loai: 'may', token: HN, tokenMacDinh: HN, orgMacDinh: 'org1' }, [j.id], { loai: 'app', may: 'PC' }, g.deps),
    ]);
    expect([a[0].cach, b[0].cach].sort()).toEqual(['chua_gui', 'da_huy_truoc']);
    expect(g.nhatKy.filter((m) => m.loai === 'da_huy')).toHaveLength(1);
  });

  it('không tra được nhật ký → KHÔNG ghi bù (thà thiếu còn hơn ghi đôi), vẫn trả ok da_huy_truoc', async () => {
    const j = job({ trangThai: 'da_huy', loiCuoi: 'Đã huỷ bởi ZaloCRM (Chị Hoa)' });
    const g = dung([j]);
    g.prisma.printLog.findFirst.mockRejectedValueOnce(new Error('db'));
    const [kq] = await huyLenhIn(ORG1, [j.id], CRM, g.deps);
    expect(kq.cach).toBe('da_huy_truoc');
    expect(g.nhatKy).toEqual([]);
  });

  it('bỏ theo dõi: cùng lỗ — bo_qua mà chưa có dòng bo_theo_doi → ghi bù đúng một dòng', async () => {
    const j = job({ trangThai: 'bo_qua', loiCuoi: 'Bỏ khỏi hàng đợi bởi ZaloCRM (Chị Hoa) — không biết đã in hay chưa' });
    const g = dung([j]);
    expect((await boTheoDoi(ORG1, [j.id], { loai: 'crm', ten: 'Người khác' }, g.deps))[0].ok).toBe(true);
    await boTheoDoi(ORG1, [j.id], CRM, g.deps);
    expect(g.nhatKy).toHaveLength(1);
    expect(g.nhatKy[0]).toMatchObject({ loai: 'bo_theo_doi', chiTiet: { nguon: 'crm', ghiBu: true } });
    expect(g.nhatKy[0].noiDung).toContain('(nguồn: ZaloCRM (Chị Hoa))');
  });
});
