// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-or-later
// PrintAgentQueuePanel (thẻ "Hàng đợi in") — hợp đồng hàng đợi/huỷ v5.1 §6.1, §8.2, §8.5, §8.10:
// hộp xác nhận ("Huỷ lệnh in" / "Giữ lại", "sẽ KHÔNG được in"), đang huỷ (spinner + khoá nút),
// ok ("Đã huỷ ✓" 3 giây rồi rời), không ok (chip đỏ + câu đầy đủ, dòng ở lại), huỷ nhiều + toast
// tổng, "Chọn tất cả của máy X", "Vì sao không huỷ được?", bỏ theo dõi (KHÔNG BAO GIỜ "đã huỷ"),
// rỗng, tự làm mới 5 giây + tạm dừng, lỗi kết nối → "chưa rõ".
// Vuetify thay bằng vỏ tối giản như các spec máy in khác; v-dialog vỏ CHỈ vẽ khi đang mở.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import type { HangDoiIn, KetQuaBoTheoDoi, KetQuaHuy, MucHangDoi } from '@/api/print-agents';

const { toast } = vi.hoisted(() => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));
vi.mock('@/composables/use-toast', () => ({ useToast: () => toast }));
vi.mock('@/api/print-agents', () => ({ huyLenhIn: vi.fn(), boTheoDoiLenhIn: vi.fn() }));

import { huyLenhIn, boTheoDoiLenhIn } from '@/api/print-agents';
import PrintAgentQueuePanel from './PrintAgentQueuePanel.vue';
import { LY_DO_KHONG_HUY } from './may-in-hang-doi';

const vo = (the: string) => defineComponent({
  name: `Vo${the}`,
  setup(_, { slots }) {
    return () => h(the, slots.default?.());
  },
});
const VoDialog = defineComponent({
  name: 'VoDialog',
  props: { modelValue: Boolean },
  setup(p, { slots }) {
    return () => (p.modelValue ? h('div', { class: 'vo-dialog', role: 'dialog' }, slots.default?.()) : null);
  },
});
const VUETIFY_VO = {
  VSelect: vo('div'), VBtn: vo('button'), VAlert: vo('div'), VProgressCircular: vo('span'), VIcon: vo('i'),
  VTable: vo('table'), VDialog: VoDialog, VCard: vo('div'), VCardText: vo('div'), VCardActions: vo('div'), VSpacer: vo('span'),
};

const MAY = [
  { id: 'mHN', ten: 'Máy HN', warehouseIds: [], laMacDinh: true, tokenDuoi: 'ab12', online: true },
  { id: 'mHCM', ten: 'Máy HCM', warehouseIds: [], laMacDinh: false, tokenDuoi: 'cd34', online: true },
];

const muc = (id: string, them: Partial<MucHangDoi> = {}): MucHangDoi => ({
  id, soHoaDon: `INV/${id}`, tenKhach: null, mayInId: 'mHN', mayInTen: 'Máy HN', trangThai: 'cho_in', nhom: 'cho_in',
  lyDo: 'Chờ tới lượt in', tamGiu: false, lanThu: 0, tao: '2026-09-25T02:48:00.000Z', capNhat: '2026-09-25T02:48:00.000Z',
  huy: 'chac_chan', ...them,
});
const khongRo = (id: string, them: Partial<MucHangDoi> = {}) => muc(id, {
  trangThai: 'khong_ro', nhom: 'chua_xac_nhan', huy: 'khong', lyDo: 'Chưa xác nhận đã in — có thể đang nằm trong máy in', ...them,
});
const hd = (choIn: MucHangDoi[], chuaXacNhan: MucHangDoi[] = []): HangDoiIn => ({ choIn, chuaXacNhan, capNhat: '2026-09-25T03:00:00.000Z' });

function gan(hangDoi: HangDoiIn | null, props: Record<string, unknown> = {}) {
  return mount(PrintAgentQueuePanel, {
    props: { hangDoi, mayIns: MAY, hoatDong: true, ...props },
    global: { components: VUETIFY_VO },
  });
}
type W = ReturnType<typeof gan>;
const nutCo = (w: W, chu: string) => w.findAll('button').filter((b) => b.text() === chu);
const nut = (w: W, chu: string) => nutCo(w, chu)[0];
const dong = (w: W, id: string) => w.find(`tr[data-id="${id}"]`);
const hop = (w: W) => w.find('.vo-dialog');

/** Promise treo do test tự quyết lúc nào xong — để thấy trạng thái "đang huỷ". */
function treo<T>() {
  let xong!: (v: T) => void;
  let hong!: (e: unknown) => void;
  const p = new Promise<T>((a, b) => { xong = a; hong = b; });
  return { p, xong, hong };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-09-25T03:00:00Z')); // 10:00 giờ VN
  vi.mocked(huyLenhIn).mockReset();
  vi.mocked(boTheoDoiLenhIn).mockReset();
  toast.success.mockReset();
  toast.warning.mockReset();
  toast.error.mockReset();
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('PrintAgentQueuePanel — hiển thị', () => {
  it('nhóm "Đang chờ in": hoá đơn + khách, máy, chip + lý do, "Chờ từ" giờ VN + tương đối; ô chọn CHỈ ở lệnh huỷ được', async () => {
    const w = gan(hd([
      muc('1', { tenKhach: 'Anh Lộc Beco', tamGiu: true, lyDo: 'Tạm giữ — máy in Hết giấy (từ 09:45)' }),
      muc('2', { trangThai: 'dang_gui', huy: 'khong', lyDo: 'Đang gửi xuống máy in' }),
    ], [khongRo('9')]));
    await flushPromises();
    const d1 = dong(w, '1');
    expect(d1.text()).toContain('INV/1');
    expect(d1.text()).toContain('Anh Lộc Beco');
    expect(d1.text()).toContain('Máy HN');
    expect(d1.text()).toContain('Tạm giữ');
    expect(d1.text()).toContain('Tạm giữ — máy in Hết giấy (từ 09:45)');
    expect(d1.text()).toContain('25/09 09:48:00');
    expect(d1.text()).toContain('12 phút trước');
    expect(d1.find('input[type="checkbox"]').exists()).toBe(true);
    expect(d1.classes()).toContain('hd-dong--tam-giu');
    const d2 = dong(w, '2');
    expect(d2.text()).toContain('Đang gửi');
    expect(d2.find('input[type="checkbox"]').exists()).toBe(false);
    expect(d2.text()).not.toMatch(/(^|\s)Huỷ(\s|$)/);
    expect(d2.text()).toContain('Vì sao không huỷ được?');
    // "Chưa xác nhận" thu gọn sẵn khi đang có lệnh chờ in
    expect(dong(w, '9').exists()).toBe(false);
    const nutNhom = w.find('#hd-nhom-chua-xn');
    expect(nutNhom.attributes('aria-expanded')).toBe('false');
    expect(nutNhom.text()).toContain('1');
    await nutNhom.trigger('click');
    expect(dong(w, '9').exists()).toBe(true);
    w.unmount();
  });

  it('không lệnh chờ in → nhóm "Chưa xác nhận" mở sẵn; rỗng cả hai → "Không có lệnh in nào đang chờ ✓"', async () => {
    const a = gan(hd([], [khongRo('9')]));
    expect(dong(a, '9').exists()).toBe(true);
    a.unmount();
    const b = gan(hd([]));
    expect(b.text()).toContain('Không có lệnh in nào đang chờ ✓');
    b.unmount();
  });

  it('lọc sẵn một máy (bấm chip trên thẻ máy) → chỉ lệnh của máy đó', async () => {
    const w = gan(hd([muc('1'), muc('2', { mayInId: 'mHCM', mayInTen: 'Máy HCM' })]), { locMay: { mayInId: 'mHCM', lan: 1 } });
    await flushPromises();
    expect(dong(w, '1').exists()).toBe(false);
    expect(dong(w, '2').exists()).toBe(true);
    w.unmount();
  });
});

describe('PrintAgentQueuePanel — huỷ một lệnh', () => {
  it('hộp xác nhận: "Huỷ lệnh in INV/1?" + "Hoá đơn INV/1 sẽ KHÔNG được in." + nút "Huỷ lệnh in" / "Giữ lại"; Giữ lại → không gọi API', async () => {
    const w = gan(hd([muc('1')]));
    await nut(w, 'Huỷ').trigger('click');
    expect(hop(w).exists()).toBe(true);
    expect(hop(w).text()).toContain('Huỷ lệnh in INV/1?');
    expect(hop(w).text()).toContain('Hoá đơn INV/1 sẽ KHÔNG được in.');
    expect(nut(w, 'Huỷ lệnh in')).toBeTruthy();
    await nut(w, 'Giữ lại').trigger('click');
    expect(hop(w).exists()).toBe(false);
    expect(huyLenhIn).not.toHaveBeenCalled();
    w.unmount();
  });

  it('đang huỷ: "Đang huỷ…" + nút khoá; ok → "Đã huỷ ✓" 3 giây rồi rời danh sách; toast; xin tải lại', async () => {
    const t = treo<KetQuaHuy[]>();
    vi.mocked(huyLenhIn).mockReturnValue(t.p);
    const hai = muc('2', { tao: '2026-09-25T02:49:00.000Z' });
    const w = gan(hd([muc('1'), hai]));
    await nutCo(w, 'Huỷ')[0].trigger('click');
    await nut(w, 'Huỷ lệnh in').trigger('click');
    await flushPromises();
    expect(huyLenhIn).toHaveBeenCalledWith(['1']);
    expect(dong(w, '1').text()).toContain('Đang huỷ…');
    expect(dong(w, '1').find('input[type="checkbox"]').attributes('disabled')).toBeDefined();
    // Trong lúc chờ: mọi nút Huỷ còn lại bị khoá
    expect(nutCo(w, 'Huỷ').every((b) => b.attributes('disabled') !== undefined)).toBe(true);
    t.xong([{ id: '1', soHoaDon: 'INV/1', ok: true, trangThaiMoi: 'da_huy', cach: 'chua_gui', noiDung: 'Đã huỷ — hoá đơn chắc chắn không in' }]);
    await flushPromises();
    expect(dong(w, '1').text()).toContain('Đã huỷ ✓');
    expect(dong(w, '1').classes()).toContain('hd-dong--da-huy');
    expect(toast.success).toHaveBeenCalledWith('Đã huỷ lệnh in INV/1 — hoá đơn chắc chắn không in');
    expect(w.emitted('taiLai')).toContainEqual([{ ngam: false }]);
    // Trang cha nạp lại NGAY: máy chủ không còn trả lệnh đã huỷ — dòng vẫn hiện "Đã huỷ ✓" đủ 3 giây
    await w.setProps({ hangDoi: hd([hai]) });
    expect(dong(w, '1').text()).toContain('Đã huỷ ✓');
    expect(w.findAll('tbody tr').map((t) => t.attributes('data-id'))).toEqual(['1', '2']);
    vi.advanceTimersByTime(2_999);
    await flushPromises();
    expect(dong(w, '1').exists()).toBe(true);
    vi.advanceTimersByTime(1);
    await flushPromises();
    // Rời danh sách dù snapshot (chưa tải lại) vẫn còn mang nó
    expect(dong(w, '1').exists()).toBe(false);
    expect(dong(w, '2').exists()).toBe(true);
    w.unmount();
  });

  it('không ok → dòng Ở LẠI, chip đỏ "Không huỷ được" + câu đầy đủ; không có chữ "Đã huỷ"', async () => {
    vi.mocked(huyLenhIn).mockResolvedValue([{ id: '1', soHoaDon: 'INV/1', ok: false, trangThaiMoi: 'dang_gui', loi: 'DANG_IN', noiDung: LY_DO_KHONG_HUY.dangIn }]);
    const w = gan(hd([muc('1')]));
    await nut(w, 'Huỷ').trigger('click');
    await nut(w, 'Huỷ lệnh in').trigger('click');
    await flushPromises();
    vi.advanceTimersByTime(10_000);
    await flushPromises();
    const d = dong(w, '1');
    expect(d.exists()).toBe(true);
    expect(d.find('.hd-chip--do').text()).toContain('Không huỷ được');
    expect(d.text()).toContain(LY_DO_KHONG_HUY.dangIn);
    expect(d.text()).not.toContain('Đã huỷ');
    expect(toast.error).toHaveBeenCalledWith('Không huỷ được lệnh in INV/1 — xem lý do ở dòng');
    // Snapshot mới (đã sang đang gửi) → thông báo vẫn giữ tới khi dòng rời hoặc người dùng ẩn
    await w.setProps({ hangDoi: hd([muc('1', { trangThai: 'dang_gui', huy: 'khong' })]) });
    expect(dong(w, '1').text()).toContain('Không huỷ được');
    await nut(w, 'Ẩn thông báo').trigger('click');
    expect(dong(w, '1').text()).not.toContain('Không huỷ được');
    w.unmount();
  });

  it('lỗi kết nối → "Chưa rõ kết quả" (không nói đã huỷ, không nói không huỷ được), toast lỗi, xin tải lại', async () => {
    vi.mocked(huyLenhIn).mockRejectedValue({ response: { status: 502 } });
    const w = gan(hd([muc('1')]));
    await nut(w, 'Huỷ').trigger('click');
    await nut(w, 'Huỷ lệnh in').trigger('click');
    await flushPromises();
    const d = dong(w, '1');
    expect(d.text()).toContain('Chưa rõ kết quả');
    expect(d.text()).not.toContain('Đã huỷ');
    expect(d.text()).not.toContain('Không huỷ được');
    expect(toast.error).toHaveBeenCalled();
    expect(w.emitted('taiLai')).toContainEqual([{ ngam: false }]);
    w.unmount();
  });
});

describe('PrintAgentQueuePanel — huỷ nhiều', () => {
  it('"Chọn tất cả của Máy HN" chỉ chọn lệnh huỷ được của máy đó → "Huỷ 4 lệnh đã chọn" → toast "Đã huỷ 3/4 lệnh"', async () => {
    const ds = [
      muc('1'), muc('2'), muc('3'), muc('4', { tamGiu: true }),
      muc('5', { trangThai: 'dang_gui', huy: 'khong' }),
      muc('6', { mayInId: 'mHCM', mayInTen: 'Máy HCM' }),
    ];
    vi.mocked(huyLenhIn).mockImplementation(async (ids: string[]) => ids.map((id) => (id === '3'
      ? { id, soHoaDon: `INV/${id}`, ok: false, trangThaiMoi: 'dang_gui', loi: 'DANG_IN', noiDung: LY_DO_KHONG_HUY.dangIn }
      : { id, soHoaDon: `INV/${id}`, ok: true, trangThaiMoi: 'da_huy', cach: 'chua_gui', noiDung: 'ok' })));
    const w = gan(hd(ds));
    expect(nut(w, 'Chọn tất cả của Máy HN (4)')).toBeTruthy();
    expect(nut(w, 'Chọn tất cả của Máy HCM (1)')).toBeTruthy();
    await nut(w, 'Chọn tất cả của Máy HN (4)').trigger('click');
    expect(w.text()).toContain('4 lệnh đã chọn');
    expect((dong(w, '6').find('input').element as HTMLInputElement).checked).toBe(false);
    await nut(w, 'Huỷ 4 lệnh đã chọn').trigger('click');
    expect(hop(w).text()).toContain('Huỷ 4 lệnh in đã chọn?');
    expect(hop(w).text()).toContain('Hoá đơn INV/1, INV/2, INV/3, INV/4 sẽ KHÔNG được in.');
    await nut(w, 'Huỷ lệnh in').trigger('click');
    await flushPromises();
    expect(huyLenhIn).toHaveBeenCalledWith(['1', '2', '3', '4']);
    expect(toast.warning).toHaveBeenCalledWith('Đã huỷ 3/4 lệnh — 1 lệnh không huỷ được (xem từng dòng)');
    for (const id of ['1', '2', '4']) expect(dong(w, id).text()).toContain('Đã huỷ ✓');
    expect(dong(w, '3').text()).toContain('Không huỷ được');
    vi.advanceTimersByTime(3_000);
    await flushPromises();
    expect(['1', '2', '3', '4', '5', '6'].filter((id) => dong(w, id).exists())).toEqual(['3', '5', '6']);
    w.unmount();
  });

  it('ô chọn ở tiêu đề chọn/bỏ mọi lệnh huỷ được đang hiện', async () => {
    const w = gan(hd([muc('1'), muc('2'), muc('5', { trangThai: 'dang_gui', huy: 'khong' })]));
    await w.find('thead input[type="checkbox"]').trigger('change');
    expect(w.text()).toContain('2 lệnh đã chọn');
    await w.find('thead input[type="checkbox"]').trigger('change');
    expect(w.text()).not.toContain('lệnh đã chọn');
    w.unmount();
  });
});

describe('PrintAgentQueuePanel — lệnh không huỷ được', () => {
  it('"Vì sao không huỷ được?" hiện đúng câu theo trạng thái (đang gửi / chưa xác nhận)', async () => {
    const w = gan(hd([muc('5', { trangThai: 'dang_gui', huy: 'khong' })], [khongRo('9')]));
    await nut(w, 'Vì sao không huỷ được?').trigger('click');
    expect(hop(w).text()).toContain('Vì sao không huỷ được INV/5?');
    expect(hop(w).text()).toContain(LY_DO_KHONG_HUY.dangIn);
    await nut(w, 'Đã hiểu').trigger('click');
    await w.find('#hd-nhom-chua-xn').trigger('click');
    await dong(w, '9').findAll('button').find((b) => b.text() === 'Vì sao không huỷ được?')!.trigger('click');
    expect(hop(w).text()).toContain(LY_DO_KHONG_HUY.chuaXacNhan);
    w.unmount();
  });

  it('"Bỏ khỏi hàng đợi": xác nhận nói rõ KHÔNG chặn việc in; ok → "Đã bỏ khỏi hàng đợi" (KHÔNG "Đã huỷ") rồi rời', async () => {
    vi.mocked(boTheoDoiLenhIn).mockResolvedValue([{ id: '9', ok: true, noiDung: 'Đã bỏ khỏi hàng đợi — hệ thống KHÔNG biết hoá đơn đã in hay chưa' }] satisfies KetQuaBoTheoDoi[]);
    const w = gan(hd([], [khongRo('9')]));
    expect(dong(w, '9').text()).not.toMatch(/(^|\s)Huỷ(\s|$)/);
    await nut(w, 'Bỏ khỏi hàng đợi').trigger('click');
    expect(hop(w).text()).toContain('Bỏ INV/9 khỏi hàng đợi?');
    expect(hop(w).text()).toContain('KHÔNG chặn việc in');
    expect(hop(w).text()).toContain('KHÔNG biết hoá đơn đã in hay chưa');
    expect(nutCo(w, 'Giữ lại')).toHaveLength(1);
    await hop(w).findAll('button').find((b) => b.text() === 'Bỏ khỏi hàng đợi')!.trigger('click');
    await flushPromises();
    expect(boTheoDoiLenhIn).toHaveBeenCalledWith(['9']);
    await w.setProps({ hangDoi: hd([], []) }); // nạp lại ngay: máy chủ không còn trả lệnh đã bỏ
    expect(dong(w, '9').text()).toContain('Đã bỏ khỏi hàng đợi');
    expect(w.text()).not.toMatch(/Đã huỷ/);
    const toastOk = toast.success.mock.calls[0][0] as string;
    expect(toastOk).toContain('không biết đã in hay chưa');
    expect(toastOk).not.toMatch(/huỷ/i);
    vi.advanceTimersByTime(3_000);
    await flushPromises();
    expect(dong(w, '9').exists()).toBe(false);
    w.unmount();
  });

  it('bỏ theo dõi không được → chip đỏ "Không bỏ được" + câu máy chủ, dòng ở lại', async () => {
    vi.mocked(boTheoDoiLenhIn).mockResolvedValue([{ id: '9', ok: false, noiDung: 'Chỉ bỏ theo dõi được lệnh chưa xác nhận đã in — lệnh này đã in xong.' }]);
    const w = gan(hd([], [khongRo('9')]));
    await nut(w, 'Bỏ khỏi hàng đợi').trigger('click');
    await hop(w).findAll('button').find((b) => b.text() === 'Bỏ khỏi hàng đợi')!.trigger('click');
    await flushPromises();
    expect(dong(w, '9').text()).toContain('Không bỏ được');
    expect(dong(w, '9').text()).toContain('lệnh này đã in xong');
    w.unmount();
  });
});

describe('PrintAgentQueuePanel — tự làm mới 5 giây', () => {
  it('mở thẻ → xin ngay; rồi mỗi 5 giây; nghỉ khi thẻ ẩn / tab trình duyệt ẩn / hộp xác nhận mở / đang huỷ', async () => {
    const w = gan(hd([muc('1')]));
    const dem = () => (w.emitted('taiLai') ?? []).filter(([t]) => (t as { ngam: boolean }).ngam).length;
    expect(dem()).toBe(1); // mở thẻ: lấy ngay
    vi.advanceTimersByTime(5_000);
    expect(dem()).toBe(2);
    // hộp xác nhận đang mở
    await nut(w, 'Huỷ').trigger('click');
    vi.advanceTimersByTime(10_000);
    expect(dem()).toBe(2);
    await nut(w, 'Giữ lại').trigger('click');
    // tab trình duyệt ẩn
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    vi.advanceTimersByTime(5_000);
    expect(dem()).toBe(2);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    // đang huỷ
    const t = treo<KetQuaHuy[]>();
    vi.mocked(huyLenhIn).mockReturnValue(t.p);
    await nut(w, 'Huỷ').trigger('click');
    await nut(w, 'Huỷ lệnh in').trigger('click');
    vi.advanceTimersByTime(10_000);
    expect(dem()).toBe(2);
    t.xong([{ id: '1', soHoaDon: 'INV/1', ok: false, trangThaiMoi: 'dang_gui', loi: 'DANG_IN', noiDung: 'x' }]);
    await flushPromises();
    vi.advanceTimersByTime(5_000);
    expect(dem()).toBe(3);
    // thẻ không được chọn
    await w.setProps({ hoatDong: false });
    vi.advanceTimersByTime(10_000);
    expect(dem()).toBe(3);
    await w.setProps({ hoatDong: true }); // quay lại thẻ: lấy ngay
    expect(dem()).toBe(4);
    w.unmount();
  });

  it('rời trang → dừng hẹn giờ (không xin tải lại nữa)', async () => {
    const nghe = vi.fn();
    const w = gan(hd([muc('1')]), { onTaiLai: nghe });
    expect(nghe).toHaveBeenCalledTimes(1); // lần mở thẻ
    w.unmount();
    vi.advanceTimersByTime(20_000);
    expect(nghe).toHaveBeenCalledTimes(1);
  });
});
