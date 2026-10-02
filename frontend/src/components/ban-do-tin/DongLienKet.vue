<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- DongLienKet — một dòng "Nhận từ / Đẩy sang" trong panel: ô số + tên khối đầu kia + mẫu nét + lý do + số 7 ngày.
     Rê chuột ⇒ làm đậm đúng một đường trên sơ đồ (SPEC §5). -->
<template>
  <button
    type="button" class="bdt-lk" :data-lk="l.id"
    @mouseenter="s.troDong.value = l.id" @mouseleave="s.troDong.value = null" @focus="s.troDong.value = l.id" @blur="s.troDong.value = null"
    @click="bam"
  >
    <SoTron :so="l.so" :loai="l.loai" />
    <span style="min-width: 0">
      <span class="d1"><ArrowRight v-if="huong === 'ra'" :size="13" />{{ ten }} <small>{{ ma }}</small><small v-if="l.dem">· {{ l.dem.d7.da_gui }} tin{{ l.dem.d7.bong ? ` + ${l.dem.d7.bong} bóng` : '' }}/7 ngày{{ l.dem.d7.chua_ro ? ` · chưa rõ ${l.dem.d7.chua_ro}` : '' }}{{ l.dem.d7.chan_tam_im ? ` · chặn ${l.dem.d7.chan_tam_im}` : '' }}</small></span>
      <span class="d2"><MauNet :loai="l.loai" />{{ l.vi_sao || KIEU_DUONG_THEO_ID[l.loai].ten }}</span>
    </span>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { ArrowRight } from 'lucide-vue-next';
import SoTron from './SoTron.vue';
import MauNet from './MauNet.vue';
import { KIEU_DUONG_THEO_ID } from '@/views/settings/ban-do-tin/cau-hinh';
import { dungBanDoTin } from '@/views/settings/ban-do-tin/use-ban-do-tin';
import type { LienKet } from '@/views/settings/ban-do-tin/kieu';

const p = defineProps<{ l: LienKet; huong: 'vao' | 'ra' }>();
const s = dungBanDoTin();
const dauKia = computed(() => s.mh.value!.khoiTheoId[p.huong === 'ra' ? p.l.den : p.l.tu]);
const ten = computed(() => dauKia.value.ten + (dauKia.value.ban_sao ? ` (${s.mh.value!.hang[dauKia.value.hang].ten})` : ''));
const ma = computed(() => s.mh.value!.pha.find((x) => x.id === dauKia.value.pha)?.ma ?? '');
function bam() { s.troDong.value = null; s.datChon({ kieu: 'khoi', id: dauKia.value.id }); }
</script>
