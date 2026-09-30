<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  Tab "Nhân viên" của trang Quyền bot (docs/77 §3.3): ai là nhân viên với bot (theo Zalo uid), vai gì,
  đang hoạt động / khoá / đã nghỉ, gắn tài khoản CRM nào. Thêm / Sửa qua BotQuyenNhanVienDialog (lý do khi
  hạ / khoá, 409 ADMIN_CUOI hiện nguyên câu backend). Không xoá cứng — cho nghỉ bằng trạng thái. Bên dưới là "Chờ gán —
  người đã nhắn cho shop" (BotQuyenChoGan, docs/77 §8): người đã gán không còn ở đó.
-->
<template>
  <section class="bq-goc" aria-label="Nhân viên của bot">
    <div class="bq-nv-dau">
      <p class="bq-nv-mo-ta bq-mo">
        Bot nhận ra nhân viên theo <b>Zalo uid</b>. Cách nhanh nhất: chọn người trong “Chờ gán” bên dưới rồi bấm <b>Gán</b>
        (hoặc tab <b>Nhóm</b> → <b>Thành viên</b> → “Đặt làm nhân viên”).
      </p>
      <div class="bq-cac-nut">
        <v-btn variant="outlined" size="small" prepend-icon="mdi-refresh" :loading="dangTai" @click="tai">Làm mới</v-btn>
        <v-btn color="primary" variant="flat" size="small" prepend-icon="mdi-plus" @click="moThem">Thêm nhân viên</v-btn>
      </div>
    </div>

    <v-alert
      v-if="!dangTai && !loiTai && ds.length > 0 && soAdmin === 0"
      type="warning" variant="tonal" density="compact" class="mb-3"
    >
      Chưa có ai vai Quản trị đang hoạt động — nên đặt ít nhất một người.
    </v-alert>
    <v-alert v-if="loiTai" type="error" variant="tonal" density="compact" class="bq-loi mb-3" role="alert">{{ loiTai }}</v-alert>
    <v-progress-linear v-if="dangTai && ds.length > 0" indeterminate color="primary" />

    <div v-if="dangTai && ds.length === 0" class="bq-trong">Đang tải danh sách nhân viên…</div>
    <div v-else-if="!loiTai && ds.length === 0" class="bq-trong">
      Chưa có nhân viên nào — bot chưa biết ai là nhân viên. Thêm từ tab Nhóm → Thành viên, hoặc bấm “Thêm nhân viên”.
    </div>

    <v-table v-else-if="ds.length > 0" class="bq-bang" density="comfortable">
      <thead>
        <tr>
          <th>Tên gọi</th>
          <th>Zalo uid</th>
          <th>Vai</th>
          <th>Trạng thái</th>
          <th>Tài khoản CRM</th>
          <th>Ghi chú</th>
          <th>Cập nhật</th>
          <th class="bq-cot-nut"><span class="d-sr-only">Thao tác</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="nv in ds" :key="nv.id" :data-id="nv.id">
          <td data-nhan="Tên gọi"><span class="bq-ten">{{ nv.tenGoi }}</span></td>
          <td data-nhan="Zalo uid">
            <span class="bq-uid">
              <span class="bq-mono">{{ nv.zaloUid }}</span>
              <v-btn
                icon="mdi-content-copy"
                size="x-small"
                variant="text"
                density="comfortable"
                :aria-label="`Sao chép Zalo uid của ${nv.tenGoi}`"
                title="Sao chép"
                @click="saoChep(nv.zaloUid)"
              />
            </span>
          </td>
          <td data-nhan="Vai"><span class="bq-chip" :class="nv.vai === 'cong_ty' ? 'bq-chip--xam' : 'bq-chip--nv'">{{ nhanVai(nv.vai) }}</span></td>
          <td data-nhan="Trạng thái"><span class="bq-chip" :class="`bq-chip--${MAU_TRANG_THAI[nv.trangThai] ?? 'xam'}`">{{ nhanTrangThai(nv.trangThai) }}</span></td>
          <td data-nhan="Tài khoản CRM"><span class="bq-nho" :class="{ 'bq-mo': !nv.user }">{{ nv.user?.fullName ?? '—' }}</span></td>
          <td data-nhan="Ghi chú"><span class="bq-nho bq-ghi-chu" :class="{ 'bq-mo': !nv.ghiChu }">{{ nv.ghiChu || '—' }}</span></td>
          <td data-nhan="Cập nhật">
            <div class="bq-nho">
              <div>{{ gio(nv.capNhatLuc) }}</div>
              <div v-if="nv.capNhatBoi" class="bq-mo">{{ nv.capNhatBoi.fullName }}</div>
            </div>
          </td>
          <td class="bq-cot-nut">
            <v-btn size="small" variant="outlined" prepend-icon="mdi-pencil-outline" @click="moSua(nv)">Sửa</v-btn>
          </td>
        </tr>
      </tbody>
    </v-table>

    <BotQuyenChoGan ref="choGan" :nguoi-dung-crm="nguoiDungCrm" @da-gan="tai" />

    <BotQuyenNhanVienDialog
      v-model="hop"
      :che-do="dangSua ? 'sua' : 'tao'"
      :nhan-vien="dangSua"
      :nguoi-dung-crm="nguoiDungCrm"
      @da-luu="daLuu"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { layDanhSachNhanVien, type NguoiDungCrm, type NhanVien } from '@/api/bot-quyen';
import { useToast } from '@/composables/use-toast';
import { nhanTrangThai, nhanVai } from '@/views/settings/bot-quyen-luat';
import { loiApi } from '@/views/settings/bot-quyen-loi';
import { dinhDangGioVN } from '@/views/settings/may-in-nhat-ky';
import BotQuyenNhanVienDialog from './BotQuyenNhanVienDialog.vue';
import BotQuyenChoGan from './BotQuyenChoGan.vue';

defineProps<{ nguoiDungCrm: NguoiDungCrm[] }>();

const MAU_TRANG_THAI: Readonly<Record<string, string>> = { hoat_dong: 'xanh', khoa: 'vang', nghi: 'do' };

const toast = useToast();
const ds = ref<NhanVien[]>([]);
const dangTai = ref(false);
const loiTai = ref('');
const soAdmin = computed(() => ds.value.filter((nv) => nv.vai === 'admin' && nv.trangThai === 'hoat_dong').length);

function gio(luc: string): string {
  return dinhDangGioVN(luc, { coNam: true }).slice(0, 16);
}

let lanTai = 0;
async function tai() {
  const lan = ++lanTai;
  dangTai.value = true;
  loiTai.value = '';
  try {
    const moi = await layDanhSachNhanVien();
    if (lan !== lanTai) return;
    ds.value = moi;
  } catch (e) {
    if (lan !== lanTai) return;
    const l = loiApi(e, 'Không tải được danh sách nhân viên');
    loiTai.value = l.chu;
    if (!l.daBao) toast.error(l.chu, 6000);
  } finally {
    if (lan === lanTai) dangTai.value = false;
  }
}

async function saoChep(uid: string) {
  try {
    await navigator.clipboard.writeText(uid);
    toast.success('Đã sao chép Zalo uid');
  } catch {
    toast.error('Không sao chép được — chọn và sao chép tay.');
  }
}

const choGan = ref<InstanceType<typeof BotQuyenChoGan> | null>(null);

/** Thêm tay / sửa xong ⇒ tải lại cả hai danh sách (người vừa thêm rời "Chờ gán"). */
async function daLuu() {
  await tai();
  void choGan.value?.tai();
}

const hop = ref(false);
const dangSua = ref<NhanVien | null>(null);

function moThem() {
  dangSua.value = null;
  hop.value = true;
}

function moSua(nv: NhanVien) {
  dangSua.value = nv;
  hop.value = true;
}

onMounted(tai);
</script>

<style scoped>
@import './bot-quyen.css';

.bq-nv-dau { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.bq-nv-mo-ta { margin: 0; font-size: 13px; flex: 1 1 280px; }
.bq-ten { font-weight: 600; overflow-wrap: anywhere; }
.bq-uid { display: inline-flex; align-items: center; gap: 2px; }
.bq-ghi-chu { display: inline-block; max-width: 220px; overflow-wrap: anywhere; }
</style>
