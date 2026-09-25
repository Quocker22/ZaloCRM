<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  PrintAgentLogPanel — mục "Nhật ký máy in" dưới bảng máy in (hợp đồng nhật ký máy in v2,
  24/09/2026, §3.5 + §5). CHỈ owner/admin: trang cha chỉ gắn khi user là admin; API vẫn trả
  403 (vd JWT còn vai cũ) thì mục TỰ ẨN, không hiện lỗi đỏ, không toast (boQuaToast403).

  Chống chồng request: mỗi lần gọi huỷ yêu cầu trước (AbortController) và mang số "thế hệ";
  phản hồi của thế hệ cũ bị bỏ — đổi bộ lọc nhanh không bao giờ để trang cũ đè trang mới.
  Tự làm mới 15 giây: chỉ lấy trang ĐẦU rồi gộp dòng mới lên trên (giữ các trang đã "Tải
  thêm"); bỏ lượt khi tab ẩn hoặc đang có yêu cầu khác; dọn interval khi rời trang.
-->
<template>
  <section v-if="!biCam" class="nk-card" aria-labelledby="nk-tieu-de">
    <header class="nk-head">
      <div>
        <h2 id="nk-tieu-de">Nhật ký máy in</h2>
        <p>
          Mọi sự kiện in của các máy: nhận lệnh, gửi máy in, đã in, lỗi, hết giấy, kẹt giấy…
          Lưu 90 ngày.
        </p>
      </div>
      <v-spacer />
      <v-switch
        v-model="tuLamMoi"
        label="Tự làm mới 15 giây"
        color="primary"
        density="compact"
        hide-details
        inset
        class="nk-switch"
      />
      <v-btn
        icon="mdi-refresh"
        variant="text"
        size="small"
        aria-label="Tải lại nhật ký"
        title="Tải lại nhật ký"
        :loading="dangTai"
        @click="taiLai"
      />
    </header>

    <div class="nk-toolbar">
      <v-text-field
        v-model="oTim"
        class="nk-tim"
        label="Tìm trong nhật ký"
        placeholder="Tìm số hoá đơn, tên khách, lỗi… (không cần dấu)"
        prepend-inner-icon="mdi-magnify"
        variant="outlined"
        density="compact"
        hide-details
        clearable
        persistent-placeholder
        @keydown.enter="apDungTuKhoaNgay"
      />
      <v-select
        v-model="mayInId"
        class="nk-may"
        :items="luaChonMayIn"
        label="Máy in"
        variant="outlined"
        density="compact"
        hide-details
      />
    </div>

    <div class="nk-toolbar">
      <v-btn-toggle
        v-model="mucDo"
        mandatory
        divided
        density="compact"
        variant="outlined"
        color="primary"
        role="group"
        aria-label="Lọc theo mức độ"
      >
        <v-btn
          v-for="o in LUA_CHON_MUC_DO"
          :key="o.value"
          :value="o.value"
          size="small"
          :aria-pressed="mucDo === o.value"
        >{{ o.title }}</v-btn>
      </v-btn-toggle>
      <v-btn-toggle
        v-model="khoang"
        mandatory
        divided
        density="compact"
        variant="outlined"
        color="primary"
        role="group"
        aria-label="Khoảng thời gian"
      >
        <v-btn
          v-for="o in LUA_CHON_KHOANG"
          :key="o.value"
          :value="o.value"
          size="small"
          :aria-pressed="khoang === o.value"
        >{{ o.title }}</v-btn>
      </v-btn-toggle>
      <v-spacer />
      <span class="nk-dem" aria-live="polite">{{ dongTrangThai }}</span>
    </div>

    <v-alert
      v-if="loi"
      type="error"
      variant="tonal"
      density="compact"
      class="mb-3"
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

    <v-table density="compact" class="nk-bang" :aria-busy="dangTai">
      <thead>
        <tr>
          <th class="nk-c-luc">Thời gian (giờ VN)</th>
          <th>Máy in</th>
          <th>Mức</th>
          <th>Sự kiện</th>
          <th>Hoá đơn</th>
          <th>Khách</th>
          <th>Nội dung</th>
        </tr>
      </thead>
      <tbody :class="{ 'nk-mo': dangTai && items.length > 0 }">
        <template v-for="k in items" :key="k.id">
          <tr class="nk-dong" :class="{ 'nk-dong--mo': moRong.has(k.id) }" @click="bamDong(k.id)">
            <td class="nk-c-luc">
              <v-btn
                :icon="moRong.has(k.id) ? 'mdi-chevron-down' : 'mdi-chevron-right'"
                variant="text"
                size="x-small"
                density="comfortable"
                :aria-expanded="moRong.has(k.id)"
                :aria-controls="`nk-ct-${k.id}`"
                :aria-label="moRong.has(k.id) ? 'Ẩn chi tiết' : 'Xem chi tiết'"
                @click.stop="doiMoRong(k.id)"
              />
              <span :title="dinhDangGioVN(k.luc, { coNam: true })">{{ dinhDangGioVN(k.luc) }}</span>
            </td>
            <td>{{ k.mayInTen || '—' }}</td>
            <td>
              <v-chip
                size="small"
                variant="tonal"
                :color="kieuMucDo(k.mucDo).mau"
                :prepend-icon="kieuMucDo(k.mucDo).bieuTuong"
              >{{ kieuMucDo(k.mucDo).nhan }}</v-chip>
            </td>
            <td class="nk-su-kien">{{ nhanCua(k.loai) }}</td>
            <td class="nk-nowrap">{{ k.soHoaDon || '—' }}</td>
            <td>{{ k.tenKhach || '—' }}</td>
            <td class="nk-noi-dung">{{ k.noiDung }}</td>
          </tr>
          <tr v-if="moRong.has(k.id)" :id="`nk-ct-${k.id}`" class="nk-ct-dong">
            <td colspan="7">
              <div class="nk-ct">
                <div class="nk-ct-meta">
                  <span><b>Lúc:</b> {{ dinhDangGioVN(k.luc, { coNam: true }) }}</span>
                  <span><b>Mã sự kiện:</b> <code>{{ k.loai }}</code></span>
                  <span v-if="k.printJobId"><b>Lệnh in:</b> <code>{{ k.printJobId }}</code></span>
                </div>
                <p v-if="k.noiDung" class="nk-ct-noi-dung">{{ k.noiDung }}</p>
                <pre v-if="chiTietDep(k.chiTiet)" class="nk-ct-json">{{ chiTietDep(k.chiTiet) }}</pre>
                <p v-else class="nk-muted">Không có chi tiết thêm.</p>
              </div>
            </td>
          </tr>
        </template>
        <tr v-if="dangTai && items.length === 0">
          <td colspan="7" class="nk-rong">Đang tải nhật ký…</td>
        </tr>
        <tr v-else-if="daTai && items.length === 0 && !loi">
          <td colspan="7" class="nk-rong">
            Không có sự kiện nào khớp bộ lọc trong {{ tenKhoang }}.
            <template v-if="mucDo === 'loi_canh_bao'">Chọn "Tất cả" để xem cả sự kiện thông tin (đã in, đã gửi…).</template>
          </td>
        </tr>
      </tbody>
    </v-table>

    <div v-if="tiepTheo" class="nk-them">
      <v-btn variant="tonal" :loading="dangTaiThem" :disabled="dangTai" @click="taiThem">Tải thêm</v-btn>
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
.nk-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 14px 14px 10px; margin-bottom: 16px; }
.nk-head { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
.nk-head h2 { font-size: 16px; font-weight: 700; margin: 0 0 2px; }
.nk-head p { color: #555; font-size: 13px; line-height: 1.5; margin: 0; }
.nk-switch { flex: none; }
.nk-toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
.nk-tim { flex: 1 1 320px; min-width: 240px; }
.nk-may { flex: 0 1 240px; min-width: 180px; }
.nk-dem { font-size: 12px; color: #6b7280; }
.nk-bang :deep(th) { white-space: nowrap; font-size: 12px; font-weight: 600; color: #6b7280; }
.nk-bang :deep(td) { font-size: 13px; vertical-align: top; padding-top: 6px !important; padding-bottom: 6px !important; }
.nk-mo { opacity: 0.55; transition: opacity 0.15s; }
.nk-dong { cursor: pointer; }
.nk-dong:hover td, .nk-dong--mo td { background: #f8fafc; }
.nk-c-luc { white-space: nowrap; }
.nk-nowrap { white-space: nowrap; }
.nk-su-kien { min-width: 140px; }
.nk-noi-dung {
  min-width: 220px; color: #374151;
  display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.nk-ct-dong td { background: #f8fafc; }
.nk-ct { padding: 6px 4px 10px 36px; }
.nk-ct-meta { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 12.5px; color: #4b5563; margin-bottom: 6px; }
.nk-ct-meta code { font-size: 12px; background: #eef2f7; padding: 1px 5px; border-radius: 4px; }
.nk-ct-noi-dung { font-size: 13px; margin: 0 0 6px; white-space: pre-wrap; }
.nk-ct-json {
  font-size: 12px; line-height: 1.45; background: #0f172a; color: #e2e8f0; border-radius: 8px;
  padding: 10px 12px; margin: 0; max-height: 320px; overflow: auto; white-space: pre-wrap; word-break: break-word;
}
.nk-rong { text-align: center; color: #999; padding: 20px 0 !important; }
.nk-muted { color: #999; font-size: 12.5px; margin: 0; }
.nk-them { display: flex; justify-content: center; padding: 10px 0 4px; }
</style>
