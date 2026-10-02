// SPDX-License-Identifier: AGPL-3.0-or-later
// Hàng thử lại sự cố máy in (docs/78 Codex v1 #2, v2 #2 + #3) — hàm thuần, không DB:
//   • MỘT hàng tuần tự (FIFO): dòng mới KHÔNG vượt dòng đang chờ — DB lỗi lúc het_giay + tam_giu, sống lại lúc tiep_tuc_in
//     ⇒ ghi ĐÚNG thứ tự het_giay → tam_giu → tiep_tuc_in (bản cũ ghi hồi phục trước, sự cố cũ sau ⇒ nhóm coi như còn mở);
//   • mỗi mục mang thứ tự ỔN ĐỊNH lúc NHẬN (luc + thu_tu đơn điệu + ma_ghi) — ghi bù giữ nguyên;
//   • nhật ký đĩa GHI TRƯỚC (write-ahead): khởi động lại TRƯỚC khi commit vẫn ghi bù; commit rồi mới chết ⇒ ma_ghi khử trùng;
//   • ghiNeuRanh (nhịp trạng thái máy): hàng còn mục ⇒ không ghi vượt (nhịp sau làm);
//   • trần hàng bỏ mục cũ nhất, `khong_luu` không giữ, người ghi ném ⇒ loi_db.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { taoHangThuLaiSuCo, type SuCoIn, type HangThuLaiSuCo } from '../src/modules/ai/may-in/su-kien-in.js';

const thuMuc: string[] = [];
const hang: HangThuLaiSuCo[] = [];
function tep(): string {
  const d = mkdtempSync(join(tmpdir(), 'su-co-cho-'));
  thuMuc.push(d);
  return join(d, 'cho.json');
}
function tao(o: Parameters<typeof taoHangThuLaiSuCo>[0]): HangThuLaiSuCo {
  const h = taoHangThuLaiSuCo(o);
  hang.push(h);
  return h;
}
afterEach(() => {
  for (const h of hang.splice(0)) h.dung();
  for (const d of thuMuc.splice(0)) rmSync(d, { recursive: true, force: true });
});
const cho = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('taoHangThuLaiSuCo — FIFO + thứ tự ổn định', () => {
  it('DB lỗi lúc het_giay + tam_giu, sống lại lúc tiep_tuc_in ⇒ ghi ĐÚNG thứ tự nhận, dòng mới chờ sau hàng', async () => {
    let hong = true;
    const ghi: SuCoIn[] = [];
    const goc = new Date('2026-10-02T01:00:00Z');
    let t = goc.getTime();
    const h = tao({
      ghi: async (sc) => { if (hong) return 'loi_db'; ghi.push(sc); return 'da_luu'; },
      msNhip: 60_000, bayGio: () => new Date((t += 1000)),
    });
    expect(await h.ghi({ maSuCo: 'het_giay' })).toBe('loi_db');
    expect(await h.ghi({ maSuCo: 'tam_giu', maGoc: 'het_giay' })).toBe('loi_db');
    expect(h.soCho()).toBe(2);
    hong = false;
    expect(await h.ghi({ maSuCo: 'tiep_tuc_in', maGoc: 'het_giay' })).toBe('da_luu');
    expect(h.soCho()).toBe(0);
    expect(ghi.map((s) => s.maSuCo)).toEqual(['het_giay', 'tam_giu', 'tiep_tuc_in']);
    // giờ + thứ tự đóng dấu LÚC NHẬN, tăng dần, giữ nguyên khi ghi bù
    expect(ghi.map((s) => s.luc!.getTime())).toEqual([goc.getTime() + 1000, goc.getTime() + 2000, goc.getTime() + 3000]);
    const tt = ghi.map((s) => s.thuTu!);
    expect(tt[0]).toBeLessThan(tt[1]);
    expect(tt[1]).toBeLessThan(tt[2]);
    expect(new Set(ghi.map((s) => s.maGhi)).size).toBe(3);
  });

  it('thu_tu đơn điệu ngay cả khi đồng hồ đứng yên', async () => {
    const ghi: SuCoIn[] = [];
    const h = tao({ ghi: async (sc) => { ghi.push(sc); return 'da_luu'; }, bayGio: () => new Date('2026-10-02T01:00:00Z') });
    for (let i = 0; i < 5; i++) await h.ghi({ maSuCo: 'het_giay' });
    const tt = ghi.map((s) => s.thuTu!);
    for (let i = 1; i < tt.length; i++) expect(tt[i]).toBeGreaterThan(tt[i - 1]);
  });

  it('ngữ cảnh tra chậm (boSung) của mục TRƯỚC không bị mục sau vượt; mục ghi đủ ngữ cảnh', async () => {
    const ghi: SuCoIn[] = [];
    const h = tao({ ghi: async (sc) => { ghi.push(sc); return 'da_luu'; } });
    let traXong!: (v: Partial<SuCoIn>) => void;
    const p1 = h.ghi({ maSuCo: 'het_giay' }, new Promise((r) => { traXong = r; }));
    const p2 = h.ghi({ maSuCo: 'tiep_tuc_in', maGoc: 'het_giay' });
    await cho(20);
    expect(ghi).toEqual([]); // tiep_tuc_in KHÔNG vượt
    traXong({ orgId: 'org-1', printJobId: 'pj-1', soHoaDon: 'INV/1' });
    expect(await p1).toBe('da_luu');
    expect(await p2).toBe('da_luu');
    expect(ghi.map((s) => [s.maSuCo, s.orgId ?? null, s.printJobId ?? null])).toEqual([
      ['het_giay', 'org-1', 'pj-1'], ['tiep_tuc_in', null, null],
    ]);
  });

  it('ghiNeuRanh: hàng còn mục ⇒ KHÔNG ghi vượt (loi_db, người gọi thử nhịp sau); hàng rỗng ⇒ ghi ngay', async () => {
    let hong = true;
    const ghi: string[] = [];
    const h = tao({ ghi: async (sc) => { if (hong) return 'loi_db'; ghi.push(sc.maSuCo); return 'da_luu'; }, msNhip: 60_000 });
    await h.ghi({ maSuCo: 'het_giay' });
    hong = false;
    expect(await h.ghiNeuRanh({ maSuCo: 'het_su_co', maGoc: 'het_giay' })).toBe('loi_db');
    expect(ghi).toEqual([]);
    await h.xa();
    expect(await h.ghiNeuRanh({ maSuCo: 'het_su_co', maGoc: 'het_giay' })).toBe('da_luu');
    expect(ghi).toEqual(['het_giay', 'het_su_co']);
  });

  it('tự xả theo nhịp; trần hàng bỏ mục CŨ NHẤT; khong_luu / trung không giữ', async () => {
    let hong = true;
    const ghi: string[] = [];
    const h = tao({
      ghi: async (sc) => {
        if (sc.maSuCo === 'x_khong_org') return 'khong_luu';
        if (hong) return 'loi_db';
        ghi.push(sc.maSuCo);
        return 'trung';
      },
      msNhip: 20, tran: 2,
    });
    await h.ghi({ maSuCo: 'a' });
    await h.ghi({ maSuCo: 'b' });
    await h.ghi({ maSuCo: 'c' }); // đầy ⇒ bỏ 'a'
    expect(h.soCho()).toBe(2);
    hong = false;
    await cho(80);
    expect(ghi).toEqual(['b', 'c']);
    expect(h.soCho()).toBe(0);
    expect(await h.ghi({ maSuCo: 'x_khong_org' })).toBe('khong_luu');
    expect(h.soCho()).toBe(0);
  });

  it('người ghi NÉM ⇒ coi như loi_db (không bao giờ ném ra ngoài)', async () => {
    const h = tao({ ghi: async () => { throw new Error('chập'); }, msNhip: 60_000 });
    expect(await h.ghi({ maSuCo: 'het_giay' })).toBe('loi_db');
    expect(h.soCho()).toBe(1);
  });
});

describe('taoHangThuLaiSuCo — nhật ký đĩa ghi trước (khởi động lại)', () => {
  it('DB lỗi ⇒ mục nằm trên đĩa; tiến trình MỚI đọc tệp ⇒ ghi bù với ĐÚNG luc/thu_tu/ma_ghi gốc, tệp rỗng sau đó', async () => {
    const f = tep();
    const a = tao({ ghi: async () => 'loi_db', msNhip: 60_000, tep: f, bayGio: () => new Date('2026-10-02T01:00:00Z') });
    await a.ghi({ maSuCo: 'het_giay', agentToken: 'tok' });
    await a.ghi({ maSuCo: 'tam_giu', maGoc: 'het_giay', agentToken: 'tok' });
    const tren = JSON.parse(readFileSync(f, 'utf8')) as { muc: SuCoIn[] };
    expect(tren.muc.map((m) => m.maSuCo)).toEqual(['het_giay', 'tam_giu']);
    a.dung(); // tiến trình chết

    const ghi: SuCoIn[] = [];
    const b = tao({ ghi: async (sc) => { ghi.push(sc); return 'da_luu'; }, msNhip: 60_000, tep: f });
    expect(b.soCho()).toBe(2);
    await b.xa();
    expect(ghi.map((s) => s.maSuCo)).toEqual(['het_giay', 'tam_giu']);
    expect(ghi[0].luc).toEqual(new Date('2026-10-02T01:00:00Z'));
    expect(ghi.map((s) => s.maGhi)).toEqual(tren.muc.map((m) => m.maGhi));
    expect(ghi.map((s) => s.thuTu)).toEqual(tren.muc.map((m) => m.thuTu));
    expect(ghi[0].agentToken).toBe('tok');
    expect((JSON.parse(readFileSync(f, 'utf8')) as { muc: unknown[] }).muc).toEqual([]);
  });

  it('khởi động lại TRƯỚC commit: tiến trình chết GIỮA lần ghi đầu (DB chưa trả lời) ⇒ mục đã nằm trên đĩa, tiến trình mới ghi bù', async () => {
    const f = tep();
    const a = tao({ ghi: () => new Promise(() => undefined), msNhip: 60_000, tep: f }); // treo mãi = chết trước commit
    void a.ghi({ maSuCo: 'ket_giay', agentToken: 'tok' });
    await cho(10);
    expect(existsSync(f)).toBe(true);
    a.dung();
    const ghi: string[] = [];
    const b = tao({ ghi: async (sc) => { ghi.push(sc.maSuCo); return 'da_luu'; }, msNhip: 60_000, tep: f });
    await b.xa();
    expect(ghi).toEqual(['ket_giay']);
  });

  it('nạp tệp ⇒ tự xả ngay (không đợi sự cố mới); tệp hỏng ⇒ bỏ qua, không ném', async () => {
    const f = tep();
    const a = tao({ ghi: async () => 'loi_db', msNhip: 60_000, tep: f });
    await a.ghi({ maSuCo: 'het_giay' });
    a.dung();
    const ghi: string[] = [];
    tao({ ghi: async (sc) => { ghi.push(sc.maSuCo); return 'da_luu'; }, msNhip: 60_000, tep: f });
    await cho(30);
    expect(ghi).toEqual(['het_giay']);

    const g = tep();
    writeFileSync(g, '{hỏng');
    const c = tao({ ghi: async () => 'da_luu', tep: g });
    expect(c.soCho()).toBe(0);
  });

  it('dòng mới sau khi khởi động lại xếp SAU mục nạp từ đĩa (thu_tu vẫn tăng dù đồng hồ mục cũ ở tương lai)', async () => {
    const f = tep();
    const a = tao({ ghi: async () => 'loi_db', msNhip: 60_000, tep: f, bayGio: () => new Date(Date.now() + 3600_000) });
    await a.ghi({ maSuCo: 'het_giay' });
    a.dung();
    const ghi: SuCoIn[] = [];
    let hong = true;
    const b = tao({ ghi: async (sc) => { if (hong) return 'loi_db'; ghi.push(sc); return 'da_luu'; }, msNhip: 60_000, tep: f });
    await cho(10);
    hong = false;
    expect(await b.ghi({ maSuCo: 'tiep_tuc_in', maGoc: 'het_giay' })).toBe('da_luu');
    expect(ghi.map((s) => s.maSuCo)).toEqual(['het_giay', 'tiep_tuc_in']);
    expect(ghi[1].thuTu!).toBeGreaterThan(ghi[0].thuTu!);
  });
});
