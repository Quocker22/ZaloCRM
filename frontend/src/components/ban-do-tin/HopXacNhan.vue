<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- HopXacNhan — hộp hỏi lại trước việc đổi hành vi thật của bot ("Hoàn lại như mã", chuyển sang Bật). Bẫy focus; focus đầu ở
     nút Huỷ (việc không lùi được thì phím Enter không được đồng ý hộ); Esc = Huỷ và KHÔNG lan ra trang (không bỏ chọn khối). -->
<template>
  <div class="bdt-phu" role="presentation" @click.self="tra(false)">
    <div
      ref="hop" class="bdt-hop-xn" role="alertdialog" aria-modal="true" aria-labelledby="bdt-xn-tieu-de" aria-describedby="bdt-xn-noi-dung"
      data-xac-nhan @keydown.esc.prevent.stop="tra(false)"
    >
      <h2 id="bdt-xn-tieu-de">{{ h.tieuDe }}</h2>
      <p id="bdt-xn-noi-dung">{{ h.noiDung }}</p>
      <div class="bdt-hai-nut">
        <button ref="nutHuy" type="button" class="bdt-nut" data-huy @click="tra(false)">Huỷ</button>
        <button type="button" class="bdt-nut chinh" data-dong-y @click="tra(true)">{{ h.nut }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { bayFocus } from '@/views/settings/ban-do-tin/bay-focus';

const p = defineProps<{ h: { tieuDe: string; noiDung: string; nut: string; tra: (ok: boolean) => void } }>();
const hop = ref<HTMLElement | null>(null);
const nutHuy = ref<HTMLButtonElement | null>(null);
let go: (() => void) | null = null;
const tra = (ok: boolean) => p.h.tra(ok);
onMounted(() => { if (hop.value) go = bayFocus(hop.value, { dau: nutHuy.value }); });
onBeforeUnmount(() => go?.());
</script>
