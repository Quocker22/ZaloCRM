<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  PrintAgentsPage — Máy in nhiều chi nhánh (Task 7, spec 10/09).
  Admin tạo máy in ở đây -> hệ thống gen TOKEN + trả serverUrl -> admin dán 2
  giá trị này vào app print-agent-rs cài trên máy tính nối máy in tại chi
  nhánh đó. Đơn thuộc kho nào tự in ở máy phục vụ kho đó (chọn máy: Task 2/3).
  Token CHỈ hiện đầy đủ 1 LẦN ngay sau khi tạo — bảng danh sách chỉ hiện 4 ký
  tự cuối (tokenDuoi) vì ai cầm token đầy đủ mạo danh được máy in, nhận/gửi
  job in thật của org.

  Nhật ký máy in (hợp đồng v2, 24/09/2026 §5): cột Trạng thái thêm chip sự cố theo
  `tinhTrang` (đỏ = lỗi, vàng = cảnh báo); mục "Nhật ký máy in" (PrintAgentLogPanel) dưới
  bảng CHỈ hiện cho owner/admin. Mã → nhãn ở may-in-nhan.ts (nguồn duy nhất).
-->
<template>
  <div class="pa-page">
    <header class="pa-head">
      <div class="ico">🖨️</div>
      <div>
        <h1>Máy in</h1>
        <p>
          Mỗi chi nhánh 1 máy in riêng, phân biệt bằng <b>token</b>. Đơn thuộc kho nào tự in ở
          máy phục vụ kho đó. Tạo máy mới ở đây rồi dán <b>token + địa chỉ server</b> vào app máy
          in cài trên máy tính tại chi nhánh. <b>Chỉ quản trị.</b>
        </p>
      </div>
      <v-spacer />
      <v-btn color="primary" prepend-icon="mdi-plus" @click="openCreate">Thêm máy in</v-btn>
    </header>

    <v-alert v-if="loadError" type="error" density="compact" class="mb-3">{{ loadError }}</v-alert>

    <section class="pa-card">
      <v-table density="comfortable">
        <thead>
          <tr>
            <th>Tên</th>
            <th>Kho phục vụ</th>
            <th>Mặc định</th>
            <th>Trạng thái</th>
            <th class="ta-right">Thao tác</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in danhSach" :key="m.id">
            <td>{{ m.ten }}</td>
            <td>{{ tenKhoCua(m.warehouseIds) }}</td>
            <td>
              <v-chip v-if="m.laMacDinh" size="small" color="primary" variant="tonal">Mặc định</v-chip>
              <span v-else class="pa-muted">—</span>
            </td>
            <td>
              <div class="pa-status-cell">
                <span class="pa-status" :class="m.online ? 'on' : 'off'">
                  <span class="pa-dot"></span>{{ m.online ? 'Online' : 'Offline' }}
                </span>
                <v-chip
                  v-if="chipCua(m)"
                  size="small"
                  variant="tonal"
                  :color="chipCua(m)!.mau"
                  :prepend-icon="chipCua(m)!.bieuTuong"
                  :title="chipCua(m)!.tieuDe"
                  class="pa-tinh-trang"
                >{{ chipCua(m)!.chu }}</v-chip>
              </div>
            </td>
            <td class="ta-right">
              <v-btn size="small" variant="text" prepend-icon="mdi-pencil-outline" @click="openEdit(m)">Sửa</v-btn>
              <v-btn size="small" variant="text" color="error" prepend-icon="mdi-trash-can-outline" @click="openXoa(m)">Xoá</v-btn>
            </td>
          </tr>
          <tr v-if="!loading && danhSach.length === 0">
            <td colspan="5" class="pa-empty">Chưa có máy in nào. Bấm "Thêm máy in" để tạo máy đầu tiên.</td>
          </tr>
          <tr v-if="loading">
            <td colspan="5" class="pa-empty">Đang tải…</td>
          </tr>
        </tbody>
      </v-table>
    </section>

    <!-- Nhật ký máy in — CHỈ owner/admin (API 403 với người khác; mục tự ẩn nếu vẫn 403) -->
    <PrintAgentLogPanel v-if="laAdmin" :may-ins="danhSach" @lam-moi="taiLaiNgam" />

    <!-- Dialog Thêm / Sửa -->
    <v-dialog v-model="formDialog" max-width="480" persistent>
      <v-card>
        <v-card-title>{{ editing ? 'Sửa máy in' : 'Thêm máy in' }}</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="form.ten"
            label="Tên máy in"
            variant="outlined"
            density="comfortable"
            placeholder="VD: Máy in Hồ Chí Minh"
            hide-details="auto"
            class="mb-4"
            autofocus
          />
          <v-select
            v-model="form.warehouseIds"
            :items="khoOptions"
            item-title="label"
            item-value="value"
            label="Kho phục vụ"
            variant="outlined"
            density="comfortable"
            multiple
            chips
            hide-details="auto"
            class="mb-4"
          />
          <v-switch
            v-model="form.laMacDinh"
            label="Máy mặc định"
            color="primary"
            hide-details="auto"
            density="comfortable"
          />
          <v-alert v-if="formError" type="error" density="compact" class="mt-3">{{ formError }}</v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" :disabled="saving" @click="formDialog = false">Huỷ</v-btn>
          <v-btn color="primary" variant="flat" :loading="saving" @click="luuForm">Lưu</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Dialog hiện token sau khi tạo — CHỈ 1 LẦN -->
    <v-dialog v-model="tokenDialog" max-width="560" persistent>
      <v-card>
        <v-card-title class="d-flex align-center ga-2">
          <v-icon color="success">mdi-check-circle</v-icon> Đã tạo máy in "{{ tokenKetQua?.mayIn.ten }}"
        </v-card-title>
        <v-card-text>
          <v-alert type="warning" density="compact" variant="tonal" class="mb-4">
            Token chỉ hiện <b>1 lần này</b>. Sao chép ngay để dán vào app máy in — đóng cửa sổ này
            sẽ không xem lại được nữa (chỉ tạo máy mới nếu quên).
          </v-alert>

          <div class="pa-copy-field">
            <div class="pa-copy-label">Token</div>
            <v-text-field
              :model-value="tokenKetQua?.token"
              readonly
              variant="outlined"
              density="comfortable"
              hide-details="auto"
            >
              <template #append-inner>
                <v-btn size="small" variant="tonal" prepend-icon="mdi-content-copy" @click="copy(tokenKetQua?.token, 'Token')">
                  Copy
                </v-btn>
              </template>
            </v-text-field>
          </div>

          <div class="pa-copy-field mt-4">
            <div class="pa-copy-label">Địa chỉ server</div>
            <v-text-field
              :model-value="tokenKetQua?.serverUrl"
              readonly
              variant="outlined"
              density="comfortable"
              hide-details="auto"
            >
              <template #append-inner>
                <v-btn size="small" variant="tonal" prepend-icon="mdi-content-copy" @click="copy(tokenKetQua?.serverUrl, 'Địa chỉ server')">
                  Copy
                </v-btn>
              </template>
            </v-text-field>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn color="primary" variant="flat" @click="dongTokenDialog">Đã sao chép, đóng</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Dialog confirm xoá — KHÔNG dùng window.confirm (treo) -->
    <v-dialog v-model="xoaDialog" max-width="420">
      <v-card>
        <v-card-title class="d-flex align-center ga-2">
          <v-icon color="error">mdi-alert</v-icon> Xoá máy in?
        </v-card-title>
        <v-card-text>
          Xoá máy in <b>"{{ dangXoa?.ten }}"</b>? App đang dùng token này sẽ mất kết nối, không
          nhận job in nữa. Thao tác không hoàn tác được.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" :disabled="xoaLoading" @click="xoaDialog = false">Huỷ</v-btn>
          <v-btn color="error" variant="flat" :loading="xoaLoading" @click="xacNhanXoa">Xoá</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useToast } from '@/composables/use-toast';
import { useAuthStore } from '@/stores/auth';
import {
  layDanhSach, layKhos, tao, sua, xoa,
  type MayIn, type Kho, type TaoMayInKetQua,
} from '@/api/print-agents';
import PrintAgentLogPanel from './PrintAgentLogPanel.vue';
import { chipTinhTrang, type ChipTinhTrang } from './may-in-nhat-ky';

const toast = useToast();
const auth = useAuthStore();
const laAdmin = computed(() => auth.isAdmin);

const loading = ref(true);
const loadError = ref('');
const danhSach = ref<MayIn[]>([]);
const khos = ref<Kho[]>([]);

const khoOptions = computed(() => khos.value.map((k) => ({ value: k.id, label: `${k.ma} — ${k.ten}` })));

function tenKhoCua(ids: number[]): string {
  if (!ids || ids.length === 0) return '—';
  const mas = ids.map((id) => khos.value.find((k) => k.id === id)?.ma).filter(Boolean);
  return mas.length ? mas.join(', ') : '—';
}

// ── Chip tình trạng (§3.4) — "Hết giấy · 3 phút trước" tính theo lúc tải danh sách ──
const mocTaiDs = ref(Date.now());
const chipTheoMay = computed(() => {
  const m = new Map<string, ChipTinhTrang | null>();
  for (const may of danhSach.value) m.set(may.id, chipTinhTrang(may.tinhTrang, mocTaiDs.value));
  return m;
});
function chipCua(m: MayIn): ChipTinhTrang | null {
  return chipTheoMay.value.get(m.id) ?? null;
}

// Số lượt tải danh sách: tải ngầm (tự làm mới) chạy chồng với load() sau khi lưu/xoá thì
// chỉ kết quả của lượt MỚI NHẤT được ghi vào bảng.
let lanTaiDs = 0;

async function load() {
  const lan = ++lanTaiDs;
  loading.value = true;
  loadError.value = '';
  try {
    const [ds, kh] = await Promise.all([layDanhSach(), layKhos()]);
    khos.value = kh;
    if (lan === lanTaiDs) {
      danhSach.value = ds;
      mocTaiDs.value = Date.now();
    }
  } catch (e: unknown) {
    loadError.value = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      || 'Không tải được danh sách máy in';
  } finally {
    loading.value = false;
  }
}

/** Nhịp "Tự làm mới" của nhật ký: tải lại danh sách máy (Online/chip) không nháy bảng. */
async function taiLaiNgam() {
  if (loading.value) return;
  const lan = ++lanTaiDs;
  try {
    const ds = await layDanhSach({ ngam: true });
    if (lan !== lanTaiDs) return;
    danhSach.value = ds;
    mocTaiDs.value = Date.now();
  } catch {
    // Giữ bảng đang hiện; nhịp sau thử lại. Chạy ngầm nên không toast — mục
    // nhật ký cùng nhịp đã báo lỗi ngay tại chỗ.
  }
}

// ── Dialog Thêm/Sửa ──────────────────────────────────────────────────────
const formDialog = ref(false);
const editing = ref<MayIn | null>(null);
const saving = ref(false);
const formError = ref('');
const form = ref<{ ten: string; warehouseIds: number[]; laMacDinh: boolean }>({
  ten: '', warehouseIds: [], laMacDinh: false,
});

function openCreate() {
  editing.value = null;
  form.value = { ten: '', warehouseIds: [], laMacDinh: false };
  formError.value = '';
  formDialog.value = true;
}

function openEdit(m: MayIn) {
  editing.value = m;
  form.value = { ten: m.ten, warehouseIds: [...m.warehouseIds], laMacDinh: m.laMacDinh };
  formError.value = '';
  formDialog.value = true;
}

async function luuForm() {
  const ten = form.value.ten.trim();
  if (!ten) {
    formError.value = 'Chưa nhập tên máy in';
    return;
  }
  saving.value = true;
  formError.value = '';
  try {
    const payload = { ten, warehouseIds: form.value.warehouseIds, laMacDinh: form.value.laMacDinh };
    if (editing.value) {
      await sua(editing.value.id, payload);
      toast.success(`Đã cập nhật máy in "${ten}"`);
      formDialog.value = false;
      await load();
    } else {
      const ketQua = await tao(payload);
      formDialog.value = false;
      await load();
      moTokenDialog(ketQua);
    }
  } catch (e: unknown) {
    const err = e as { response?: { data?: { error?: string } } };
    const code = err?.response?.data?.error;
    formError.value = code === 'THIEU_TEN' ? 'Chưa nhập tên máy in'
      : code === 'CHI_ADMIN' ? 'Chỉ quản trị mới được thao tác'
      : 'Lưu thất bại';
  } finally {
    saving.value = false;
  }
}

// ── Dialog hiện token (chỉ sau khi tạo) ─────────────────────────────────
const tokenDialog = ref(false);
const tokenKetQua = ref<TaoMayInKetQua | null>(null);

function moTokenDialog(ketQua: TaoMayInKetQua) {
  tokenKetQua.value = ketQua;
  tokenDialog.value = true;
}

function dongTokenDialog() {
  tokenDialog.value = false;
  tokenKetQua.value = null;
}

async function copy(value: string | undefined, label: string) {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`Đã sao chép ${label}`);
  } catch {
    toast.error(`Không sao chép được ${label}`);
  }
}

// ── Xoá — v-dialog confirm, KHÔNG window.confirm ─────────────────────────
const xoaDialog = ref(false);
const dangXoa = ref<MayIn | null>(null);
const xoaLoading = ref(false);

function openXoa(m: MayIn) {
  dangXoa.value = m;
  xoaDialog.value = true;
}

async function xacNhanXoa() {
  if (!dangXoa.value) return;
  xoaLoading.value = true;
  try {
    await xoa(dangXoa.value.id);
    toast.success(`Đã xoá máy in "${dangXoa.value.ten}"`);
    xoaDialog.value = false;
    await load();
  } catch (e: unknown) {
    const code = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
    toast.error(code === 'CHI_ADMIN' ? 'Chỉ quản trị mới được thao tác' : 'Xoá thất bại');
  } finally {
    xoaLoading.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.pa-page { max-width: 1200px; }
.pa-head { display: flex; gap: 14px; align-items: flex-start; margin-bottom: 18px; }
.pa-head .ico { width: 44px; height: 44px; border-radius: 12px; background: #eff6ff; display: grid; place-items: center; font-size: 22px; flex: none; }
.pa-head h1 { font-size: 19px; font-weight: 700; margin: 0 0 4px; }
.pa-head p { color: #555; font-size: 14px; line-height: 1.5; margin: 0; }
.pa-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 8px 8px 4px; margin-bottom: 16px; }
.pa-empty { text-align: center; color: #999; padding: 20px 0 !important; }
.pa-muted { color: #999; }
.ta-right { text-align: right; }
.pa-status { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; }
.pa-status.on { color: #166534; }
.pa-status.off { color: #6b7280; }
.pa-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.pa-status.on .pa-dot { background: #22c55e; }
.pa-status.off .pa-dot { background: #9ca3af; }
.pa-status-cell { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
.pa-tinh-trang { max-width: 100%; }
.pa-copy-label { font-size: 12px; font-weight: 600; color: #6b7785; margin-bottom: 4px; }
</style>
