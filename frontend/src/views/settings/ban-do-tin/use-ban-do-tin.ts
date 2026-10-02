// SPDX-License-Identifier: AGPL-3.0-or-later
// use-ban-do-tin.ts — trạng thái dùng chung của trang "Bản đồ tin" (provide/inject).
// Chia lớp tính toán để mỗi lần bấm chỉ tính lại phần rẻ:
//   anh (dữ liệu) → mh (mô hình) → boCuc (thu gọn/cột) → duong (định tuyến)   — tính lại khi DỮ LIỆU/BỐ CỤC đổi
//   chon/tro/troDong → kq (trang-thai.ts)                                       — tính lại mỗi lần bấm/rê
import { computed, inject, provide, reactive, ref, shallowRef, type InjectionKey } from 'vue';
import type { BanDoTinClient } from '@/api/ban-do-tin';
import { dungMoHinh } from './mo-hinh';
import { cotGian, dungBoCuc, kepZoom, rongMuonToanManHinh } from './bo-cuc';
import { dinhTuyen } from './dinh-tuyen';
import { tinhTrangThai, type LuaChon } from './trang-thai';
import type { AnhChupBanDo, CheDo, MaDich } from './kieu';

export type TabBanDo = 'so_do' | 'theo_pha' | 'lien_ket' | 'ghi_chu';

export function taoBanDoTin(client: BanDoTinClient) {
  const anh = shallowRef<AnhChupBanDo | null>(null);
  const loi = ref<string | null>(null);
  const dangTai = ref(false);
  const dangLuu = ref(false);
  const loiLuu = ref<string | null>(null);

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

  async function tai() {
    dangTai.value = true;
    loi.value = null;
    try { anh.value = await client.layAnhChup(); } catch (e) { loi.value = (e as Error).message; } finally { dangTai.value = false; }
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

  async function luuLuat(loai: string, dich: MaDich[], cheDo: CheDo) {
    dangLuu.value = true;
    loiLuu.value = null;
    try {
      const cu = anh.value?.luat.find((l) => l.loai === loai);
      await client.luuLuat({ loai, dich, che_do: cheDo, phien_ban: cu?.phien_ban });
      anh.value = await client.layAnhChup();
    } catch (e) {
      loiLuu.value = (e as Error).message;
    } finally { dangLuu.value = false; }
  }
  async function hoanLai(loai: string) {
    dangLuu.value = true;
    loiLuu.value = null;
    try { await client.xoaLuat(loai); anh.value = await client.layAnhChup(); } catch (e) { loiLuu.value = (e as Error).message; } finally { dangLuu.value = false; }
  }

  return {
    client, anh, loi, dangTai, dangLuu, loiLuu, thuGon, toanManHinh, khung, chon, tro, troDong, zoom, zoomVua, tab,
    hopHuongDan, theme, mh, boCuc, duong, kq, tai, datChon, doiThuGon, tatCaThuGon, thuGonTatCa, datZoom, luuLuat, hoanLai,
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
