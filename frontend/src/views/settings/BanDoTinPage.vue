<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  BanDoTinPage — Cài đặt › Hệ thống › "Bản đồ tin" (docs/78 §3 C3).
  Mọi tin bot gửi, từ đầu tới cuối: cột = pha, hàng = đích, khối = loại tin × đích, đường = tin này dẫn tới tin kia.
  Giao diện dựng lại theo số đo `docs/78-thong-bao-chu-dong/tham-chieu-noti/SPEC.md` (mã của mình, không chép).
  Dữ liệu qua `BanDoTinClient` (@/api/ban-do-tin): API thật /bot-quyen/ban-do-tin + /luat-thong-bao + /ban-do-tin/crm-tu-dong.
  Adapter giả lập chỉ vào qua prop `client` (test, khung so ảnh) — khi đó hiện nhãn "Dữ liệu mẫu".
-->
<template>
  <div
    ref="goc" class="bdt" :data-theme="s.theme.value"
    :class="{ 'bdt-dt': manHinh === 'dt' }"
  >
    <div class="bdt-trang" :class="{ 'toan-man-hinh': s.toanManHinh.value }">
      <div class="bdt-thanh">
        <div class="bdt-tabs" role="tablist" aria-label="Cách xem" @keydown.left.prevent="buocTab(-1)" @keydown.right.prevent="buocTab(1)">
          <button
            v-for="t in TABS" :key="t.id" type="button" role="tab" class="bdt-tab" :class="{ khoa: t.id === 'so_do' && soDoKhoa }"
            :aria-selected="s.tab.value === t.id" :tabindex="s.tab.value === t.id ? 0 : -1" :data-tab="t.id"
            @click="chonTab(t.id)"
          >
            <Lock v-if="t.id === 'so_do' && soDoKhoa" :size="13" /><component :is="t.icon" v-else :size="15" />{{ t.ten }}
            <span v-if="t.id === 'lien_ket' && s.mh.value" class="dem">{{ s.mh.value.lienKet.length }}</span>
          </button>
        </div>
        <span v-if="s.client.laMau && manHinh !== 'dt'" class="bdt-chip-mau" title="Adapter giả lập — danh mục mẫu, cạnh viết tay, số đếm giả"><i />Dữ liệu mẫu</span>
        <div class="bdt-gian" />
        <button type="button" class="bdt-nut-tron" :aria-label="s.theme.value === 'dark' ? 'Giao diện sáng' : 'Giao diện tối'" data-doi-theme @click="doiTheme">
          <Sun v-if="s.theme.value === 'dark'" :size="15" /><Moon v-else :size="15" />
        </button>
        <button v-if="manHinh !== 'dt'" type="button" class="bdt-nut-tron" aria-label="Tải lại" title="Tải lại bản đồ" data-tai-lai :disabled="s.dangTai.value" @click="s.tai()">
          <RefreshCw :size="15" />
        </button>
        <OTimKiem v-if="s.mh.value" />
        <button v-if="manHinh !== 'dt'" type="button" class="bdt-nut-tmh" :class="{ bat: s.toanManHinh.value }" data-toan-man-hinh @click="doiToanManHinh">
          <Minimize v-if="s.toanManHinh.value" :size="14" /><Maximize v-else :size="14" />{{ s.toanManHinh.value ? 'Thoát toàn màn hình' : 'Toàn màn hình' }}
        </button>
      </div>

      <p v-if="s.loi.value" class="bdt-chan" role="alert">Không tải được bản đồ: {{ s.loi.value }}</p>
      <div v-else-if="s.chuaCoBanDo.value" class="bdt-cong bdt-trong" data-chua-co-ban-do>
        <div class="o-ico"><MapIcon :size="24" /></div>
        <h2>Bot chưa gửi danh mục — bản đồ sẽ hiện sau khi bot dev chạy bản mới</h2>
        <p>Bot đẩy danh mục loại tin (kèm số đếm) lên CRM mỗi lần đồng bộ. Chưa có ảnh chụp nào cho tổ chức này nên chưa vẽ
          được bản đồ, và chưa tạo/sửa được luật thông báo (CRM cần danh mục để kiểm luật cứng).</p>
        <p v-if="s.soLuatKhiTrong.value" class="bdt-nho">Đang có {{ s.soLuatKhiTrong.value }} luật thông báo đã lưu — bot nhận chúng ở chế độ an toàn (không đích) cho tới khi có danh mục.</p>
        <button type="button" class="bdt-nut" :disabled="s.dangTai.value" @click="s.tai()"><RefreshCw :size="14" />Tải lại</button>
      </div>
      <p v-else-if="!s.mh.value" class="bdt-nho">Đang tải…</p>

      <template v-else>
        <div v-if="s.anh.value?.canh_bao.length || s.anh.value?.loi_crm" class="bdt-bao" data-canh-bao-trang>
          <p v-if="s.anh.value?.canh_bao.length"><b>CRM sẽ bỏ khi phát luật cho bot ({{ s.anh.value.canh_bao.length }}):</b></p>
          <ul v-if="s.anh.value?.canh_bao.length"><li v-for="(c, i) in s.anh.value.canh_bao" :key="i">{{ c }}</li></ul>
          <p v-if="s.anh.value?.loi_crm">Không tải được lớp CRM tự động ({{ s.anh.value.loi_crm }}) — dải "CRM tự động" đang trống.</p>
        </div>
        <!-- Điện thoại: cổng "mở trên máy tính" (SPEC §8) -->
        <div v-if="manHinh === 'dt' && !rutGon" class="bdt-cong" data-cong>
          <div class="o-ico"><MonitorSmartphone :size="24" /></div>
          <h2>Mở trên máy tính để thấy trọn bản đồ</h2>
          <p>Bản đồ có {{ s.mh.value.pha.length }} pha, {{ s.mh.value.khoi.length }} khối và {{ s.mh.value.lienKet.length }} đường nối —
            màn hình điện thoại quá hẹp để hiện hết.</p>
          <button type="button" class="bdt-nut chinh" @click="chepLink"><Send :size="15" />{{ daChep ? 'Đã chép link' : 'Chép link để mở trên máy tính' }}</button>
          <button type="button" class="bdt-nut" data-rut-gon @click="xemRutGon">Vẫn xem bản rút gọn</button>
        </div>

        <div v-else class="bdt-luoi" :class="{ 'mot-cot': manHinh !== 'may' }">
          <SoDoBanDo v-if="s.tab.value === 'so_do' && !soDoKhoa" />
          <TabTheoPha v-else-if="s.tab.value === 'theo_pha' || soDoKhoa" :gon="manHinh === 'dt'" @chon-khoi="(id) => s.datChon({ kieu: 'khoi', id })" />
          <TabLienKet v-else-if="s.tab.value === 'lien_ket'" />
          <TabGhiChu v-else />
          <PanelChiTiet v-if="manHinh === 'may'" />
          <PanelChiTiet v-else-if="s.chon.value" sheet />
        </div>
      </template>
    </div>

    <HopHuongDan v-if="s.hopHuongDan.value" @dong="s.hopHuongDan.value = false" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Layers, LayoutGrid, Link as LinkIcon, Lock, Map as MapIcon, Maximize, Minimize, MonitorSmartphone, Moon, RefreshCw, Send, StickyNote, Sun } from 'lucide-vue-next';
import '@/components/ban-do-tin/ban-do-tin.css';
import SoDoBanDo from '@/components/ban-do-tin/SoDoBanDo.vue';
import PanelChiTiet from '@/components/ban-do-tin/PanelChiTiet.vue';
import TabTheoPha from '@/components/ban-do-tin/TabTheoPha.vue';
import TabLienKet from '@/components/ban-do-tin/TabLienKet.vue';
import TabGhiChu from '@/components/ban-do-tin/TabGhiChu.vue';
import HopHuongDan from '@/components/ban-do-tin/HopHuongDan.vue';
import OTimKiem from '@/components/ban-do-tin/OTimKiem.vue';
import { taoClientBanDoTin, type BanDoTinClient } from '@/api/ban-do-tin';
import { cungCapBanDoTin, taoBanDoTin, type TabBanDo } from './ban-do-tin/use-ban-do-tin';
import { cheDoManHinh, type CheDoManHinh } from './ban-do-tin/bo-cuc';
import { docHash, vietHash } from './ban-do-tin/hash';

const props = defineProps<{ client?: BanDoTinClient }>();
const s = taoBanDoTin(props.client ?? taoClientBanDoTin());
cungCapBanDoTin(s);

const TABS: { id: TabBanDo; ten: string; icon: unknown }[] = [
  { id: 'so_do', ten: 'Sơ đồ', icon: LayoutGrid },
  { id: 'theo_pha', ten: 'Theo pha', icon: Layers },
  { id: 'lien_ket', ten: 'Liên kết', icon: LinkIcon },
  { id: 'ghi_chu', ten: 'Ghi chú', icon: StickyNote },
];

// ── bộ nhớ trình duyệt — mọi truy cập bọc try/catch (chế độ riêng tư / chặn dữ liệu trang) ──
const doc = (k: string, kho: 'l' | 's' = 'l') => { try { return (kho === 'l' ? localStorage : sessionStorage).getItem(k); } catch { return null; } };
const ghi = (k: string, v: string, kho: 'l' | 's' = 'l') => { try { (kho === 'l' ? localStorage : sessionStorage).setItem(k, v); } catch { /* bỏ qua */ } };

// ── màn hình ──
const manHinh = ref<CheDoManHinh>(cheDoManHinh(typeof window !== 'undefined' ? window.innerWidth : 1440));
const rutGon = ref(doc('bdt-rut-gon', 's') === '1');
const soDoKhoa = computed(() => manHinh.value === 'dt');
const capNhatManHinh = () => { manHinh.value = cheDoManHinh(window.innerWidth); };
function xemRutGon() { rutGon.value = true; ghi('bdt-rut-gon', '1', 's'); s.tab.value = 'theo_pha'; }

// ── tab (nhớ ở localStorage, KHÔNG ghi vào hash) ──
const tabDaLuu = doc('bdt-tab') as TabBanDo | null;
if (tabDaLuu && TABS.some((t) => t.id === tabDaLuu)) s.tab.value = tabDaLuu;
if (manHinh.value === 'dt' && s.tab.value === 'so_do') s.tab.value = 'theo_pha';
function chonTab(t: TabBanDo) { if (t === 'so_do' && soDoKhoa.value) return; s.tab.value = t; }
watch(s.tab, (t) => ghi('bdt-tab', t));
function buocTab(b: number) {
  const ds = TABS.filter((t) => !(t.id === 'so_do' && soDoKhoa.value));
  const i = ds.findIndex((t) => t.id === s.tab.value);
  chonTab(ds[(i + b + ds.length) % ds.length].id);
  (goc.value?.querySelector(`[data-tab="${s.tab.value}"]`) as HTMLElement | null)?.focus();
}

// ── theme (trang Cài đặt luôn sáng; bản đồ có sáng/tối riêng) ──
const themeLuu = doc('bdt-theme');
if (themeLuu === 'dark' || themeLuu === 'light') s.theme.value = themeLuu;
function doiTheme() { s.theme.value = s.theme.value === 'dark' ? 'light' : 'dark'; ghi('bdt-theme', s.theme.value); }

// ── toàn màn hình ──
function doiToanManHinh() { s.toanManHinh.value = !s.toanManHinh.value; }
watch(s.toanManHinh, (v) => { document.body.style.overflow = v ? 'hidden' : ''; });

// ── hash ↔ lựa chọn ──
const goc = ref<HTMLElement | null>(null);
function apHash() {
  const c = docHash(location.hash);
  if (!c) { if (!location.hash) s.datChon(null); return; }
  s.datChon(c);
  if (s.tab.value !== 'so_do' && !soDoKhoa.value && c.kieu !== 'khoi') s.tab.value = 'so_do';
}
watch(s.chon, (c) => {
  const h = vietHash(c);
  if (h === location.hash || (!h && !location.hash)) return;
  history.replaceState(history.state, '', `${location.pathname}${location.search}${h}`);
});

// ── Esc đóng từng lớp: hộp thoại → bỏ chọn → toàn màn hình ──
function phimEsc(e: KeyboardEvent) {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  if (s.hopHuongDan.value) s.hopHuongDan.value = false;
  else if (s.chon.value) s.datChon(null);
  else if (s.toanManHinh.value) s.toanManHinh.value = false;
  else return;
  e.preventDefault();
}

const daChep = ref(false);
async function chepLink() { try { await navigator.clipboard.writeText(location.href); daChep.value = true; } catch { /* bỏ qua */ } }

onMounted(async () => {
  window.addEventListener('resize', capNhatManHinh);
  window.addEventListener('hashchange', apHash);
  document.addEventListener('keydown', phimEsc);
  await s.tai();
  apHash();
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', capNhatManHinh);
  window.removeEventListener('hashchange', apHash);
  document.removeEventListener('keydown', phimEsc);
  document.body.style.overflow = '';
});
defineExpose({ s });
</script>
