// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-or-later
// BanDoTinPage — trang Cài đặt › Hệ thống › "Bản đồ tin" (docs/78 C3) với client GIẢ LẬP:
//   • bấm khối ⇒ panel: khi nào gửi, ví dụ NGUYÊN VĂN trong bong bóng Zalo, nguồn câu, đích + hash #khoi=;
//   • tin 🔒 ⇒ mọi ô đích bị khoá kèm lý do; tin ✎ ⇒ tick đích gọi client.luuLuat, khối bản sao hiện trên sơ đồ;
//   • rào phía trình duyệt: khách + nhạy cảm bị khoá; kho + giá ⇒ cảnh báo che giá;
//   • chạy bóng ⇒ "Nếu bật, 24 giờ qua sẽ gửi N"; Gửi thử tắt khi chưa có backend;
//   • Esc bỏ chọn (xoá hash); điện thoại < 768 ⇒ cổng "mở trên máy tính" rồi bản rút gọn Theo pha.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';

vi.mock('@/api/index', () => ({ api: {} }));

import BanDoTinPage from './BanDoTinPage.vue';
import { taoClientMau } from './ban-do-tin/client-mau';
import vd from './ban-do-tin/du-lieu-mau.json';
import type { BanDoTinClient } from '@/api/ban-do-tin';

let w: VueWrapper | null = null;
async function mo(rong = 1440, hash = ''): Promise<{ w: VueWrapper; client: BanDoTinClient }> {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: rong });
  history.replaceState(null, '', `/settings/ban-do-tin${hash}`);
  const client = taoClientMau();
  vi.spyOn(client, 'luuLuat');
  w = mount(BanDoTinPage, { props: { client }, attachTo: document.body });
  await flushPromises();
  return { w, client };
}
const bamKhoi = async (wr: VueWrapper, id: string) => { await wr.find(`[data-khoi="${id}"]`).trigger('click'); await flushPromises(); };
const panel = (wr: VueWrapper) => wr.find('[data-panel]');

beforeEach(() => {
  w?.unmount(); w = null;
  try { localStorage.clear(); sessionStorage.clear(); } catch { /* jsdom */ }
});

describe('BanDoTinPage — máy tính', () => {
  it('vẽ đủ khối, chú giải sáu loại, nhãn dữ liệu mẫu', async () => {
    const { w } = await mo();
    expect(w.findAll('.bdt-khoi').length).toBeGreaterThan(46);
    expect(w.findAll('[data-loai]')).toHaveLength(6);
    expect(w.text()).toContain('Dữ liệu mẫu');
  });

  it('bấm khối ⇒ panel có khi nào gửi, ví dụ nguyên văn, nguồn câu; hash #khoi=', async () => {
    const { w } = await mo();
    await bamKhoi(w, 'the_xem_truoc@nhom_goc');
    const p = panel(w);
    expect(p.text()).toContain('Khi nào gửi');
    const goc = (vd as { id: string; vi_du: string }[]).find((x) => x.id === 'the_xem_truoc')!.vi_du;
    expect(p.find('[data-vi-du]').element.textContent).toBe(goc);
    expect(p.text()).toContain('Nguồn câu');
    expect(location.hash).toBe('#khoi=the_xem_truoc@nhom_goc');
    expect(w.find('[data-khoi="the_xem_truoc@nhom_goc"]').classes()).toContain('chon');
    expect(w.find('[data-khoi="kho_cong@nhom_goc"]').classes()).toContain('mo-chon');
    expect(p.text()).toMatch(/Nhận từ\s*2/);
    expect(p.text()).toMatch(/Đẩy sang\s*7/);
  });

  it('tin 🔒: ô đích khoá + lý do; chế độ không đổi được', async () => {
    const { w } = await mo();
    await bamKhoi(w, 'the_xem_truoc@nhom_goc');
    const p = panel(w);
    expect(p.text()).toContain('Đích cố định');
    for (const o of p.findAll('[data-dich] input')) expect((o.element as HTMLInputElement).disabled).toBe(true);
    expect(p.findAll('.bdt-che-do button').every((b) => (b.element as HTMLButtonElement).disabled)).toBe(true);
  });

  it('tin ✎ bản sao: nơi gốc 🔒, khách bị chặn, tick Kế toán ⇒ luuLuat + khối bản sao xuất hiện', async () => {
    const { w, client } = await mo();
    await bamKhoi(w, 'da_chot@nhom_goc');
    let p = panel(w);
    expect((p.find('[data-dich-dong="nhom_goc"] input').element as HTMLInputElement).disabled).toBe(true);
    expect((p.find('[data-dich-dong="g_khach"] input').element as HTMLInputElement).disabled).toBe(true);
    expect(p.find('[data-dich-dong="g_khach"]').text()).toMatch(/cấm vào nhóm khách/);
    expect(p.find('[data-lo]').text()).toMatch(/giá, SĐT/);
    await p.find('[data-dich-dong="g_ketoan"] input').setValue(true);
    await flushPromises();
    expect(client.luuLuat).toHaveBeenCalledWith(expect.objectContaining({ loai: 'da_chot', dich: ['nhom_goc', 'g_ketoan'], che_do: 'bat' }));
    expect(w.find('[data-khoi="da_chot@g_ketoan"]').exists()).toBe(true);
    p = panel(w);
    expect(p.text()).toMatch(/thêm Kế toán/); // nhật ký
  });

  it('kho + giá ⇒ cảnh báo bản che giá sau khi tick', async () => {
    const { w } = await mo();
    await bamKhoi(w, 'xuat_hoa_don_tool@nhom_goc');
    await panel(w).find('[data-dich-dong="g_kho"] input').setValue(true);
    await flushPromises();
    expect(panel(w).find('[data-dich-dong="g_kho"]').text()).toMatch(/che giá/);
  });

  it('chạy bóng ⇒ "Nếu bật, 24 giờ qua sẽ gửi N"; Gửi thử tắt', async () => {
    const { w } = await mo();
    await bamKhoi(w, 'in_xong@g_kho');
    const p = panel(w);
    expect(p.find('[data-neu-bat]').text()).toMatch(/Nếu bật, 24 giờ qua sẽ gửi \d+ tin/);
    const gui = p.findAll('button').find((b) => b.text().includes('Gửi thử'))!;
    expect((gui.element as HTMLButtonElement).disabled).toBe(true);
  });

  it('rê dòng panel ⇒ đúng một đường được đánh dấu đang trỏ', async () => {
    const { w } = await mo();
    await bamKhoi(w, 'the_xem_truoc@nhom_goc');
    const dong = panel(w).findAll('.bdt-lk')[2];
    await dong.trigger('mouseenter');
    const id = dong.attributes('data-lk');
    expect(w.findAll('.bdt-bong.to')).toHaveLength(1);
    expect(w.find('.bdt-bong.to').attributes('data-bong')).toBeDefined();
    expect(id).toBeTruthy();
  });

  it('Esc bỏ chọn và xoá hash; hash lúc mở trang được áp', async () => {
    const { w } = await mo(1440, '#pha=chot');
    expect(panel(w).text()).toMatch(/P3 · Chốt/);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(location.hash).toBe('');
    expect(panel(w).text()).toContain('Bấm vào sơ đồ để bắt đầu');
  });
});

describe('BanDoTinPage — điện thoại', () => {
  it('< 768 ⇒ cổng mở trên máy tính; bản rút gọn = Theo pha, tab Sơ đồ khoá; chọn thẻ ⇒ bottom sheet + #khoi=', async () => {
    const { w } = await mo(390);
    expect(w.find('[data-cong]').exists()).toBe(true);
    expect(w.find('.bdt-khoi').exists()).toBe(false);
    await w.find('[data-rut-gon]').trigger('click');
    await flushPromises();
    expect(w.find('[data-tab="so_do"]').classes()).toContain('khoa');
    expect(w.find('[data-tab="theo_pha"]').attributes('aria-selected')).toBe('true');
    await w.find('[data-the]').trigger('click');
    await flushPromises();
    expect(w.find('.bdt-panel.sheet').exists()).toBe(true);
    expect(location.hash).toMatch(/^#khoi=/);
  });
});
