// SPDX-License-Identifier: AGPL-3.0-or-later
// thong-tin-app.ts — đọc event `thong-tin-app` (app ≥ 0.2.8 thêm ketNoi / heDieuHanh / banBuild):
// làm sạch chữ (che token + trần độ dài), mã liệt kê ngoài danh sách → null, laMang phải là boolean
// THẬT, khoá lạ bị bỏ; payload 5 trường cũ đọc y như trước; câu nhật ký app_ket_noi / app_ket_noi_doi.
import { describe, it, expect } from 'vitest';
import {
  docThongTinApp, docKetNoi, khoaKetNoi, moTaKetNoi, moTaKetNoiApp, cauDoiKetNoi, chiTietThongTinApp,
  LOAI_KET_NOI, NGUON_IP, BAN_BUILD, TRAN_CHU_THONG_TIN, type LamSach,
} from '../../../src/modules/ai/may-in/thong-tin-app.js';
import { catChu, cheToken } from '../../../src/modules/ai/may-in/nhat-ky.js';

const TOKEN = 'tokHN_bi_mat_khong_duoc_lo_9x7';
/** Đúng hàm agent-ws dùng (chuTuApp): che token TRƯỚC rồi mới cắt. */
const lamSach: LamSach = (x, tran) => catChu(x === null || x === undefined ? x : cheToken(String(x), TOKEN), tran);

const KET_NOI_WSD = {
  loai: 'wsd', laMang: true, cong: 'WSD-3f2a9c', ip: '192.168.1.23', nguonIp: 'pnpx',
  mayTraLoi: 'sẵn sàng (IPP)', moTa: 'Mạng LAN (WSD) · 192.168.1.23 · máy báo sẵn sàng',
};

describe('docThongTinApp — năm trường cũ', () => {
  it('payload app ≤ 0.2.7 đọc y như trước; trường mới = null', () => {
    const tt = docThongTinApp({ phienBan: '0.2.7', mayIn: 'HP LaserJet 4003', khay: 'tray-2', khoGiay: 'A5', may: 'PC-SHOP-HN' }, lamSach);
    expect(tt).toEqual({
      phienBan: '0.2.7', mayIn: 'HP LaserJet 4003', khay: 'tray-2', khoGiay: 'A5', may: 'PC-SHOP-HN',
      ketNoi: null, heDieuHanh: null, banBuild: null,
    });
    expect(chiTietThongTinApp(tt)).toEqual({ phienBan: '0.2.7', mayIn: 'HP LaserJet 4003', khay: 'tray-2', khoGiay: 'A5', may: 'PC-SHOP-HN' });
    expect(moTaKetNoiApp(tt)).toBe('máy in "HP LaserJet 4003", máy tính PC-SHOP-HN, app v0.2.7');
  });

  it('payload rác (null, chuỗi, mảng) → mọi trường null, không ném', () => {
    for (const rac of [null, undefined, 'x', 42, ['a']]) {
      expect(docThongTinApp(rac, lamSach)).toMatchObject({ phienBan: null, ketNoi: null, heDieuHanh: null, banBuild: null });
    }
  });
});

describe('docThongTinApp — ketNoi / heDieuHanh / banBuild', () => {
  it('payload 0.2.8 đầy đủ → giữ đúng từng trường; khoá lạ bị bỏ', () => {
    const tt = docThongTinApp({
      phienBan: '0.2.8', mayIn: 'HP 4003', may: 'KHO-HN',
      ketNoi: { ...KET_NOI_WSD, matKhau: 'x', __proto__: { hack: 1 } },
      heDieuHanh: 'Windows 7 SP1 (6.1.7601)', banBuild: 'win7', token: TOKEN, laAdmin: true,
    }, lamSach);
    expect(tt.ketNoi).toEqual(KET_NOI_WSD);
    expect(tt.heDieuHanh).toBe('Windows 7 SP1 (6.1.7601)');
    expect(tt.banBuild).toBe('win7');
    expect(Object.keys(tt).sort()).toEqual(['banBuild', 'heDieuHanh', 'ketNoi', 'khay', 'khoGiay', 'may', 'mayIn', 'phienBan']);
    expect(Object.keys(tt.ketNoi!).sort()).toEqual(['cong', 'ip', 'laMang', 'loai', 'mayTraLoi', 'moTa', 'nguonIp']);
  });

  it('mã liệt kê: loai / nguonIp / banBuild ngoài danh sách → null (không nhận chữ hoa, khoảng trắng, số)', () => {
    expect([...LOAI_KET_NOI]).toEqual(['usb', 'wsd', 'tcpip', 'ipp', 'chia_se', 'khac']);
    expect([...NGUON_IP]).toEqual(['cau_hinh', 'ten_cong', 'registry', 'location', 'pnpx']);
    expect([...BAN_BUILD]).toEqual(['win7', 'thuong']);
    for (const sai of ['USB', ' usb', 'lan', 'DROP TABLE', 1, null, {}]) {
      expect(docKetNoi({ loai: sai, cong: 'USB001' }, lamSach)?.loai ?? null).toBeNull();
      expect(docKetNoi({ loai: 'usb', nguonIp: sai }, lamSach)!.nguonIp).toBeNull();
      expect(docThongTinApp({ banBuild: sai }, lamSach).banBuild).toBeNull();
    }
    for (const l of LOAI_KET_NOI) expect(docKetNoi({ loai: l }, lamSach)!.loai).toBe(l);
    for (const n of NGUON_IP) expect(docKetNoi({ loai: 'tcpip', nguonIp: n }, lamSach)!.nguonIp).toBe(n);
  });

  it('laMang phải là boolean THẬT: "true", 1, "false" → null; true/false giữ', () => {
    for (const sai of ['true', 1, 'false', 0, null, undefined]) expect(docKetNoi({ loai: 'wsd', laMang: sai }, lamSach)!.laMang).toBeNull();
    expect(docKetNoi({ loai: 'wsd', laMang: true }, lamSach)!.laMang).toBe(true);
    expect(docKetNoi({ loai: 'usb', laMang: false }, lamSach)!.laMang).toBe(false);
  });

  it('trần độ dài: moTa 200, cong 120, ip 64, mayTraLoi 80, heDieuHanh 80 (cắt có "…")', () => {
    expect(TRAN_CHU_THONG_TIN).toMatchObject({ moTa: 200, cong: 120, ip: 64, mayTraLoi: 80, heDieuHanh: 80 });
    const dai = 'x'.repeat(1000);
    const k = docKetNoi({ loai: 'tcpip', moTa: dai, cong: dai, ip: dai, mayTraLoi: dai }, lamSach)!;
    expect([k.moTa!.length, k.cong!.length, k.ip!.length, k.mayTraLoi!.length]).toEqual([200, 120, 64, 80]);
    expect(k.moTa!.endsWith('…')).toBe(true);
    expect(docThongTinApp({ heDieuHanh: dai }, lamSach).heDieuHanh).toHaveLength(80);
  });

  it('chữ không phải chuỗi được ép chữ; rỗng/khoảng trắng → null; token trong chữ bị che', () => {
    const k = docKetNoi({ loai: 'tcpip', ip: 192, cong: '   ', moTa: `lỗi ${TOKEN} x`, mayTraLoi: '' }, lamSach)!;
    expect(k.ip).toBe('192');
    expect(k.cong).toBeNull();
    expect(k.mayTraLoi).toBeNull();
    expect(k.moTa).toBe('lỗi … x');
  });

  it('ketNoi vắng / không phải object / mảng / không có gì dùng được → null', () => {
    for (const x of [undefined, null, 'usb', 3, [KET_NOI_WSD], {}, { laMang: true, nguonIp: 'pnpx' }]) {
      expect(docKetNoi(x, lamSach)).toBeNull();
    }
  });
});

describe('câu nhật ký + khoá so đổi', () => {
  it('app_ket_noi: máy in, máy tính, app, <moTa>, hệ điều hành', () => {
    const tt = docThongTinApp({
      phienBan: '0.2.8', mayIn: 'HP 4003', may: 'KHO-HN',
      ketNoi: { loai: 'wsd', laMang: true, moTa: 'Mạng LAN (WSD) · 192.168.1.23' }, heDieuHanh: 'Windows 7 SP1',
    }, lamSach);
    expect(moTaKetNoiApp(tt)).toBe('máy in "HP 4003", máy tính KHO-HN, app v0.2.8, Mạng LAN (WSD) · 192.168.1.23, Windows 7 SP1');
    expect(chiTietThongTinApp(tt)).toMatchObject({ ketNoi: { loai: 'wsd' }, heDieuHanh: 'Windows 7 SP1' });
    expect(chiTietThongTinApp(tt)).not.toHaveProperty('banBuild');
  });

  it('moTa vắng → dựng tối thiểu từ loai / ip / cổng', () => {
    const k = (o: Record<string, unknown>) => docKetNoi(o, lamSach);
    expect(moTaKetNoi(k({ loai: 'usb', cong: 'USB001' }))).toBe('USB (USB001)');
    expect(moTaKetNoi(k({ loai: 'usb' }))).toBe('USB');
    expect(moTaKetNoi(k({ loai: 'tcpip', ip: '10.0.0.9', mayTraLoi: 'không trả lời' }))).toBe('Mạng LAN (TCP/IP) · 10.0.0.9 · không trả lời');
    expect(moTaKetNoi(k({ loai: 'chia_se', cong: '\\\\KHO\\HP' }))).toBe('Máy in chia sẻ');
    expect(moTaKetNoi(k({ loai: 'khac', cong: 'FILE:' }))).toBe('Cổng FILE:');
    expect(moTaKetNoi(null)).toBeNull();
  });

  it('khoá so đổi CHỈ theo loai / ip / mayTraLoi (moTa, cổng đổi chữ không tính)', () => {
    const a = docKetNoi(KET_NOI_WSD, lamSach);
    expect(khoaKetNoi(a)).toBe(khoaKetNoi(docKetNoi({ ...KET_NOI_WSD, moTa: 'khác chữ', cong: 'WSD-khac' }, lamSach)));
    expect(khoaKetNoi(a)).not.toBe(khoaKetNoi(docKetNoi({ ...KET_NOI_WSD, mayTraLoi: 'không trả lời' }, lamSach)));
    expect(khoaKetNoi(a)).not.toBe(khoaKetNoi(docKetNoi({ ...KET_NOI_WSD, ip: '192.168.1.24' }, lamSach)));
    expect(khoaKetNoi(a)).not.toBe(khoaKetNoi(docKetNoi({ ...KET_NOI_WSD, loai: 'tcpip' }, lamSach)));
    expect(khoaKetNoi(null)).toBe('');
  });

  it('app_ket_noi_doi: mới + trước; không biết → "chưa rõ"', () => {
    const cu = docKetNoi({ ...KET_NOI_WSD, mayTraLoi: 'không trả lời', moTa: 'Mạng LAN (WSD) · 192.168.1.23 · máy không trả lời' }, lamSach);
    const moi = docKetNoi(KET_NOI_WSD, lamSach);
    expect(cauDoiKetNoi(moi, cu, 'HP 4003')).toBe(
      'Kết nối máy in "HP 4003" đổi: Mạng LAN (WSD) · 192.168.1.23 · máy báo sẵn sàng (trước: Mạng LAN (WSD) · 192.168.1.23 · máy không trả lời)',
    );
    expect(cauDoiKetNoi(moi, null, null)).toBe('Kết nối máy in đổi: Mạng LAN (WSD) · 192.168.1.23 · máy báo sẵn sàng (trước: chưa rõ)');
  });
});
