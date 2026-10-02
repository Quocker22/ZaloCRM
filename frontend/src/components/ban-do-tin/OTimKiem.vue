<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- OTimKiem — combobox tìm khối/đích/liên kết không dấu; ↑ ↓ Enter; chọn xong thì xoá ô (SPEC §7). Sơ đồ không bị lọc. -->
<template>
  <div class="bdt-tim">
    <Search class="ico" :size="14" />
    <input
      ref="o" v-model="q" type="search" role="combobox" placeholder="Tìm tin, đích, liên kết…" aria-label="Tìm"
      :aria-expanded="mo" aria-controls="bdt-tim-ds" aria-autocomplete="list"
      @focus="mo = true" @blur="dongTre" @keydown.down.prevent="dichuyen(1)" @keydown.up.prevent="dichuyen(-1)"
      @keydown.enter.prevent="chon(kq[i])" @keydown.esc.stop="thoat"
    >
    <div v-if="mo && q.trim()" id="bdt-tim-ds" class="bdt-tim-ds" role="listbox">
      <button
        v-for="(r, j) in kq" :key="j" type="button" role="option" class="bdt-tim-dong" :aria-selected="j === i"
        @mousedown.prevent="chon(r)"
      ><span class="loai">{{ r.nhom }}</span><span style="min-width: 0"><span class="chu">{{ r.chu }}</span><span class="phu">{{ r.phu }}</span></span></button>
      <div v-if="!kq.length" class="bdt-tim-rong">Không thấy gì khớp.</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Search } from 'lucide-vue-next';
import { timKiem, type KetQuaTim } from '@/views/settings/ban-do-tin/tim';
import { dungBanDoTin } from '@/views/settings/ban-do-tin/use-ban-do-tin';

const s = dungBanDoTin();
const q = ref('');
const mo = ref(false);
const i = ref(0);
const o = ref<HTMLInputElement | null>(null);
const kq = computed(() => (s.mh.value ? timKiem(s.mh.value, q.value) : []));
watch(q, () => { i.value = 0; mo.value = true; });
const dichuyen = (b: number) => { if (kq.value.length) i.value = (i.value + b + kq.value.length) % kq.value.length; };
function chon(r?: KetQuaTim) {
  if (!r) return;
  s.datChon(r.chon);
  if (r.chon.kieu !== 'loai') s.tab.value = s.tab.value === 'theo_pha' ? 'theo_pha' : 'so_do';
  q.value = '';
  mo.value = false;
}
function thoat() { if (q.value) q.value = ''; else o.value?.blur(); mo.value = false; }
function dongTre() { setTimeout(() => (mo.value = false), 120); }
</script>
