<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  Tab "Nhật ký" của trang Quyền bot (docs/77 §3.3): mọi thay đổi quyền bot, mới nhất trước — ai, lúc nào,
  đổi gì (trước → sau), lý do. Mỗi dòng đọc thành MỘT câu (bot-quyen-nhat-ky.ts cauNhatKy). Dòng HỆ THỐNG ghi khi mặc định
  nhóm tự đổi (docs/77 §8) mang chip "Tự động".
-->
<template>
  <section class="bq-goc" aria-label="Nhật ký thay đổi quyền bot">
    <div class="bq-nk-dau">
      <p class="bq-mo bq-nk-mo-ta">{{ GIOI_HAN }} thay đổi gần nhất, mới nhất ở trên.</p>
      <v-btn variant="outlined" size="small" prepend-icon="mdi-refresh" :loading="dangTai" @click="tai">Làm mới</v-btn>
    </div>

    <v-alert v-if="loiTai" type="error" variant="tonal" density="compact" class="bq-loi mb-3" role="alert">{{ loiTai }}</v-alert>
    <div v-if="dangTai && ds.length === 0" class="bq-trong">Đang tải nhật ký…</div>
    <div v-else-if="!loiTai && ds.length === 0" class="bq-trong">Chưa có thay đổi nào.</div>

    <ol v-else-if="ds.length > 0" class="bq-nk-ds">
      <li v-for="e in dsSap" :key="e.id" class="bq-nk" :data-id="e.id">
        <div class="bq-nk-phu">
          <time :datetime="e.luc">{{ gio(e.luc) }}</time>
          <span class="bq-chip bq-chip--xam">{{ e.doiTuong === 'nhom' ? 'Nhóm' : e.doiTuong === 'nhan_vien' ? 'Nhân viên' : e.doiTuong }}</span>
          <span
            v-if="e.tuDong"
            class="bq-chip bq-chip--tu-dong"
            title="Hệ thống tự ghi: mặc định của nhóm đổi theo thành viên / danh sách nhân viên (không ai bấm)"
          >Tự động</span>
        </div>
        <div class="bq-nk-cau">{{ cauNhatKy(e, { tenNguoiDung }) }}</div>
      </li>
    </ol>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { layNhatKy, type NguoiDungCrm, type NhatKy } from '@/api/bot-quyen';
import { useToast } from '@/composables/use-toast';
import { cauNhatKy } from '@/views/settings/bot-quyen-nhat-ky';
import { loiApi } from '@/views/settings/bot-quyen-loi';
import { dinhDangGioVN } from '@/views/settings/may-in-nhat-ky';

const props = defineProps<{ nguoiDungCrm: NguoiDungCrm[] }>();

const GIOI_HAN = 200;
const toast = useToast();
const ds = ref<NhatKy[]>([]);
const dangTai = ref(false);
const loiTai = ref('');

/** API đã trả mới nhất trước; sắp lại cho chắc (cùng giây thì giữ thứ tự API). */
const dsSap = computed(() => [...ds.value].sort((a, b) => Date.parse(b.luc) - Date.parse(a.luc)));
const tenTheoId = computed(() => new Map(props.nguoiDungCrm.map((u) => [u.id, u.fullName])));
const tenNguoiDung = (id: string) => tenTheoId.value.get(id) ?? null;

function gio(luc: string): string {
  return dinhDangGioVN(luc, { coNam: true }).slice(0, 16);
}

async function tai() {
  dangTai.value = true;
  loiTai.value = '';
  try {
    ds.value = await layNhatKy(GIOI_HAN);
  } catch (e) {
    const l = loiApi(e, 'Không tải được nhật ký');
    loiTai.value = l.chu;
    if (!l.daBao) toast.error(l.chu, 6000);
  } finally {
    dangTai.value = false;
  }
}

onMounted(tai);
</script>

<style scoped>
@import './bot-quyen.css';

.bq-nk-dau { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.bq-nk-mo-ta { margin: 0; font-size: 13px; }
.bq-nk-ds { list-style: none; margin: 0; padding: 0; }
.bq-nk { padding: 10px 0; border-bottom: 1px solid var(--bq-vien); }
.bq-nk:last-child { border-bottom: 0; }
.bq-nk-phu { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--bq-mo); margin-bottom: 3px; }
.bq-nk-cau { font-size: 14px; line-height: 1.5; overflow-wrap: anywhere; }
.bq-chip--tu-dong { color: var(--bq-chinh); border-color: currentColor; border-style: dashed; background: transparent; }
</style>
