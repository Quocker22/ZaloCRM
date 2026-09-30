<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  "Chờ gán — người đã nhắn cho shop" (tab Nhân viên của trang Quyền bot, docs/77 §8). Chủ 30/09: "danh sách tất cả
  những người đã nhắn tin cho shop, kiểu như /settings/crm/agent-operators; những người đã gán rồi sẽ không gán nữa".
  Nguồn: GET /bot-quyen/nguoi-da-nhan — tin riêng + tin nhóm, bỏ người đã là nhân viên và nick của org; người "đang sai
  bot" (trang agent-operators) có chip và đứng đầu. Chọn vai rồi bấm Gán ⇒ hộp xác nhận (uid + tên + vai điền sẵn) như
  mọi thay đổi khác của trang. Tìm (tên không dấu / uid) + phân trang ở máy chủ.
-->
<template>
  <section class="bq-goc bq-cho-gan" aria-label="Chờ gán — người đã nhắn cho shop">
    <div class="bq-cg-dau">
      <div>
        <h2 class="bq-cg-tieu-de">Chờ gán — người đã nhắn cho shop <span v-if="trang" class="bq-mo">({{ trang.tong }})</span></h2>
        <p class="bq-mo bq-cg-mo-ta">
          Mọi người đã nhắn vào nick shop (tin riêng hoặc trong nhóm) mà chưa có trong danh sách nhân viên. Zalo cấp uid
          <b>khác nhau cho mỗi nick</b> — gán đúng dòng của nick bot đang dùng.
        </p>
      </div>
      <v-btn variant="outlined" size="small" prepend-icon="mdi-refresh" :loading="dangTai" @click="tai(true)">Làm mới</v-btn>
    </div>

    <v-text-field
      v-model="tuKhoa"
      class="bq-cg-tim"
      label="Tìm theo tên hoặc uid"
      prepend-inner-icon="mdi-magnify"
      clearable
      hide-details
      @update:model-value="timTre"
    />

    <v-alert v-if="loiTai" type="error" variant="tonal" density="compact" class="bq-loi my-3" role="alert">{{ loiTai }}</v-alert>
    <v-progress-linear v-if="dangTai && trang" indeterminate color="primary" />

    <div v-if="dangTai && !trang" class="bq-trong">Đang tải người đã nhắn…</div>
    <div v-else-if="trang && trang.ungVien.length === 0" class="bq-trong">
      {{ tuKhoa ? 'Không có ai khớp.' : 'Chưa có ai nhắn mà chưa được gán.' }}
    </div>

    <v-table v-else-if="trang" class="bq-bang" density="comfortable">
      <thead>
        <tr>
          <th>Tên Zalo</th>
          <th>Tin gần nhất</th>
          <th>Ở đâu</th>
          <th>Vai</th>
          <th class="bq-cot-nut"><span class="d-sr-only">Thao tác</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="u in trang.ungVien" :key="u.zaloUid" :data-uid="u.zaloUid">
          <!-- Một khối con mỗi ô: màn hẹp mỗi ô là một hàng flex (nhãn | nội dung). -->
          <td data-nhan="Tên Zalo">
            <div>
              <div class="bq-cg-ten">
                <span class="bq-ten">{{ u.ten }}</span>
                <span v-if="u.dangSaiBot" class="bq-chip bq-chip--xanh" title="Đang được sai bot ở trang Nhân viên sai bot — gần như chắc là nhân viên">
                  <v-icon size="12" icon="mdi-robot-outline" />đang sai bot
                </span>
              </div>
              <div class="bq-mono bq-mo">{{ u.zaloUid }}</div>
            </div>
          </td>
          <td data-nhan="Tin gần nhất">
            <div>
              <div class="bq-nho bq-cg-tin">{{ tomTatTin(u) }}</div>
              <div v-if="u.tinCuoi" class="bq-nho bq-mo">{{ gio(u.tinCuoi.luc) }}</div>
            </div>
          </td>
          <td data-nhan="Ở đâu">
            <div class="bq-cg-noi">
              <span v-for="(d, i) in moTaNoi(u)" :key="i" class="bq-nho" :class="{ 'bq-mo': i > 0 }">{{ d }}</span>
            </div>
          </td>
          <td data-nhan="Vai">
            <select v-model="vaiChon[u.zaloUid]" class="bq-cg-vai" :aria-label="`Vai của ${u.ten}`">
              <option v-for="v in VAI" :key="v" :value="v">{{ NHAN_VAI[v] }}</option>
            </select>
          </td>
          <td class="bq-cot-nut">
            <v-btn size="small" color="primary" variant="flat" prepend-icon="mdi-account-plus-outline" @click="gan(u)">Gán</v-btn>
          </td>
        </tr>
      </tbody>
    </v-table>

    <div v-if="trang && soTrang > 1" class="bq-cg-trang">
      <v-btn size="small" variant="text" :disabled="trang.trang <= 1 || dangTai" prepend-icon="mdi-chevron-left" @click="denTrang(trang.trang - 1)">Trước</v-btn>
      <span class="bq-nho">Trang {{ trang.trang }} / {{ soTrang }}</span>
      <v-btn size="small" variant="text" :disabled="trang.trang >= soTrang || dangTai" append-icon="mdi-chevron-right" @click="denTrang(trang.trang + 1)">Sau</v-btn>
    </div>

    <BotQuyenNhanVienDialog
      v-model="hop"
      che-do="tao"
      :mau="mau"
      :nguoi-dung-crm="nguoiDungCrm"
      @da-luu="daGan"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { layNguoiDaNhan, type NguoiDaNhan, type NguoiDungCrm, type TrangNguoiDaNhan, type VaiNhanVien } from '@/api/bot-quyen';
import { useToast } from '@/composables/use-toast';
import { VAI, NHAN_VAI } from '@/views/settings/bot-quyen-luat';
import { moTaNoi, mauGan, tomTatTin } from '@/views/settings/bot-quyen-cho-gan';
import type { MauNhanVien } from '@/views/settings/bot-quyen-thanh-vien';
import { loiApi } from '@/views/settings/bot-quyen-loi';
import { dinhDangGioVN } from '@/views/settings/may-in-nhat-ky';
import BotQuyenNhanVienDialog from './BotQuyenNhanVienDialog.vue';

defineProps<{ nguoiDungCrm: NguoiDungCrm[] }>();
const emit = defineEmits<{ 'da-gan': [] }>();

const MOI_TRANG = 30;
const toast = useToast();
const trang = ref<TrangNguoiDaNhan | null>(null);
const dangTai = ref(false);
const loiTai = ref('');
const tuKhoa = ref<string | null>('');
const soTrang = computed(() => (trang.value ? Math.max(1, Math.ceil(trang.value.tong / trang.value.moiTrang)) : 1));
const vaiChon = reactive<Record<string, VaiNhanVien>>({});

function gio(luc: string): string {
  return dinhDangGioVN(luc, { coNam: true }).slice(0, 16);
}

let lanTai = 0;
async function tai(lamMoi = false, soTrangMuon = 1) {
  const lan = ++lanTai;
  dangTai.value = true;
  loiTai.value = '';
  try {
    const moi = await layNguoiDaNhan({ tuKhoa: tuKhoa.value ?? '', trang: soTrangMuon, moiTrang: MOI_TRANG, lamMoi });
    if (lan !== lanTai) return;
    // Người "đang sai bot" gần như chắc là nhân viên bán hàng — chọn sẵn Bán hàng cho mọi người (đổi được).
    for (const u of moi.ungVien) if (!vaiChon[u.zaloUid]) vaiChon[u.zaloUid] = 'sales';
    trang.value = moi;
  } catch (e) {
    if (lan !== lanTai) return;
    const l = loiApi(e, 'Không tải được danh sách người đã nhắn');
    loiTai.value = l.chu;
    if (!l.daBao) toast.error(l.chu, 6000);
  } finally {
    if (lan === lanTai) dangTai.value = false;
  }
}

function denTrang(n: number) {
  void tai(false, n);
}

let hen: ReturnType<typeof setTimeout> | null = null;
function timTre() {
  if (hen) clearTimeout(hen);
  hen = setTimeout(() => { void tai(false, 1); }, 300);
}

const hop = ref(false);
const mau = ref<MauNhanVien | null>(null);

function gan(u: NguoiDaNhan) {
  mau.value = mauGan(u, vaiChon[u.zaloUid] ?? 'sales');
  hop.value = true;
}

async function daGan() {
  emit('da-gan');
  await tai(false, trang.value?.trang ?? 1);
}

defineExpose({ tai });
onMounted(() => { void tai(); });
</script>

<style scoped>
@import './bot-quyen.css';

.bq-cho-gan { margin-top: 28px; padding-top: 18px; border-top: 1px solid var(--bq-vien); }
.bq-cg-dau { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: flex-start; justify-content: space-between; margin-bottom: 10px; }
.bq-cg-tieu-de { font-size: 15px; font-weight: 700; margin: 0 0 4px; }
.bq-cg-mo-ta { margin: 0; font-size: 13px; line-height: 1.5; max-width: 720px; }
.bq-cg-tim { max-width: 420px; margin-bottom: 8px; }
.bq-cg-ten { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.bq-ten { font-weight: 600; overflow-wrap: anywhere; }
.bq-cg-tin { max-width: 260px; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; }
.bq-cg-noi { display: flex; flex-direction: column; gap: 1px; max-width: 280px; overflow-wrap: anywhere; }
.bq-cg-vai {
  padding: 5px 8px; border: 1px solid var(--bq-vien); border-radius: 6px; background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface)); font: inherit; font-size: 13px; max-width: 220px;
}
.bq-cg-trang { display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 10px; }
@media (max-width: 700px) {
  .bq-cg-tin, .bq-cg-noi { max-width: none; }
  .bq-cg-vai { max-width: 100%; }
}
</style>
