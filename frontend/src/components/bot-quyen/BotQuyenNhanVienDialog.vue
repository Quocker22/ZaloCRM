<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  Hộp Thêm / Sửa nhân viên của bot (trang Quyền bot, docs/77 §3.3). Dùng ở tab Nhân viên và ở ngăn
  thành viên nhóm ("Đặt làm nhân viên", "Là người công ty (không dùng bot)" — uid + tên lấy sẵn từ nhóm).
  Khung "Sau khi lưu" nói bot sẽ làm gì với người này. Lý do bắt buộc đúng chỗ backend bắt buộc:
  tạo người công ty / đang khoá / đã nghỉ; sửa mà hạ vai hoặc khoá / cho nghỉ (bot-quyen-luat.ts).
  Zalo uid chỉ đọc khi sửa (backend không cho đổi). Lỗi 4xx (409 ADMIN_CUOI, 409 NHAN_VIEN_DA_CO…) hiện
  nguyên câu `error` — toast + trong hộp.
-->
<template>
  <v-dialog
    :model-value="modelValue"
    max-width="580"
    :fullscreen="isMobile"
    scrollable
    @update:model-value="(v: boolean) => { if (!v) dong(); }"
  >
    <v-card class="bq-goc bq-nv-dialog" rounded="lg">
      <div class="bq-dlg-dau">
        <div class="bq-dlg-ico" aria-hidden="true">
          <v-icon size="18" :icon="cheDo === 'sua' ? 'mdi-account-edit-outline' : 'mdi-account-plus-outline'" />
        </div>
        <div>
          <div class="bq-dlg-tieu-de">{{ tieuDe }}</div>
          <div v-if="mau?.nguon" class="bq-dlg-phu">{{ mau.nguon }}</div>
        </div>
      </div>

      <v-card-text class="bq-dlg-than">
        <v-text-field
          v-model="zaloUid"
          data-o="zalo-uid"
          label="Zalo uid"
          class="bq-mono-o"
          :readonly="uidChiDoc"
          :hint="cheDo === 'sua' ? 'Không đổi được — Zalo khác thì thêm nhân viên mới.' : mau?.khoaUid ? 'Lấy sẵn — uid theo nick ghi ở trên.' : 'Uid Zalo của người này (lấy ở ngăn Thành viên nhóm).'"
          persistent-hint
          maxlength="64"
        />
        <v-text-field v-model="tenGoi" data-o="ten-goi" label="Tên gọi" maxlength="100" hide-details="auto" />
        <div class="bq-hai-cot">
          <v-select
            v-if="!mau?.vaiCoDinh"
            v-model="vai"
            data-o="vai"
            :items="dsVai"
            item-title="title"
            item-value="value"
            label="Vai"
            hide-details="auto"
          />
          <div v-else class="bq-vai-co-dinh">
            <div class="bq-he-qua-nhan">Vai</div>
            <span class="bq-chip bq-chip--xam">{{ NHAN_VAI[mau.vaiCoDinh] }}</span>
          </div>
          <v-select
            v-model="trangThai"
            data-o="trang-thai"
            :items="dsTrangThai"
            item-title="title"
            item-value="value"
            label="Trạng thái"
            hide-details="auto"
          />
        </div>
        <v-select
          v-model="userId"
          data-o="user"
          :items="dsNguoiDung"
          item-title="title"
          item-value="value"
          label="Tài khoản CRM (không bắt buộc)"
          hide-details="auto"
        />
        <v-text-field v-model="ghiChu" data-o="ghi-chu" label="Ghi chú (không bắt buộc)" maxlength="500" hide-details="auto" />
        <v-text-field
          v-model="soDienThoai" data-o="so-dien-thoai" class="mt-2" label="SĐT Zalo (không bắt buộc)" maxlength="20"
          hint="Nick khác tìm người này theo SĐT — chỉ nối khi globalId Zalo trùng Zalo đã chọn" persistent-hint
        />

        <div v-if="cauHeQua" class="bq-he-qua" :class="{ 'bq-he-qua--ha': canLyDo }" aria-live="polite">
          <div class="bq-he-qua-nhan">Sau khi lưu</div>
          <div>{{ cauHeQua }}</div>
          <div v-if="canLyDo" class="bq-he-qua-ha">{{ cheDo === 'sua' ? 'Thay đổi này làm bot bớt quyền của người này — cần ghi lý do.' : 'Bot sẽ khoá Zalo này — cần ghi lý do.' }}</div>
        </div>

        <v-text-field
          v-model="lyDo"
          data-o="ly-do"
          :label="canLyDo ? 'Lý do (bắt buộc)' : 'Lý do (không bắt buộc)'"
          maxlength="500"
          hide-details="auto"
          :error="loiLyDo"
        />

        <v-alert v-if="loi" type="error" variant="tonal" density="compact" class="bq-loi" role="alert">{{ loi }}</v-alert>
      </v-card-text>

      <v-card-actions class="bq-dlg-chan">
        <v-spacer />
        <v-btn variant="text" :disabled="dangLuu" @click="dong">Huỷ</v-btn>
        <v-btn data-nut="luu" :color="canLyDo ? 'error' : 'primary'" variant="flat" :loading="dangLuu" @click="luu">
          {{ cheDo === 'sua' ? 'Lưu' : 'Thêm' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  themNhanVien, suaNhanVien,
  type NhanVien, type NguoiDungCrm, type SuaNhanVienPayload, type TaoNhanVienPayload,
} from '@/api/bot-quyen';
import { useToast } from '@/composables/use-toast';
import { useMobile } from '@/composables/use-mobile';
import {
  VAI, TRANG_THAI, NHAN_VAI, NHAN_TRANG_THAI, CAU_CAN_LY_DO_NHAN_VIEN, CAU_CAN_LY_DO_TAO_NHAN_VIEN,
  canLyDoSuaNhanVien, canLyDoTaoNhanVien, thieuLyDo, heQuaNhanVien, type Vai, type TrangThai,
} from '@/views/settings/bot-quyen-luat';
import { loiApi } from '@/views/settings/bot-quyen-loi';
import type { MauNhanVien } from '@/views/settings/bot-quyen-thanh-vien';

const props = defineProps<{
  modelValue: boolean;
  cheDo: 'tao' | 'sua';
  nhanVien?: NhanVien | null;
  mau?: MauNhanVien | null;
  nguoiDungCrm: NguoiDungCrm[];
}>();
const emit = defineEmits<{ 'update:modelValue': [boolean]; 'da-luu': [NhanVien] }>();

const toast = useToast();
const { isMobile } = useMobile();

const zaloUid = ref('');
const tenGoi = ref('');
const vai = ref<Vai | null>(null);
const trangThai = ref<TrangThai>('hoat_dong');
const userId = ref<string>('');
const ghiChu = ref('');
const soDienThoai = ref('');
const lyDo = ref('');
const loi = ref('');
const loiLyDo = ref(false);
const dangLuu = ref(false);

const uidChiDoc = computed(() => props.cheDo === 'sua' || !!props.mau?.khoaUid);

const tieuDe = computed(() => {
  if (props.cheDo === 'sua') return `Sửa nhân viên “${props.nhanVien?.tenGoi ?? ''}”`;
  return props.mau?.tieuDe ?? 'Thêm nhân viên';
});

/** "Đặt làm nhân viên" (từ ngăn thành viên) chọn trong 4 vai dùng bot — người công ty có nút riêng. */
const dsVai = computed(() => {
  const anCongTy = props.cheDo === 'tao' && !!props.mau?.khoaUid && !props.mau?.choPhepCongTy;
  return VAI.filter((v) => !(anCongTy && v === 'cong_ty')).map((v) => ({ title: NHAN_VAI[v], value: v }));
});
const dsTrangThai = TRANG_THAI.map((t) => ({ title: NHAN_TRANG_THAI[t], value: t }));
const dsNguoiDung = computed(() => {
  const ds = [{ title: '(không liên kết)', value: '' }, ...props.nguoiDungCrm.map((u) => ({ title: u.fullName, value: u.id }))];
  // Tài khoản đang liên kết mà không còn trong danh sách (đã xoá / khác org) — vẫn hiện, không mất lựa chọn.
  const nv = props.nhanVien;
  if (nv?.userId && !ds.some((x) => x.value === nv.userId)) ds.push({ title: nv.user?.fullName ?? '(tài khoản không còn)', value: nv.userId });
  return ds;
});

const vaiHieuLuc = computed<Vai | null>(() => props.mau?.vaiCoDinh ?? vai.value);

const canLyDo = computed(() => {
  const v = vaiHieuLuc.value;
  if (!v) return false;
  if (props.cheDo === 'sua' && props.nhanVien) {
    return canLyDoSuaNhanVien(props.nhanVien, { vai: v, trangThai: trangThai.value });
  }
  return canLyDoTaoNhanVien(v, trangThai.value);
});

const cauHeQua = computed(() => heQuaNhanVien(vaiHieuLuc.value, trangThai.value));

watch(
  () => [props.modelValue, props.nhanVien, props.mau] as const,
  ([mo]) => {
    if (!mo) return;
    const nv = props.cheDo === 'sua' ? props.nhanVien : null;
    zaloUid.value = nv?.zaloUid ?? props.mau?.zaloUid ?? '';
    tenGoi.value = nv?.tenGoi ?? props.mau?.tenGoi ?? '';
    vai.value = nv?.vai ?? props.mau?.vaiCoDinh ?? props.mau?.vai ?? null;
    trangThai.value = nv?.trangThai ?? 'hoat_dong';
    userId.value = nv?.userId ?? '';
    ghiChu.value = nv?.ghiChu ?? '';
    soDienThoai.value = nv?.soDienThoai ?? '';
    lyDo.value = '';
    loi.value = '';
    loiLyDo.value = false;
  },
  { immediate: true },
);

function dong() {
  if (dangLuu.value) return;
  emit('update:modelValue', false);
}

function kiem(): string | null {
  if (props.cheDo === 'tao' && !zaloUid.value.trim()) return 'Chưa có Zalo uid.';
  if (!tenGoi.value.trim()) return 'Chưa nhập tên gọi.';
  if (!vaiHieuLuc.value) return 'Chọn vai cho người này.';
  if (thieuLyDo(canLyDo.value, lyDo.value)) {
    loiLyDo.value = true;
    return props.cheDo === 'sua' ? CAU_CAN_LY_DO_NHAN_VIEN : CAU_CAN_LY_DO_TAO_NHAN_VIEN;
  }
  return null;
}

async function luu() {
  if (dangLuu.value) return;
  loiLyDo.value = false;
  const chan = kiem();
  if (chan) {
    loi.value = chan;
    return;
  }
  const v = vaiHieuLuc.value as Vai;
  const lyDoGui = lyDo.value.trim();
  dangLuu.value = true;
  loi.value = '';
  try {
    let ketQua: NhanVien;
    if (props.cheDo === 'sua' && props.nhanVien) {
      const payload: SuaNhanVienPayload = {
        tenGoi: tenGoi.value.trim(),
        vai: v,
        trangThai: trangThai.value,
        userId: userId.value || null,
        ghiChu: ghiChu.value.trim() || null,
        soDienThoai: soDienThoai.value.trim() || null,
        ...(lyDoGui ? { lyDo: lyDoGui } : {}),
      };
      const kq = await suaNhanVien(props.nhanVien.id, payload);
      ketQua = kq.nhanVien;
      toast.success(kq.doi ? `Đã lưu “${payload.tenGoi}” — bot áp trong khoảng 1 phút.` : 'Không có gì thay đổi.');
    } else {
      const payload: TaoNhanVienPayload = {
        zaloUid: zaloUid.value.trim(),
        ...(props.mau?.zaloUidsKem?.length ? { zaloUids: props.mau.zaloUidsKem } : {}),
        tenGoi: tenGoi.value.trim(),
        vai: v,
        trangThai: trangThai.value,
        ...(userId.value ? { userId: userId.value } : {}),
        ...(ghiChu.value.trim() ? { ghiChu: ghiChu.value.trim() } : {}),
        ...(soDienThoai.value.trim() ? { soDienThoai: soDienThoai.value.trim() } : {}),
        ...(lyDoGui ? { lyDo: lyDoGui } : {}),
      };
      ketQua = await themNhanVien(payload);
      toast.success(`Đã thêm “${payload.tenGoi}” — ${NHAN_VAI[v]}. Bot áp trong khoảng 1 phút.`);
    }
    dangLuu.value = false;
    emit('da-luu', ketQua);
    emit('update:modelValue', false);
  } catch (e) {
    const l = loiApi(e, 'Lưu thất bại');
    loi.value = l.chu;
    if (l.ma === 'THIEU_LY_DO') loiLyDo.value = true;
    if (!l.daBao) toast.error(l.chu, 6000);
  } finally {
    dangLuu.value = false;
  }
}
</script>

<style scoped>
@import './bot-quyen.css';

.bq-hai-cot { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 520px) {
  .bq-hai-cot { grid-template-columns: 1fr; }
}
.bq-vai-co-dinh { display: flex; flex-direction: column; gap: 4px; justify-content: center; }
.bq-mono-o :deep(input) { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
</style>
