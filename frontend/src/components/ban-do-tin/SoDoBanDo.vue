<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  SoDoBanDo — khung kính + vùng xem + bản đồ vẽ bằng div tuyệt đối và 3 lớp svg (SPEC §1, §3, §4.2 thứ tự lớp):
  tiêu đề pha → svg đường nền → dải nhóm → dải hàng → thanh nhóm → nhãn hàng → nhãn vòng → svg đường nổi → khối → svg bong số.
  Thu phóng bằng CSS zoom (+ biến --z bù viền focus). Toạ độ trong DOM là toạ độ gốc.
-->
<template>
  <section class="bdt-khung" aria-label="Sơ đồ bản đồ tin">
    <header class="bdt-dau-khung">
      <h2><span class="logo"><Send :size="13" /></span>Bản đồ tin — {{ mh.khoi.length }} khối × {{ mh.pha.length }} pha</h2>
      <span class="bdt-goi-y">Bấm một khối để làm nổi luồng · Bấm tên nhóm để thu gọn · Ctrl + cuộn để phóng to · kéo để di chuyển</span>
      <div class="bdt-nut-hang">
        <button type="button" class="bdt-nut huong-dan" @click="s.hopHuongDan.value = true"><BookOpenText :size="14" />Hướng dẫn sử dụng</button>
        <button type="button" class="bdt-nut" @click="s.thuGonTatCa()"><Layers :size="14" />{{ s.tatCaThuGon.value ? 'Mở tất cả nhóm' : 'Thu gọn nhóm' }}</button>
        <div class="bdt-zoom" role="group" aria-label="Thu phóng">
          <button type="button" aria-label="Thu nhỏ" :disabled="s.zoom.value <= ZOOM_MIN + 1e-6" @click="buocZoom(1 / 1.2)"><Minus :size="14" /></button>
          <button type="button" class="pt" title="Về cỡ mặc định (≥ 75 %)" data-zoom-pt @click="veMacDinh">{{ Math.round(s.zoom.value * 100) }}%</button>
          <button type="button" aria-label="Phóng to" :disabled="s.zoom.value >= ZOOM_MAX - 1e-6" @click="buocZoom(1.2)"><Plus :size="14" /></button>
        </div>
        <button type="button" class="bdt-nut" title="Thu nhỏ cho thấy trọn bản đồ" data-vua-khung @click="vuaKhung"><RotateCcw :size="14" />Vừa khung</button>
      </div>
    </header>

    <div
      ref="vungXem"
      class="bdt-vung-xem"
      :class="{ 'dang-keo': keo.dang }"
      :data-zoomed="lonHonKhung ? '1' : '0'"
      tabindex="0"
      aria-label="Vùng sơ đồ — phím + − 0 để thu phóng"
      @mousedown="batDauKeo"
      @keydown="phim"
      @click="bamTrong"
    >
      <div class="bdt-ban-do" :style="{ width: `${bc.rong}px`, height: `${bc.cao}px`, zoom: s.zoom.value, '--z': s.zoom.value }">
        <!-- 2. svg đường nền: mọi đường, độ đục theo một class -->
        <svg class="bdt-svg bdt-lop-nen" :class="kq.che" :width="bc.rong" :height="bc.cao" aria-hidden="true">
          <defs>
            <marker
              v-for="k in KIEU_DUONG" :id="`bdt-mui-${k.id}`" :key="k.id" viewBox="0 0 10 10" refX="8.5" refY="5"
              markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto"
            ><path d="M0,0 L10,5 L0,10 z" :style="{ fill: `var(--bdt-lk-${k.mau})` }" /></marker>
          </defs>
          <LopDuong :ds="dsCoDuong" :duong="duong" :ten-khoi="tenKhoi" @chon="chonLienKet" @tro="() => {}" />
        </svg>

        <!-- 3–4. dải nhóm, dải hàng -->
        <template v-for="g in bc.nhom" :key="`n${g.id}`">
          <div v-if="g.dai" class="bdt-nhom" :class="{ crm: g.id === 'crm' }" :style="hcn(g.dai)" />
        </template>
        <div v-for="h in bc.hang" :key="`d${h.id}`" class="bdt-dai-hang" :style="hcn(h.dai)" />
        <template v-for="g in bc.nhom" :key="`dg${g.id}`">
          <div v-if="g.thuGon" class="bdt-dai-hang" :style="{ left: '144px', top: `${g.dai!.y + 3}px`, width: `${bc.phaiCotCuoi + 4 - 144}px`, height: '44px' }" />
        </template>

        <!-- 7. nhãn vòng -->
        <div class="bdt-nhan-vong" :style="{ left: `${bc.nhanVong.x}px`, top: `${bc.nhanVong.y}px` }">Quay vòng: về pha trước</div>

        <!-- 8. svg đường nổi — chỉ các đường đang nổi -->
        <svg class="bdt-svg" :width="bc.rong" :height="bc.cao" aria-hidden="true">
          <LopDuong :ds="dsNoi" :duong="duong" :ten-khoi="tenKhoi" noi :kq="kq" @chon="chonLienKet" @tro="troDuong" />
        </svg>

        <!-- 9. khối + ô tóm tắt -->
        <button
          v-for="k in khoiHien" :key="k.id" type="button" class="bdt-khoi" :data-khoi="k.id"
          :class="lopKhoi(k)" :style="hcn(bc.khoi[k.id])"
          :aria-pressed="kq.khoiChon.has(k.id)"
          @click.stop="s.datChon({ kieu: 'khoi', id: k.id })"
          @mouseenter="s.tro.value = k.id" @mouseleave="s.tro.value = null"
        >
          <span class="ten">{{ k.ten }}<span v-for="t in k.tags.slice(0, 2)" :key="t" class="bdt-tag" :class="LOP_TAG[t]">{{ t }}</span></span>
          <span v-if="kq.badge[k.id]" class="bdt-badge" :class="kq.badge[k.id].kieu">{{ kq.badge[k.id].chu }}</span>
        </button>
        <button
          v-for="o in bc.tomTat" :key="o.id" type="button" class="bdt-tom" :style="hcn(o.hinh)"
          :class="{ 'mo-chon': kq.che === 'chon' && !o.khoi.some((id) => kq.khoiSang.has(id)), 'mo-tro': kq.che === 'tro' && !o.khoi.some((id) => kq.khoiSang.has(id)) }"
          :title="o.khoi.map((id) => mh.khoiTheoId[id].ten).join(' · ')"
          @click.stop="s.doiThuGon(o.nhom)"
        >
          <span v-for="h in o.hang.slice(0, 3)" :key="h" class="ico18"><IconBdt :ten="mh.hang[h].icon" :size="11" /></span>
          <span class="n">{{ o.khoi.length }} khối</span>
          <span class="ds">{{ o.hang.map((h) => mh.hang[h].ten).join(', ') }}</span>
        </button>

        <!-- 10. svg bong số — chỉ khi đang chọn -->
        <svg class="bdt-svg" :width="bc.rong" :height="bc.cao">
          <template v-if="kq.che === 'chon'">
            <g
              v-for="l in dsNoi" :key="l.id" class="bdt-bong" :data-bong="l.so"
              :class="{ mo: kq.troDong && kq.troDong !== l.id, to: kq.troDong === l.id }"
              role="button" :aria-label="`Liên kết ${l.so}`"
              @click.stop="chonLienKet(l.id)"
            >
              <circle :cx="duong[l.id].bong.x" :cy="duong[l.id].bong.y" r="8" :style="{ fill: `var(--bdt-lk-${l.loai})` }" />
              <text :x="duong[l.id].bong.x" :y="duong[l.id].bong.y" :style="{ fill: `var(--bdt-lkc-${l.loai})` }">{{ l.so }}</text>
            </g>
          </template>
        </svg>

        <!-- 11. lớp DÍNH: hàng tiêu đề pha (dính trên) + cột nhãn hàng (dính trái) + góc — cuộn ngang/dọc vẫn đọc được.
             Ba lớp cùng một ô lưới của .bdt-ban-do (position: sticky); con bên trong vẫn tuyệt đối theo toạ độ gốc. -->
        <div class="bdt-dinh bdt-dinh-hang" :style="{ width: `${COT_TRAI}px`, height: `${bc.cao}px` }" data-dinh-hang>
          <template v-for="g in bc.nhom" :key="`dn${g.id}`">
            <div v-if="g.dai" class="bdt-nhom" :class="{ crm: g.id === 'crm' }" :style="hcn(g.dai)" />
          </template>
          <!-- 5. thanh nhóm dọc -->
          <template v-for="g in bc.nhom" :key="`t${g.id}`">
            <button
              v-if="g.thanh" type="button" class="bdt-thanh-nhom" :class="{ gon: g.thuGon, crm: g.id === 'crm' }" :style="hcn(g.thanh)"
              :aria-expanded="!g.thuGon" :aria-label="`${g.thuGon ? 'Mở' : 'Thu gọn'} nhóm ${tenNhom[g.id]}`"
              @click.stop="s.doiThuGon(g.id)"
            ><ChevronDown class="chev" :size="12" /><span v-if="!g.thuGon" class="chu-doc">{{ tenNhom[g.id] }}</span></button>
          </template>
          <!-- 6. nhãn hàng (hoặc tên nhóm khi thu gọn) -->
          <button
            v-for="h in bc.hang" :key="`l${h.id}`" type="button" class="bdt-nhan-hang"
            :class="{ sang: kq.che === 'chon' && kq.hangSang.has(h.id), mo: kq.che === 'chon' && !kq.hangSang.has(h.id) }"
            :style="hcn(h.nhan)" @click.stop="s.datChon({ kieu: 'hang', id: h.id })"
          ><span class="o-ico"><IconBdt :ten="mh.hang[h.id].icon" /></span><span class="chu">{{ mh.hang[h.id].ten }}</span></button>
          <template v-for="g in bc.nhom" :key="`ln${g.id}`">
            <button v-if="g.nhanThuGon" type="button" class="bdt-nhan-hang" :style="hcn(g.nhanThuGon)" @click.stop="s.doiThuGon(g.id)">
              <span class="o-ico"><IconBdt :ten="mh.hang[nhomTheoId[g.id].hang[0]].icon" /></span><span class="chu">{{ tenNhom[g.id] }}</span>
            </button>
          </template>
        </div>
        <div class="bdt-dinh bdt-dinh-pha" :style="{ width: `${bc.rong}px`, height: `${CAO_DAU}px` }" data-dinh-pha>
          <button
            v-for="(p, i) in mh.pha" :key="p.id" type="button" class="bdt-pha"
            :class="{ sang: kq.che === 'chon' && kq.phaSang.has(p.id), mo: kq.che === 'chon' && !kq.phaSang.has(p.id) }"
            :style="hcn(bc.dauPha[i])" :title="`${p.ma} · ${p.ten}`" @click.stop="s.datChon({ kieu: 'pha', id: p.id })"
          ><span class="ma">{{ p.ma }}</span>{{ p.ten }}</button>
        </div>
        <div class="bdt-dinh bdt-dinh-goc" :style="{ width: `${COT_TRAI}px`, height: `${CAO_DAU}px` }" />
      </div>
    </div>
    <footer class="bdt-chan-khung">{{ chanKhung }}</footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { BookOpenText, ChevronDown, Layers, Minus, Plus, RotateCcw, Send } from 'lucide-vue-next';
import IconBdt from './IconBdt.vue';
import LopDuong from './LopDuong.vue';
import { KIEU_DUONG, LOP_TAG } from '@/views/settings/ban-do-tin/cau-hinh';
import {
  COT_X0, DAI_NHOM_LE, HANG_DAU_TOP, zoomMacDinh, zoomVuaHaiChieu, zoomVuaKhung, ZOOM_MAX, ZOOM_MIN, type HinhChuNhat,
} from '@/views/settings/ban-do-tin/bo-cuc';
import { dungBanDoTin } from '@/views/settings/ban-do-tin/use-ban-do-tin';
import type { Khoi } from '@/views/settings/ban-do-tin/kieu';
import { doDucKhoi } from '@/views/settings/ban-do-tin/trang-thai';

const s = dungBanDoTin();
const mh = computed(() => s.mh.value!);
const bc = computed(() => s.boCuc.value!);
const duong = computed(() => s.duong.value);
const kq = computed(() => s.kq.value!);

const tenNhom = computed(() => Object.fromEntries(mh.value.nhom.map((n) => [n.id, n.ten])) as Record<string, string>);
const nhomTheoId = computed(() => Object.fromEntries(mh.value.nhom.map((n) => [n.id, n])));
const khoiHien = computed(() => mh.value.khoi.filter((k) => bc.value.khoi[k.id]));
// đường có hình (thu gọn nhóm: hai đầu cùng ô tóm tắt ⇒ không vẽ)
const dsCoDuong = computed(() => mh.value.lienKet.filter((l) => duong.value[l.id]));
const dsNoi = computed(() => mh.value.lienKet.filter((l) => kq.value.noi.has(l.id) && duong.value[l.id]));
const tenKhoi = (id: string) => mh.value.khoiTheoId[id]?.ten ?? id;
const chanKhung = computed(() => {
  const a = s.anh.value;
  if (a?.mau) return 'Dữ liệu MẪU — danh mục 46 tin + cạnh viết tay, số đếm giả (adapter giả lập)';
  const luc = a?.luc ? new Date(a.luc) : null;
  const gio = luc && !isNaN(+luc) ? ` · bot gửi lúc ${luc.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}` : '';
  return `Danh mục bot phiên bản ${a?.phien_ban ?? '—'}${gio} · số đếm 7 ngày`;
});

/** lớp dính: cột nhãn hàng rộng tới mép dải hàng; hàng tiêu đề pha cao tới mép trên dải nhóm đầu */
const COT_TRAI = COT_X0 - 6;
const CAO_DAU = HANG_DAU_TOP - DAI_NHOM_LE - 1;
const hcn = (r: HinhChuNhat) => ({ left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });

function lopKhoi(k: Khoi) {
  const d = doDucKhoi(kq.value, k.id);
  return {
    chon: kq.value.khoiChon.has(k.id),
    'mo-tro': d.opacity < 1 && !d.xam,
    'mo-chon': d.xam,
    'ban-sao': k.ban_sao,
    tat: k.che_do === 'tat',
    'chi-xem': k.loai_nut !== 'composer',
  };
}

function chonLienKet(id: string) { s.datChon({ kieu: 'lien_ket', id }); }
function troDuong(id: string | null) { s.troDong.value = id; }

// ── Thu phóng ───────────────────────────────────────────────
const vungXem = ref<HTMLElement | null>(null);
/** mac_dinh = vừa khung nhưng KHÔNG dưới 75 % (đọc được ở 1440×900, cuộn ngang) · vua = vừa trọn khung · tu_do = người chỉnh */
const cheDoZoom = ref<'mac_dinh' | 'vua' | 'tu_do'>('mac_dinh');
const lonHonKhung = ref(false);

function tinhVua() {
  const el = vungXem.value;
  if (!el) return;
  const w = el.clientWidth, h = el.clientHeight;
  s.khung.rong = w; s.khung.cao = h;
  s.zoomVua.value = s.toanManHinh.value ? zoomVuaHaiChieu(w, h, bc.value.rong, bc.value.cao) : zoomVuaKhung(w, bc.value.rong);
  if (cheDoZoom.value === 'mac_dinh') s.datZoom(zoomMacDinh(s.zoomVua.value));
  else if (cheDoZoom.value === 'vua') s.datZoom(s.zoomVua.value);
  capNhatLon();
}
function capNhatLon() {
  const el = vungXem.value;
  if (!el) return;
  lonHonKhung.value = bc.value.rong * s.zoom.value > el.clientWidth - 24 + 1 || bc.value.cao * s.zoom.value > el.clientHeight - 20 + 1;
}
function buocZoom(f: number) { cheDoZoom.value = 'tu_do'; s.datZoom(s.zoom.value * f); requestAnimationFrame(capNhatLon); }
function vuaKhung() { cheDoZoom.value = 'vua'; s.datZoom(s.zoomVua.value); requestAnimationFrame(capNhatLon); }
function veMacDinh() { cheDoZoom.value = 'mac_dinh'; s.datZoom(zoomMacDinh(s.zoomVua.value)); requestAnimationFrame(capNhatLon); }
function banhXe(e: WheelEvent) {
  if (!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  buocZoom(e.deltaY < 0 ? 1.1 : 1 / 1.1);
}
function phim(e: KeyboardEvent) {
  if ((e.target as HTMLElement).closest('input,textarea')) return;
  if (e.key === '+' || e.key === '=') { buocZoom(1.2); e.preventDefault(); }
  else if (e.key === '-' || e.key === '_') { buocZoom(1 / 1.2); e.preventDefault(); }
  else if (e.key === '0') { veMacDinh(); e.preventDefault(); }
}

// ── Kéo để di chuyển ────────────────────────────────────────
const keo = reactive({ dang: false, x: 0, y: 0, sl: 0, st: 0, di: 0 });
function batDauKeo(e: MouseEvent) {
  if (e.button !== 0 || !lonHonKhung.value || (e.target as HTMLElement).closest('button,[role=button],.vung-bam')) return;
  const el = vungXem.value!;
  Object.assign(keo, { dang: true, x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop, di: 0 });
  window.addEventListener('mousemove', diKeo);
  window.addEventListener('mouseup', hetKeo, { once: true });
}
function diKeo(e: MouseEvent) {
  const el = vungXem.value!;
  keo.di = Math.max(keo.di, Math.abs(e.clientX - keo.x) + Math.abs(e.clientY - keo.y));
  el.scrollLeft = keo.sl - (e.clientX - keo.x);
  el.scrollTop = keo.st - (e.clientY - keo.y);
}
function hetKeo() { keo.dang = false; window.removeEventListener('mousemove', diKeo); }
function bamTrong() {
  if (keo.di > 4) { keo.di = 0; return; }
  s.datChon(null);
}

let ro: ResizeObserver | null = null;
onMounted(() => {
  tinhVua();
  vungXem.value?.addEventListener('wheel', banhXe, { passive: false });
  if (typeof ResizeObserver !== 'undefined' && vungXem.value) { ro = new ResizeObserver(tinhVua); ro.observe(vungXem.value); }
});
onBeforeUnmount(() => { ro?.disconnect(); vungXem.value?.removeEventListener('wheel', banhXe); window.removeEventListener('mousemove', diKeo); });
watch(() => [bc.value.rong, bc.value.cao, s.toanManHinh.value], () => requestAnimationFrame(tinhVua));
defineExpose({ vuaKhung, buocZoom, veMacDinh });
</script>
