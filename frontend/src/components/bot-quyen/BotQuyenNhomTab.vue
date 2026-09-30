<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  Tab "Nhóm" của trang Quyền bot (docs/77 §3.3): mọi nhóm Zalo trong CRM + chức năng + bot đang làm gì
  trong nhóm. Nhóm không xếp thì theo MẶC ĐỊNH (docs/77 §8): toàn nhân viên ⇒ "Nhóm nhân viên (mặc định)", có người
  ngoài ⇒ "Khách (mặc định)" — chip nói vì sao; chưa biết đủ thành viên ⇒ nhãn ĐỎ "Bot đang im — chưa xếp loại" + nút
  "Đọc lại". Chủ xếp tường minh ⇒ chip "cố định" (hộp xếp loại có "Theo mặc định" để bỏ). Lọc theo nick, ẩn nhóm đã ẩn (bật
  "Hiện nhóm đã ẩn"), tìm theo tên. "Xếp loại"/"Đổi" mở hộp chọn chức năng; "Thành viên" mở ngăn thành viên.
  Danh sách nạp một lần rồi lọc tại chỗ (bot-quyen-nhom.ts).
-->
<template>
  <section class="bq-goc" aria-label="Nhóm Zalo">
    <div class="bq-loc">
      <v-text-field
        v-model="tuKhoa"
        class="bq-loc-tim"
        label="Tìm nhóm"
        prepend-inner-icon="mdi-magnify"
        clearable
        hide-details
      />
      <v-select
        v-model="nickId"
        class="bq-loc-nick"
        :items="dsNickChon"
        item-title="title"
        item-value="value"
        label="Nick"
        hide-details
      />
      <v-switch v-model="hienDaAn" class="bq-loc-an" label="Hiện nhóm đã ẩn" color="primary" density="compact" hide-details inset />
      <v-btn variant="outlined" size="small" prepend-icon="mdi-refresh" :loading="dangTai" @click="tai">Làm mới</v-btn>
    </div>

    <p class="bq-giai-thich bq-mo">
      Nhóm không xếp thì tự theo thành viên: <b>toàn nhân viên</b> ⇒ Nhóm nhân viên (bot trả lời như nhân viên thường),
      <b>có người ngoài</b> ⇒ Khách (bot im). Bấm “Cố định” để tự chọn.
    </p>
    <p v-if="soChuaXepLoai > 0" class="bq-tom-tat">
      <v-icon size="16" icon="mdi-volume-off" />
      {{ soChuaXepLoai }} nhóm chưa xếp loại — bot đang im ở các nhóm này.
    </p>

    <v-alert v-if="loiTai" type="error" variant="tonal" density="compact" class="bq-loi mb-3" role="alert">{{ loiTai }}</v-alert>
    <v-progress-linear v-if="dangTai && ds.length > 0" indeterminate color="primary" />

    <div v-if="dangTai && ds.length === 0" class="bq-trong">Đang tải danh sách nhóm…</div>
    <div v-else-if="!loiTai && ds.length === 0" class="bq-trong">Chưa có nhóm Zalo nào trong CRM.</div>
    <div v-else-if="!loiTai && hienThi.length === 0" class="bq-trong">Không có nhóm nào khớp bộ lọc.</div>

    <v-table v-else-if="hienThi.length > 0" class="bq-bang" density="comfortable">
      <thead>
        <tr>
          <th>Nhóm</th>
          <th>Nick</th>
          <th>Chức năng</th>
          <th>Bot</th>
          <th>Cập nhật</th>
          <th class="bq-cot-nut"><span class="d-sr-only">Thao tác</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="n in hienThi" :key="n.conversationId" :data-id="n.conversationId">
          <td data-nhan="Nhóm">
            <div>
              <div class="bq-ten-nhom">
                {{ tenNhomHienThi(n) }}
                <span v-if="n.daAn" class="bq-chip bq-chip--xam">Đã ẩn</span>
              </div>
              <div v-if="tenDangKyPhu(n)" class="bq-nho bq-mo">Tên đăng ký: {{ tenDangKyPhu(n) }}</div>
              <div v-if="n.soThanhVien != null" class="bq-nho bq-mo">{{ n.soThanhVien }} thành viên</div>
            </div>
          </td>
          <td data-nhan="Nick"><span class="bq-nho">{{ tenNick(n.nick) }}</span></td>
          <td data-nhan="Chức năng">
            <div class="bq-cn">
              <span class="bq-cn-dong">
                <span class="bq-chip" :class="`bq-chip--${nhanChucNangNhom(n).mau}`" data-o="chuc-nang">{{ nhanChucNangNhom(n).chu }}</span>
                <span v-if="nhanChucNangNhom(n).coDinh" class="bq-chip bq-chip--xam" title="Chủ đã chọn — không tự đổi theo thành viên">
                  <v-icon size="12" icon="mdi-lock-outline" />cố định
                </span>
              </span>
              <span v-if="nhanChucNangNhom(n).lyDo" class="bq-nho bq-mo" data-o="ly-do-mac-dinh">{{ nhanChucNangNhom(n).lyDo }}</span>
            </div>
          </td>
          <td data-nhan="Bot">
            <span class="bq-bot" :class="`bq-bot--${trangThaiBotNhom(n.chucNangHieuLuc).mau}`">
              <v-icon size="14" :icon="trangThaiBotNhom(n.chucNangHieuLuc).bieuTuong" />{{ trangThaiBotNhom(n.chucNangHieuLuc).chu }}
            </span>
          </td>
          <td data-nhan="Cập nhật">
            <div v-if="n.capNhatLuc" class="bq-nho">
              <div>{{ gio(n.capNhatLuc) }}</div>
              <div v-if="n.capNhatBoi" class="bq-mo">{{ n.capNhatBoi.fullName }}</div>
            </div>
            <span v-else class="bq-mo bq-nho">—</span>
          </td>
          <td class="bq-cot-nut">
            <div class="bq-cac-nut">
              <v-btn size="small" :variant="n.chucNangHieuLuc ? 'outlined' : 'flat'" :color="n.chucNangHieuLuc ? undefined : 'primary'" @click="moXepLoai(n)">
                {{ n.chucNang ? 'Đổi' : n.chucNangHieuLuc ? 'Cố định' : 'Xếp loại' }}
              </v-btn>
              <v-btn
                v-if="!n.chucNang && !n.macDinh.chucNang"
                size="small"
                variant="text"
                prepend-icon="mdi-account-sync-outline"
                :loading="dangDocLai === n.conversationId"
                @click="docLai(n)"
              >Đọc lại</v-btn>
              <v-btn size="small" variant="text" prepend-icon="mdi-account-group-outline" @click="moThanhVien(n)">Thành viên</v-btn>
            </div>
          </td>
        </tr>
      </tbody>
    </v-table>

    <BotQuyenXepLoaiDialog v-model="hopXepLoai" :nhom="nhomXepLoai" @da-luu="tai" />
    <BotQuyenThanhVienNgan
      v-model="nganThanhVien"
      :nhom="nhomThanhVien"
      :nguoi-dung-crm="nguoiDungCrm"
      @xep-loai="nhomThanhVien && moXepLoai(nhomThanhVien)"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { layDanhSachNhom, docLaiThanhVienNhom, type NguoiDungCrm, type NhomView } from '@/api/bot-quyen';
import { useToast } from '@/composables/use-toast';
import { trangThaiBotNhom } from '@/views/settings/bot-quyen-luat';
import { locNhom, dsNick, tenNhomHienThi, tenDangKyPhu, tenNick } from '@/views/settings/bot-quyen-nhom';
import { nhanChucNangNhom, demBotIm } from '@/views/settings/bot-quyen-mac-dinh';
import { loiApi } from '@/views/settings/bot-quyen-loi';
import { dinhDangGioVN } from '@/views/settings/may-in-nhat-ky';
import BotQuyenXepLoaiDialog from './BotQuyenXepLoaiDialog.vue';
import BotQuyenThanhVienNgan from './BotQuyenThanhVienNgan.vue';

defineProps<{ nguoiDungCrm: NguoiDungCrm[] }>();

const toast = useToast();

const ds = ref<NhomView[]>([]);
const dangTai = ref(false);
const loiTai = ref('');
const tuKhoa = ref<string | null>('');
const nickId = ref(''); // '' = tất cả nick
const hienDaAn = ref(false);

const dsNickChon = computed(() => [{ title: 'Tất cả nick', value: '' }, ...dsNick(ds.value).map((x) => ({ title: x.ten, value: x.id }))]);
const hienThi = computed(() => locNhom(ds.value, { nickId: nickId.value || null, hienDaAn: hienDaAn.value, tuKhoa: tuKhoa.value ?? '' }));
const soChuaXepLoai = computed(() => demBotIm(ds.value));

function gio(luc: string): string {
  return dinhDangGioVN(luc, { coNam: true }).slice(0, 16);
}

let lanTai = 0;
async function tai() {
  const lan = ++lanTai;
  dangTai.value = true;
  loiTai.value = '';
  try {
    const moi = await layDanhSachNhom();
    if (lan !== lanTai) return;
    ds.value = moi;
    // Ngăn / hộp đang mở giữ nhóm theo id — thay bằng bản mới (chức năng vừa đổi hiện ngay).
    if (nhomThanhVien.value) nhomThanhVien.value = moi.find((x) => x.conversationId === nhomThanhVien.value!.conversationId) ?? nhomThanhVien.value;
  } catch (e) {
    if (lan !== lanTai) return;
    const l = loiApi(e, 'Không tải được danh sách nhóm');
    loiTai.value = l.chu;
    if (!l.daBao) toast.error(l.chu, 6000);
  } finally {
    if (lan === lanTai) dangTai.value = false;
  }
}

// ── Đọc lại danh sách thành viên (nhóm chưa có mặc định) ──
const dangDocLai = ref<string | null>(null);
async function docLai(n: NhomView) {
  dangDocLai.value = n.conversationId;
  try {
    await docLaiThanhVienNhom(n.conversationId);
    toast.success(`Đang đọc lại thành viên nhóm “${tenNhomHienThi(n)}” — bấm Làm mới sau vài giây.`);
    setTimeout(() => { void tai(); }, 4000);
  } catch (e) {
    const l = loiApi(e, 'Không yêu cầu đọc lại được');
    if (!l.daBao) toast.error(l.chu, 6000);
  } finally {
    dangDocLai.value = null;
  }
}

// ── Hộp xếp loại + ngăn thành viên ──
const hopXepLoai = ref(false);
const nhomXepLoai = ref<NhomView | null>(null);
const nganThanhVien = ref(false);
const nhomThanhVien = ref<NhomView | null>(null);

function moXepLoai(n: NhomView) {
  nhomXepLoai.value = n;
  hopXepLoai.value = true;
}

function moThanhVien(n: NhomView) {
  nhomThanhVien.value = n;
  nganThanhVien.value = true;
}

onMounted(tai);
</script>

<style scoped>
@import './bot-quyen.css';

.bq-loc { display: flex; flex-wrap: wrap; gap: 10px 12px; align-items: center; margin-bottom: 12px; }
.bq-loc-tim { flex: 1 1 220px; min-width: 180px; }
.bq-loc-nick { flex: 0 1 220px; min-width: 160px; }
.bq-loc-an { flex: none; }
@media (max-width: 520px) {
  .bq-loc-tim, .bq-loc-nick { flex: 1 1 100%; }
}
.bq-tom-tat {
  display: flex; align-items: center; gap: 6px; margin: 0 0 10px; font-size: 13px; font-weight: 600; color: var(--bq-do);
}
.bq-giai-thich { margin: 0 0 8px; font-size: 13px; line-height: 1.5; }
.bq-cn { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.bq-cn-dong { display: inline-flex; flex-wrap: wrap; gap: 4px; }
.bq-ten-nhom { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-weight: 600; overflow-wrap: anywhere; }
</style>
