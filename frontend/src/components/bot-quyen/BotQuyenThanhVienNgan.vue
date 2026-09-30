<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  Ngăn "Thành viên nhóm" (trang Quyền bot, docs/77 §3.3). GET /bot-quyen/nhom/:id/thanh-vien — danh sách
  lấy từ lần quét đã lưu, hoặc đọc thẳng từ Zalo ("Đọc lại từ Zalo" = lamMoi=1), hoặc (Zalo lỗi) từ những
  người đã nhắn trong nhóm; dòng nguồn nói rõ lấy từ đâu, lúc nào.
  Mỗi người một nhãn: Nhân viên (vai + trạng thái) / Nick của nhóm / Người ngoài / Nick CRM khác. Người ngoài
  có hai nút: "Đặt làm nhân viên" và "Là người công ty (không dùng bot)" — mở hộp thêm nhân viên điền sẵn
  uid + tên. Nhóm có người ngoài mà chức năng ≠ Khách ⇒ cảnh báo bot sẽ im.
  Máy tính: ngăn trượt bên phải; điện thoại: toàn màn hình.
-->
<template>
  <v-dialog
    :model-value="modelValue"
    class="bq-ngan-dialog"
    :fullscreen="isMobile"
    :transition="isMobile ? 'dialog-bottom-transition' : 'slide-x-reverse-transition'"
    scrollable
    @update:model-value="(v: boolean) => { if (!v) emit('update:modelValue', false); }"
  >
    <v-card class="bq-goc bq-ngan" rounded="0">
      <div class="bq-ngan-dau">
        <div class="bq-ngan-dau-chu">
          <div class="bq-dlg-tieu-de">Thành viên nhóm “{{ nhom ? tenNhomHienThi(nhom) : '' }}”</div>
          <div v-if="nhom" class="bq-dlg-phu">
            Nick {{ tenNick(nhom.nick) }} · {{ nhanChucNangNhom(nhom).chu }}
          </div>
          <div v-if="nhom" class="bq-ngan-trang-thai">
            <span class="bq-bot" :class="`bq-bot--${botNhom.mau}`">
              <v-icon size="14" :icon="botNhom.bieuTuong" />{{ botNhom.chu }}
            </span>
            <v-btn size="small" variant="text" color="primary" @click="emit('xep-loai')">
              {{ nhom.chucNang ? 'Đổi chức năng nhóm' : 'Xếp loại nhóm' }}
            </v-btn>
          </div>
        </div>
        <v-btn icon="mdi-close" variant="text" size="small" aria-label="Đóng" @click="emit('update:modelValue', false)" />
      </div>
      <v-divider />

      <v-card-text class="bq-ngan-than">
        <v-progress-linear v-if="dangTai" indeterminate color="primary" class="mb-2" />

        <div v-if="ketQua" class="bq-nguon">
          <div class="bq-nguon-chu">
            <v-icon size="16" icon="mdi-information-outline" />
            <span>{{ nguon.chu }}</span>
          </div>
          <div v-if="nguon.phu" class="bq-nguon-phu">{{ nguon.phu }}</div>
        </div>
        <div class="bq-nguon-nut">
          <v-btn size="small" variant="outlined" prepend-icon="mdi-refresh" :loading="dangTai && lamMoiLanCuoi" :disabled="dangTai" @click="tai(true)">
            Đọc lại từ Zalo
          </v-btn>
        </div>

        <v-alert v-if="canhBao" type="warning" variant="tonal" density="compact" class="bq-canh-bao" role="status">
          {{ canhBao }}
        </v-alert>
        <v-alert v-if="loiTai" type="error" variant="tonal" density="compact" class="bq-loi" role="alert">{{ loiTai }}</v-alert>

        <p v-if="ketQua && ketQua.thanhVien.length === 0" class="bq-trong">Không đọc được thành viên nào của nhóm này.</p>
        <ul v-else-if="ketQua" class="bq-tv-ds" aria-label="Thành viên">
          <li v-for="tv in ketQua.thanhVien" :key="tv.zaloUid" class="bq-tv" :data-uid="tv.zaloUid">
            <div class="bq-tv-dong">
              <div class="bq-tv-ten-khoi">
                <div class="bq-tv-ten">{{ tenThanhVien(tv) }}</div>
                <div class="bq-mono bq-mo">{{ tv.zaloUid }}</div>
              </div>
              <div class="bq-tv-nhan">
                <span v-for="c in chipThanhVien(tv)" :key="c.chu" class="bq-chip" :class="`bq-chip--${c.mau}`">{{ c.chu }}</span>
              </div>
            </div>
            <div v-if="tv.loai === 'nguoi_ngoai'" class="bq-tv-nut">
              <p v-if="goiYCongTy(tv)" class="bq-tv-goi-y">Đây là một nick Zalo của công ty — nên chọn “Là người công ty”.</p>
              <div class="bq-cac-nut">
                <v-btn size="small" variant="tonal" color="primary" @click="moThem(tv, 'nhan_vien')">Đặt làm nhân viên</v-btn>
                <v-btn size="small" variant="outlined" @click="moThem(tv, 'cong_ty')">Là người công ty (không dùng bot)</v-btn>
              </div>
            </div>
          </li>
        </ul>
      </v-card-text>
    </v-card>
  </v-dialog>

  <BotQuyenNhanVienDialog
    v-model="hopNv"
    che-do="tao"
    :mau="mauNv"
    :nguoi-dung-crm="nguoiDungCrm"
    @da-luu="daThemNhanVien"
  />
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { layThanhVienNhom, type NhanVien, type NguoiDungCrm, type NhomView, type ThanhVien, type ThanhVienNhom } from '@/api/bot-quyen';
import { useToast } from '@/composables/use-toast';
import { useMobile } from '@/composables/use-mobile';
import { trangThaiBotNhom } from '@/views/settings/bot-quyen-luat';
import { nhanChucNangNhom } from '@/views/settings/bot-quyen-mac-dinh';
import { tenNhomHienThi, tenNick } from '@/views/settings/bot-quyen-nhom';
import {
  chipThanhVien, chuNguonThanhVien, canhBaoNguoiNgoai, tenThanhVien, goiYCongTy, mauTuThanhVien, type MauNhanVien,
} from '@/views/settings/bot-quyen-thanh-vien';
import { loiApi } from '@/views/settings/bot-quyen-loi';
import BotQuyenNhanVienDialog from './BotQuyenNhanVienDialog.vue';

const props = defineProps<{ modelValue: boolean; nhom: NhomView | null; nguoiDungCrm: NguoiDungCrm[] }>();
const emit = defineEmits<{ 'update:modelValue': [boolean]; 'xep-loai': [] }>();

const toast = useToast();
const { isMobile } = useMobile();

const ketQua = ref<ThanhVienNhom | null>(null);
const dangTai = ref(false);
const loiTai = ref('');
const lamMoiLanCuoi = ref(false);
let lanTai = 0;

const botNhom = computed(() => trangThaiBotNhom(props.nhom?.chucNangHieuLuc ?? null));
const nguon = computed(() => (ketQua.value ? chuNguonThanhVien(ketQua.value) : { chu: '', phu: null }));
const canhBao = computed(() => (ketQua.value && props.nhom
  ? canhBaoNguoiNgoai(ketQua.value.soNguoiNgoai, props.nhom.chucNangHieuLuc)
  : null));

async function tai(lamMoi: boolean) {
  const n = props.nhom;
  if (!n) return;
  const lan = ++lanTai;
  dangTai.value = true;
  lamMoiLanCuoi.value = lamMoi;
  loiTai.value = '';
  try {
    const kq = await layThanhVienNhom(n.conversationId, { lamMoi });
    if (lan !== lanTai) return;
    ketQua.value = kq;
  } catch (e) {
    if (lan !== lanTai) return;
    const l = loiApi(e, 'Không tải được thành viên nhóm');
    loiTai.value = l.chu;
    if (!l.daBao) toast.error(l.chu, 6000);
  } finally {
    if (lan === lanTai) dangTai.value = false;
  }
}

// Mở ngăn (hoặc đổi sang nhóm khác) ⇒ nạp lại; đổi chức năng cùng nhóm thì giữ danh sách (chỉ cảnh báo đổi).
watch(
  () => [props.modelValue, props.nhom?.conversationId] as const,
  ([mo, id], cu) => {
    if (!mo || !id) return;
    const [moCu, idCu] = cu ?? [false, undefined];
    if (moCu && idCu === id && ketQua.value) return;
    ketQua.value = null;
    void tai(false);
  },
  { immediate: true },
);

// ── Thêm nhân viên / người công ty từ một thành viên ──
const hopNv = ref(false);
const mauNv = ref<MauNhanVien | null>(null);

function moThem(tv: ThanhVien, kieu: 'nhan_vien' | 'cong_ty') {
  if (!props.nhom) return;
  mauNv.value = mauTuThanhVien(tv, props.nhom, kieu);
  hopNv.value = true;
}

/** Cập nhật nhãn tại chỗ — không gọi Zalo lần nữa (quota), số người ngoài đếm lại từ danh sách. */
function daThemNhanVien(nv: NhanVien) {
  const kq = ketQua.value;
  if (!kq || !nv) return;
  const thanhVien = kq.thanhVien.map((tv) => (tv.zaloUid === nv.zaloUid
    ? { ...tv, loai: 'nhan_vien' as const, nhanVien: { id: nv.id, tenGoi: nv.tenGoi, vai: nv.vai, trangThai: nv.trangThai } }
    : tv));
  ketQua.value = { ...kq, thanhVien, soNguoiNgoai: thanhVien.filter((tv) => tv.loai === 'nguoi_ngoai').length };
}
</script>

<style scoped>
@import './bot-quyen.css';

.bq-ngan { height: 100%; }
.bq-ngan-dau { display: flex; gap: 8px; align-items: flex-start; padding: 16px 12px 12px 20px; }
.bq-ngan-dau-chu { flex: 1; min-width: 0; }
.bq-ngan-trang-thai { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; margin-top: 8px; }
.bq-ngan-than { display: flex; flex-direction: column; gap: 10px; padding: 14px 20px 24px; }
/* v-alert của Vuetify tự giãn (flex-grow) trong cột flex ⇒ ô cảnh báo cao vọt; chữ cam gốc quá nhạt trên nền sáng. */
.bq-ngan-than > .v-alert { flex: none; }
.bq-canh-bao :deep(.v-alert__content) { color: var(--bq-vang); font-weight: 600; }

.bq-nguon { font-size: 13px; }
.bq-nguon-chu { display: flex; align-items: center; gap: 6px; font-weight: 600; }
.bq-nguon-phu { color: var(--bq-mo); margin-top: 2px; line-height: 1.45; }
.bq-nguon-nut { display: flex; }

.bq-tv-ds { list-style: none; margin: 0; padding: 0; }
.bq-tv { padding: 10px 0; border-bottom: 1px solid var(--bq-vien); }
.bq-tv:last-child { border-bottom: 0; }
.bq-tv-dong { display: flex; gap: 10px; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; }
.bq-tv-ten-khoi { min-width: 0; flex: 1 1 180px; }
.bq-tv-ten { font-weight: 600; font-size: 14px; overflow-wrap: anywhere; }
.bq-tv-nhan { display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-end; }
.bq-tv-nut { margin-top: 8px; }
.bq-tv-goi-y { font-size: 12.5px; color: var(--bq-mo); margin: 0 0 6px; }
.bq-tv-nut .bq-cac-nut { flex-wrap: wrap; }
@media (max-width: 520px) {
  .bq-tv-nhan { justify-content: flex-start; }
  .bq-ngan-than { padding: 12px 14px 20px; }
  .bq-ngan-dau { padding: 12px 8px 10px 14px; }
}
</style>

<!-- Ngăn trượt bên phải trên màn rộng: lớp đặt lên gốc v-overlay (bị teleport — kiểu scoped không tới). -->
<style>
.v-dialog.bq-ngan-dialog:not(.v-dialog--fullscreen) {
  align-items: stretch;
  justify-content: flex-end;
}
.v-dialog.bq-ngan-dialog:not(.v-dialog--fullscreen) > .v-overlay__content {
  margin: 0;
  width: min(600px, 100%);
  max-width: 100%;
  height: 100%;
  max-height: 100%;
}
.v-dialog.bq-ngan-dialog:not(.v-dialog--fullscreen) > .v-overlay__content > .v-card {
  border-radius: 0;
}
</style>
