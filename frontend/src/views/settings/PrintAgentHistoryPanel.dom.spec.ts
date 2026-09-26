// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-or-later
// PrintAgentHistoryPanel (thẻ "Đã in" / "Đã huỷ", 30 ngày) — tự nạp khi thẻ được chọn; dòng: số hoá
// đơn + khách, máy, kết quả (+ người huỷ), giờ tạo, giờ in/huỷ (giờ VN); lọc máy; "Tải thêm" bằng
// con trỏ; tự làm mới 15 giây CHỈ khi thẻ đang chọn + tab hiện (gộp dòng mới lên đầu, bỏ dòng quá
// 30 ngày); đổi bộ lọc nhanh không để trang cũ đè; rỗng; 403 → câu báo quyền; 404 → backend cũ;
// chỉ đọc — không có nút huỷ trên dòng. Vuetify thay bằng vỏ tối giản như các spec máy in khác.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import type { MucLichSu, TrangLichSu } from '@/api/print-agents';

vi.mock('@/api/print-agents', () => ({
  layLichSuIn: vi.fn(),
  maHttpCuaLoi: (e: { response?: { status?: number } } | null) => e?.response?.status,
  laYeuCauDaHuy: (e: { code?: string } | null) => e?.code === 'ERR_CANCELED',
}));

import { layLichSuIn } from '@/api/print-agents';
import PrintAgentHistoryPanel from './PrintAgentHistoryPanel.vue';

const vo = (the: string) => defineComponent({
  name: `Vo${the}`,
  setup(_, { slots }) {
    return () => h(the, slots.default?.());
  },
});
/** v-select vỏ: một <select> thật để test đổi được máy lọc. */
const VoSelect = defineComponent({
  name: 'VoSelect',
  props: { modelValue: String, items: { type: Array, default: () => [] } },
  emits: ['update:modelValue'],
  setup(p, { emit }) {
    return () => h('select', {
      class: 'vo-select',
      value: p.modelValue,
      onChange: (e: Event) => emit('update:modelValue', (e.target as HTMLSelectElement).value),
    }, (p.items as Array<{ title: string; value: string }>).map((o) => h('option', { value: o.value }, o.title)));
  },
});
const VUETIFY_VO = {
  VSelect: VoSelect, VBtn: vo('button'), VAlert: vo('div'), VProgressCircular: vo('span'), VIcon: vo('i'),
  VTable: vo('table'), VThemeProvider: vo('div'),
};

const MAY = [
  { id: 'mHN', ten: 'Máy HN', warehouseIds: [], laMacDinh: true, tokenDuoi: 'ab12', online: true },
  { id: 'mHCM', ten: 'Máy HCM', warehouseIds: [], laMacDinh: false, tokenDuoi: 'cd34', online: true },
];

const BAY_GIO = '2026-09-26T07:00:00.000Z'; // 14:00 giờ VN
const muc = (id: string, them: Partial<MucLichSu> = {}): MucLichSu => ({
  id, soHoaDon: `INV/2026/${id}`, tenKhach: null, mayInId: 'mHN', mayInTen: 'Máy HN', trangThai: 'da_in',
  tao: '2026-09-26T06:40:00.000Z', ketThuc: '2026-09-26T06:48:00.000Z', lyDo: null, ...them,
});
const trang = (items: MucLichSu[], them: Partial<TrangLichSu> = {}): TrangLichSu => ({
  items, tiepTheo: null, tong: items.length, tu: '2026-08-27T07:00:00.000Z', ...them,
});

function gan(props: Record<string, unknown> = {}) {
  return mount(PrintAgentHistoryPanel, {
    props: { trangThai: 'da_in', mayIns: MAY, hoatDong: true, ...props },
    global: { components: VUETIFY_VO },
  });
}
type W = ReturnType<typeof gan>;
const dong = (w: W) => w.findAll('tr.ls-dong');
const goi = () => vi.mocked(layLichSuIn).mock.calls;

/** Promise treo do test tự quyết lúc nào xong. */
function treo<T>() {
  let xong!: (v: T) => void;
  let hong!: (e: unknown) => void;
  const p = new Promise<T>((a, b) => { xong = a; hong = b; });
  return { p, xong, hong };
}

let an = false;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date(BAY_GIO));
  an = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => an });
  vi.mocked(layLichSuIn).mockReset();
  vi.mocked(layLichSuIn).mockResolvedValue(trang([]));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('PrintAgentHistoryPanel — "Đã in"', () => {
  it('thẻ đang chọn → tải trang đầu (không lọc máy); dòng: số HĐ + khách, máy, "Đã in", giờ tạo + giờ in (giờ VN)', async () => {
    vi.mocked(layLichSuIn).mockResolvedValue(trang([
      muc('030067', { tenKhach: 'Anh Lộc Beco' }),
      muc('030066', { mayInId: 'mHCM', mayInTen: 'Máy HCM', ketThuc: '2026-09-25T10:00:00.000Z', tao: '2026-09-25T09:59:00.000Z' }),
    ]));
    const w = gan();
    await flushPromises();
    expect(goi()).toHaveLength(1);
    expect(goi()[0][0]).toEqual({ trangThai: 'da_in', mayInId: undefined, truoc: undefined, gioiHan: 50 });
    const [d1, d2] = dong(w);
    expect(d1.attributes('data-id')).toBe('030067');
    expect(d1.find('.ls-so').text()).toBe('INV/2026/030067');
    expect(d1.find('.ls-khach').text()).toBe('Anh Lộc Beco');
    expect(d1.find('.ls-c-may').text()).toContain('Máy HN');
    expect(d1.find('.ls-chip').text()).toBe('Đã in');
    expect(d1.find('.ls-c-tao .ls-gio').text()).toBe('26/09 13:40:00');
    expect(d1.find('.ls-c-ket-thuc .ls-gio').text()).toBe('26/09 13:48:00');
    expect(d1.find('.ls-c-ket-thuc .ls-tuong-doi').text()).toBe('12 phút trước');
    expect(d2.find('.ls-khach').exists()).toBe(false);
    expect(d2.find('.ls-c-may').text()).toContain('Máy HCM');
    expect(w.findAll('th').map((t) => t.text())).toEqual(['Hoá đơn', 'Máy in', 'Kết quả', 'Tạo lúc', 'In lúc']);
    expect(w.find('.ls-dem').text()).toBe('2 hoá đơn · cập nhật 14:00:00');
    // Chỉ đọc: không có nút huỷ / bỏ trên dòng
    expect(w.findAll('tr.ls-dong button')).toHaveLength(0);
    w.unmount();
  });

  it('gắn khi thẻ CHƯA chọn → không gọi API; được chọn → tải', async () => {
    const w = gan({ hoatDong: false });
    await flushPromises();
    expect(goi()).toHaveLength(0);
    await w.setProps({ hoatDong: true });
    await flushPromises();
    expect(goi()).toHaveLength(1);
    w.unmount();
  });

  it('rỗng → câu "chưa có … 30 ngày"; đang lọc một máy → gợi ý chọn "Tất cả máy in"', async () => {
    const w = gan();
    await flushPromises();
    expect(w.text()).toContain('Chưa có hoá đơn nào in xong trong 30 ngày gần nhất.');
    expect(w.text()).not.toContain('Chỉ đang xem một máy');
    await w.find('select.vo-select').setValue('mHCM');
    await flushPromises();
    expect(goi().at(-1)![0]).toMatchObject({ trangThai: 'da_in', mayInId: 'mHCM' });
    expect(w.text()).toContain('Chỉ đang xem một máy');
    w.unmount();
  });

  it('"Tải thêm" gửi con trỏ, nối trang sau (bỏ trùng); đếm "50/120"', async () => {
    const trang1 = Array.from({ length: 3 }, (_, i) => muc(`a${i}`));
    vi.mocked(layLichSuIn).mockResolvedValueOnce(trang(trang1, { tiepTheo: 'C1', tong: 5 }));
    const w = gan();
    await flushPromises();
    expect(w.find('.ls-dem').text()).toContain('3/5 hoá đơn');
    vi.mocked(layLichSuIn).mockResolvedValueOnce(trang([muc('a2'), muc('b0'), muc('b1')], { tiepTheo: null, tong: null }));
    await w.findAll('button').find((b) => b.text() === 'Tải thêm')!.trigger('click');
    await flushPromises();
    expect(goi().at(-1)![0]).toMatchObject({ truoc: 'C1' });
    expect(dong(w).map((d) => d.attributes('data-id'))).toEqual(['a0', 'a1', 'a2', 'b0', 'b1']);
    expect(w.findAll('button').some((b) => b.text() === 'Tải thêm')).toBe(false);
    expect(w.find('.ls-dem').text()).toMatch(/^5 hoá đơn · cập nhật/);
    w.unmount();
  });

  it('tự làm mới 15 giây: gộp dòng MỚI lên đầu, bỏ dòng đã quá 30 ngày; KHÔNG chạy khi thẻ không chọn hoặc tab ẩn', async () => {
    const cu = muc('cu', { ketThuc: '2026-08-27T06:59:00.000Z' }); // vừa rơi khỏi cửa sổ khi làm mới
    vi.mocked(layLichSuIn).mockResolvedValueOnce(trang([muc('b'), cu], { tong: 2 }));
    const w = gan();
    await flushPromises();
    vi.mocked(layLichSuIn).mockResolvedValue(trang([muc('moi'), muc('b')], { tong: 2, tu: '2026-08-27T07:00:15.000Z' }));
    vi.advanceTimersByTime(15_000);
    await flushPromises();
    expect(goi()).toHaveLength(2);
    expect(goi()[1][1]).toMatchObject({ ngam: true });
    expect(dong(w).map((d) => d.attributes('data-id'))).toEqual(['moi', 'b']);
    await w.setProps({ hoatDong: false });
    vi.advanceTimersByTime(30_000);
    await flushPromises();
    expect(goi()).toHaveLength(2);
    await w.setProps({ hoatDong: true }); // quay lại thẻ → lấy ngay phần đã lỡ
    await flushPromises();
    expect(goi()).toHaveLength(3);
    an = true;
    vi.advanceTimersByTime(30_000);
    await flushPromises();
    expect(goi()).toHaveLength(3);
    w.unmount();
  });

  it('đổi máy lọc khi trang cũ còn bay → trang cũ về sau KHÔNG đè', async () => {
    const cham = treo<TrangLichSu>();
    vi.mocked(layLichSuIn).mockReturnValueOnce(cham.p);
    const w = gan();
    await flushPromises();
    vi.mocked(layLichSuIn).mockResolvedValueOnce(trang([muc('hcm', { mayInId: 'mHCM', mayInTen: 'Máy HCM' })]));
    await w.find('select.vo-select').setValue('mHCM');
    await flushPromises();
    cham.xong(trang([muc('cu-tat-ca')]));
    await flushPromises();
    expect(dong(w).map((d) => d.attributes('data-id'))).toEqual(['hcm']);
    w.unmount();
  });

  it('403 → câu báo quyền, không bảng, không gọi thêm; 404 → báo backend cũ', async () => {
    vi.mocked(layLichSuIn).mockRejectedValueOnce({ response: { status: 403 } });
    const a = gan();
    await flushPromises();
    expect(a.text()).toContain('Chỉ chủ sở hữu hoặc quản trị viên xem được lịch sử in.');
    vi.advanceTimersByTime(60_000);
    await flushPromises();
    expect(goi()).toHaveLength(1);
    a.unmount();
    vi.mocked(layLichSuIn).mockRejectedValueOnce({ response: { status: 404 } });
    const b = gan();
    await flushPromises();
    expect(b.text()).toContain('Máy chủ chưa có lịch sử in (backend cần cập nhật).');
    b.unmount();
  });
});

describe('PrintAgentHistoryPanel — "Đã huỷ"', () => {
  it('gọi trangThai=da_huy; chip "Đã huỷ" + người huỷ; cột "Huỷ lúc"; rỗng có câu riêng', async () => {
    vi.mocked(layLichSuIn).mockResolvedValueOnce(trang([
      muc('1', { trangThai: 'da_huy', lyDo: 'Đã huỷ bởi ZaloCRM (Chị Hoa)' }),
      muc('2', { trangThai: 'da_huy', lyDo: null }),
    ]));
    const w = gan({ trangThai: 'da_huy' });
    await flushPromises();
    expect(goi()[0][0]).toMatchObject({ trangThai: 'da_huy' });
    const [d1, d2] = dong(w);
    expect(d1.find('.ls-chip').text()).toBe('Đã huỷ');
    expect(d1.find('.ls-ly-do').text()).toBe('Đã huỷ bởi ZaloCRM (Chị Hoa)');
    expect(d2.find('.ls-ly-do').text()).toBe('Hoá đơn chắc chắn không in');
    expect(w.findAll('th').at(-1)!.text()).toBe('Huỷ lúc');
    w.unmount();
    vi.mocked(layLichSuIn).mockResolvedValueOnce(trang([]));
    const r = gan({ trangThai: 'da_huy' });
    await flushPromises();
    expect(r.text()).toContain('Không có lệnh in nào bị huỷ trong 30 ngày gần nhất.');
    r.unmount();
  });
});
