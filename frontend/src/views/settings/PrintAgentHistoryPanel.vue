<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  PrintAgentHistoryPanel — thẻ "Đã in" / "Đã huỷ" trong mục Hàng đợi & nhật ký máy in (26/09, chủ
  giao: thêm danh sách đã in và đã huỷ cạnh "Hàng đợi in" — "log 30 ngày thôi"). Một component,
  hai thẻ: `trangThai` = `da_in` | `da_huy`.

  Dữ liệu: GET /may-in-agents/lich-su (backend lich-su-in.ts) — 30 ngày gần nhất theo LÚC in xong /
  LÚC huỷ, mới trước, "Tải thêm" bằng con trỏ. Chỉ đọc; không có thao tác nào trên dòng.
  "Đã huỷ" = huỷ CHẮC CHẮN (hoá đơn không in); "Bỏ khỏi hàng đợi" KHÔNG phải huỷ và không nằm ở đây.

  Tự nạp (khác thẻ Hàng đợi do trang cha nạp): lần đầu khi thẻ được chọn, rồi tự làm mới 15 giây
  CHỈ khi thẻ đang chọn và tab trình duyệt đang hiện — lấy trang đầu, gộp dòng mới lên trên (giữ các
  trang đã "Tải thêm"). Chống chồng request như thẻ Nhật ký in: huỷ yêu cầu trước (AbortController)
  + số "thế hệ". 403 → câu báo quyền, không đỏ, không toast.

  Giao diện như thẻ Hàng đợi: ép theme sáng (hsLight) — MobileLayout mặc định theme tối mà token
  Atlas là chữ tối; khung hẹp (< 640px, container query) mỗi dòng thành một thẻ xếp dọc.
-->
<template>
  <div class="ls-card" :aria-busy="dangTai">
    <v-theme-provider theme="hsLight">
      <div v-if="biCam" class="ls-rong" role="status">
        <div class="ls-rong-ico ls-rong-ico--xam" aria-hidden="true"><v-icon size="22" icon="mdi-lock-outline" /></div>
        <div class="ls-rong-chu">Chỉ chủ sở hữu hoặc quản trị viên xem được lịch sử in.</div>
        <div class="ls-rong-phu">Nhờ quản trị viên cấp quyền, hoặc đăng nhập lại nếu vừa được đổi vai trò.</div>
      </div>

      <template v-else>
        <div class="ls-toolbar">
          <v-select
            v-model="mayInId"
            class="ls-may-chon"
            :items="luaChonMayIn"
            prepend-inner-icon="mdi-printer-outline"
            variant="outlined"
            density="compact"
            hide-details
            aria-label="Lọc theo máy in"
          />
          <div class="ls-toolbar-phai">
            <span class="ls-dem" aria-live="polite">{{ dongTrangThai }}</span>
            <v-btn
              icon="mdi-refresh"
              variant="text"
              size="small"
              density="comfortable"
              :aria-label="`Tải lại danh sách ${chu.the.toLowerCase()}`"
              :title="`Tải lại danh sách ${chu.the.toLowerCase()}`"
              :loading="dangTai"
              @click="taiLai()"
            />
          </div>
        </div>

        <v-alert v-if="loi" type="error" variant="tonal" density="compact" class="ls-loi">
          {{ loi }}
          <template #append>
            <v-btn size="small" variant="text" @click="taiLai()">Thử lại</v-btn>
          </template>
        </v-alert>

        <div v-if="items.length === 0 && (dangTai || !daTai)" class="ls-rong" role="status">
          <v-progress-circular indeterminate size="18" width="2" color="primary" class="mr-2" />
          Đang tải…
        </div>

        <div v-else-if="items.length === 0 && !loi" class="ls-rong" role="status">
          <div class="ls-rong-ico" :class="{ 'ls-rong-ico--xam': trangThai === 'da_huy' }" aria-hidden="true">
            <v-icon size="22" :icon="chu.bieuTuongThe" />
          </div>
          <div class="ls-rong-chu">{{ chu.rong }}</div>
          <div v-if="mayInId !== TAT_CA" class="ls-rong-phu">Chỉ đang xem một máy — chọn "Tất cả máy in" để xem các máy khác.</div>
        </div>

        <v-table v-else-if="items.length" class="ls-bang">
          <thead>
            <tr>
              <th>Hoá đơn</th>
              <th class="ls-c-may">Máy in</th>
              <th>Kết quả</th>
              <th class="ls-c-gio" title="Giờ Việt Nam">Tạo lúc</th>
              <th class="ls-c-gio ls-c-gio-ket-thuc" :title="chu.tieuDeCotKetThuc">{{ chu.cotKetThuc }}</th>
            </tr>
          </thead>
          <tbody :class="{ 'ls-mo': dangTai }">
            <tr v-for="m in items" :key="m.id" class="ls-dong" :class="`ls-dong--${m.trangThai}`" :data-id="m.id">
              <td class="ls-c-hd">
                <div class="ls-so">{{ m.soHoaDon }}</div>
                <div v-if="m.tenKhach" class="ls-khach">{{ m.tenKhach }}</div>
              </td>
              <td class="ls-c-may"><span class="ls-nhan-hep">Máy in: </span>{{ m.mayInTen || '—' }}</td>
              <td class="ls-c-kq">
                <span class="ls-chip" :class="`ls-chip--${chipLichSu(m.trangThai).mau}`">
                  <v-icon size="14" :icon="chipLichSu(m.trangThai).bieuTuong" aria-hidden="true" />{{ chipLichSu(m.trangThai).chu }}
                </span>
                <div class="ls-ly-do">{{ m.lyDo || chu.phu }}</div>
              </td>
              <td class="ls-c-gio ls-c-tao">
                <span class="ls-nhan-hep">Tạo lúc </span>
                <span class="ls-gio" :title="dinhDangGioVN(m.tao, { coNam: true })">{{ mocGio(m.tao, bayGio).gio }}</span>
              </td>
              <td class="ls-c-gio ls-c-ket-thuc">
                <span class="ls-nhan-hep">{{ chu.nhanKetThuc }}</span>
                <span class="ls-gio" :title="dinhDangGioVN(m.ketThuc, { coNam: true })">{{ mocGio(m.ketThuc, bayGio).gio }}</span>
                <span class="ls-tuong-doi">{{ mocGio(m.ketThuc, bayGio).tuongDoi }}</span>
              </td>
            </tr>
          </tbody>
        </v-table>

        <div v-if="tiepTheo" class="ls-them">
          <v-btn variant="tonal" size="small" :loading="dangTaiThem" :disabled="dangTai" @click="taiThem">Tải thêm</v-btn>
        </div>
      </template>
    </v-theme-provider>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import {
  layLichSuIn, maHttpCuaLoi, laYeuCauDaHuy,
  type MayIn, type MucLichSu, type TrangThaiLichSu,
} from '@/api/print-agents';
import { dinhDangGioVN, gopTrangMoi, noiTrangSau } from './may-in-nhat-ky';
import { CHU_LICH_SU, chipLichSu, dongTrangThaiLichSu, locTrongCuaSo, mocGio } from './may-in-lich-su';

const props = withDefaults(defineProps<{
  trangThai: TrangThaiLichSu;
  mayIns: MayIn[];
  /** false khi thẻ không được chọn — không tải, nghỉ tự làm mới. */
  hoatDong?: boolean;
}>(), { hoatDong: true });

const TAT_CA = '__tat_ca__';
const GIOI_HAN = 50;
const NHIP_TU_LAM_MOI_MS = 15_000;

const chu = computed(() => CHU_LICH_SU[props.trangThai]);

// ── Lọc máy ───────────────────────────────────────────────────────────────
const mayInId = ref<string>(TAT_CA);
const luaChonMayIn = computed(() => [
  { title: 'Tất cả máy in', value: TAT_CA },
  ...props.mayIns.map((m) => ({ title: m.ten, value: m.id })),
]);
// Máy đang lọc bị xoá khỏi danh sách → về "Tất cả máy in" (select không hiện id trần).
watch(
  () => props.mayIns,
  (ds) => {
    if (mayInId.value !== TAT_CA && !ds.some((m) => m.id === mayInId.value)) mayInId.value = TAT_CA;
  },
);

// ── Dữ liệu ───────────────────────────────────────────────────────────────
const items = ref<MucLichSu[]>([]);
const tiepTheo = ref<string | null>(null);
const tong = ref<number | null>(null);
const dangTai = ref(false);
const dangTaiThem = ref(false);
const daTai = ref(false);
const loi = ref('');
const biCam = ref(false);
const lucCapNhat = ref<number | null>(null);
const bayGio = ref(Date.now());

const dongTrangThai = computed(() => {
  if (dangTai.value && items.value.length === 0) return 'Đang tải…';
  if (!daTai.value || (loi.value && items.value.length === 0)) return '';
  return dongTrangThaiLichSu(items.value.length, tong.value, !!tiepTheo.value, lucCapNhat.value);
});

let boHuy: AbortController | null = null;
let theHe = 0;
let dangLamMoi = false;
let daRoiTrang = false;

function thamSo(truoc?: string) {
  return {
    trangThai: props.trangThai,
    mayInId: mayInId.value === TAT_CA ? undefined : mayInId.value,
    truoc,
    gioiHan: GIOI_HAN,
  };
}

/** Huỷ yêu cầu đang bay, mở thế hệ mới. Mọi cờ "đang tải" thuộc thế hệ cũ bị xoá. */
function batDauYeuCau(): { signal: AbortSignal; the: number } {
  boHuy?.abort();
  boHuy = new AbortController();
  dangTai.value = false;
  dangTaiThem.value = false;
  dangLamMoi = false;
  return { signal: boHuy.signal, the: ++theHe };
}

function xuLyLoi(e: unknown, viec: string): void {
  const ma = maHttpCuaLoi(e);
  if (ma === 403) {
    biCam.value = true; // không toast, không đỏ (boQuaToast403)
    return;
  }
  if (ma === 404) {
    loi.value = 'Máy chủ chưa có lịch sử in (backend cần cập nhật).';
    return;
  }
  const maLoi = (e as { response?: { data?: { error?: unknown } } })?.response?.data?.error;
  const maDoc = typeof maLoi === 'string' && /^[A-Z][A-Z0-9_]+$/.test(maLoi) ? maLoi : `mã ${ma}`;
  loi.value = ma ? `${viec} (${maDoc}).` : `${viec} — không kết nối được máy chủ.`;
}

/** Tải lại từ đầu theo bộ lọc. `ngam` = gọi từ nhịp tự làm mới (5xx không toast chung). */
async function taiLai(tuy: { ngam?: boolean } = {}): Promise<void> {
  const { signal, the } = batDauYeuCau();
  dangTai.value = true;
  loi.value = '';
  try {
    const trang = await layLichSuIn(thamSo(), { signal, ngam: tuy.ngam === true });
    if (the !== theHe) return;
    items.value = trang.items;
    tiepTheo.value = trang.tiepTheo;
    tong.value = trang.tong;
    lucCapNhat.value = Date.now();
  } catch (e) {
    if (the !== theHe || laYeuCauDaHuy(e)) return;
    // Bộ lọc đã đổi mà tải hỏng: đừng để danh sách của bộ lọc CŨ nằm dưới như thể là kết quả.
    items.value = [];
    tiepTheo.value = null;
    tong.value = null;
    xuLyLoi(e, `Không tải được danh sách ${chu.value.the.toLowerCase()}`);
  } finally {
    if (the === theHe) {
      dangTai.value = false;
      daTai.value = true;
      bayGio.value = Date.now();
    }
  }
}

async function taiThem(): Promise<void> {
  const truoc = tiepTheo.value;
  if (!truoc || dangTai.value || dangTaiThem.value) return;
  const { signal, the } = batDauYeuCau(); // huỷ lượt tự làm mới đang bay (nếu có) — nhịp sau làm lại
  dangTaiThem.value = true;
  try {
    const trang = await layLichSuIn(thamSo(truoc), { signal });
    if (the !== theHe) return;
    items.value = noiTrangSau(items.value, trang.items);
    tiepTheo.value = trang.tiepTheo;
    loi.value = '';
  } catch (e) {
    if (the !== theHe || laYeuCauDaHuy(e)) return;
    xuLyLoi(e, 'Không tải thêm được');
  } finally {
    if (the === theHe) dangTaiThem.value = false;
  }
}

/** Nhịp tự làm mới: lấy trang đầu, gộp dòng mới lên trên, không nháy bảng. */
async function lamMoiNgam(): Promise<void> {
  if (dangTai.value || dangTaiThem.value || dangLamMoi) return;
  // Chỉ lần tải ĐẦU mới đi đường có "Đang tải…". Danh sách rỗng (vd "Đã huỷ" chưa có gì) cũng
  // làm mới NGẦM — bản trước gọi taiLai() nên cứ 15 giây lại nháy "Đang tải…" (giám sát vòng 2).
  if (!daTai.value) {
    await taiLai({ ngam: true });
    return;
  }
  const { signal, the } = batDauYeuCau();
  dangLamMoi = true;
  try {
    const trang = await layLichSuIn(thamSo(), { signal, ngam: true });
    if (the !== theHe) return;
    const { ds, datLai } = gopTrangMoi(items.value, trang.items);
    items.value = locTrongCuaSo(ds, trang.tu);
    if (datLai) tiepTheo.value = trang.tiepTheo;
    tong.value = trang.tong;
    loi.value = '';
    lucCapNhat.value = Date.now();
  } catch (e) {
    if (the !== theHe || laYeuCauDaHuy(e)) return;
    // Giữ danh sách đang xem; chỉ báo — nhịp sau tự thử lại.
    xuLyLoi(e, 'Không làm mới được — sẽ thử lại');
  } finally {
    if (the === theHe) dangLamMoi = false;
    bayGio.value = Date.now();
  }
}

watch(mayInId, () => {
  void taiLai();
});

// Thẻ vừa được chọn: lần đầu thì tải; quay lại thì lấy ngay phần đã lỡ.
watch(
  () => props.hoatDong,
  (hd) => {
    if (!hd || biCam.value) return;
    if (!daTai.value && !dangTai.value) void taiLai();
    else if (!document.hidden) void lamMoiNgam();
  },
);

// ── Tự làm mới 15 giây ───────────────────────────────────────────────────
let henGio: ReturnType<typeof setInterval> | null = null;

function nhip(): void {
  bayGio.value = Date.now();
  if (!props.hoatDong || biCam.value || document.hidden || daRoiTrang) return;
  void lamMoiNgam();
}

onMounted(() => {
  if (props.hoatDong) void taiLai();
  henGio = setInterval(nhip, NHIP_TU_LAM_MOI_MS);
});

onBeforeUnmount(() => {
  daRoiTrang = true;
  if (henGio) clearInterval(henGio);
  henGio = null;
  theHe++; // mọi phản hồi còn bay sau khi rời trang đều bị bỏ
  boHuy?.abort();
  boHuy = null;
});
</script>

<style scoped>
/* Cùng bộ token Atlas với trang Máy in (.airtable-scope); giá trị dự phòng nếu gắn chỗ khác.
   Màu nền/chữ đặt TƯỜNG MINH (không dựa vào theme Vuetify): MobileLayout mặc định theme tối. */
.ls-card {
  container-type: inline-size; container-name: lich-su;
  background: var(--at-canvas, #fff); color: var(--at-body, #475066);
  border: 1px solid var(--at-hairline, #e7eaf0); border-radius: 12px;
  box-shadow: var(--at-shadow-card, 0 1px 2px rgba(20, 26, 36, 0.05)); overflow: hidden;
}
.ls-toolbar {
  display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
  padding: 12px 14px 8px; border-bottom: 1px solid var(--at-hairline, #e7eaf0);
}
.ls-may-chon { flex: 0 1 260px; min-width: 190px; }
.ls-toolbar :deep(.v-field) { border-radius: 8px; font-size: 13px; }
.ls-toolbar :deep(.v-field__input) { font-size: 13px; }
.ls-toolbar-phai { display: flex; align-items: center; gap: 4px 10px; }
.ls-dem { font-size: 12px; color: var(--at-muted, #6b7488); font-variant-numeric: tabular-nums; }

.ls-loi { margin: 12px 14px; }

/* Bảng (khung rộng) */
.ls-bang { background: transparent !important; color: inherit !important; }
.ls-bang :deep(table) { table-layout: auto; }
.ls-bang :deep(th) {
  white-space: nowrap; height: 34px !important;
  font-size: 11px !important; font-weight: 600 !important; letter-spacing: 0.4px; text-transform: uppercase;
  color: var(--at-muted, #6b7488) !important; background: #fafbfd;
}
.ls-bang :deep(td) {
  font-size: 13px; color: var(--at-body, #475066); vertical-align: top; background: var(--at-canvas, #fff);
  padding-top: 9px !important; padding-bottom: 9px !important; height: auto !important;
  border-bottom-color: var(--at-hairline, #e7eaf0) !important;
}
.ls-mo { opacity: 0.55; transition: opacity 0.15s; }
.ls-dong:hover td { background: #f7f9fc; }
/* Vạch mép trái theo kết quả */
.ls-dong > td:first-child { box-shadow: inset 3px 0 0 transparent; }
.ls-dong--da_in > td:first-child { box-shadow: inset 3px 0 0 var(--at-atlas-success, #12b76a); }
.ls-dong--da_huy > td:first-child { box-shadow: inset 3px 0 0 var(--at-hint, #97a0b3); }

.ls-c-may { white-space: nowrap; }
.ls-c-kq { min-width: 220px; }
.ls-c-gio { white-space: nowrap; width: 1%; }
.ls-c-ket-thuc .ls-gio, .ls-c-ket-thuc .ls-tuong-doi { display: block; }
.ls-nhan-hep { display: none; }
.ls-so {
  font-family: var(--mono, 'Roboto Mono', ui-monospace, monospace); font-size: 12.5px;
  color: var(--at-ink, #141a24); white-space: nowrap; font-weight: 600;
}
.ls-khach { font-size: 12px; color: var(--at-muted, #6b7488); margin-top: 1px; }
.ls-gio { font-variant-numeric: tabular-nums; color: var(--at-ink, #141a24); font-size: 12.5px; }
.ls-c-tao .ls-gio { color: var(--at-body, #475066); }
.ls-tuong-doi { font-size: 11.5px; color: var(--at-muted, #6b7488); margin-top: 1px; }
.ls-ly-do { font-size: 12px; color: var(--at-body, #475066); margin-top: 4px; line-height: 1.45; }

.ls-chip {
  display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px; border-radius: 9999px;
  font-size: 11.5px; font-weight: 600; line-height: 1.6; white-space: nowrap;
  background: var(--at-surface-soft, #f1f4f9); color: var(--at-body, #475066); border: 1px solid var(--at-hairline, #e7eaf0);
}
.ls-chip--xanh-la { background: var(--at-atlas-success-soft, #e7f7ef); color: #1b6b46; border-color: #86efac; }
.ls-chip--xam { background: var(--at-surface-soft, #f1f4f9); color: var(--at-body, #475066); }

/* Trống / đang tải */
.ls-rong { text-align: center; color: var(--at-muted, #6b7488); padding: 32px 16px; font-size: 13px; }
.ls-rong-ico {
  width: 40px; height: 40px; border-radius: 10px; margin: 0 auto 10px;
  display: flex; align-items: center; justify-content: center;
  background: var(--at-atlas-success-soft, #e7f7ef); color: #1b6b46;
}
.ls-rong-ico--xam { background: var(--at-surface-soft, #f1f4f9); color: var(--at-muted, #6b7488); }
.ls-rong-chu { font-size: 13.5px; font-weight: 600; color: var(--at-ink, #141a24); }
.ls-rong-phu { font-size: 12.5px; margin-top: 4px; }

.ls-them { display: flex; justify-content: center; padding: 12px 0; border-top: 1px solid var(--at-hairline, #e7eaf0); }

/* ── Khung HẸP (điện thoại ~390px): mỗi dòng một thẻ xếp dọc — hoá đơn + khách, máy, kết quả +
      lý do, giờ tạo, giờ in/huỷ. Không cuộn ngang. ── */
@container lich-su (max-width: 640px) {
  .ls-bang :deep(.v-table__wrapper) { overflow: visible; }
  .ls-bang :deep(table), .ls-bang tbody { display: block; width: 100%; }
  .ls-bang thead { display: none; }
  .ls-dong {
    display: grid; grid-template-columns: minmax(0, 1fr);
    grid-template-areas: 'hd' 'may' 'kq' 'ket' 'tao';
    row-gap: 4px; padding: 12px 14px;
    border-bottom: 1px solid var(--at-hairline, #e7eaf0); background: var(--at-canvas, #fff);
  }
  .ls-dong > td {
    display: block; min-width: 0; width: auto !important; padding: 0 !important; border: 0 !important;
    white-space: normal; text-align: left; background: transparent !important; box-shadow: none !important;
  }
  .ls-dong--da_in { box-shadow: inset 3px 0 0 var(--at-atlas-success, #12b76a); }
  .ls-dong--da_huy { box-shadow: inset 3px 0 0 var(--at-hint, #97a0b3); }
  .ls-c-hd { grid-area: hd; }
  .ls-c-may { grid-area: may; font-size: 12px !important; color: var(--at-muted, #6b7488) !important; }
  .ls-c-kq { grid-area: kq; min-width: 0; }
  .ls-c-ket-thuc { grid-area: ket; display: flex !important; flex-wrap: wrap; align-items: baseline; gap: 2px 6px; }
  .ls-c-ket-thuc .ls-gio, .ls-c-ket-thuc .ls-tuong-doi { display: inline; margin: 0; }
  .ls-c-tao { grid-area: tao; }
  .ls-nhan-hep { display: inline; font-size: 12px; color: var(--at-hint, #97a0b3); }
  .ls-so { white-space: normal; overflow-wrap: anywhere; }
  .ls-chip { white-space: normal; }
  .ls-may-chon { flex: 1 1 100%; min-width: 0; }
  .ls-toolbar-phai { flex: 1 1 100%; justify-content: space-between; }
}
</style>
