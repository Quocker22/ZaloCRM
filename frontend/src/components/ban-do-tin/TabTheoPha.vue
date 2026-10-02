<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- TabTheoPha — đọc bản đồ theo từng pha (SPEC §9.1). Cũng là bản rút gọn trên điện thoại. -->
<template>
  <section class="bdt-tab-khung" aria-label="Theo pha">
    <div class="bdt-tp-dau">
      <span>Lần đầu xem bản đồ tin?</span>
      <button type="button" class="bdt-nut huong-dan" style="margin-left: auto" @click="s.hopHuongDan.value = true"><BookOpenText :size="14" />Hướng dẫn sử dụng</button>
    </div>
    <div class="bdt-dai-pha" role="tablist" aria-label="Chọn pha">
      <button
        v-for="p in mh.pha" :key="p.id" type="button" role="tab" :aria-selected="phaId === p.id" @click="phaId = p.id"
      ><b>{{ p.ma }}</b><span v-if="!gon">{{ p.ten }}</span></button>
    </div>
    <div class="bdt-tp-than">
      <div class="bdt-tp-tieu-de">
        <h3><span class="ma">{{ pha.ma }}</span>{{ pha.ten }}</h3>
        <button type="button" class="lk" @click="xemLienKet">Xem liên kết của pha</button>
      </div>
      <p class="bdt-trich">“{{ pha.cau_hoi }}”</p>
      <div class="bdt-tp-hai">
        <div>
          <h4 class="bdt-h4">Đẩy sang pha sau</h4>
          <ul class="bdt-tp-ds">
            <li v-for="t in dayPhaSau" :key="t"><Check :size="14" />{{ t }}</li>
            <li v-if="!dayPhaSau.length" class="bdt-nho">Không có.</li>
          </ul>
        </div>
        <div>
          <h4 class="bdt-h4">Đích trong pha</h4>
          <ul class="bdt-tp-ds">
            <li v-for="h in dichTrongPha" :key="h.id"><IconBdt :ten="h.icon" :size="14" style="color: var(--bdt-brand)" />{{ h.ten }}</li>
          </ul>
        </div>
      </div>
      <h4 class="bdt-h4">{{ khoi.length }} khối trong pha</h4>
      <div class="bdt-the-luoi">
        <button v-for="k in khoi" :key="k.id" type="button" class="bdt-the" :data-the="k.id" @click="emit('chonKhoi', k.id)">
          <span class="o-ico"><IconBdt :ten="mh.hang[k.hang].icon" :size="16" /></span>
          <span style="min-width: 0">
            <span class="kenh">{{ mh.hang[k.hang].ten }}{{ k.ban_sao ? ' · bản sao' : '' }}</span>
            <span class="ten" style="display: block">{{ k.ten }}<span v-for="t in k.tags.slice(0, 2)" :key="t" class="bdt-tag" :class="LOP_TAG[t]">{{ t }}</span></span>
            <span class="mt">{{ moTa(k.nguon_id) }}</span>
            <span class="cuoi"><span>Nhận {{ mh.vao[k.id].length }}</span><span>Đẩy {{ mh.ra[k.id].length }}</span></span>
          </span>
        </button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { BookOpenText, Check } from 'lucide-vue-next';
import IconBdt from './IconBdt.vue';
import { dungBanDoTin } from '@/views/settings/ban-do-tin/use-ban-do-tin';
import { viTriPha } from '@/views/settings/ban-do-tin/mo-hinh';
import type { Hang, MaPha, TagKhoi } from '@/views/settings/ban-do-tin/kieu';

defineProps<{ gon?: boolean }>();
const emit = defineEmits<{ chonKhoi: [id: string] }>();
const s = dungBanDoTin();
const mh = computed(() => s.mh.value!);
const LOP_TAG: Record<TagKhoi, string> = { Mã: 't-ma', Model: 't-model', Mẫu: 't-mau', Ảnh: 't-anh', Mới: 't-moi', Bóng: 't-bong', Nguồn: 't-nguon', CRM: 't-crm' };
const phaId = ref<MaPha>((s.chon.value?.kieu === 'pha' ? s.chon.value.id : 'hoi') as MaPha);
const pha = computed(() => mh.value.pha.find((p) => p.id === phaId.value)!);
const khoi = computed(() => mh.value.khoi.filter((k) => k.pha === phaId.value));
const dichTrongPha = computed(() => {
  const thay = new Set(khoi.value.map((k) => k.hang));
  return Object.values(mh.value.hang).filter((h) => thay.has(h.id)) as Hang[];
});
const dayPhaSau = computed(() => {
  const i = viTriPha(phaId.value);
  const ten = new Set<string>();
  for (const k of khoi.value) for (const l of mh.value.ra[k.id]) {
    const d = mh.value.khoiTheoId[l.den];
    if (viTriPha(d.pha) > i) ten.add(`${d.ten} (${mh.value.pha[viTriPha(d.pha)].ma})`);
  }
  return [...ten];
});
const moTa = (id: string) => mh.value.composer[id]?.khi_nao ?? mh.value.nutPhu[id]?.mo_ta ?? '';
function xemLienKet() { s.datChon({ kieu: 'pha', id: phaId.value }); s.tab.value = 'so_do'; }
</script>
