<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  Hộp "Xếp loại nhóm" (trang Quyền bot, docs/77 §3.3). Mỗi lựa chọn chức năng kèm MỘT câu hệ quả, và câu
  của lựa chọn đang chọn hiện lại trong khung "Sau khi lưu" — người bấm Lưu đã đọc bot sẽ làm gì khác đi.
  Đổi làm bot BỚT quyền (bot-quyen-luat.ts canLyDoNhom, chép luật backend) ⇒ bắt buộc lý do; thiếu thì
  chặn ngay trong hộp, không gửi. Backend vẫn kiểm; lỗi 4xx hiện nguyên câu `error` (toast + trong hộp).
  "Theo mặc định" (DELETE — docs/77 §8) chỉ có khi nhóm đang được xếp tường minh: bỏ lựa chọn của chủ, nhóm tự theo
  thành viên (toàn nhân viên ⇒ Nhóm nhân viên, có người ngoài ⇒ Khách). Nhóm đang theo mặc định mở hộp với giá trị mặc
  định chọn sẵn — bấm Lưu là CỐ ĐỊNH giá trị đó.
-->
<template>
  <v-dialog
    :model-value="modelValue"
    max-width="620"
    :fullscreen="isMobile"
    scrollable
    @update:model-value="(v: boolean) => { if (!v) dong(); }"
  >
    <v-card class="bq-goc bq-xep-loai" rounded="lg">
      <div class="bq-dlg-dau">
        <div class="bq-dlg-ico" aria-hidden="true"><v-icon size="18" icon="mdi-tag-outline" /></div>
        <div>
          <div class="bq-dlg-tieu-de">{{ tieuDe }} “{{ ten }}”</div>
          <div class="bq-dlg-phu">
            Nick {{ nhom ? tenNick(nhom.nick) : '' }} · hiện tại: {{ hienTai }}
          </div>
        </div>
      </div>

      <v-card-text class="bq-dlg-than">
        <div v-if="nhom" class="bq-mac-dinh bq-nho" data-o="mac-dinh">
          <v-icon size="14" icon="mdi-account-group-outline" /> Mặc định theo thành viên: <b>{{ cauMacDinh(nhom.macDinh) }}</b>
        </div>
        <div class="bq-lua-chon-ds" role="radiogroup" aria-label="Chức năng nhóm">
          <button
            v-for="o in luaChon"
            :key="o.giaTri"
            type="button"
            role="radio"
            class="bq-lua-chon"
            :class="{ 'bq-lua-chon--chon': chon === o.giaTri, 'bq-lua-chon--bo': o.giaTri === 'bo' }"
            :aria-checked="chon === o.giaTri ? 'true' : 'false'"
            :data-gia-tri="o.giaTri"
            @click="chonLuaChon(o.giaTri)"
          >
            <span class="bq-lua-chon-cham" aria-hidden="true" />
            <span class="bq-lua-chon-chu">
              <span class="bq-lua-chon-ten">
                {{ o.ten }}<span v-if="o.giaTri === nhom?.chucNangHieuLuc" class="bq-mo"> (hiện tại{{ nhom?.laMacDinh ? ' — mặc định' : '' }})</span>
              </span>
              <span class="bq-lua-chon-cau">{{ o.cau }}</span>
            </span>
          </button>
        </div>

        <div v-if="chon" class="bq-he-qua" :class="{ 'bq-he-qua--ha': canLyDo }" aria-live="polite">
          <div class="bq-he-qua-nhan">Sau khi lưu</div>
          <div>{{ cauHeQua }}</div>
          <div v-if="canLyDo" class="bq-he-qua-ha">Thay đổi này làm bot bớt quyền trong nhóm — cần ghi lý do.</div>
        </div>

        <template v-if="chon !== 'bo'">
          <v-text-field
            v-model="tenDangKy"
            data-o="ten-dang-ky"
            label="Tên đăng ký"
            hint="Tên bot dùng khi nhắc tới nhóm này (không lấy tên Zalo tự đổi được)"
            persistent-hint
            maxlength="100"
          />
          <v-text-field v-model="ghiChu" data-o="ghi-chu" label="Ghi chú (không bắt buộc)" maxlength="500" hide-details="auto" />
        </template>
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
        <v-btn
          data-nut="luu"
          :color="chon === 'bo' || canLyDo ? 'error' : 'primary'"
          variant="flat"
          :loading="dangLuu"
          @click="luu"
        >
          {{ chon === 'bo' ? 'Về mặc định' : 'Lưu' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { luuChucNangNhom, boXepLoaiNhom, type NhomView } from '@/api/bot-quyen';
import { useToast } from '@/composables/use-toast';
import { useMobile } from '@/composables/use-mobile';
import {
  CHUC_NANG, NHAN_CHUC_NANG, HE_QUA_CHUC_NANG, CAU_CAN_LY_DO_NHOM,
  canLyDoNhom, thieuLyDo, type ChucNang,
} from '@/views/settings/bot-quyen-luat';
import { cauMacDinh, heQuaVeMacDinh, nhanChucNangNhom } from '@/views/settings/bot-quyen-mac-dinh';
import { tenNhomHienThi, tenDangKyMacDinh, tenNick } from '@/views/settings/bot-quyen-nhom';
import { loiApi } from '@/views/settings/bot-quyen-loi';

type LuaChon = ChucNang | 'bo';

const props = defineProps<{ modelValue: boolean; nhom: NhomView | null }>();
const emit = defineEmits<{ 'update:modelValue': [boolean]; 'da-luu': [] }>();

const toast = useToast();
const { isMobile } = useMobile();

const chon = ref<LuaChon | null>(null);
const tenDangKy = ref('');
const ghiChu = ref('');
const lyDo = ref('');
const loi = ref('');
const loiLyDo = ref(false);
const dangLuu = ref(false);

const ten = computed(() => (props.nhom ? tenNhomHienThi(props.nhom) : ''));
const tieuDe = computed(() => {
  const n = props.nhom;
  if (n?.chucNang) return 'Đổi chức năng nhóm';
  return n?.chucNangHieuLuc ? 'Cố định chức năng nhóm' : 'Xếp loại nhóm';
});
const hienTai = computed(() => {
  const n = props.nhom;
  if (!n) return '';
  const nh = nhanChucNangNhom(n);
  if (nh.coDinh) return `${nh.chu} (cố định)`;
  return nh.lyDo ? `${nh.chu} — ${nh.lyDo}${n.chucNangHieuLuc ? '' : ' (bot đang im)'}` : nh.chu;
});
const cauVeMacDinh = computed(() => (props.nhom ? heQuaVeMacDinh(props.nhom.macDinh) : ''));

const luaChon = computed(() => {
  const ds: Array<{ giaTri: LuaChon; ten: string; cau: string }> = CHUC_NANG.map((c) => ({
    giaTri: c, ten: NHAN_CHUC_NANG[c], cau: HE_QUA_CHUC_NANG[c],
  }));
  if (props.nhom?.chucNang) ds.push({ giaTri: 'bo', ten: 'Theo mặc định (tự theo thành viên)', cau: cauVeMacDinh.value });
  return ds;
});

const canLyDo = computed(() => {
  if (!chon.value || !props.nhom) return false;
  return canLyDoNhom(props.nhom.chucNang, chon.value === 'bo' ? null : chon.value);
});

const cauHeQua = computed(() => {
  if (!chon.value) return '';
  return chon.value === 'bo' ? cauVeMacDinh.value : HE_QUA_CHUC_NANG[chon.value];
});

watch(
  () => [props.modelValue, props.nhom] as const,
  ([mo, n]) => {
    if (!mo || !n) return;
    // Đang theo mặc định ⇒ chọn sẵn giá trị mặc định (Lưu = cố định nó).
    chon.value = n.chucNang ?? n.macDinh?.chucNang ?? null;
    tenDangKy.value = tenDangKyMacDinh(n);
    ghiChu.value = n.ghiChu ?? '';
    lyDo.value = '';
    loi.value = '';
    loiLyDo.value = false;
  },
  { immediate: true },
);

function chonLuaChon(g: LuaChon) {
  chon.value = g;
  loi.value = '';
  loiLyDo.value = false;
}

function dong() {
  if (dangLuu.value) return;
  emit('update:modelValue', false);
}

async function luu() {
  const n = props.nhom;
  if (!n || dangLuu.value) return;
  if (!chon.value) {
    loi.value = 'Chọn chức năng cho nhóm.';
    return;
  }
  if (thieuLyDo(canLyDo.value, lyDo.value)) {
    loi.value = CAU_CAN_LY_DO_NHOM;
    loiLyDo.value = true;
    return;
  }
  const lyDoGui = lyDo.value.trim();
  dangLuu.value = true;
  loi.value = '';
  try {
    if (chon.value === 'bo') {
      const kq = await boXepLoaiNhom(n.conversationId, lyDoGui || undefined);
      toast.success(kq.doi
        ? `Nhóm “${ten.value}” về mặc định: ${cauMacDinh(n.macDinh)} — bot áp trong khoảng 1 phút.`
        : 'Nhóm này vốn đang theo mặc định.');
    } else {
      const c = chon.value;
      const kq = await luuChucNangNhom(n.conversationId, {
        chucNang: c,
        tenDangKy: tenDangKy.value.trim(),
        ghiChu: ghiChu.value.trim(),
        ...(lyDoGui ? { lyDo: lyDoGui } : {}),
      });
      toast.success(kq.doi
        ? `Đã lưu nhóm “${ten.value}” là ${NHAN_CHUC_NANG[c]} — bot áp trong khoảng 1 phút.`
        : 'Không có gì thay đổi.');
    }
    dangLuu.value = false;
    emit('da-luu');
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

.bq-lua-chon-ds { display: flex; flex-direction: column; gap: 6px; }
.bq-mac-dinh { display: flex; align-items: flex-start; gap: 5px; line-height: 1.5; color: var(--bq-mo); }
.bq-lua-chon {
  display: flex; gap: 10px; align-items: flex-start; width: 100%; text-align: left; cursor: pointer;
  padding: 9px 12px; border: 1px solid var(--bq-vien); border-radius: 8px; background: transparent;
  color: inherit; font: inherit;
}
.bq-lua-chon:hover { background: var(--bq-nen-nhe); }
.bq-lua-chon:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: 1px; }
.bq-lua-chon--chon { border-color: rgb(var(--v-theme-primary)); background: rgba(var(--v-theme-primary), 0.08); }
.bq-lua-chon--bo.bq-lua-chon--chon { border-color: rgb(var(--v-theme-error)); background: rgba(var(--v-theme-error), 0.08); }
.bq-lua-chon-cham {
  flex: none; width: 16px; height: 16px; margin-top: 2px; border-radius: 50%;
  border: 2px solid var(--bq-mo); box-sizing: border-box;
}
.bq-lua-chon--chon .bq-lua-chon-cham { border: 5px solid rgb(var(--v-theme-primary)); }
.bq-lua-chon--bo.bq-lua-chon--chon .bq-lua-chon-cham { border-color: rgb(var(--v-theme-error)); }
.bq-lua-chon-chu { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.bq-lua-chon-ten { font-weight: 700; font-size: 14px; }
.bq-lua-chon-cau { font-size: 13px; line-height: 1.45; color: var(--bq-mo); }
</style>
