// SPDX-License-Identifier: AGPL-3.0-or-later
// Bộ gửi snapshot `hang-doi` cho một socket app (hang-doi-app.ts, hợp đồng v5.1 §8.7):
// chỉ gửi khi nội dung đổi (JSON đã sắp, không tính `capNhat`), tối đa 1 lần/giây (gộp),
// `lay-hang-doi` bỏ qua so trùng, thay đổi tới lúc đang dựng thì dựng lại một lần, lỗi không ném.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { taoBoGuiHangDoi, jsonSapXep } from '../../../src/modules/ai/may-in/hang-doi-app.js';
import type { HangDoiIn, MucHangDoi } from '../../../src/modules/ai/may-in/huy-lenh-in.js';

const muc = (id: string, them: Partial<MucHangDoi> = {}): MucHangDoi => ({
  id, soHoaDon: `INV/${id}`, tenKhach: null, mayInId: 'm1', mayInTen: 'Máy HN', trangThai: 'cho_in', nhom: 'cho_in',
  lyDo: 'Chờ tới lượt in', tamGiu: false, lanThu: 0, tao: '2026-09-25T01:00:00.000Z', capNhat: '2026-09-25T01:00:00.000Z',
  huy: 'chac_chan', ...them,
});

let bayGio = 0;
beforeEach(() => {
  vi.useFakeTimers();
  bayGio = 1_000_000;
});
afterEach(() => vi.useRealTimers());

function dung(dsLay: Array<HangDoiIn | Error>) {
  const gui: HangDoiIn[] = [];
  const loi: unknown[] = [];
  let i = 0;
  const lay = vi.fn(async () => {
    const x = dsLay[Math.min(i, dsLay.length - 1)];
    i += 1;
    if (x instanceof Error) throw x;
    return x;
  });
  const bo = taoBoGuiHangDoi({ lay, gui: (hd) => gui.push(hd), msToiThieu: 1000, bayGio: () => bayGio, onLoi: (e) => loi.push(e) });
  return { bo, gui, lay, loi };
}

const hd = (choIn: MucHangDoi[], capNhat = new Date(bayGio).toISOString()): HangDoiIn => ({ choIn, chuaXacNhan: [], capNhat });

describe('taoBoGuiHangDoi', () => {
  it('lần đầu gửi ngay; nội dung KHÔNG đổi (chỉ capNhat đổi) → không gửi lại', async () => {
    const g = dung([hd([muc('a')], 't1'), hd([muc('a')], 't2')]);
    g.bo.yeuCau({ boQuaSoTrung: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(g.gui).toHaveLength(1);
    bayGio += 5000;
    g.bo.yeuCau();
    await vi.advanceTimersByTimeAsync(0);
    expect(g.lay).toHaveBeenCalledTimes(2);
    expect(g.gui).toHaveLength(1);
  });

  it('nội dung đổi → gửi; `lay-hang-doi` (boQuaSoTrung) gửi kể cả khi không đổi', async () => {
    const g = dung([hd([muc('a')]), hd([muc('a', { tamGiu: true, lyDo: 'Tạm giữ' })]), hd([muc('a', { tamGiu: true, lyDo: 'Tạm giữ' })])]);
    g.bo.yeuCau();
    await vi.advanceTimersByTimeAsync(0);
    bayGio += 2000;
    g.bo.yeuCau();
    await vi.advanceTimersByTimeAsync(0);
    expect(g.gui).toHaveLength(2);
    bayGio += 2000;
    g.bo.yeuCau({ boQuaSoTrung: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(g.gui).toHaveLength(3);
  });

  it('tối đa 1 lần/giây: 10 yêu cầu dồn (một lượt cron claim 10 job) → một lần dựng ngay + MỘT lần gộp sau 1 giây', async () => {
    const g = dung([hd([muc('a')]), hd([muc('b')])]);
    g.bo.yeuCau();
    await vi.advanceTimersByTimeAsync(0);
    for (let k = 0; k < 10; k++) {
      bayGio += 50;
      g.bo.yeuCau();
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(g.lay).toHaveBeenCalledTimes(1);
    bayGio = 1_000_000 + 1000;
    await vi.advanceTimersByTimeAsync(1000);
    expect(g.lay).toHaveBeenCalledTimes(2);
    expect(g.gui.map((x) => x.choIn[0].id)).toEqual(['a', 'b']);
  });

  it('yêu cầu tới GIỮA lúc đang dựng → dựng lại đúng một lần sau khi xong (không mất thay đổi)', async () => {
    let tha: (() => void) | null = null;
    const gui: HangDoiIn[] = [];
    let lan = 0;
    const lay = vi.fn(() => new Promise<HangDoiIn>((ok) => {
      lan += 1;
      const x = hd([muc(lan === 1 ? 'cu' : 'moi')]);
      if (lan === 1) tha = () => ok(x);
      else ok(x);
    }));
    const bo = taoBoGuiHangDoi({ lay, gui: (h) => gui.push(h), msToiThieu: 1000, bayGio: () => bayGio });
    bo.yeuCau();
    bo.yeuCau();
    bo.yeuCau();
    tha!();
    await vi.advanceTimersByTimeAsync(0);
    bayGio += 1000;
    await vi.advanceTimersByTimeAsync(1000);
    expect(lay).toHaveBeenCalledTimes(2);
    expect(gui.map((x) => x.choIn[0].id)).toEqual(['cu', 'moi']);
  });

  it('dựng lỗi (DB) → onLoi, không ném, lần sau vẫn gửi được', async () => {
    const g = dung([new Error('db down'), hd([muc('a')])]);
    g.bo.yeuCau();
    await vi.advanceTimersByTimeAsync(0);
    expect(g.loi).toHaveLength(1);
    bayGio += 1000;
    g.bo.yeuCau();
    await vi.advanceTimersByTimeAsync(0);
    expect(g.gui).toHaveLength(1);
  });

  it('dung() (socket ngắt) → huỷ hẹn giờ, không gửi gì nữa', async () => {
    const g = dung([hd([muc('a')]), hd([muc('b')])]);
    g.bo.yeuCau();
    await vi.advanceTimersByTimeAsync(0);
    g.bo.yeuCau(); // hẹn sau 1 giây
    g.bo.dung();
    bayGio += 5000;
    await vi.advanceTimersByTimeAsync(5000);
    g.bo.yeuCau();
    await vi.advanceTimersByTimeAsync(0);
    expect(g.lay).toHaveBeenCalledTimes(1);
    expect(g.gui).toHaveLength(1);
  });
});

describe('jsonSapXep', () => {
  it('khoá object sắp xếp (lồng nhau), mảng giữ thứ tự', () => {
    expect(jsonSapXep({ b: 1, a: { d: 2, c: [3, { f: 1, e: 2 }] } })).toBe('{"a":{"c":[3,{"e":2,"f":1}],"d":2},"b":1}');
    expect(jsonSapXep({ x: 1, y: 2 })).toBe(jsonSapXep({ y: 2, x: 1 }));
  });
});
