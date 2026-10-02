<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  Hộp xác nhận có ô LÝ DO (trang Quyền bot, docs/77 §8b-an-toàn): gỡ uid, "Nối" / "Không phải" một đề xuất, gỡ nick CRM.
  `batBuoc` ⇒ nút xác nhận chỉ bật khi đã ghi lý do. Lỗi backend hiện nguyên câu trong hộp. Slot mặc định: nội dung thêm
  (danh sách người được áp gợi ý "Gọi là", lưu ý duyệt tài liệu…).
-->
<template>
  <v-dialog :model-value="modelValue" max-width="520" @update:model-value="(v: boolean) => emit('update:modelValue', v)">
    <v-card class="bq-goc" rounded="lg">
      <v-card-title class="bq-dlg-tieu-de">{{ tieuDe }}</v-card-title>
      <v-card-text>
        <p v-if="moTa" class="bq-nho">{{ moTa }}</p>
        <!-- Nội dung thêm (danh sách người / tài liệu, lưu ý) — tuỳ nơi gọi. -->
        <slot />
        <v-text-field
          v-model="lyDo"
          class="mt-2"
          :label="batBuoc ? 'Lý do (bắt buộc)' : 'Lý do (không bắt buộc — có thì ghi nhật ký)'"
          maxlength="500"
          hide-details
          data-o="ly-do"
        />
        <v-alert v-if="loi" type="error" variant="tonal" density="compact" class="bq-loi mt-3" role="alert">{{ loi }}</v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :disabled="dangLam" @click="emit('update:modelValue', false)">Huỷ</v-btn>
        <v-btn
          :color="nguyHiem ? 'error' : 'primary'" variant="flat" data-nut="xac-nhan-ly-do"
          :loading="dangLam" :disabled="batBuoc && !lyDo.trim()" @click="emit('xac-nhan', lyDo.trim())"
        >{{ nutChu }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

const props = withDefaults(defineProps<{
  modelValue: boolean; tieuDe: string; moTa?: string; batBuoc?: boolean; nutChu?: string; dangLam?: boolean; loi?: string;
  nguyHiem?: boolean;
}>(), { moTa: '', batBuoc: false, nutChu: 'Xác nhận', dangLam: false, loi: '', nguyHiem: false });
const emit = defineEmits<{ 'update:modelValue': [boolean]; 'xac-nhan': [string] }>();

const lyDo = ref('');
watch(() => props.modelValue, (mo) => { if (mo) lyDo.value = ''; });
</script>

<style scoped>
@import './bot-quyen.css';
</style>
