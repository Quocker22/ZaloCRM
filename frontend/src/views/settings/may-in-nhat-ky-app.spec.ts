// SPDX-License-Identifier: AGPL-3.0-or-later
// Test hàm thuần của thẻ "Log app" — khoảng lọc, gộp dòng mới, con trỏ đuôi, nhóm sự kiện,
// chọn thẻ, giờ tới mili-giây, nhãn mã sự kiện app; và hai hàm API nhật ký app (axios giả).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  khoangNhatKyApp, gopDongMoi, conTroDuoi, conTroCua, suKienCuaNhom, chonTabNhatKy, NHOM_SU_KIEN_APP,
} from './may-in-nhat-ky-app';
import { dinhDangGioVN } from './may-in-nhat-ky';
import { kieuSuKienApp } from './may-in-nhan';

vi.mock('@/api/index', () => ({ api: { get: vi.fn() } }));
import { api } from '@/api/index';
import { layNhatKyApp, taiVeNhatKyApp, tenFileTuHeader } from '@/api/print-agents';

const ms = (iso: string) => new Date(iso).getTime();
const d = (id: string, luc: string) => ({ id, luc });

describe('khoangNhatKyApp', () => {
  const bayGio = ms('2026-09-25T03:00:00.000Z'); // 10:00 giờ VN
  it('"1 giờ" / "24 giờ" cuốn theo bây giờ, không có den', () => {
    expect(khoangNhatKyApp('1_gio', bayGio)).toEqual({ tu: '2026-09-25T02:00:00.000Z', cuon: true });
    expect(khoangNhatKyApp('24_gio', bayGio)).toEqual({ tu: '2026-09-24T03:00:00.000Z', cuon: true });
  });
  it('"Hôm nay" / "7 ngày" / "30 ngày" theo ngày lịch VN', () => {
    expect(khoangNhatKyApp('hom_nay', bayGio)).toEqual({ tu: '2026-09-24T17:00:00.000Z', den: '2026-09-25T16:59:59.999Z', cuon: false });
    expect(khoangNhatKyApp('7_ngay', bayGio).tu).toBe('2026-09-18T17:00:00.000Z');
    expect(khoangNhatKyApp('30_ngay', bayGio).tu).toBe('2026-08-26T17:00:00.000Z');
  });
});

describe('gopDongMoi', () => {
  const cu = [d('b', '2026-09-25T02:59:50.000Z'), d('a', '2026-09-25T02:59:40.000Z')];
  it('bỏ trùng id, xếp mới nhất trước — dòng đến trễ vào đúng chỗ', () => {
    const { ds, catDuoi } = gopDongMoi(cu, [d('a', '2026-09-25T02:59:40.000Z'), d('tre', '2026-09-25T02:59:45.000Z'), d('c', '2026-09-25T03:00:00.000Z')]);
    expect(ds.map((x) => x.id)).toEqual(['c', 'b', 'tre', 'a']);
    expect(catDuoi).toBe(false);
  });
  it('cùng mili-giây → id lớn trước (như máy chủ: luc DESC, id DESC)', () => {
    const { ds } = gopDongMoi([d('c1', '2026-09-25T03:00:00.000Z')], [d('c2', '2026-09-25T03:00:00.000Z')]);
    expect(ds.map((x) => x.id)).toEqual(['c2', 'c1']);
  });
  it('không có gì mới → giữ nguyên; quá trần → bỏ dòng CŨ nhất, báo catDuoi', () => {
    expect(gopDongMoi(cu, [cu[0]])).toEqual({ ds: cu, catDuoi: false });
    const { ds, catDuoi } = gopDongMoi(cu, [d('c', '2026-09-25T03:00:00.000Z')], 2);
    expect(ds.map((x) => x.id)).toEqual(['c', 'b']);
    expect(catDuoi).toBe(true);
  });
});

describe('conTroDuoi — lùi 2 phút để bắt dòng máy khác gửi trễ', () => {
  it('rỗng → null; một dòng → chính nó', () => {
    expect(conTroDuoi([])).toBeNull();
    expect(conTroDuoi([d('a', '2026-09-25T03:00:00.000Z')])).toBe('2026-09-25T03:00:00.000Z|a');
  });
  it('lấy dòng đầu tiên cũ hơn (mới nhất − 2 phút)', () => {
    const ds = [
      d('d', '2026-09-25T03:00:00.000Z'),
      d('c', '2026-09-25T02:59:00.000Z'),
      d('b', '2026-09-25T02:58:00.000Z'), // đúng mốc 2 phút
      d('a', '2026-09-25T02:50:00.000Z'),
    ];
    expect(conTroDuoi(ds)).toBe(conTroCua(ds[2]));
  });
  it('không lùi quá `toiDaLui` dòng', () => {
    const ds = Array.from({ length: 10 }, (_, i) => d(`x${i}`, new Date(ms('2026-09-25T03:00:00.000Z') - i * 1000).toISOString()));
    expect(conTroDuoi(ds, 120_000, 3)).toBe(conTroCua(ds[3]));
  });
});

describe('nhóm sự kiện + chọn thẻ + nhãn', () => {
  it('đủ viên theo yêu cầu, "Tất cả" cuối; Kết nối = hai mã', () => {
    expect(NHOM_SU_KIEN_APP.map((n) => n.value)).toEqual([
      'vet_in', 'usb_doc', 'usb_khay', 'ket_qua', 'su_co', 'trang_thai_may_in', 'nhan_job', 'ket_noi', 'tat_ca',
    ]);
    expect(suKienCuaNhom('ket_noi')).toBe('ket_noi,mat_ket_noi');
    expect(suKienCuaNhom('vet_in')).toBe('vet_in');
    expect(suKienCuaNhom('tat_ca')).toBeUndefined();
    expect(suKienCuaNhom('la')).toBeUndefined();
  });
  it('chonTabNhatKy: URL thắng thẻ đã nhớ; giá trị lạ → "in"', () => {
    expect(chonTabNhatKy('app', 'in')).toBe('app');
    expect(chonTabNhatKy('in', 'app')).toBe('in');
    expect(chonTabNhatKy(null, 'app')).toBe('app');
    expect(chonTabNhatKy('xyz', 'abc')).toBe('in');
    expect(chonTabNhatKy(undefined, undefined)).toBe('in');
  });
  it('giờ VN tới mili-giây', () => {
    expect(dinhDangGioVN('2026-09-25T10:16:06.328Z', { coMs: true })).toBe('25/09 17:16:06.328');
    expect(dinhDangGioVN('2026-09-25T10:16:06.005Z', { coMs: true, coNam: true })).toBe('25/09/2026 17:16:06.005');
  });
  it('kieuSuKienApp: mã biết có nhãn + tông; mã lạ → xám, nhãn = mã; không lọt prototype', () => {
    expect(kieuSuKienApp('su_co')).toEqual({ nhan: 'Sự cố máy in', tong: 'do' });
    expect(kieuSuKienApp('app_bo_dong').tong).toBe('vang');
    expect(kieuSuKienApp('ma_moi')).toEqual({ nhan: 'ma_moi', tong: 'xam' });
    expect(kieuSuKienApp('constructor')).toEqual({ nhan: 'constructor', tong: 'xam' });
  });
});

describe('API nhật ký app', () => {
  beforeEach(() => vi.mocked(api.get).mockReset());

  it('layNhatKyApp: bỏ trường rỗng, không toast 403, `ngam` → không toast 5xx', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { items: [{ id: 'a' }], tiepTheo: 'x|a' } });
    const kq = await layNhatKyApp({ q: '', mayInId: 'm1', suKien: 'vet_in', sau: 'L|c', gioiHan: 500 }, { ngam: true });
    expect(api.get).toHaveBeenCalledWith('/may-in-agents/nhat-ky-app', expect.objectContaining({
      params: { mayInId: 'm1', suKien: 'vet_in', sau: 'L|c', gioiHan: '500' },
      boQuaToast403: true,
      boQuaToast5xx: true,
    }));
    expect(kq).toEqual({ items: [{ id: 'a' }], tiepTheo: 'x|a' });
  });

  it('taiVeNhatKyApp: bỏ con trỏ/giới hạn, tải blob, lấy tên file từ Content-Disposition', async () => {
    const blob = new Blob(['a\tb\n']);
    vi.mocked(api.get).mockResolvedValue({ data: blob, headers: { 'content-disposition': 'attachment; filename="nhat-ky-may-in-tat-ca-20260925-1016.txt"' } });
    const kq = await taiVeNhatKyApp({ q: 'loi', tu: 'T', truoc: 'L|c', sau: 'L|d', gioiHan: 200 });
    expect(api.get).toHaveBeenCalledWith('/may-in-agents/nhat-ky-app/tai-ve', expect.objectContaining({
      params: { q: 'loi', tu: 'T' },
      responseType: 'blob',
      boQuaToast403: true,
    }));
    expect(kq).toEqual({ duLieu: blob, tenFile: 'nhat-ky-may-in-tat-ca-20260925-1016.txt' });
  });

  it('tenFileTuHeader: filename*, filename, không có', () => {
    expect(tenFileTuHeader("attachment; filename*=UTF-8''nh%E1%BA%ADt-k%C3%BD.txt")).toBe('nhật-ký.txt');
    expect(tenFileTuHeader('attachment; filename=a.txt')).toBe('a.txt');
    expect(tenFileTuHeader(undefined)).toBeNull();
    expect(tenFileTuHeader('inline')).toBeNull();
  });
});
