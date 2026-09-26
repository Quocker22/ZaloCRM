// SPDX-License-Identifier: AGPL-3.0-or-later
// may-in-ket-noi.ts — dòng "máy in nối kiểu gì" (USB / mạng LAN / chia sẻ) + dòng "Máy tính".
import { describe, it, expect } from 'vitest';
import type { KetNoiMayIn } from '@/api/print-agents';
import { dongKetNoi, dongMayTinh } from './may-in-ket-noi';

const kn = (them: Partial<KetNoiMayIn> = {}): KetNoiMayIn => ({
  loai: 'wsd', laMang: true, cong: 'WSD-3f2a', ip: '192.168.1.23', nguonIp: 'pnpx',
  mayTraLoi: 'sẵn sàng (IPP)', moTa: 'Mạng LAN (WSD) · 192.168.1.23 · máy báo sẵn sàng', ...them,
});

describe('dongKetNoi', () => {
  it('USB → "🔌 USB" (tooltip: cổng Windows)', () => {
    expect(dongKetNoi({ online: true, ketNoi: kn({ loai: 'usb', laMang: false, cong: 'USB001', ip: null, moTa: 'USB (USB001)' }) }))
      .toEqual({ kieu: 'usb', chu: '🔌 USB', tieuDe: 'Cổng Windows: USB001' });
  });

  it('mạng LAN → "🌐 <moTa>"; moTa vắng → dựng từ loai/ip/máy trả lời', () => {
    expect(dongKetNoi({ online: true, ketNoi: kn() })).toEqual({
      kieu: 'mang', chu: '🌐 Mạng LAN (WSD) · 192.168.1.23 · máy báo sẵn sàng',
      tieuDe: 'Cổng Windows: WSD-3f2a · IP lấy từ PnP-X (WSD)',
    });
    expect(dongKetNoi({ online: true, ketNoi: kn({ loai: 'tcpip', moTa: null, mayTraLoi: null, cong: null, nguonIp: null }) }))
      .toEqual({ kieu: 'mang', chu: '🌐 Mạng LAN (TCP/IP) · 192.168.1.23', tieuDe: 'Máy in nối qua mạng LAN' });
  });

  it('chia sẻ → "Máy in chia sẻ"', () => {
    expect(dongKetNoi({ online: true, ketNoi: kn({ loai: 'chia_se', laMang: false, cong: '\\\\KHO\\HP', ip: null }) })!.chu).toBe('Máy in chia sẻ');
  });

  it('không hiện gì: offline, app cũ (null/vắng), loại lạ/khác không phải mạng, laMang không phải true', () => {
    expect(dongKetNoi({ online: false, ketNoi: kn() })).toBeNull();
    expect(dongKetNoi({ online: true, ketNoi: null })).toBeNull();
    expect(dongKetNoi({ online: true })).toBeNull();
    expect(dongKetNoi({ online: true, ketNoi: kn({ loai: 'khac', laMang: false }) })).toBeNull();
    expect(dongKetNoi({ online: true, ketNoi: kn({ loai: null, laMang: null }) })).toBeNull();
    expect(dongKetNoi({ online: true, ketNoi: kn({ loai: 'bluetooth', laMang: null }) })).toBeNull();
  });
});

describe('dongMayTinh', () => {
  it('hệ điều hành + app + "bản Win7"; thiếu phần nào bỏ phần đó; offline / không biết → null', () => {
    expect(dongMayTinh({ online: true, heDieuHanh: 'Windows 7 SP1 (6.1.7601)', phienBan: '0.2.8', banBuild: 'win7' }))
      .toBe('Windows 7 SP1 (6.1.7601) · app v0.2.8 · bản Win7');
    expect(dongMayTinh({ online: true, heDieuHanh: 'Windows 11', phienBan: '0.2.8', banBuild: 'thuong' })).toBe('Windows 11 · app v0.2.8');
    expect(dongMayTinh({ online: true, phienBan: '0.2.7' })).toBe('app v0.2.7');
    expect(dongMayTinh({ online: false, heDieuHanh: 'Windows 11', phienBan: '0.2.8' })).toBeNull();
    expect(dongMayTinh({ online: true })).toBeNull();
  });
});
