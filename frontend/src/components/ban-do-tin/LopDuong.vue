<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  LopDuong — các <g> đường nối của MỘT lớp svg (SPEC §4.1): viền lót (halo) · nét chính + mũi tên · vùng bấm 10px
  [· nét chạy khi nổi]. Lớp NỀN nhận props không đổi theo trạng thái ⇒ không vẽ lại khi bấm/rê; độ đục của cả lớp
  đổi bằng một class ở thẻ <svg> cha. Lớp NỔI chỉ nhận các đường đang nổi.
-->
<template>
  <g v-for="l in ds" :key="l.id" :data-lk="l.id">
    <path class="halo" :d="duong[l.id].d" :style="{ strokeWidth: rong(l) + 2.4 }" />
    <path
      class="net"
      :class="noi && kq?.chay && KIEU[l.loai].dash ? (l.loai === 'hoi_lai' ? 'chay-vong' : 'chay-dut') : ''"
      :d="duong[l.id].d"
      :marker-end="`url(#bdt-mui-${l.loai})`"
      :style="{ stroke: `var(--bdt-lk-${l.loai})`, strokeWidth: rong(l), strokeDasharray: KIEU[l.loai].dash ?? undefined, opacity: duc(l) }"
    />
    <path v-if="noi && kq?.chay && !KIEU[l.loai].dash" class="chay-lien" :d="duong[l.id].d" :style="{ opacity: duc(l) * 0.95 }" />
    <path
      class="vung-bam" :d="duong[l.id].d" stroke="transparent" stroke-width="10"
      @click.stop="emit('chon', l.id)" @mouseenter="emit('tro', l.id)" @mouseleave="emit('tro', null)"
    ><title>{{ l.so }}. {{ tieuDe(l) }}</title></path>
  </g>
</template>

<script setup lang="ts">
import { KIEU_DUONG_THEO_ID as KIEU } from '@/views/settings/ban-do-tin/cau-hinh';
import type { DuongVe } from '@/views/settings/ban-do-tin/dinh-tuyen';
import type { LienKet } from '@/views/settings/ban-do-tin/kieu';
import { doDucDuongNoi, type KetQuaTrangThai } from '@/views/settings/ban-do-tin/trang-thai';

const p = defineProps<{
  ds: LienKet[];
  duong: Record<string, DuongVe>;
  tenKhoi: (id: string) => string;
  noi?: boolean;
  kq?: KetQuaTrangThai | null;
}>();
const emit = defineEmits<{ chon: [id: string]; tro: [id: string | null] }>();

const rong = (l: LienKet) => KIEU[l.loai].rong * (p.noi && p.kq ? doDucDuongNoi(p.kq, l.id).heSo : 1);
const duc = (l: LienKet) => (p.noi && p.kq ? doDucDuongNoi(p.kq, l.id).opacity : 1);
const tieuDe = (l: LienKet) => `${p.tenKhoi(l.tu)} → ${p.tenKhoi(l.den)}${l.vi_sao ? ` — ${l.vi_sao}` : ''}`;
</script>
