<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- MauNet — dòng mẫu nét 30×10 của một loại đường (chú giải, dòng liên kết). -->
<template>
  <svg width="30" height="10" viewBox="0 0 30 10" aria-hidden="true">
    <line
      x1="1" y1="5" x2="29" y2="5" stroke-linecap="round"
      :style="{ stroke: `var(--bdt-lk-${k.mau})`, strokeWidth: k.dash ? 1.96 : 2.24, strokeDasharray: dash }"
    />
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { KIEU_DUONG_THEO_ID } from '@/views/settings/ban-do-tin/cau-hinh';
import type { LoaiLienKet } from '@/views/settings/ban-do-tin/kieu';

const p = defineProps<{ loai: LoaiLienKet }>();
const k = computed(() => KIEU_DUONG_THEO_ID[p.loai]);
// nét đứt phóng ×~1.07 cho dễ thấy ở cỡ 30px (SPEC §6.1: "7.2 4")
const dash = computed(() => (k.value.dash ? k.value.dash.split(' ').map((n) => (+n * 1.07).toFixed(2)).join(' ') : undefined));
</script>
