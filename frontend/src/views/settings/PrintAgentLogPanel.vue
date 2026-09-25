<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  PrintAgentLogPanel — mục "Nhật ký máy in" dưới bảng máy in (hợp đồng nhật ký máy in v2,
  24/09/2026, §3.5 + §5). CHỈ owner/admin: trang cha chỉ gắn khi user là admin; API vẫn trả
  403 (vd JWT còn vai cũ) thì mục TỰ ẨN, không hiện lỗi đỏ, không toast (boQuaToast403).

  Chống chồng request: mỗi lần gọi huỷ yêu cầu trước (AbortController) và mang số "thế hệ";
  phản hồi của thế hệ cũ bị bỏ — đổi bộ lọc nhanh không bao giờ để trang cũ đè trang mới.
  Tự làm mới 15 giây: chỉ lấy trang ĐẦU rồi gộp dòng mới lên trên (giữ các trang đã "Tải
  thêm"); bỏ lượt khi tab ẩn hoặc đang có yêu cầu khác; dọn interval khi rời trang.

  Giao diện (25/09, khuôn Atlas như trang cha): tiêu đề mục + công tắc tự làm mới ở ngoài,
  MỘT khung trắng gồm thanh lọc (tìm · máy · khoảng) + hàng "viên" mức độ (một chạm, không
  menu) + bảng 5 cột; mức độ hiện bằng biểu tượng màu + vạch mép trái dòng.
-->
<template>
  <section v-if="!biCam" class="nk" aria-labelledby="nk-tieu-de">
    <div class="nk-head">
      <div class="nk-head-trai">
        <h2 id="nk-tieu-de" class="nk-h2">Nhật ký máy in</h2>
        <p class="nk-phu">Nhận lệnh, gửi máy in, đã in, lỗi, hết giấy, kẹt giấy… · lưu 90 ngày</p>
      </div>
      <div class="nk-head-phai">
        <span class="nk-dem" aria-live="polite">{{ dongTrangThai }}</span>
        <div class="nk-tu-lam-moi" title="Tự tải sự kiện mới mỗi 15 giây">
          <v-switch
            v-model="tuLamMoi"
            label="Tự làm mới"
            color="primary"
            density="compact"
            hide-details
            class="nk-switch"
          />
        </div>
        <v-btn
          icon="mdi-refresh"
          variant="text"
          size="small"
          density="comfortable"
          aria-label="Tải lại nhật ký"
          title="Tải lại nhật ký"
          :loading="dangTai"
          @click="taiLai"
        />
      </div>
    </div>

    <div class="nk-card">
      <div class="nk-toolbar">
        <v-text-field
          v-model="oTim"
          class="nk-tim"
          placeholder="Tìm số hoá đơn, tên khách, lỗi… (không cần dấu)"
          prepend-inner-icon="mdi-magnify"
          variant="outlined"
          density="compact"
          hide-details
          clearable
          aria-label="Tìm trong nhật ký"
          @keydown.enter="apDungTuKhoaNgay"
        />
        <v-select
          v-model="mayInId"
          class="nk-may"
          :items="luaChonMayIn"
          prepend-inner-icon="mdi-printer-outline"
          variant="outlined"
          density="compact"
          hide-details
          aria-label="Máy in"
        />
        <v-select
          v-model="khoang"
          class="nk-khoang"
          :items="KHOANG_DS"
          prepend-inner-icon="mdi-calendar-range"
          variant="outlined"
          density="compact"
          hide-details
          aria-label="Khoảng thời gian"
        />
      </div>

      <div class="nk-muc-loc" role="radiogroup" aria-label="Lọc theo mức độ">
        <button
          v-for="o in LUA_CHON_MUC_DO"
          :key="o.value"
          type="button"
          role="radio"
          class="nk-pill"
          :class="{ 'nk-pill--chon': mucDo === o.value }"
          :aria-checked="mucDo === o.value"
          @click="mucDo = o.value"
        >
          <span v-if="o.value !== 'tat_ca'" class="nk-pill-dot" :class="`nk-pill-dot--${o.value}`" aria-hidden="true" />
          {{ o.title }}
        </button>
      </div>

      <v-alert
        v-if="loi"
        type="error"
        variant="tonal"
        density="compact"
        class="nk-loi"
      >
        {{ loi }}
        <template #append>
          <v-btn size="small" variant="text" @click="taiLai">Thử lại</v-btn>
        </template>
      </v-alert>

      <v-progress-linear
        :active="dangTai && items.length > 0"
        indeterminate
        color="primary"
        height="2"
        aria-hidden="true"
      />

      <v-table class="nk-bang" :aria-busy="dangTai">
        <thead>
          <tr>
            <th class="nk-c-luc" title="Giờ Việt Nam">Thời gian</th>
            <th class="nk-c-su-kien">Sự kiện</th>
            <th class="nk-c-may">Máy in</th>
            <th class="nk-c-hd">Hoá đơn · Khách</th>
            <th>Nội dung</th>
          </tr>
        </thead>
        <tbody :class="{ 'nk-mo': dangTai && items.length > 0 }">
          <template v-for="k in items" :key="k.id">
            <tr
              class="nk-dong"
              :class="[`nk-dong--${k.mucDo}`, { 'nk-dong--mo': moRong.has(k.id) }]"
              @click="bamDong(k.id)"
            >
              <td class="nk-c-luc">
                <div class="nk-luc">
                  <v-btn
                    :icon="moRong.has(k.id) ? 'mdi-chevron-down' : 'mdi-chevron-right'"
                    variant="text"
                    size="x-small"
                    density="comfortable"
                    class="nk-mo-nut"
                    :aria-expanded="moRong.has(k.id)"
                    :aria-controls="`nk-ct-${k.id}`"
                    :aria-label="moRong.has(k.id) ? 'Ẩn chi tiết' : 'Xem chi tiết'"
                    @click.stop="doiMoRong(k.id)"
                  />
                  <span class="nk-gio" :title="dinhDangGioVN(k.luc, { coNam: true })">{{ dinhDangGioVN(k.luc) }}</span>
                </div>
              </td>
              <td class="nk-c-su-kien">
                <div class="nk-su-kien" :title="kieuMucDo(k.mucDo).nhan">
                  <v-icon
                    size="16"
                    :color="kieuMucDo(k.mucDo).mau"
                    :icon="kieuMucDo(k.mucDo).bieuTuong"
                    aria-hidden="true"
                  />
                  <span class="nk-an">{{ kieuMucDo(k.mucDo).nhan }}: </span>
                  <span class="nk-su-kien-chu">{{ nhanCua(k.loai) }}</span>
                </div>
              </td>
              <td class="nk-c-may">{{ k.mayInTen || '—' }}</td>
              <td class="nk-c-hd">
                <div v-if="k.soHoaDon" class="nk-hd">{{ k.soHoaDon }}</div>
                <div v-if="k.tenKhach" class="nk-khach">{{ k.tenKhach }}</div>
                <span v-if="!k.soHoaDon && !k.tenKhach" class="nk-gach">—</span>
              </td>
              <td><div class="nk-noi-dung">{{ k.noiDung }}</div></td>
            </tr>
            <tr v-if="moRong.has(k.id)" :id="`nk-ct-${k.id}`" class="nk-ct-dong">
              <td colspan="5">
                <div class="nk-ct">
                  <dl class="nk-ct-meta">
                    <div><dt>Lúc</dt><dd>{{ dinhDangGioVN(k.luc, { coNam: true }) }}</dd></div>
                    <div><dt>Mã sự kiện</dt><dd><code>{{ k.loai }}</code></dd></div>
                    <div v-if="k.printJobId"><dt>Lệnh in</dt><dd><code>{{ k.printJobId }}</code></dd></div>
                  </dl>
                  <p v-if="k.noiDung" class="nk-ct-noi-dung">{{ k.noiDung }}</p>
                  <pre v-if="chiTietDep(k.chiTiet)" class="nk-ct-json">{{ chiTietDep(k.chiTiet) }}</pre>
                  <p v-else class="nk-muted">Không có chi tiết thêm.</p>
                </div>
              </td>
            </tr>
          </template>
          <tr v-if="dangTai && items.length === 0">
            <td colspan="5" class="nk-rong">
              <v-progress-circular indeterminate size="18" width="2" color="primary" class="mr-2" />
              Đang tải nhật ký…
            </td>
          </tr>
          <tr v-else-if="daTai && items.length === 0 && !loi">
            <td colspan="5" class="nk-rong">
              <div class="nk-rong-ico" aria-hidden="true"><v-icon size="22" icon="mdi-text-box-search-outline" /></div>
              <div class="nk-rong-chu">Không có sự kiện nào khớp bộ lọc trong {{ tenKhoang }}.</div>
              <div v-if="mucDo === 'loi_canh_bao'" class="nk-rong-phu">
                Chọn "Tất cả" để xem cả sự kiện thông tin (đã in, đã gửi…).
              </div>
            </td>
          </tr>
        </tbody>
      </v-table>

      <div v-if="tiepTheo" class="nk-them">
        <v-btn variant="tonal" size="small" :loading="dangTaiThem" :disabled="dangTai" @click="taiThem">Tải thêm</v-btn>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import {
  layNhatKy, maHttpCuaLoi, laYeuCauDaHuy,
  type MayIn, type NhatKy, type LocMucDo, type ThamSoNhatKy,
} from '@/api/print-agents';
import { kieuMucDo, nhanCua } from './may-in-nhan';
import {
  LUA_CHON_KHOANG, khoangThoiGian, chuanHoaTuKhoa, gopTrangMoi, noiTrangSau,
  dinhDangGioVN, chiTietDep, type KhoangNhatKy,
} from './may-in-nhat-ky';

const props = defineProps<{ mayIns: MayIn[] }>();
const emit = defineEmits<{
  /** Mỗi nhịp tự làm mới — trang cha tải lại danh sách máy in (chip tình trạng) cho khớp. */
  lamMoi: [];
}>();

const GIOI_HAN = 50;
const NHIP_TU_LAM_MOI_MS = 15_000;
const TRE_TIM_MS = 300;
const TAT_CA = '__tat_ca__';

type LuaChonMucDo = LocMucDo | 'tat_ca';
const LUA_CHON_MUC_DO: ReadonlyArray<{ value: LuaChonMucDo; title: string }> = [
  { value: 'loi_canh_bao', title: 'Lỗi & cảnh báo' },
  { value: 'loi', title: 'Lỗi' },
  { value: 'canh_bao', title: 'Cảnh báo' },
  { value: 'thong_tin', title: 'Thông tin' },
  { value: 'tat_ca', title: 'Tất cả' },
];
// v-select nhận mảng thường, không nhận ReadonlyArray.
const KHOANG_DS = [...LUA_CHON_KHOANG];

// ── Bộ lọc ────────────────────────────────────────────────────────────────
const oTim = ref<string | null>('');       // chữ đang gõ (clearable đặt về null)
const tuKhoa = ref('');                     // đã chuẩn hoá, sau 300 ms
const mayInId = ref<string>(TAT_CA);
const mucDo = ref<LuaChonMucDo>('loi_canh_bao');
const khoang = ref<KhoangNhatKy>('7_ngay');
// Bật sẵn (25/09): trang Máy in là nơi người trực mở ra xem máy nào đang hết
// giấy — chip tình trạng + dòng nhật ký phải tự mới, không bắt nhớ bật công tắc.
const tuLamMoi = ref(true);

const luaChonMayIn = computed(() => [
  { title: 'Tất cả máy in', value: TAT_CA },
  ...props.mayIns.map((m) => ({ title: m.ten, value: m.id })),
]);
const tenKhoang = computed(() => {
  const o = LUA_CHON_KHOANG.find((x) => x.value === khoang.value);
  return o?.value === 'hom_nay' ? 'hôm nay' : (o?.title ?? '');
});

// ── Dữ liệu ───────────────────────────────────────────────────────────────
const items = ref<NhatKy[]>([]);
const tiepTheo = ref<string | null>(null);
const dangTai = ref(false);      // tải trang đầu theo bộ lọc (thay danh sách)
const dangTaiThem = ref(false);
const daTai = ref(false);        // đã có ít nhất một lần tải xong (phân biệt "rỗng" với "chưa tải")
const loi = ref('');
const biCam = ref(false);        // 403 → ẩn cả mục
const lucCapNhat = ref<number | null>(null);
const moRong = ref(new Set<string>());

const dongTrangThai = computed(() => {
  if (dangTai.value && items.value.length === 0) return 'Đang tải…';
  if (!daTai.value) return '';
  const dem = `${items.value.length}${tiepTheo.value ? '+' : ''} sự kiện`;
  return lucCapNhat.value ? `${dem} · cập nhật ${dinhDangGioVN(lucCapNhat.value).slice(6)}` : dem;
});

let boHuy: AbortController | null = null;
let theHe = 0;
let dangLamMoi = false;
/** (tu, den) của danh sách đang hiện — "Tải thêm" và gộp tự làm mới phải dùng đúng khoảng này. */
let khoangDangDung: { tu: string; den: string } | null = null;

function thamSo(k: { tu: string; den: string }, truoc?: string): ThamSoNhatKy {
  return {
    q: tuKhoa.value || undefined,
    mayInId: mayInId.value === TAT_CA ? undefined : mayInId.value,
    mucDo: mucDo.value === 'tat_ca' ? undefined : mucDo.value,
    tu: k.tu,
    den: k.den,
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
    // Không phải admin (hoặc JWT còn vai cũ): ẩn mục, dừng tự làm mới. Không toast, không đỏ.
    biCam.value = true;
    tuLamMoi.value = false;
    return;
  }
  if (ma === 404) {
    loi.value = 'Máy chủ chưa có nhật ký máy in (backend cần cập nhật).';
    return;
  }
  if (ma === 503) {
    loi.value = 'Máy chủ chưa tạo bảng nhật ký máy in (cần chạy migration print_logs).';
    return;
  }
  // Mã nghiệp vụ kiểu "CHI_ADMIN" thì hiện; chữ tiếng Anh của Fastify ("Internal Server Error") thì thôi.
  const maLoi = (e as { response?: { data?: { error?: unknown } } })?.response?.data?.error;
  const maDoc = typeof maLoi === 'string' && /^[A-Z][A-Z0-9_]+$/.test(maLoi) ? maLoi : `mã ${ma}`;
  loi.value = ma ? `${viec} (${maDoc}).` : `${viec} — không kết nối được máy chủ.`;
}

/**
 * Tải lại từ đầu theo bộ lọc. `ngam`: gọi từ nhịp tự làm mới (lần tải đầu hỏng
 * → nhịp nào cũng rơi vào đây) — lỗi 5xx chỉ báo trong mục, không toast chung.
 * (Nút "Tải lại" truyền MouseEvent vào đây — không có `ngam` nên vẫn toast.)
 */
async function taiLai(tuy: { ngam?: boolean } = {}): Promise<void> {
  const { signal, the } = batDauYeuCau();
  const k = khoangThoiGian(khoang.value);
  dangTai.value = true;
  loi.value = '';
  try {
    const trang = await layNhatKy(thamSo(k), { signal, ngam: tuy.ngam === true });
    if (the !== theHe) return;
    items.value = trang.items;
    tiepTheo.value = trang.tiepTheo;
    khoangDangDung = k;
    moRong.value = new Set();
    lucCapNhat.value = Date.now();
  } catch (e) {
    if (the !== theHe || laYeuCauDaHuy(e)) return;
    // Bộ lọc đã đổi mà tải hỏng: đừng để danh sách của bộ lọc CŨ nằm dưới như thể là kết quả.
    items.value = [];
    tiepTheo.value = null;
    khoangDangDung = null;
    xuLyLoi(e, 'Không tải được nhật ký máy in');
  } finally {
    if (the === theHe) {
      dangTai.value = false;
      daTai.value = true;
    }
  }
}

async function taiThem(): Promise<void> {
  const truoc = tiepTheo.value;
  const k = khoangDangDung;
  if (!truoc || !k || dangTai.value || dangTaiThem.value) return;
  const { signal, the } = batDauYeuCau(); // huỷ lượt tự làm mới đang bay (nếu có) — nhịp sau làm lại
  dangTaiThem.value = true;
  try {
    const trang = await layNhatKy(thamSo(k, truoc), { signal });
    if (the !== theHe) return;
    items.value = noiTrangSau(items.value, trang.items);
    tiepTheo.value = trang.tiepTheo;
    loi.value = '';
  } catch (e) {
    if (the !== theHe || laYeuCauDaHuy(e)) return;
    xuLyLoi(e, 'Không tải thêm được nhật ký');
  } finally {
    if (the === theHe) dangTaiThem.value = false;
  }
}

/** Nhịp tự làm mới: lấy trang đầu, gộp dòng mới lên trên, không nháy bảng. */
async function lamMoiNgam(): Promise<void> {
  if (dangTai.value || dangTaiThem.value || dangLamMoi) return;
  const k = khoangThoiGian(khoang.value);
  // Sang ngày mới (đổi khoảng) hoặc chưa có danh sách hợp lệ → tải lại từ đầu.
  if (!khoangDangDung || k.tu !== khoangDangDung.tu || k.den !== khoangDangDung.den) {
    await taiLai({ ngam: true });
    return;
  }
  const { signal, the } = batDauYeuCau();
  dangLamMoi = true;
  try {
    const trang = await layNhatKy(thamSo(k), { signal, ngam: true });
    if (the !== theHe) return;
    const { ds, datLai } = gopTrangMoi(items.value, trang.items);
    items.value = ds;
    if (datLai) {
      tiepTheo.value = trang.tiepTheo;
      const conLai = new Set(ds.map((d) => d.id));
      moRong.value = new Set([...moRong.value].filter((id) => conLai.has(id)));
    }
    loi.value = '';
    lucCapNhat.value = Date.now();
  } catch (e) {
    if (the !== theHe || laYeuCauDaHuy(e)) return;
    // Giữ danh sách đang xem; chỉ báo — nhịp sau tự thử lại.
    xuLyLoi(e, 'Không làm mới được nhật ký — sẽ thử lại');
  } finally {
    if (the === theHe) dangLamMoi = false;
  }
}

/** Bấm chuột vào dòng: mở/đóng chi tiết — trừ khi người dùng đang bôi đen chữ để chép. */
function bamDong(id: string): void {
  if (window.getSelection?.()?.toString()) return;
  doiMoRong(id);
}

function doiMoRong(id: string): void {
  const s = new Set(moRong.value);
  if (s.has(id)) s.delete(id);
  else s.add(id);
  moRong.value = s;
}

// ── Ô tìm: trễ 300 ms ────────────────────────────────────────────────────
let henGioTim: ReturnType<typeof setTimeout> | null = null;

function huyHenGioTim(): void {
  if (henGioTim) {
    clearTimeout(henGioTim);
    henGioTim = null;
  }
}

function apDungTuKhoaNgay(): void {
  huyHenGioTim();
  tuKhoa.value = chuanHoaTuKhoa(oTim.value); // trùng giá trị cũ thì watch không chạy — không gọi thừa
}

watch(oTim, () => {
  huyHenGioTim();
  henGioTim = setTimeout(apDungTuKhoaNgay, TRE_TIM_MS);
});

watch([tuKhoa, mayInId, mucDo, khoang], () => {
  void taiLai();
});

// Máy đang lọc bị xoá khỏi danh sách → về "Tất cả máy in" (select không hiện id trần).
watch(
  () => props.mayIns,
  (ds) => {
    if (mayInId.value !== TAT_CA && !ds.some((m) => m.id === mayInId.value)) mayInId.value = TAT_CA;
  },
);

// ── Tự làm mới 15 giây ───────────────────────────────────────────────────
let henGioLamMoi: ReturnType<typeof setInterval> | null = null;

function dungTuLamMoi(): void {
  if (henGioLamMoi) {
    clearInterval(henGioLamMoi);
    henGioLamMoi = null;
  }
}

function nhipLamMoi(): void {
  if (biCam.value || document.hidden) return; // tab ẩn: không gọi API vô ích
  emit('lamMoi');
  void lamMoiNgam();
}

function batHenGioLamMoi(): void {
  dungTuLamMoi();
  if (tuLamMoi.value && !biCam.value) henGioLamMoi = setInterval(nhipLamMoi, NHIP_TU_LAM_MOI_MS);
}

watch(tuLamMoi, (bat) => {
  batHenGioLamMoi();
  if (bat && !biCam.value) nhipLamMoi(); // bật lên là làm mới ngay, không bắt chờ 15 giây
});

onMounted(() => {
  void taiLai();
  batHenGioLamMoi(); // bật sẵn — lần tải đầu là taiLai() ở trên, nhịp đầu sau 15 giây
});

onBeforeUnmount(() => {
  dungTuLamMoi();
  huyHenGioTim();
  theHe++; // mọi phản hồi còn bay sau khi rời trang đều bị bỏ
  boHuy?.abort();
  boHuy = null;
});
</script>

<style scoped>
/* Cùng bộ token Atlas với trang cha (PrintAgentsPage bọc .airtable-scope + nạp airtable.css);
   giá trị dự phòng để mục vẫn đúng màu nếu gắn ở chỗ khác. */
.nk { margin-bottom: 24px; }
.nk-head {
  display: flex; align-items: flex-end; justify-content: space-between; gap: 8px 16px;
  flex-wrap: wrap; margin-bottom: 12px;
}
.nk-head-trai { min-width: 0; }
.nk-h2 { font-size: 14px; font-weight: 700; color: var(--at-ink, #141a24); margin: 0; }
.nk-phu { font-size: 12px; color: var(--at-muted, #6b7488); margin: 2px 0 0; }
.nk-head-phai { display: flex; align-items: center; gap: 4px 12px; flex-wrap: wrap; }
.nk-dem { font-size: 12px; color: var(--at-muted, #6b7488); font-variant-numeric: tabular-nums; }
.nk-tu-lam-moi { display: flex; align-items: center; gap: 6px; }
.nk-switch { flex: none; }
.nk-switch :deep(.v-label) { font-size: 12.5px; color: var(--at-body, #475066); opacity: 1; }

.nk-card {
  background: var(--at-canvas, #fff); border: 1px solid var(--at-hairline, #e7eaf0); border-radius: 12px;
  box-shadow: var(--at-shadow-card, 0 1px 2px rgba(20, 26, 36, 0.05)); overflow: hidden;
}

/* Thanh lọc */
.nk-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 12px 14px 8px; }
.nk-tim { flex: 1 1 300px; min-width: 220px; }
.nk-may { flex: 0 1 220px; min-width: 170px; }
.nk-khoang { flex: 0 0 150px; }
.nk-toolbar :deep(.v-field) { border-radius: 8px; font-size: 13px; }
.nk-toolbar :deep(.v-field__input) { font-size: 13px; }

.nk-muc-loc {
  display: flex; flex-wrap: wrap; gap: 6px; padding: 0 14px 12px;
  border-bottom: 1px solid var(--at-hairline, #e7eaf0);
}
.nk-pill {
  display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 11px;
  border-radius: 9999px; border: 1px solid var(--at-hairline, #e7eaf0); background: var(--at-canvas, #fff);
  font: inherit; font-size: 12.5px; font-weight: 500; color: var(--at-body, #475066); cursor: pointer;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}
.nk-pill:hover { background: var(--at-surface-soft, #f1f4f9); }
.nk-pill:focus-visible { outline: 2px solid var(--at-action, #1786be); outline-offset: 2px; }
.nk-pill--chon, .nk-pill--chon:hover {
  background: var(--at-action-soft, #e4f1f8); border-color: #93c5fd; color: var(--at-action, #1786be); font-weight: 600;
}
.nk-pill-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.nk-pill-dot--loi_canh_bao { background: linear-gradient(135deg, var(--at-atlas-danger, #f04438) 50%, var(--at-atlas-warning, #f5a524) 50%); }
.nk-pill-dot--loi { background: var(--at-atlas-danger, #f04438); }
.nk-pill-dot--canh_bao { background: var(--at-atlas-warning, #f5a524); }
.nk-pill-dot--thong_tin { background: var(--at-action, #1786be); }

.nk-loi { margin: 12px 14px 0; }

/* Bảng */
.nk-bang :deep(table) { table-layout: auto; }
.nk-bang :deep(th) {
  white-space: nowrap; height: 36px !important;
  font-size: 11px !important; font-weight: 600 !important; letter-spacing: 0.4px; text-transform: uppercase;
  color: var(--at-muted, #6b7488) !important; background: #fafbfd;
}
.nk-bang :deep(td) {
  font-size: 13px; color: var(--at-body, #475066); vertical-align: top;
  padding-top: 9px !important; padding-bottom: 9px !important; height: auto !important;
  border-bottom-color: var(--at-hairline, #e7eaf0) !important;
}
.nk-mo { opacity: 0.55; transition: opacity 0.15s; }
.nk-dong { cursor: pointer; }
.nk-dong:hover td, .nk-dong--mo td { background: #f7f9fc; }
/* Vạch màu mức độ ở mép trái dòng */
.nk-dong > td:first-child { box-shadow: inset 3px 0 0 transparent; }
.nk-dong--loi > td:first-child { box-shadow: inset 3px 0 0 var(--at-atlas-danger, #f04438); }
.nk-dong--canh_bao > td:first-child { box-shadow: inset 3px 0 0 var(--at-atlas-warning, #f5a524); }

.nk-c-luc { white-space: nowrap; width: 1%; }
.nk-luc { display: flex; align-items: center; gap: 2px; margin-left: -6px; }
.nk-mo-nut { color: var(--at-hint, #97a0b3) !important; }
.nk-gio { font-variant-numeric: tabular-nums; color: var(--at-ink, #141a24); font-size: 12.5px; }
.nk-c-su-kien { min-width: 150px; }
.nk-su-kien { display: flex; align-items: flex-start; gap: 6px; }
.nk-su-kien :deep(.v-icon) { margin-top: 1px; flex: none; }
.nk-su-kien-chu { font-weight: 600; color: var(--at-ink, #141a24); }
.nk-c-may { white-space: nowrap; }
.nk-c-hd { min-width: 150px; }
.nk-hd {
  font-family: var(--mono, 'Roboto Mono', ui-monospace, monospace); font-size: 12px;
  color: var(--at-ink, #141a24); white-space: nowrap;
}
.nk-khach { font-size: 12px; color: var(--at-muted, #6b7488); margin-top: 1px; }
.nk-gach { color: var(--at-hint, #97a0b3); }
.nk-noi-dung {
  min-width: 220px; color: var(--at-body, #475066); line-height: 1.45;
  display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.nk-an {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden;
  clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}

/* Chi tiết khi mở dòng */
.nk-ct-dong td { background: #f7f9fc; }
.nk-ct { padding: 4px 4px 12px 30px; }
.nk-ct-meta { display: flex; flex-wrap: wrap; gap: 6px 22px; margin: 0 0 8px; }
.nk-ct-meta > div { display: flex; align-items: baseline; gap: 6px; }
.nk-ct-meta dt {
  font-size: 10.5px; font-weight: 600; letter-spacing: 0.4px; text-transform: uppercase;
  color: var(--at-hint, #97a0b3);
}
.nk-ct-meta dd { margin: 0; font-size: 12.5px; color: var(--at-body, #475066); }
.nk-ct-meta code {
  font-family: var(--mono, 'Roboto Mono', ui-monospace, monospace); font-size: 11.5px;
  background: #fff; border: 1px solid var(--at-hairline, #e7eaf0); padding: 1px 5px; border-radius: 4px;
}
.nk-ct-noi-dung { font-size: 13px; color: var(--at-ink, #141a24); margin: 0 0 8px; white-space: pre-wrap; }
.nk-ct-json {
  font-family: var(--mono, 'Roboto Mono', ui-monospace, monospace);
  font-size: 12px; line-height: 1.5; background: #fff; color: #334155;
  border: 1px solid var(--at-hairline, #e7eaf0); border-radius: 8px;
  padding: 10px 12px; margin: 0; max-height: 320px; overflow: auto; white-space: pre-wrap; word-break: break-word;
}
.nk-muted { color: var(--at-hint, #97a0b3); font-size: 12.5px; margin: 0; }

/* Trống / đang tải */
.nk-rong { text-align: center; color: var(--at-muted, #6b7488); padding: 32px 16px !important; }
.nk-rong-ico {
  width: 40px; height: 40px; border-radius: 10px; margin: 0 auto 10px;
  display: flex; align-items: center; justify-content: center;
  background: var(--at-surface-soft, #f1f4f9); color: var(--at-muted, #6b7488);
}
.nk-rong-chu { font-size: 13px; font-weight: 600; color: var(--at-ink, #141a24); }
.nk-rong-phu { font-size: 12.5px; margin-top: 4px; }

.nk-them { display: flex; justify-content: center; padding: 12px 0; border-top: 1px solid var(--at-hairline, #e7eaf0); }
</style>
