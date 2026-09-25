// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-or-later
// PrintAgentLogPanel — test hành vi yêu cầu mạng: tham số gửi đi, trễ 300 ms ô tìm, huỷ +
// bỏ phản hồi cũ, "Tải thêm", tự làm mới 15 giây (và dọn khi rời trang), 403 → ẩn mục.
// Vuetify thay bằng vỏ tối giản (test logic, không test giao diện Vuetify).
// (Vitest 4 bỏ environmentMatchGlobs của vitest.config.ts → khai jsdom bằng docblock ở dòng 1.)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import type { NhatKy, ThamSoNhatKy, TrangNhatKy } from '@/api/print-agents';

vi.mock('@/api/print-agents', () => ({
  layNhatKy: vi.fn(),
  maHttpCuaLoi: (e: { response?: { status?: number } } | null) => e?.response?.status,
  laYeuCauDaHuy: (e: { code?: string } | null) => e?.code === 'ERR_CANCELED',
}));

import { layNhatKy } from '@/api/print-agents';
import PrintAgentLogPanel from './PrintAgentLogPanel.vue';

interface LuotGoi {
  thamSo: ThamSoNhatKy;
  signal?: AbortSignal;
  ngam: boolean;
  xong: (t: TrangNhatKy) => void;
  hong: (e: unknown) => void;
}

let goi: LuotGoi[] = [];

function dong(id: string, them: Partial<NhatKy> = {}): NhatKy {
  return {
    id, luc: '2026-09-24T02:00:00Z', mucDo: 'loi', loai: 'het_giay', noiDung: `nd ${id}`,
    soHoaDon: null, tenKhach: null, mayInId: 'm1', mayInTen: 'Máy HCM', printJobId: null, chiTiet: null,
    ...them,
  };
}

const vo = (the: string) => defineComponent({
  name: `Vo${the}`,
  setup(_, { slots }) {
    return () => h(the, slots.default?.());
  },
});

const VUETIFY_VO = {
  VSwitch: vo('div'), VBtn: vo('button'), VSpacer: vo('span'), VTextField: vo('div'), VSelect: vo('div'),
  VBtnToggle: vo('div'), VAlert: vo('div'), VProgressLinear: vo('div'), VTable: vo('table'), VChip: vo('span'),
  VIcon: vo('i'), VProgressCircular: vo('span'),
};

function gan(mayIns = [{ id: 'm1', ten: 'Máy HCM', warehouseIds: [], laMacDinh: true, tokenDuoi: 'ab12', online: true }]) {
  return mount(PrintAgentLogPanel, { props: { mayIns }, global: { components: VUETIFY_VO } });
}

// script setup: VTU cho đọc/ghi setupState qua wrapper.vm.
type Vm = Record<string, unknown>;

beforeEach(() => {
  goi = [];
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-09-24T02:00:00Z')); // 09:00 giờ VN
  vi.mocked(layNhatKy).mockReset();
  vi.mocked(layNhatKy).mockImplementation((thamSo = {}, tuyChon = {}) => new Promise<TrangNhatKy>((xong, hong) => {
    tuyChon.signal?.addEventListener('abort', () => hong({ code: 'ERR_CANCELED' }));
    goi.push({ thamSo, signal: tuyChon.signal, ngam: tuyChon.ngam === true, xong, hong });
  }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PrintAgentLogPanel', () => {
  it('lần đầu: mặc định "Lỗi & cảnh báo" + 7 ngày giờ VN, không gửi q/mayInId', async () => {
    const w = gan();
    await flushPromises();
    expect(goi).toHaveLength(1);
    expect(goi[0].thamSo).toEqual({
      q: undefined, mayInId: undefined, mucDo: 'loi_canh_bao', truoc: undefined, gioiHan: 50,
      tu: '2026-09-17T17:00:00.000Z', den: '2026-09-24T16:59:59.999Z',
    });
    goi[0].xong({ items: [dong('a')], tiepTheo: null });
    await flushPromises();
    expect(w.text()).toContain('Hết giấy');
    expect(w.text()).toContain('24/09 09:00:00');
    w.unmount();
  });

  it('ô tìm: trễ 300 ms, bỏ dấu; yêu cầu cũ bị huỷ và phản hồi cũ bị bỏ', async () => {
    const w = gan();
    await flushPromises();
    const vm = w.vm as unknown as Vm;
    vm.oTim = 'Lộc  Beco';
    await flushPromises();
    vi.advanceTimersByTime(299);
    await flushPromises();
    expect(goi).toHaveLength(1);
    vi.advanceTimersByTime(1);
    await flushPromises();
    expect(goi).toHaveLength(2);
    expect(goi[1].thamSo.q).toBe('loc beco');
    expect(goi[0].signal?.aborted).toBe(true);
    // phản hồi muộn của yêu cầu cũ không được đè kết quả mới
    goi[1].xong({ items: [dong('moi')], tiepTheo: null });
    goi[0].xong({ items: [dong('cu')], tiepTheo: null });
    await flushPromises();
    expect(w.text()).toContain('nd moi');
    expect(w.text()).not.toContain('nd cu');
    w.unmount();
  });

  it('"Tải thêm" dùng con trỏ tiepTheo và đúng khoảng (tu, den) của danh sách', async () => {
    const w = gan();
    await flushPromises();
    goi[0].xong({ items: [dong('b')], tiepTheo: 'c1' });
    await flushPromises();
    const nut = w.findAll('button').find((b) => b.text() === 'Tải thêm');
    expect(nut).toBeTruthy();
    await nut!.trigger('click');
    await flushPromises();
    expect(goi[1].thamSo).toMatchObject({ truoc: 'c1', tu: goi[0].thamSo.tu, den: goi[0].thamSo.den });
    goi[1].xong({ items: [dong('b'), dong('a')], tiepTheo: null });
    await flushPromises();
    expect(w.text()).toContain('nd a');
    expect(w.findAll('tr.nk-dong')).toHaveLength(2); // "b" chồng mép không lặp
    expect(w.findAll('button').some((b) => b.text() === 'Tải thêm')).toBe(false);
    w.unmount();
  });

  it('tự làm mới BẬT SẴN: mỗi 15 giây, gộp dòng mới lên đầu, báo trang cha; tắt thì dừng, bật lại gọi ngay; rời trang là dừng', async () => {
    const w = gan();
    await flushPromises();
    goi[0].xong({ items: [dong('a')], tiepTheo: 'c1' });
    await flushPromises();
    expect((w.vm as unknown as Vm).tuLamMoi).toBe(true);
    expect(goi).toHaveLength(1); // mở trang: chỉ lần tải đầu, không gọi đôi
    vi.advanceTimersByTime(15_000);
    await flushPromises();
    expect(goi).toHaveLength(2);
    expect(w.emitted('lamMoi')).toHaveLength(1);
    goi[1].xong({ items: [dong('b'), dong('a')], tiepTheo: 'khac' });
    await flushPromises();
    expect(w.findAll('tr.nk-dong').map((t) => t.text())).toEqual([
      expect.stringContaining('nd b'), expect.stringContaining('nd a'),
    ]);
    // gộp: giữ con trỏ "Tải thêm" của danh sách đang xem
    expect((w.vm as unknown as Vm).tiepTheo).toBe('c1');

    vi.advanceTimersByTime(15_000);
    await flushPromises();
    expect(goi).toHaveLength(3);
    // đang có yêu cầu bay → nhịp sau bỏ lượt, không chồng request
    vi.advanceTimersByTime(15_000);
    await flushPromises();
    expect(goi).toHaveLength(3);
    goi[2].xong({ items: [dong('b')], tiepTheo: null });
    await flushPromises();

    (w.vm as unknown as Vm).tuLamMoi = false;
    await flushPromises();
    vi.advanceTimersByTime(45_000);
    await flushPromises();
    expect(goi).toHaveLength(3);
    (w.vm as unknown as Vm).tuLamMoi = true;
    await flushPromises();
    expect(goi).toHaveLength(4); // bật lại → gọi ngay
    goi[3].xong({ items: [dong('b')], tiepTheo: null });
    await flushPromises();

    w.unmount();
    vi.advanceTimersByTime(60_000);
    await flushPromises();
    expect(goi).toHaveLength(4);
  });

  it('lượt người dùng KHÔNG ngầm (toast 5xx chung như cũ); nhịp tự làm mới LUÔN ngầm — kể cả khi lần tải đầu hỏng', async () => {
    const w = gan();
    await flushPromises();
    expect(goi[0].ngam).toBe(false);
    goi[0].hong({ response: { status: 503, data: { error: 'CHUA_MIGRATE' } } });
    await flushPromises();
    vi.advanceTimersByTime(15_000);
    await flushPromises();
    expect(goi).toHaveLength(2);
    expect(goi[1].ngam).toBe(true); // lần đầu hỏng → nhịp rơi vào tải lại từ đầu, vẫn phải ngầm
    goi[1].xong({ items: [], tiepTheo: null });
    await flushPromises();
    vi.advanceTimersByTime(15_000);
    await flushPromises();
    expect(goi[2].ngam).toBe(true);
    w.unmount();
  });

  it('bảng chưa migrate (503 CHUA_MIGRATE) → câu báo rõ, không phải "mã 503"', async () => {
    const w = gan();
    await flushPromises();
    goi[0].hong({ response: { status: 503, data: { error: 'CHUA_MIGRATE' } } });
    await flushPromises();
    expect(w.text()).toContain('cần chạy migration print_logs');
    w.unmount();
  });

  it('403 → ẩn cả mục, không hiện lỗi, dừng tự làm mới', async () => {
    const w = gan();
    await flushPromises();
    goi[0].hong({ response: { status: 403, data: { error: 'CHI_ADMIN' } } });
    await flushPromises();
    expect(w.find('section').exists()).toBe(false);
    expect(w.text()).not.toContain('CHI_ADMIN');
    (w.vm as unknown as Vm).tuLamMoi = true;
    await flushPromises();
    vi.advanceTimersByTime(30_000);
    await flushPromises();
    expect(goi).toHaveLength(1);
    w.unmount();
  });

  it('lỗi khác → báo rõ, xoá danh sách của bộ lọc cũ; rỗng → câu trạng thái rỗng', async () => {
    const w = gan();
    await flushPromises();
    goi[0].hong({ response: { status: 500, data: { error: 'Internal Server Error' } } });
    await flushPromises();
    expect(w.text()).toContain('Không tải được nhật ký máy in (mã 500).');
    (w.vm as unknown as Vm).khoang = 'hom_nay';
    await flushPromises();
    goi[1].xong({ items: [], tiepTheo: null });
    await flushPromises();
    expect(w.text()).toContain('Không có sự kiện nào khớp bộ lọc trong hôm nay.');
    expect(w.text()).not.toContain('mã 500');
    w.unmount();
  });
});
