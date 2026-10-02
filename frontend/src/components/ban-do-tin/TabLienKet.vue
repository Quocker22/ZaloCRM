<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- TabLienKet — bảng mọi liên kết, lọc theo loại + chữ (SPEC §9.1). Bấm dòng ⇒ chọn liên kết trên Sơ đồ. -->
<template>
  <section class="bdt-tab-khung" aria-label="Liên kết">
    <div class="bdt-lk-loc">
      <button type="button" class="bdt-chip" :aria-pressed="loai === null" @click="loai = null">Tất cả <span class="so">{{ mh.lienKet.length }}</span></button>
      <button v-for="k in KIEU_DUONG" :key="k.id" type="button" class="bdt-chip" :aria-pressed="loai === k.id" @click="loai = k.id">
        <MauNet :loai="k.id" />{{ k.ten }} <span class="so">{{ dem[k.id] }}</span>
      </button>
    </div>
    <div class="bdt-lk-o"><input v-model="loc" type="search" placeholder="Lọc theo tên khối hoặc nội dung liên kết…" aria-label="Lọc liên kết"></div>
    <div class="bdt-bang" role="table">
      <div class="bdt-bang-dau" role="row"><div>#</div><div>Điểm đi</div><div>Điểm đến</div><div>Nội dung · 7 ngày</div></div>
      <div v-for="l in ds" :key="l.id" class="bdt-bang-dong" role="row" tabindex="0" @click="chon(l.id)" @keydown.enter="chon(l.id)">
        <div><SoTron :so="l.so" :loai="l.loai" /></div>
        <div><b>{{ ten(l.tu) }}</b><small>{{ ma(l.tu) }}</small></div>
        <div><b>{{ ten(l.den) }}</b><small>{{ ma(l.den) }}</small></div>
        <div><MauNet :loai="l.loai" /><span>{{ l.vi_sao || KIEU_DUONG_THEO_ID[l.loai].ten }}</span><small v-if="l.dem" style="margin-left: auto">{{ l.dem.so }}</small></div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import MauNet from './MauNet.vue';
import SoTron from './SoTron.vue';
import { KIEU_DUONG, KIEU_DUONG_THEO_ID } from '@/views/settings/ban-do-tin/cau-hinh';
import { demTheoLoai } from '@/views/settings/ban-do-tin/mo-hinh';
import { boDau } from '@/views/settings/ban-do-tin/tim';
import { dungBanDoTin } from '@/views/settings/ban-do-tin/use-ban-do-tin';
import type { LoaiLienKet } from '@/views/settings/ban-do-tin/kieu';

const s = dungBanDoTin();
const mh = computed(() => s.mh.value!);
const loai = ref<LoaiLienKet | null>(null);
const loc = ref('');
const dem = computed(() => demTheoLoai(mh.value.lienKet));
const ten = (id: string) => { const k = mh.value.khoiTheoId[id]; return k.ban_sao ? `${k.ten} (${mh.value.hang[k.hang].ten})` : k.ten; };
const ma = (id: string) => mh.value.pha.find((p) => p.id === mh.value.khoiTheoId[id].pha)?.ma;
const ds = computed(() => {
  const q = boDau(loc.value.trim());
  return mh.value.lienKet.filter((l) => (!loai.value || l.loai === loai.value) && (!q || boDau(`${ten(l.tu)} ${ten(l.den)} ${l.vi_sao}`).includes(q)));
});
function chon(id: string) { s.datChon({ kieu: 'lien_ket', id }); s.tab.value = 'so_do'; }
</script>
