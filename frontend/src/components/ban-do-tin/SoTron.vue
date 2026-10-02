<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SoTron — ô số tròn 20px theo màu loại đường (chữ tương phản riêng cho từng loại, cả sáng lẫn tối). -->
<template>
  <span class="bdt-so-tron" :style="{ background: `var(--bdt-lk-${loai})`, color: `var(--bdt-lkc-${loai})` }">{{ so }}</span>
</template>

<script setup lang="ts">
import type { LoaiLienKet } from '@/views/settings/ban-do-tin/kieu';
defineProps<{ so: number; loai: LoaiLienKet }>();
</script>
