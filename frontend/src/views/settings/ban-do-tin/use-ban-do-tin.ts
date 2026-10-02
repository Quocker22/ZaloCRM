// SPDX-License-Identifier: AGPL-3.0-or-later
// use-ban-do-tin.ts — trạng thái dùng chung của trang "Bản đồ tin" (provide/inject).
// Chia lớp tính toán để mỗi lần bấm chỉ tính lại phần rẻ:
//   anh (dữ liệu) → mh (mô hình) → boCuc (thu gọn/cột) → duong (định tuyến)   — tính lại khi DỮ LIỆU/BỐ CỤC đổi
//   chon/tro/troDong → kq (trang-thai.ts)                                       — tính lại mỗi lần bấm/rê
import { computed, inject, provide, reactive, ref, shallowRef, type InjectionKey } from 'vue';
import type { BanDoTinClient } from '@/api/ban-do-tin';
import { loiTuApi } from './loi';
import { dungMoHinh } from './mo-hinh';
import { doiHangTrongDich, dungAnhChup } from './chuyen-doi';
import { cotGian, dungBoCuc, kepZoom, rongMuonToanManHinh } from './bo-cuc';
import { dinhTuyen } from './dinh-tuyen';
import { tinhTrangThai, type LuaChon } from './trang-thai';
import type { AnhChupBanDo, CheDo, MaDich } from './kieu';
import type { DichLuatApi } from './hop-dong';

export type TabBanDo = 'so_do' | 'theo_pha' | 'lien_ket' | 'ghi_chu';

export function taoBanDoTin(client: BanDoTinClient) {
  const anh = shallowRef<AnhChupBanDo | null>(null);
  const loi = ref<string | null>(null);
  const dangTai = ref(false);
  /** đã tải xong mà bot chưa gửi ảnh chụp nào (GET /ban-do-tin → banDo null) */
  const chuaCoBanDo = ref(false);
  /** số luật CRM đang có (hiện ở trạng thái trống — luật vẫn sống dù chưa có bản đồ) */
  const soLuatKhiTrong = ref(0);
  const dangLuu = ref(false);
  /** lỗi của lần lưu gần nhất — `chu` là câu server NGUYÊN VĂN */
  const loiLuu = ref<{ chu: string; code: string | null; loai: string } | null>(null);
  /** thông báo sau lưu (vd đã tải lại vì luật vừa bị người khác sửa) */
  const tinLuu = ref<string | null>(null);

  const thuGon = shallowRef<ReadonlySet<string>>(new Set());
  const toanManHinh = ref(false);
  const khung = reactive({ rong: 1000, cao: 700 });

  const chon = shallowRef<LuaChon | null>(null);
  const tro = ref<string | null>(null);
  const troDong = ref<string | null>(null);

  const zoom = ref(1);
  const zoomVua = ref(1);
  const tab = ref<TabBanDo>('so_do');
  const hopHuongDan = ref(false);
  const theme = ref<'light' | 'dark'>('light');

  const mh = computed(() => (anh.value ? dungMoHinh(anh.value) : null));
  const boCucThuong = computed(() => (mh.value ? dungBoCuc(mh.value, { thuGon: thuGon.value }) : null));
  const boCuc = computed(() => {
    const b = boCucThuong.value;
    if (!b || !mh.value || !toanManHinh.value) return b;
    const g = cotGian(mh.value.pha.length, rongMuonToanManHinh(khung.rong, khung.cao, b.cao));
    if (g.cotBuoc === b.cotBuoc) return b;
    return dungBoCuc(mh.value, { thuGon: thuGon.value, ...g });
  });
  const duong = computed(() => (boCuc.value && mh.value ? dinhTuyen(boCuc.value, mh.value.lienKet) : {}));
  const kq = computed(() => (mh.value ? tinhTrangThai(mh.value, { chon: chon.value, tro: tro.value, troDong: troDong.value }) : null));

  async function napAnh(): Promise<void> {
    const [banDo, luat, crm] = await Promise.allSettled([client.layBanDo(), client.layLuat(), client.layCrmTuDong()]);
    if (banDo.status === 'rejected') throw banDo.reason;
    if (luat.status === 'rejected') throw luat.reason;
    if (!banDo.value) {
      chuaCoBanDo.value = true;
      soLuatKhiTrong.value = luat.value.luat.length;
      anh.value = null;
      return;
    }
    chuaCoBanDo.value = false;
    anh.value = dungAnhChup({
      banDo: banDo.value,
      luat: luat.value,
      crm: crm.status === 'fulfilled' ? crm.value : null,
      loiCrm: crm.status === 'rejected' ? loiTuApi(crm.reason).message : null,
      mau: client.laMau,
    });
  }

  async function tai() {
    dangTai.value = true;
    loi.value = null;
    try { await napAnh(); } catch (e) { loi.value = loiTuApi(e).message; } finally { dangTai.value = false; }
  }

  function datChon(c: LuaChon | null) {
    chon.value = c;
    troDong.value = null;
  }

  function doiThuGon(id: string) {
    const s = new Set(thuGon.value);
    if (s.has(id)) s.delete(id); else s.add(id);
    thuGon.value = s;
  }
  const coTheThuGon = computed(() => (mh.value?.nhom ?? []).filter((n) => !n.le).map((n) => n.id));
  const tatCaThuGon = computed(() => coTheThuGon.value.length > 0 && coTheThuGon.value.every((id) => thuGon.value.has(id)));
  function thuGonTatCa() {
    thuGon.value = tatCaThuGon.value ? new Set() : new Set(coTheThuGon.value);
  }

  const datZoom = (z: number) => { zoom.value = kepZoom(z); };

  const luatCua = (loai: string) => anh.value?.luat.find((l) => l.loai === loai);

  /**
   * Một lần ghi luật: có luật ⇒ PUT (kèm phienBan đang xem); chưa có ⇒ POST (CRM mặc định chạy bóng). Lỗi ⇒ câu server
   * nguyên văn; 409 (luật vừa bị sửa / vừa có người tạo) ⇒ tải lại để lần sau ghi đúng phiên bản. Luôn tải lại sau ghi.
   */
  async function ghiLuat(loai: string, thay: { dich?: DichLuatApi[]; cheDo?: CheDo }) {
    dangLuu.value = true;
    loiLuu.value = null;
    tinLuu.value = null;
    try {
      const cu = luatCua(loai);
      if (cu) await client.suaLuat(cu.id, { phienBan: cu.phien_ban, ...thay });
      else await client.taoLuat({ loai, dich: thay.dich ?? [], ...(thay.cheDo ? { cheDo: thay.cheDo } : {}) });
      await napAnh();
      if (!cu) tinLuu.value = thay.cheDo ? null : 'Đã tạo luật ở chế độ CHẠY BÓNG — bot ghi sổ, chưa gửi. Xem số 24 giờ rồi bấm Bật.';
    } catch (e) {
      const l = loiTuApi(e);
      loiLuu.value = { chu: l.message, code: l.code, loai };
      if (l.status === 409) {
        try { await napAnh(); tinLuu.value = 'Đã tải lại luật mới nhất — kiểm lại rồi sửa tiếp.'; } catch { /* giữ lỗi gốc */ }
      }
    } finally { dangLuu.value = false; }
  }

  /** Bật/tắt MỘT hàng bản sao (giữ nguyên các đích khác, kể cả đích NV). */
  function doiDich(loai: string, hang: MaDich, co: boolean) {
    return ghiLuat(loai, { dich: doiHangTrongDich(luatCua(loai)?.dich_tho ?? [], hang, co) });
  }
  /** Thay cả danh sách đích (thêm/bỏ đích NV). */
  function datDich(loai: string, dich: DichLuatApi[]) { return ghiLuat(loai, { dich }); }
  function doiCheDo(loai: string, cheDo: CheDo) { return ghiLuat(loai, { cheDo }); }

  async function hoanLai(loai: string) {
    const cu = luatCua(loai);
    if (!cu) return;
    dangLuu.value = true;
    loiLuu.value = null;
    tinLuu.value = null;
    try { await client.xoaLuat(cu.id); await napAnh(); } catch (e) {
      loiLuu.value = { chu: loiTuApi(e).message, code: loiTuApi(e).code, loai };
    } finally { dangLuu.value = false; }
  }

  return {
    client, anh, loi, dangTai, chuaCoBanDo, soLuatKhiTrong, dangLuu, loiLuu, tinLuu, thuGon, toanManHinh, khung, chon, tro, troDong, zoom, zoomVua, tab,
    hopHuongDan, theme, mh, boCuc, duong, kq, tai, datChon, doiThuGon, tatCaThuGon, thuGonTatCa, datZoom, luatCua, doiDich, datDich, doiCheDo, hoanLai,
  };
}

export type BanDoTin = ReturnType<typeof taoBanDoTin>;
const KHOA: InjectionKey<BanDoTin> = Symbol('ban-do-tin');
export const cungCapBanDoTin = (s: BanDoTin) => provide(KHOA, s);
export function dungBanDoTin(): BanDoTin {
  const s = inject(KHOA);
  if (!s) throw new Error('thiếu provide ban-do-tin');
  return s;
}
