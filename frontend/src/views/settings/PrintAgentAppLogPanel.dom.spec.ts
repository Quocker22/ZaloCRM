// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-or-later
// PrintAgentAppLogPanel (thẻ "Log app") — hành vi yêu cầu mạng: tham số gửi đi, lọc sự kiện
// một chạm, trễ 300 ms ô tìm, tự làm mới 5 giây bằng con trỏ `sau` (gộp theo giờ, nghỉ khi
// thẻ không được chọn), "Tải thêm", tải xuống .txt, 403 / 503 / rỗng.
// Vuetify thay bằng vỏ tối giản như PrintAgentLogPanel.dom.spec.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import type { NhatKyApp, ThamSoNhatKyApp, TrangNhatKyApp } from '@/api/print-agents';

vi.mock('@/api/print-agents', () => ({
  layNhatKyApp: vi.fn(),
  taiVeNhatKyApp: vi.fn(),
  maHttpCuaLoi: (e: { response?: { status?: number } } | null) => e?.response?.status,
  laYeuCauDaHuy: (e: { code?: string } | null) => e?.code === 'ERR_CANCELED',
}));

import { layNhatKyApp, taiVeNhatKyApp } from '@/api/print-agents';
import PrintAgentAppLogPanel from './PrintAgentAppLogPanel.vue';

interface LuotGoi {
  thamSo: ThamSoNhatKyApp;
  signal?: AbortSignal;
  ngam: boolean;
  xong: (t: TrangNhatKyApp) => void;
  hong: (e: unknown) => void;
}

let goi: LuotGoi[] = [];

function dong(id: string, luc: string, them: Partial<NhatKyApp> = {}): NhatKyApp {
  return { id, luc, mayInId: 'm1', mayInTen: 'Máy HCM', suKien: 'vet_in', noiDung: `nd ${id}`, phienBan: '0.2.4', ...them };
}

const vo = (the: string) => defineComponent({
  name: `Vo${the}`,
  setup(_, { slots }) {
    return () => h(the, slots.default?.());
  },
});

const VUETIFY_VO = {
  VSwitch: vo('div'), VBtn: vo('button'), VTextField: vo('div'), VSelect: vo('div'),
  VAlert: vo('div'), VProgressLinear: vo('div'), VIcon: vo('i'), VProgressCircular: vo('span'),
};

const MAY = [{ id: 'm1', ten: 'Máy HCM', warehouseIds: [], laMacDinh: true, tokenDuoi: 'ab12', online: true }];

function gan(props: Record<string, unknown> = {}) {
  return mount(PrintAgentAppLogPanel, { props: { mayIns: MAY, ...props }, global: { components: VUETIFY_VO } });
}

type Vm = Record<string, unknown>;
const nut = (w: ReturnType<typeof gan>, chu: string) => w.findAll('button').find((b) => b.text() === chu);

beforeEach(() => {
  goi = [];
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-09-25T03:00:00Z')); // 10:00 giờ VN
  vi.mocked(layNhatKyApp).mockReset();
  vi.mocked(layNhatKyApp).mockImplementation((thamSo = {}, tuyChon = {}) => new Promise<TrangNhatKyApp>((xong, hong) => {
    tuyChon.signal?.addEventListener('abort', () => hong({ code: 'ERR_CANCELED' }));
    goi.push({ thamSo, signal: tuyChon.signal, ngam: tuyChon.ngam === true, xong, hong });
  }));
  vi.mocked(taiVeNhatKyApp).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('PrintAgentAppLogPanel', () => {
  it('lần đầu: 24 giờ gần nhất (chỉ gửi tu), 200 dòng, không lọc; hiện giờ VN tới mili-giây + mã sự kiện', async () => {
    const w = gan();
    await flushPromises();
    expect(goi).toHaveLength(1);
    expect(goi[0].thamSo).toEqual({
      q: undefined, mayInId: undefined, suKien: undefined, tu: '2026-09-24T03:00:00.000Z', den: undefined,
      truoc: undefined, sau: undefined, gioiHan: 200,
    });
    expect(goi[0].ngam).toBe(false);
    goi[0].xong({ items: [dong('a', '2026-09-25T02:59:58.042Z', { suKien: 'usb_doc', noiDung: 'x'.repeat(600) })], tiepTheo: null });
    await flushPromises();
    expect(w.text()).toContain('25/09 09:59:58.042');
    expect(w.text()).toContain('usb_doc');
    expect(w.text()).toContain('Máy HCM');
    w.unmount();
  });

  it('máy lọc sẵn từ thẻ "Nhật ký in"; viên "Kết nối" gửi hai mã; ô tìm trễ 300 ms, bỏ dấu', async () => {
    const w = gan({ mayInIdDau: 'm1' });
    await flushPromises();
    expect(goi[0].thamSo.mayInId).toBe('m1');
    await nut(w, 'Kết nối')!.trigger('click');
    await flushPromises();
    expect(goi[1].thamSo).toMatchObject({ suKien: 'ket_noi,mat_ket_noi', mayInId: 'm1' });
    expect(goi[0].signal?.aborted).toBe(true);
    await nut(w, 'Tất cả')!.trigger('click');
    await flushPromises();
    expect(goi[2].thamSo.suKien).toBeUndefined();
    (w.vm as unknown as Vm).oTim = 'Lỗi  USB';
    await flushPromises();
    vi.advanceTimersByTime(299);
    await flushPromises();
    expect(goi).toHaveLength(3);
    vi.advanceTimersByTime(1);
    await flushPromises();
    expect(goi[3].thamSo.q).toBe('loi usb');
    w.unmount();
  });

  it('khoảng "Hôm nay" theo ngày lịch VN (có den); "1 giờ" chỉ có tu', async () => {
    const w = gan();
    await flushPromises();
    (w.vm as unknown as Vm).khoang = 'hom_nay';
    await flushPromises();
    expect(goi[1].thamSo).toMatchObject({ tu: '2026-09-24T17:00:00.000Z', den: '2026-09-25T16:59:59.999Z' });
    (w.vm as unknown as Vm).khoang = '1_gio';
    await flushPromises();
    expect(goi[2].thamSo).toMatchObject({ tu: '2026-09-25T02:00:00.000Z', den: undefined });
    w.unmount();
  });

  it('tự làm mới 5 giây bằng con trỏ `sau` (lùi 2 phút, 500 dòng), gộp theo giờ; dòng trễ vào đúng chỗ', async () => {
    const w = gan();
    await flushPromises();
    goi[0].xong({
      items: [dong('b', '2026-09-25T02:59:50.000Z'), dong('a', '2026-09-25T02:59:40.000Z')],
      tiepTheo: '2026-09-25T02:59:40.000Z|a',
    });
    await flushPromises();
    vi.advanceTimersByTime(5_000);
    await flushPromises();
    expect(goi).toHaveLength(2);
    expect(goi[1].ngam).toBe(true);
    // cả hai dòng đều trong 2 phút cuối → con trỏ lùi tới dòng cuối danh sách
    expect(goi[1].thamSo).toMatchObject({ sau: '2026-09-25T02:59:40.000Z|a', gioiHan: 500, tu: goi[0].thamSo.tu, truoc: undefined });
    goi[1].xong({
      items: [dong('tre', '2026-09-25T02:59:45.000Z', { mayInTen: 'Máy HN' }), dong('b', '2026-09-25T02:59:50.000Z'), dong('c', '2026-09-25T02:59:59.000Z')],
      tiepTheo: null,
    });
    await flushPromises();
    expect(w.findAll('.nka-dong').map((d) => d.text())).toEqual([
      expect.stringContaining('nd c'), expect.stringContaining('nd b'), expect.stringContaining('nd tre'), expect.stringContaining('nd a'),
    ]);
    // gộp không đụng con trỏ "Tải thêm" của danh sách
    expect((w.vm as unknown as Vm).tiepTheo).toBe('2026-09-25T02:59:40.000Z|a');
    w.unmount();
  });

  it('nhiều dòng mới hơn một lượt (còn tiepTheo khi đi `sau`) → tải lại trang đầu', async () => {
    const w = gan();
    await flushPromises();
    goi[0].xong({ items: [dong('a', '2026-09-25T02:59:40.000Z')], tiepTheo: null });
    await flushPromises();
    vi.advanceTimersByTime(5_000);
    await flushPromises();
    goi[1].xong({ items: [dong('x', '2026-09-25T02:59:41.000Z')], tiepTheo: '2026-09-25T02:59:41.000Z|x' });
    await flushPromises();
    expect(goi).toHaveLength(3);
    expect(goi[2].thamSo.sau).toBeUndefined();
    expect(goi[2].thamSo.gioiHan).toBe(200);
    w.unmount();
  });

  it('thẻ không được chọn (hoatDong=false) → nghỉ; chọn lại → làm mới ngay; rời trang là dừng', async () => {
    const w = gan();
    await flushPromises();
    goi[0].xong({ items: [dong('a', '2026-09-25T02:59:40.000Z')], tiepTheo: null });
    await flushPromises();
    await w.setProps({ hoatDong: false });
    vi.advanceTimersByTime(30_000);
    await flushPromises();
    expect(goi).toHaveLength(1);
    await w.setProps({ hoatDong: true });
    await flushPromises();
    expect(goi).toHaveLength(2);
    expect(goi[1].thamSo.sau).toBe('2026-09-25T02:59:40.000Z|a');
    goi[1].xong({ items: [], tiepTheo: null });
    await flushPromises();
    w.unmount();
    vi.advanceTimersByTime(30_000);
    await flushPromises();
    expect(goi).toHaveLength(2);
  });

  it('tắt "Tự làm mới" → dừng hẳn', async () => {
    const w = gan();
    await flushPromises();
    goi[0].xong({ items: [], tiepTheo: null });
    await flushPromises();
    (w.vm as unknown as Vm).tuLamMoi = false;
    await flushPromises();
    vi.advanceTimersByTime(30_000);
    await flushPromises();
    expect(goi).toHaveLength(1);
    w.unmount();
  });

  it('"Tải thêm" dùng con trỏ truoc = tiepTheo, đúng khoảng của danh sách', async () => {
    const w = gan();
    await flushPromises();
    goi[0].xong({ items: [dong('b', '2026-09-25T02:59:50.000Z')], tiepTheo: '2026-09-25T02:59:50.000Z|b' });
    await flushPromises();
    await nut(w, 'Tải thêm')!.trigger('click');
    await flushPromises();
    expect(goi[1].thamSo).toMatchObject({ truoc: '2026-09-25T02:59:50.000Z|b', sau: undefined, tu: goi[0].thamSo.tu, gioiHan: 200 });
    goi[1].xong({ items: [dong('a', '2026-09-25T02:00:00.000Z')], tiepTheo: null });
    await flushPromises();
    expect(w.findAll('.nka-dong')).toHaveLength(2);
    expect(nut(w, 'Tải thêm')).toBeUndefined();
    w.unmount();
  });

  it('"Tải xuống .txt" gọi tai-ve với bộ lọc đang chọn rồi tạo link tải', async () => {
    const taoUrl = vi.fn(() => 'blob:x');
    vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL: taoUrl, revokeObjectURL: vi.fn() }));
    const bam = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.mocked(taiVeNhatKyApp).mockResolvedValue({ duLieu: new Blob(['a']), tenFile: 'nhat-ky-may-in-tat-ca-20260925-1000.txt' });
    const w = gan();
    await flushPromises();
    await nut(w, 'Sự cố')!.trigger('click');
    await flushPromises();
    await nut(w, 'Tải xuống .txt')!.trigger('click');
    await flushPromises();
    expect(taiVeNhatKyApp).toHaveBeenCalledWith(expect.objectContaining({ suKien: 'su_co', tu: '2026-09-24T03:00:00.000Z' }));
    expect(taoUrl).toHaveBeenCalled();
    expect(bam).toHaveBeenCalled();
    bam.mockRestore();
    w.unmount();
  });

  it('403 → câu báo quyền, không danh sách, dừng tự làm mới', async () => {
    const w = gan();
    await flushPromises();
    goi[0].hong({ response: { status: 403, data: { error: 'CHI_ADMIN' } } });
    await flushPromises();
    expect(w.text()).toContain('Chỉ chủ sở hữu hoặc quản trị viên xem được nhật ký app máy in.');
    expect(w.find('.nka-ds').exists()).toBe(false);
    expect(w.text()).not.toContain('CHI_ADMIN');
    vi.advanceTimersByTime(30_000);
    await flushPromises();
    expect(goi).toHaveLength(1);
    w.unmount();
  });

  it('503 CHUA_MIGRATE → câu báo rõ; rỗng → câu trạng thái rỗng', async () => {
    const w = gan();
    await flushPromises();
    goi[0].hong({ response: { status: 503, data: { error: 'CHUA_MIGRATE' } } });
    await flushPromises();
    expect(w.text()).toContain('cần chạy migration print_app_logs');
    (w.vm as unknown as Vm).khoang = '7_ngay';
    await flushPromises();
    goi[1].xong({ items: [], tiepTheo: null });
    await flushPromises();
    expect(w.text()).toContain('Không có dòng log app nào khớp bộ lọc trong 7 ngày qua.');
    expect(w.text()).not.toContain('migration');
    w.unmount();
  });
});
