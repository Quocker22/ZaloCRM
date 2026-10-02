// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-or-later
// BanDoTinPage — trang Cài đặt › Hệ thống › "Bản đồ tin" (docs/78 C3) với client GIẢ LẬP đúng hợp đồng API:
//   • bấm khối ⇒ panel: khi nào gửi, ví dụ NGUYÊN VĂN trong bong bóng Zalo, nguồn câu, đích + hash #khoi=;
//   • tin 🔒 ⇒ mọi ô đích khoá kèm lý do, không có chế độ; tin ✎: tick đích ⇒ POST luật (chạy bóng) / PUT kèm phienBan;
//   • lỗi server hiện NGUYÊN VĂN; 409 ⇒ tải lại; canhBao của CRM hiện ở trang + panel; số bóng 24h của luật;
//   • lớp CRM tự động chỉ xem; trạng thái trống khi bot chưa gửi danh mục; nhãn "Dữ liệu mẫu" chỉ với adapter giả lập;
//   • Esc bỏ chọn (xoá hash); điện thoại < 768 ⇒ cổng "mở trên máy tính" rồi bản rút gọn Theo pha.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';

vi.mock('@/api/index', () => ({ api: {} }));

import BanDoTinPage from './BanDoTinPage.vue';
import { taoClientMau, type TuyChonMau } from './ban-do-tin/client-mau';
import { LoiBanDoTin } from './ban-do-tin/loi';
import vd from './ban-do-tin/du-lieu-mau.json';
import type { BanDoTinClient } from '@/api/ban-do-tin';

let w: VueWrapper | null = null;
async function mo(rong = 1440, hash = '', tc: TuyChonMau = {}, sua?: (c: BanDoTinClient) => void): Promise<{ w: VueWrapper; client: BanDoTinClient }> {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: rong });
  history.replaceState(null, '', `/settings/ban-do-tin${hash}`);
  const client = taoClientMau(tc);
  for (const k of ['taoLuat', 'suaLuat', 'xoaLuat', 'layLuat', 'layBanDo'] as const) vi.spyOn(client, k);
  sua?.(client);
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

  it('tin 🔒: ô đích khoá + lý do; không có phần chế độ', async () => {
    const { w } = await mo();
    await bamKhoi(w, 'the_xem_truoc@nhom_goc');
    const p = panel(w);
    expect(p.text()).toContain('Đích cố định');
    for (const o of p.findAll('[data-dich] input')) expect((o.element as HTMLInputElement).disabled).toBe(true);
    expect(p.find('.bdt-che-do').exists()).toBe(false);
    // bổ sung 02/10: dòng 🔒 = ly_do_khoa bot khai; nhãn Soạn; số khối gốc 24h + 7 ngày
    expect(p.find('[data-ly-do-khoa]').text()).toBe("Đích cố định: Mã chốt gắn với làn hội thoại; gửi chỗ khác thì 'chốt' ở đó không tìm ra đơn.");
    expect(p.find('[data-soan]').text()).toBe('Soạn: Mã');
    expect(p.find('[data-so-khoi] [data-cua-so="h24"]').text()).toMatch(/\d+ đã gửi/);
    expect(p.find('[data-so-khoi] [data-cua-so="d7"]').text()).toMatch(/\d+ đã gửi/);
  });

  it('bổ sung 02/10: khối mang nhãn Mã/Model/Mẫu/Ảnh theo ai_soan + số 24h của khối gốc; gợi ý 💡 trong panel', async () => {
    const { w } = await mo();
    const nhan = (id: string) => w.find(`[data-khoi="${id}"] [data-soan]`).text();
    expect([nhan('the_xem_truoc@nhom_goc'), nhan('model_tra_loi@nhom_goc'), nhan('bao_cao_soan_tin@nhom_goc'), nhan('anh_bao_gia@nhom_goc')])
      .toEqual(['Mã', 'Model', 'Mẫu', 'Ảnh']);
    expect(w.find('[data-khoi="crm_su_kien_in@crm_bot"]').exists()).toBe(true);
    expect(w.find('[data-khoi="crm_su_kien_in@crm_bot"] [data-soan]').exists()).toBe(false);
    const so = w.find('[data-khoi="the_xem_truoc@nhom_goc"] [data-dem-khoi]');
    expect(so.text()).toMatch(/^\d+\/24h$/);
    expect(so.find('[data-dem-bong]').exists()).toBe(false);
    expect(so.attributes('title')).toMatch(/^24 giờ: .* — 7 ngày: /);
    await bamKhoi(w, 'xuat_hoa_don_tool@nhom_goc');
    expect(panel(w).find('[data-goi-y]').text()).toBe('💡 Ứng viên: thêm nhóm Kế toán.');
    expect(panel(w).find('[data-ly-do-khoa]').exists()).toBe(false);
  });

  it('tin ✎ chưa có luật: nơi gốc 🔒, khách bị chặn; tick Kế toán ⇒ POST luật (CRM mặc định chạy bóng) + khối bản sao "Bóng"', async () => {
    const { w, client } = await mo();
    await bamKhoi(w, 'da_chot@nhom_goc');
    let p = panel(w);
    expect(p.find('[data-chua-luat]').exists()).toBe(true);
    expect((p.find('[data-dich-dong="nhom_goc"] input').element as HTMLInputElement).disabled).toBe(true);
    expect((p.find('[data-dich-dong="g_khach"] input').element as HTMLInputElement).disabled).toBe(true);
    expect(p.find('[data-dich-dong="g_khach"]').text()).toMatch(/cấm vào nhóm khách/);
    expect(p.find('[data-lo]').text()).toMatch(/giá, SĐT/);
    await p.find('[data-dich-dong="g_ketoan"] input').setValue(true);
    await flushPromises();
    expect(client.taoLuat).toHaveBeenCalledWith({ loai: 'da_chot', dich: [{ kieu: 'chuc_nang', gia_tri: 'ke_toan' }] });
    expect(client.suaLuat).not.toHaveBeenCalled();
    const k = w.find('[data-khoi="da_chot@g_ketoan"]');
    expect(k.exists()).toBe(true);
    expect(k.text()).toContain('Bóng');
    p = panel(w);
    expect(p.find('[data-tin-luu]').text()).toMatch(/CHẠY BÓNG/);
    expect(p.find('[data-luat-meta]').text()).toMatch(/phiên bản 1/);
  });

  it('luật đã có: tick Kho ⇒ PUT kèm phienBan, giữ đích cũ; cảnh báo bản che giá', async () => {
    const { w, client } = await mo();
    await bamKhoi(w, 'xuat_hoa_don_tool@nhom_goc');
    await panel(w).find('[data-dich-dong="g_kho"] input').setValue(true);
    await flushPromises();
    expect(client.suaLuat).toHaveBeenCalledWith('luat-1', {
      phienBan: 1, dich: [{ kieu: 'chuc_nang', gia_tri: 'ke_toan' }, { kieu: 'chuc_nang', gia_tri: 'kho' }],
    });
    expect(panel(w).find('[data-dich-dong="g_kho"]').text()).toMatch(/che giá/);
    expect(w.find('[data-khoi="xuat_hoa_don_tool@g_kho"]').exists()).toBe(true);
  });

  it('đổi chế độ ⇒ PUT chỉ cheDo; Hoàn lại như mã ⇒ DELETE, khối bản sao biến mất', async () => {
    const { w, client } = await mo();
    await bamKhoi(w, 'xuat_hoa_don_tool@nhom_goc');
    await panel(w).findAll('.bdt-che-do button').find((b) => b.text() === 'Chạy bóng')!.trigger('click');
    await flushPromises();
    expect(client.suaLuat).toHaveBeenCalledWith('luat-1', { phienBan: 1, cheDo: 'bong' });
    expect(w.find('[data-khoi="xuat_hoa_don_tool@g_ketoan"]').text()).toContain('Bóng');
    await panel(w).find('[data-hoan-lai]').trigger('click');
    await flushPromises();
    expect(client.xoaLuat).not.toHaveBeenCalled(); // hỏi trước
    await w.find('[data-xac-nhan] [data-dong-y]').trigger('click');
    await flushPromises();
    expect(client.xoaLuat).toHaveBeenCalledWith('luat-1');
    expect(w.find('[data-khoi="xuat_hoa_don_tool@g_ketoan"]').exists()).toBe(false);
  });

  it('lỗi server hiện NGUYÊN VĂN; 409 PHIEN_BAN_CU ⇒ tải lại luật + báo', async () => {
    const CAU = 'Không có nhân viên bot với zalo_uid uid-x trong tổ chức';
    const { w, client } = await mo(1440, '', {}, (c) => {
      vi.spyOn(c, 'suaLuat')
        .mockRejectedValueOnce(new LoiBanDoTin(CAU, 400, 'NV_KHONG_CO'))
        .mockRejectedValueOnce(new LoiBanDoTin('Luật vừa được người khác sửa — tải lại rồi sửa tiếp', 409, 'PHIEN_BAN_CU'));
    });
    await bamKhoi(w, 'xuat_hoa_don_tool@nhom_goc');
    await panel(w).find('[data-dich-dong="g_admin"] input').setValue(true);
    await flushPromises();
    expect(panel(w).find('[data-loi-luu]').text()).toBe(CAU);
    const lanTai = vi.mocked(client.layLuat).mock.calls.length;
    await panel(w).find('[data-dich-dong="g_admin"] input').setValue(true);
    await flushPromises();
    expect(panel(w).find('[data-loi-luu]').text()).toBe('Luật vừa được người khác sửa — tải lại rồi sửa tiếp');
    expect(vi.mocked(client.layLuat).mock.calls.length).toBe(lanTai + 1);
    expect(panel(w).find('[data-tin-luu]').text()).toMatch(/Đã tải lại/);
  });

  it('luật chạy bóng ⇒ "Nếu bật, 24 giờ qua sẽ gửi N" (tổng bong/24h của luật); Gửi thử tắt; link Nhật ký Quyền bot', async () => {
    const { w } = await mo();
    await bamKhoi(w, 'in_sau_chot@nhom_goc');
    const p = panel(w);
    expect(p.find('[data-neu-bat]').text()).toMatch(/Nếu bật, 24 giờ qua sẽ gửi \d+ tin/);
    const gui = p.findAll('button').find((b) => b.text().includes('Gửi thử'))!;
    expect((gui.element as HTMLButtonElement).disabled).toBe(true);
    expect(p.find('[data-nhat-ky]').attributes('href')).toBe('/settings/bot-quyen?tab=nhat-ky');
  });

  it('canhBao của CRM hiện ở đầu trang và trong panel của loại tin đó', async () => {
    const CB = 'in_sau_chot: bỏ đích chuc_nang:khach — Tin "In sau chốt" có dữ liệu nhạy cảm (gia) — không gửi vào nhóm khách';
    const { w } = await mo(1440, '', {}, (c) => {
      const goc = c.layLuat.bind(c);
      c.layLuat = async () => ({ ...(await goc()), canhBao: [CB] });
    });
    expect(w.find('[data-canh-bao-trang]').text()).toContain(CB);
    await bamKhoi(w, 'in_sau_chot@nhom_goc');
    expect(panel(w).find('[data-canh-bao]').text()).toContain(CB);
    await bamKhoi(w, 'xuat_hoa_don_tool@nhom_goc');
    expect(panel(w).find('[data-canh-bao]').exists()).toBe(false);
  });

  it('Một NV chỉ định: chọn NV ⇒ PUT thêm đích nv (zalo_uid)', async () => {
    const { w, client } = await mo();
    await bamKhoi(w, 'xuat_hoa_don_tool@nhom_goc');
    const chon = panel(w).find('[data-them-nv]');
    await chon.trigger('focus');
    await flushPromises();
    await chon.setValue('uid-nv-lan');
    await flushPromises();
    expect(client.suaLuat).toHaveBeenCalledWith('luat-1', {
      phienBan: 1, dich: [{ kieu: 'chuc_nang', gia_tri: 'ke_toan' }, { kieu: 'nv', gia_tri: 'uid-nv-lan' }],
    });
    expect(panel(w).find('[data-nv-dich]').text()).toContain('Chị Lan');
  });

  it('khối CRM tự động: chỉ xem, nói rõ bật/tắt + lý do, không có ô tick', async () => {
    const { w } = await mo();
    await bamKhoi(w, 'crm_lich_hen_nhac@crm_sale');
    const p = panel(w);
    expect(p.find('[data-crm-trang-thai]').text()).toMatch(/chỉ xem.*Đang tắt: Chưa bật "Nhắc lịch hẹn qua Zalo"/s);
    expect(p.find('[data-dich] input').exists()).toBe(false);
  });

  it('lớp CRM tự động hỏng ⇒ vẫn vẽ phần bot + báo ở đầu trang', async () => {
    const { w } = await mo(1440, '', { loiCrm: true });
    expect(w.findAll('.bdt-khoi').length).toBeGreaterThan(46);
    expect(w.find('[data-canh-bao-trang]').text()).toMatch(/Không tải được lớp CRM tự động/);
  });

  it('bot chưa gửi ảnh chụp ⇒ trạng thái trống rõ ràng, không vẽ sơ đồ', async () => {
    const { w } = await mo(1440, '', { trong: true });
    expect(w.find('[data-chua-co-ban-do]').text()).toContain('Bot chưa gửi danh mục — bản đồ sẽ hiện khi bot cập nhật bản mới');
    expect(w.find('.bdt-khoi').exists()).toBe(false);
  });

  it('adapter thật (không phải giả lập) ⇒ KHÔNG có nhãn "Dữ liệu mẫu"', async () => {
    const { w } = await mo(1440, '', {}, (c) => { (c as { laMau: boolean }).laMau = false; });
    expect(w.text()).not.toContain('Dữ liệu mẫu');
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

describe('BanDoTinPage — tự rà vòng 2', () => {
  it('link sâu trỏ tới khối không còn trong danh mục ⇒ bỏ chọn, xoá hash, báo "Khối không còn trong danh mục"', async () => {
    const { w } = await mo(1440, '#khoi=da_bo_khoi_nay@nhom_goc');
    expect(location.hash).toBe('');
    expect(w.find('[data-chon-mat]').text()).toBe('Khối không còn trong danh mục');
    expect(panel(w).text()).toContain('Bấm vào sơ đồ để bắt đầu');
    await bamKhoi(w, 'the_xem_truoc@nhom_goc');
    expect(w.find('[data-chon-mat]').exists()).toBe(false);
  });

  it('liên kết cũ (#lien-ket=) và đích ẩn (#dich=) cũng bị bỏ + báo đúng loại', async () => {
    let r = await mo(1440, '#lien-ket=a@nhom_goc~b@nhom_goc');
    expect(location.hash).toBe('');
    expect(r.w.find('[data-chon-mat]').text()).toBe('Liên kết không còn trong danh mục');
    r.w.unmount(); w = null;
    r = await mo(1440, '#dich=n_khac');
    expect(location.hash).toBe('');
    expect(r.w.find('[data-chon-mat]').text()).toBe('Đích không còn trong danh mục');
  });

  it('khối bản sao đang xem biến mất sau "Hoàn lại như mã" ⇒ panel về trống + báo, không lơ lửng', async () => {
    const { w } = await mo();
    await bamKhoi(w, 'xuat_hoa_don_tool@g_ketoan');
    await panel(w).find('[data-hoan-lai]').trigger('click');
    await w.find('[data-xac-nhan] [data-dong-y]').trigger('click');
    await flushPromises();
    expect(panel(w).text()).toContain('Bấm vào sơ đồ để bắt đầu');
    expect(location.hash).toBe('');
    expect(w.find('[data-chon-mat]').text()).toBe('Khối không còn trong danh mục');
  });

  it('link sâu hợp lệ ⇒ cuộn khối đích vào khung (SPEC §7)', async () => {
    const cuon = vi.fn();
    const goc = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = cuon;
    try {
      await mo(1440, '#khoi=the_xem_truoc@nhom_goc');
      expect(cuon).toHaveBeenCalled();
      expect((cuon.mock.contexts.at(-1) as HTMLElement).getAttribute('data-khoi')).toBe('the_xem_truoc@nhom_goc');
    } finally { Element.prototype.scrollIntoView = goc; }
  });

  it('"Hoàn lại như mã": huỷ trong hộp xác nhận ⇒ không xoá; Esc đóng hộp mà KHÔNG bỏ chọn khối', async () => {
    const { w, client } = await mo();
    await bamKhoi(w, 'xuat_hoa_don_tool@nhom_goc');
    await panel(w).find('[data-hoan-lai]').trigger('click');
    const hop = w.find('[data-xac-nhan]');
    expect(hop.attributes('role')).toBe('alertdialog');
    expect(hop.text()).toMatch(/Hoàn lại như mã/);
    expect(hop.element.contains(document.activeElement)).toBe(true);
    await hop.find('[data-huy]').trigger('click');
    expect(w.find('[data-xac-nhan]').exists()).toBe(false);
    await panel(w).find('[data-hoan-lai]').trigger('click');
    w.find('[data-xac-nhan]').element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await flushPromises();
    expect(w.find('[data-xac-nhan]').exists()).toBe(false);
    expect(location.hash).toBe('#khoi=xuat_hoa_don_tool@nhom_goc');
    expect(client.xoaLuat).not.toHaveBeenCalled();
  });

  it('chuyển sang Bật ⇒ hỏi trước, nói "24 giờ qua sẽ gửi N tin" nếu biết; đồng ý ⇒ PUT cheDo bat', async () => {
    const { w, client } = await mo();
    await bamKhoi(w, 'in_sau_chot@nhom_goc');
    const n = panel(w).find('[data-neu-bat] b').text();
    await panel(w).findAll('.bdt-che-do button').find((b) => b.text() === 'Bật')!.trigger('click');
    expect(client.suaLuat).not.toHaveBeenCalled();
    expect(w.find('[data-xac-nhan]').text()).toContain(`24 giờ qua sẽ gửi ${n} tin`);
    await w.find('[data-xac-nhan] [data-dong-y]').trigger('click');
    await flushPromises();
    expect(client.suaLuat).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ cheDo: 'bat' }));
  });

  it('chưa có luật ⇒ nút Bật khoá kèm lý do (luật mới bắt đầu ở chạy bóng)', async () => {
    const { w, client } = await mo();
    await bamKhoi(w, 'da_chot@nhom_goc');
    const bat = panel(w).findAll('.bdt-che-do button').find((b) => b.text() === 'Bật')!;
    expect((bat.element as HTMLButtonElement).disabled).toBe(true);
    expect(bat.attributes('title')).toMatch(/luật mới bắt đầu ở Chạy bóng/);
    expect(client.taoLuat).not.toHaveBeenCalled();
  });

  it('lưu được nhưng tải lại hỏng ⇒ "Đã lưu; tải lại lỗi", KHÔNG báo lỗi lưu', async () => {
    const { w, client } = await mo();
    vi.mocked(client.layLuat).mockRejectedValue(new LoiBanDoTin('Mất mạng', 0, null));
    await bamKhoi(w, 'xuat_hoa_don_tool@nhom_goc');
    await panel(w).find('[data-dich-dong="g_admin"] input').setValue(true);
    await flushPromises();
    expect(client.suaLuat).toHaveBeenCalled();
    expect(panel(w).find('[data-loi-luu]').exists()).toBe(false);
    expect(panel(w).find('[data-tin-luu]').text()).toMatch(/^Đã lưu; tải lại lỗi/);
  });

  it('khối có chạy bóng: số chính = đã gửi thật, bóng tách riêng; panel có "chưa rõ"', async () => {
    const { w } = await mo();
    const so = w.find('[data-khoi="in_sau_chot@g_kho"] [data-dem-khoi]');
    expect(so.find('[data-dem-gui]').text()).toBe('0');
    expect(so.find('[data-dem-bong]').text()).toMatch(/^\d+ bóng$/);
    expect(so.attributes('title')).toMatch(/chạy bóng/);
    await bamKhoi(w, 'the_xem_truoc@nhom_goc');
    expect(panel(w).find('[data-cua-so="h24"]').text()).toMatch(/chưa rõ/);
  });

  it('bong số focus được bằng phím (tabindex + aria-label), Enter chọn liên kết', async () => {
    const { w } = await mo();
    await bamKhoi(w, 'the_xem_truoc@nhom_goc');
    const b = w.find('.bdt-bong');
    expect(b.attributes('tabindex')).toBe('0');
    expect(b.attributes('aria-label')).toMatch(/^Liên kết \d+: .+ → .+/);
    await b.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(location.hash).toMatch(/^#lien-ket=/);
  });

  it('hộp hướng dẫn: không hứa "đổi đích tự do" cho tin ✎; giữ focus trong hộp, Esc trả focus về nút mở', async () => {
    const { w } = await mo();
    const nut = w.findAll('button').find((b) => b.text().includes('Hướng dẫn sử dụng'))!;
    (nut.element as HTMLElement).focus();
    await nut.trigger('click');
    await flushPromises();
    const hop = w.find('.bdt-hop');
    expect(hop.text()).not.toMatch(/✎ cho THÊM bản sao.*đổi đích tự do/);
    expect(hop.text()).toContain('nơi gốc luôn nhận');
    expect(hop.text()).toContain('Mỗi loại tin một luật; tick cập nhật luật đó');
    expect(hop.text()).toContain('khi đích không phải Admin');
    expect(hop.element.contains(document.activeElement)).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(w.find('.bdt-hop').exists()).toBe(false);
    expect(document.activeElement).toBe(nut.element);
  });

  it('khối CRM tự động không có đầu vào ⇒ "Kích hoạt bởi sự kiện/lịch của CRM" (không phải "tin NV gõ")', async () => {
    const { w } = await mo();
    await bamKhoi(w, 'crm_lich_hen_nhac@crm_sale');
    expect(panel(w).text()).toContain('Kích hoạt bởi sự kiện/lịch của CRM');
    expect(panel(w).text()).not.toContain('tin NV gõ');
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
    (w.find('[data-the]').element as HTMLElement).focus(); // trình duyệt focus nút khi bấm; jsdom thì không
    await w.find('[data-the]').trigger('click');
    await flushPromises();
    expect(w.find('.bdt-panel.sheet').exists()).toBe(true);
    expect(location.hash).toMatch(/^#khoi=/);
    // bottom sheet: focus vào sheet, Esc đóng và trả focus về thẻ đã mở
    expect(w.find('.bdt-panel.sheet').element.contains(document.activeElement)).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(w.find('.bdt-panel.sheet').exists()).toBe(false);
    expect(document.activeElement).toBe(w.find('[data-the]').element);
  });
});
