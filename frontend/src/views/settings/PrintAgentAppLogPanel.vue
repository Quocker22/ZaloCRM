<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  PrintAgentAppLogPanel — thẻ "Log app" trong mục Nhật ký máy in (25/09). App Windows ở chi
  nhánh gửi TOÀN BỘ dòng nó ghi vào file .txt cục bộ (backend may-in/nhat-ky-app.ts, bảng
  print_app_logs, lưu 30 ngày) — xem ở đây thay vì nhờ người ở shop gửi file.

  Khác thẻ "Nhật ký in" (PrintAgentLogPanel): log THÔ, nhiều dòng, không có mức → danh sách
  chữ đơn cách dày (giờ VN tới mili-giây · máy · sự kiện · nội dung xuống dòng tự do).

  Chống chồng request như thẻ kia: huỷ yêu cầu trước (AbortController) + số "thế hệ".
  Tự làm mới 5 giây bằng con trỏ `sau` (chỉ lấy dòng mới, gộp theo giờ — conTroDuoi lùi
  2 phút để dòng máy khác gửi trễ vẫn vào); nghỉ khi tab trình duyệt ẩn hoặc thẻ không được
  chọn (`hoatDong`); danh sách giữ tối đa ~5000 dòng. 403 → câu báo quyền, không đỏ.

  Mức độ (25/09, hợp đồng hàng đợi/huỷ v5 §5 + §6.1): máy chủ phân loại từng dòng (`mucDo`:
  lỗi / cảnh báo / thông tin — vd hết giấy là lỗi). Hàng viên mức độ giống thẻ "Nhật ký in"
  (Lỗi & cảnh báo · Lỗi · Cảnh báo · Thông tin · Tất cả; mặc định Tất cả), đặt SAU hàng viên
  sự kiện (giữ nguyên); mỗi dòng có vạch màu mép trái theo mức.
-->
<template>
  <div class="nka-card" :aria-busy="dangTai">
    <div v-if="biCam" class="nka-cam" role="status">
      <div class="nka-rong-ico" aria-hidden="true"><v-icon size="22" icon="mdi-lock-outline" /></div>
      <div class="nka-rong-chu">Chỉ chủ sở hữu hoặc quản trị viên xem được nhật ký app máy in.</div>
      <div class="nka-rong-phu">Nhờ quản trị viên cấp quyền, hoặc đăng nhập lại nếu vừa được đổi vai trò.</div>
    </div>

    <template v-else>
      <div class="nka-toolbar">
        <v-text-field
          v-model="oTim"
          class="nka-tim"
          placeholder="Tìm trong log app: job, lỗi, tên file… (không cần dấu)"
          prepend-inner-icon="mdi-magnify"
          variant="outlined"
          density="compact"
          hide-details
          clearable
          aria-label="Tìm trong nhật ký app"
          @keydown.enter="apDungTuKhoaNgay"
        />
        <v-select
          v-model="mayInId"
          class="nka-may-chon"
          :items="luaChonMayIn"
          prepend-inner-icon="mdi-printer-outline"
          variant="outlined"
          density="compact"
          hide-details
          aria-label="Máy in"
        />
        <v-select
          v-model="khoang"
          class="nka-khoang"
          :items="KHOANG_DS"
          prepend-inner-icon="mdi-calendar-range"
          variant="outlined"
          density="compact"
          hide-details
          aria-label="Khoảng thời gian"
        />
      </div>

      <div class="nka-hang2">
        <div class="nka-loc" role="radiogroup" aria-label="Lọc theo sự kiện">
          <button
            v-for="o in NHOM_SU_KIEN_APP"
            :key="o.value"
            type="button"
            role="radio"
            class="nka-pill"
            :class="{ 'nka-pill--chon': nhom === o.value }"
            :aria-checked="nhom === o.value"
            :title="o.ma.length ? o.ma.join(' · ') : 'Mọi sự kiện'"
            @click="nhom = o.value"
          >
            <span v-if="o.ma.length" class="nka-pill-dot" :class="`nka-tong--${kieuSuKienApp(o.ma[0]).tong}`" aria-hidden="true" />
            {{ o.title }}
          </button>
        </div>
        <div class="nka-dieu-khien">
          <span class="nka-dem" aria-live="polite">{{ dongTrangThai }}</span>
          <div class="nka-tu-lam-moi" title="Tự tải dòng mới mỗi 5 giây">
            <v-switch
              v-model="tuLamMoi"
              label="Tự làm mới"
              color="primary"
              density="compact"
              hide-details
              class="nka-switch"
            />
          </div>
          <v-btn
            variant="outlined"
            size="small"
            prepend-icon="mdi-download"
            :loading="dangTaiXuong"
            title="Tải toàn bộ dòng khớp bộ lọc về máy (cũ nhất trước, tối đa 200.000 dòng)"
            @click="taiXuong"
          >Tải xuống .txt</v-btn>
          <v-btn
            icon="mdi-refresh"
            variant="text"
            size="small"
            density="comfortable"
            aria-label="Tải lại nhật ký app"
            title="Tải lại nhật ký app"
            :loading="dangTai"
            @click="taiLai"
          />
        </div>
      </div>

      <div class="nka-muc-loc" role="radiogroup" aria-label="Lọc theo mức độ">
        <span class="nka-nhan-loc" aria-hidden="true">Mức</span>
        <button
          v-for="o in LUA_CHON_MUC_DO_APP"
          :key="o.value"
          type="button"
          role="radio"
          class="nka-pill"
          :class="{ 'nka-pill--chon': mucDo === o.value }"
          :aria-checked="mucDo === o.value"
          :data-muc-do="o.value"
          @click="mucDo = o.value"
        >
          <span v-if="o.value !== 'tat_ca'" class="nka-muc-dot" :class="`nka-muc-dot--${o.value}`" aria-hidden="true" />
          {{ o.title }}
        </button>
      </div>

      <v-alert v-if="loi" type="error" variant="tonal" density="compact" class="nka-loi">
        {{ loi }}
        <template #append>
          <v-btn size="small" variant="text" @click="taiLai">Thử lại</v-btn>
        </template>
      </v-alert>
      <v-alert v-if="loiTaiXuong" type="warning" variant="tonal" density="compact" class="nka-loi">
        {{ loiTaiXuong }}
      </v-alert>

      <v-progress-linear
        :active="dangTai && items.length > 0"
        indeterminate
        color="primary"
        height="2"
        aria-hidden="true"
      />

      <div class="nka-ds" :class="{ 'nka-mo': dangTai && items.length > 0 }" role="log" aria-label="Nhật ký app máy in">
        <div
          v-for="k in items"
          :key="k.id"
          class="nka-dong"
          :class="[`nka-dong--${kieuSuKienApp(k.suKien).tong}`, `nka-dong--muc-${mucDoDong(k)}`]"
          :data-muc-do="mucDoDong(k)"
        >
          <span class="nka-gio" :title="dinhDangGioVN(k.luc, { coNam: true, coMs: true })">{{ dinhDangGioVN(k.luc, { coMs: true }) }}</span>
          <span class="nka-may" :title="k.phienBan ? `${k.mayInTen || ''} · app v${k.phienBan}` : (k.mayInTen || '')">{{ k.mayInTen || '—' }}</span>
          <span class="nka-su-kien" :class="`nka-tong--${kieuSuKienApp(k.suKien).tong}`" :title="kieuSuKienApp(k.suKien).nhan">{{ k.suKien }}</span>
          <span class="nka-noi-dung"><span v-if="mucDoDong(k) !== 'thong_tin'" class="nka-an">{{ kieuMucDo(mucDoDong(k)).nhan }}: </span>{{ k.noiDung }}</span>
        </div>

        <div v-if="dangTai && items.length === 0" class="nka-rong">
          <v-progress-circular indeterminate size="18" width="2" color="primary" class="mr-2" />
          Đang tải nhật ký app…
        </div>
        <div v-else-if="daTai && items.length === 0 && !loi" class="nka-rong">
          <div class="nka-rong-ico" aria-hidden="true"><v-icon size="22" icon="mdi-console" /></div>
          <div class="nka-rong-chu">Không có dòng log app nào khớp bộ lọc trong {{ tenKhoang }}.</div>
          <div v-if="mucDo !== 'tat_ca'" class="nka-rong-phu">Chọn mức "Tất cả" để xem cả dòng thông tin.</div>
          <div class="nka-rong-phu">Chỉ app Máy in bản mới (có gửi nhật ký lên máy chủ) mới có dòng ở đây.</div>
        </div>
      </div>

      <div v-if="tiepTheo" class="nka-them">
        <v-btn variant="tonal" size="small" :loading="dangTaiThem" :disabled="dangTai" @click="taiThem">Tải thêm</v-btn>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import {
  layNhatKyApp, taiVeNhatKyApp, maHttpCuaLoi, laYeuCauDaHuy,
  type MayIn, type NhatKyApp, type ThamSoNhatKyApp, type LocMucDo,
} from '@/api/print-agents';
import { kieuSuKienApp, kieuMucDo } from './may-in-nhan';
import { chuanHoaTuKhoa, dinhDangGioVN, noiTrangSau } from './may-in-nhat-ky';
import {
  LUA_CHON_KHOANG_APP, NHOM_SU_KIEN_APP, khoangNhatKyApp, suKienCuaNhom, gopDongMoi, conTroDuoi, conTroCua,
  type KhoangNhatKyApp,
} from './may-in-nhat-ky-app';

const props = withDefaults(defineProps<{
  mayIns: MayIn[];
  /** false khi thẻ "Log app" không được chọn — nghỉ tự làm mới, chọn lại thì làm mới ngay. */
  hoatDong?: boolean;
  /** Máy lọc sẵn lúc mở thẻ lần đầu (lấy theo bộ lọc của thẻ "Nhật ký in"). */
  mayInIdDau?: string | null;
}>(), { hoatDong: true, mayInIdDau: null });

const GIOI_HAN = 200;
/** Lượt tự làm mới lấy tối đa chừng này dòng mới; nhiều hơn thì tải lại từ đầu. */
const GIOI_HAN_DUOI = 500;
/** Danh sách giữ tối đa chừng này dòng (bỏ dòng cũ nhất khi tự làm mới). */
const TRAN_DS = 5000;
const NHIP_TU_LAM_MOI_MS = 5_000;
const TRE_TIM_MS = 300;
const TAT_CA = '__tat_ca__';
// v-select nhận mảng thường, không nhận ReadonlyArray.
const KHOANG_DS = [...LUA_CHON_KHOANG_APP];

type LuaChonMucDoApp = LocMucDo | 'tat_ca';
/** Cùng thứ tự + chữ với thẻ "Nhật ký in" (PrintAgentLogPanel). */
const LUA_CHON_MUC_DO_APP: ReadonlyArray<{ value: LuaChonMucDoApp; title: string }> = [
  { value: 'loi_canh_bao', title: 'Lỗi & cảnh báo' },
  { value: 'loi', title: 'Lỗi' },
  { value: 'canh_bao', title: 'Cảnh báo' },
  { value: 'thong_tin', title: 'Thông tin' },
  { value: 'tat_ca', title: 'Tất cả' },
];

// ── Bộ lọc ────────────────────────────────────────────────────────────────
const oTim = ref<string | null>('');
const tuKhoa = ref('');
const mayInId = ref<string>(props.mayInIdDau && props.mayIns.some((m) => m.id === props.mayInIdDau) ? props.mayInIdDau : TAT_CA);
const khoang = ref<KhoangNhatKyApp>('24_gio');
const nhom = ref('tat_ca');
/**
 * Mức của một dòng — máy chủ trả `mucDo`; backend cũ không trả thì suy từ tông mã sự kiện
 * (đỏ → lỗi, vàng → cảnh báo) để vạch màu không biến mất.
 */
function mucDoDong(k: NhatKyApp): string {
  if (k.mucDo === 'loi' || k.mucDo === 'canh_bao' || k.mucDo === 'thong_tin') return k.mucDo;
  const tong = kieuSuKienApp(k.suKien).tong;
  return tong === 'do' ? 'loi' : tong === 'vang' ? 'canh_bao' : 'thong_tin';
}

/** Mặc định "Tất cả" (log thô — người mở thẻ này thường cần đủ ngữ cảnh). */
const mucDo = ref<LuaChonMucDoApp>('tat_ca');
const tuLamMoi = ref(true);

const luaChonMayIn = computed(() => [
  { title: 'Tất cả máy in', value: TAT_CA },
  ...props.mayIns.map((m) => ({ title: m.ten, value: m.id })),
]);
const tenKhoang = computed(() => {
  const o = LUA_CHON_KHOANG_APP.find((x) => x.value === khoang.value);
  return o?.value === 'hom_nay' ? 'hôm nay' : `${o?.title ?? ''} qua`;
});

// ── Dữ liệu ───────────────────────────────────────────────────────────────
const items = ref<NhatKyApp[]>([]);
const tiepTheo = ref<string | null>(null);
const dangTai = ref(false);
const dangTaiThem = ref(false);
const daTai = ref(false);
const loi = ref('');
const biCam = ref(false);
const lucCapNhat = ref<number | null>(null);
const dangTaiXuong = ref(false);
const loiTaiXuong = ref('');

const dongTrangThai = computed(() => {
  if (dangTai.value && items.value.length === 0) return 'Đang tải…';
  if (!daTai.value) return '';
  const dem = `${items.value.length.toLocaleString('vi-VN')}${tiepTheo.value ? '+' : ''} dòng`;
  return lucCapNhat.value ? `${dem} · cập nhật ${dinhDangGioVN(lucCapNhat.value).slice(6)}` : dem;
});

let boHuy: AbortController | null = null;
let theHe = 0;
let dangLamMoi = false;
/** Khoảng (tu, den) của danh sách đang hiện — "Tải thêm" và tự làm mới dùng đúng khoảng này. */
let khoangDangDung: { tu: string; den?: string } | null = null;

function thamSo(k: { tu: string; den?: string }, conTro: { truoc?: string; sau?: string } = {}): ThamSoNhatKyApp {
  return {
    q: tuKhoa.value || undefined,
    mayInId: mayInId.value === TAT_CA ? undefined : mayInId.value,
    suKien: suKienCuaNhom(nhom.value),
    mucDo: mucDo.value === 'tat_ca' ? undefined : mucDo.value,
    tu: k.tu,
    den: k.den,
    truoc: conTro.truoc,
    sau: conTro.sau,
    gioiHan: conTro.sau ? GIOI_HAN_DUOI : GIOI_HAN,
  };
}

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
    biCam.value = true;
    tuLamMoi.value = false;
    return;
  }
  if (ma === 404) {
    loi.value = 'Máy chủ chưa có nhật ký app máy in (backend cần cập nhật).';
    return;
  }
  if (ma === 503) {
    loi.value = 'Máy chủ chưa tạo bảng nhật ký app máy in (cần chạy migration print_app_logs).';
    return;
  }
  const maLoi = (e as { response?: { data?: { error?: unknown } } })?.response?.data?.error;
  const maDoc = typeof maLoi === 'string' && /^[A-Z][A-Z0-9_]+$/.test(maLoi) ? maLoi : `mã ${ma}`;
  loi.value = ma ? `${viec} (${maDoc}).` : `${viec} — không kết nối được máy chủ.`;
}

/** Tải lại từ đầu theo bộ lọc (mới nhất trước). `ngam`: từ nhịp tự làm mới — 5xx không toast. */
async function taiLai(tuy: { ngam?: boolean } = {}): Promise<void> {
  const { signal, the } = batDauYeuCau();
  const k = khoangNhatKyApp(khoang.value);
  dangTai.value = true;
  loi.value = '';
  try {
    const trang = await layNhatKyApp(thamSo(k), { signal, ngam: tuy.ngam === true });
    if (the !== theHe) return;
    items.value = trang.items;
    tiepTheo.value = trang.tiepTheo;
    khoangDangDung = k;
    lucCapNhat.value = Date.now();
  } catch (e) {
    if (the !== theHe || laYeuCauDaHuy(e)) return;
    items.value = [];
    tiepTheo.value = null;
    khoangDangDung = null;
    xuLyLoi(e, 'Không tải được nhật ký app máy in');
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
  const { signal, the } = batDauYeuCau();
  dangTaiThem.value = true;
  try {
    const trang = await layNhatKyApp(thamSo(k, { truoc }), { signal });
    if (the !== theHe) return;
    items.value = noiTrangSau(items.value, trang.items);
    tiepTheo.value = trang.tiepTheo;
    loi.value = '';
  } catch (e) {
    if (the !== theHe || laYeuCauDaHuy(e)) return;
    xuLyLoi(e, 'Không tải thêm được nhật ký app');
  } finally {
    if (the === theHe) dangTaiThem.value = false;
  }
}

/**
 * Nhịp tự làm mới: chỉ hỏi dòng MỚI hơn con trỏ đuôi (`sau`), gộp theo giờ, không nháy.
 * Quá nhiều dòng mới (còn trang sau) hoặc sang ngày mới với khoảng theo ngày lịch → tải lại.
 */
async function lamMoiNgam(): Promise<void> {
  if (dangTai.value || dangTaiThem.value || dangLamMoi) return;
  const kMoi = khoangNhatKyApp(khoang.value);
  const k = khoangDangDung;
  if (!k || (!kMoi.cuon && kMoi.tu !== k.tu)) {
    await taiLai({ ngam: true });
    return;
  }
  const sau = conTroDuoi(items.value) ?? undefined;
  const { signal, the } = batDauYeuCau();
  dangLamMoi = true;
  let canTaiLai = false;
  try {
    const trang = await layNhatKyApp(thamSo(k, { sau }), { signal, ngam: true });
    if (the !== theHe) return;
    if (!sau) {
      // Danh sách đang rỗng: đây là trang đầu (mới nhất trước) — thay luôn.
      items.value = trang.items;
      tiepTheo.value = trang.tiepTheo;
    } else if (trang.tiepTheo) {
      canTaiLai = true; // hơn 500 dòng mới từ nhịp trước — lấy lại trang đầu cho gọn
    } else {
      const { ds, catDuoi } = gopDongMoi(items.value, trang.items, TRAN_DS);
      items.value = ds;
      if (catDuoi && ds.length > 0) tiepTheo.value = conTroCua(ds[ds.length - 1]);
    }
    loi.value = '';
    lucCapNhat.value = Date.now();
  } catch (e) {
    if (the !== theHe || laYeuCauDaHuy(e)) return;
    xuLyLoi(e, 'Không làm mới được nhật ký app — sẽ thử lại');
  } finally {
    if (the === theHe) dangLamMoi = false;
  }
  if (canTaiLai) await taiLai({ ngam: true });
}

// ── Tải xuống .txt ────────────────────────────────────────────────────────
async function taiXuong(): Promise<void> {
  if (dangTaiXuong.value) return;
  dangTaiXuong.value = true;
  loiTaiXuong.value = '';
  try {
    // Cùng bộ lọc đang chọn, khoảng tính lại theo lúc bấm (taiVeNhatKyApp bỏ con trỏ/giới hạn).
    const { duLieu, tenFile } = await taiVeNhatKyApp(thamSo(khoangNhatKyApp(khoang.value)));
    const url = URL.createObjectURL(duLieu);
    const a = document.createElement('a');
    a.href = url;
    a.download = tenFile;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  } catch (e) {
    const ma = maHttpCuaLoi(e);
    if (ma === 403) {
      biCam.value = true;
      tuLamMoi.value = false;
    } else if (ma === 503) {
      loiTaiXuong.value = 'Chưa tải xuống được: máy chủ chưa tạo bảng nhật ký app máy in (cần chạy migration print_app_logs).';
    } else {
      loiTaiXuong.value = ma ? `Không tải xuống được nhật ký app (mã ${ma}).` : 'Không tải xuống được nhật ký app — không kết nối được máy chủ.';
    }
  } finally {
    dangTaiXuong.value = false;
  }
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
  tuKhoa.value = chuanHoaTuKhoa(oTim.value);
}

watch(oTim, () => {
  huyHenGioTim();
  henGioTim = setTimeout(apDungTuKhoaNgay, TRE_TIM_MS);
});

watch([tuKhoa, mayInId, khoang, nhom, mucDo], () => {
  loiTaiXuong.value = '';
  void taiLai();
});

watch(
  () => props.mayIns,
  (ds) => {
    if (mayInId.value !== TAT_CA && !ds.some((m) => m.id === mayInId.value)) mayInId.value = TAT_CA;
  },
);

// ── Tự làm mới 5 giây ────────────────────────────────────────────────────
let henGioLamMoi: ReturnType<typeof setInterval> | null = null;

function dungTuLamMoi(): void {
  if (henGioLamMoi) {
    clearInterval(henGioLamMoi);
    henGioLamMoi = null;
  }
}

function nhipLamMoi(): void {
  if (biCam.value || !props.hoatDong || document.hidden) return;
  void lamMoiNgam();
}

function batHenGioLamMoi(): void {
  dungTuLamMoi();
  if (tuLamMoi.value && props.hoatDong && !biCam.value) henGioLamMoi = setInterval(nhipLamMoi, NHIP_TU_LAM_MOI_MS);
}

watch(tuLamMoi, (bat) => {
  batHenGioLamMoi();
  if (bat) nhipLamMoi(); // bật lên là làm mới ngay
});

watch(() => props.hoatDong, (hd) => {
  batHenGioLamMoi();
  if (hd && tuLamMoi.value) nhipLamMoi(); // quay lại thẻ: lấy ngay phần đã lỡ
});

onMounted(() => {
  void taiLai();
  batHenGioLamMoi();
});

onBeforeUnmount(() => {
  dungTuLamMoi();
  huyHenGioTim();
  theHe++;
  boHuy?.abort();
  boHuy = null;
});
</script>

<style scoped>
/* Cùng bộ token Atlas với trang Máy in (.airtable-scope); giá trị dự phòng nếu gắn chỗ khác. */
.nka-card {
  background: var(--at-canvas, #fff); border: 1px solid var(--at-hairline, #e7eaf0); border-radius: 12px;
  box-shadow: var(--at-shadow-card, 0 1px 2px rgba(20, 26, 36, 0.05)); overflow: hidden;
}

.nka-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 12px 14px 8px; }
.nka-tim { flex: 1 1 300px; min-width: 220px; }
.nka-may-chon { flex: 0 1 220px; min-width: 170px; }
.nka-khoang { flex: 0 0 150px; }
.nka-toolbar :deep(.v-field) { border-radius: 8px; font-size: 13px; }
.nka-toolbar :deep(.v-field__input) { font-size: 13px; }

.nka-hang2 {
  display: flex; align-items: center; justify-content: space-between; gap: 8px 16px; flex-wrap: wrap;
  padding: 0 14px 12px; border-bottom: 1px solid var(--at-hairline, #e7eaf0);
}
.nka-loc { display: flex; flex-wrap: wrap; gap: 6px; }
.nka-pill {
  display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 11px;
  border-radius: 9999px; border: 1px solid var(--at-hairline, #e7eaf0); background: var(--at-canvas, #fff);
  font: inherit; font-size: 12.5px; font-weight: 500; color: var(--at-body, #475066); cursor: pointer;
  white-space: nowrap; transition: background 0.12s, border-color 0.12s, color 0.12s;
}
.nka-pill:hover { background: var(--at-surface-soft, #f1f4f9); }
.nka-pill:focus-visible { outline: 2px solid var(--at-action, #1786be); outline-offset: 2px; }
.nka-pill--chon, .nka-pill--chon:hover {
  background: var(--at-action-soft, #e4f1f8); border-color: #93c5fd; color: var(--at-action, #1786be); font-weight: 600;
}
.nka-pill-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; background: var(--nka-mau, #97a0b3); }

.nka-dieu-khien { display: flex; align-items: center; gap: 4px 12px; flex-wrap: wrap; }
.nka-dem { font-size: 12px; color: var(--at-muted, #6b7488); font-variant-numeric: tabular-nums; }
.nka-tu-lam-moi { display: flex; align-items: center; }
.nka-switch { flex: none; }
.nka-switch :deep(.v-label) { font-size: 12.5px; color: var(--at-body, #475066); opacity: 1; }

.nka-loi { margin: 12px 14px 0; }

/* Danh sách dạng log: chữ đơn cách, dày, nội dung dài (usb_doc) tự xuống dòng.
   Font đặt THẲNG lên dòng + từng ô: `.smax-app *` của vỏ ứng dụng ép font chữ thường
   cho mọi phần tử, đặt ở khung ngoài thì các ô con không thừa hưởng. */
.nka-ds {
  font-size: 12px; line-height: 1.5; color: var(--at-body, #475066);
  transition: opacity 0.15s;
}
.nka-dong, .nka-dong > span {
  font-family: var(--mono, 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
}
.nka-mo { opacity: 0.55; }
.nka-dong {
  display: grid; grid-template-columns: 148px minmax(90px, 150px) 132px minmax(0, 1fr);
  column-gap: 12px; align-items: baseline;
  padding: 3px 14px 3px 11px; border-bottom: 1px solid #f1f3f7;
  border-left: 3px solid transparent;
}
.nka-dong:hover { background: #f7f9fc; }
/* Vạch mép trái theo MỨC (máy chủ phân loại) — lỗi đỏ, cảnh báo vàng, thông tin không vạch.
   Nền hồng nhạt chỉ cho dòng lỗi. (Trước 25/09 vạch theo tông mã sự kiện.) */
.nka-dong--muc-loi { border-left-color: var(--at-atlas-danger, #f04438); background: #fff8f7; }
.nka-dong--muc-canh_bao { border-left-color: var(--at-atlas-warning, #f5a524); }
.nka-gio { color: var(--at-ink, #141a24); white-space: nowrap; font-variant-numeric: tabular-nums; }
.nka-may { color: var(--at-muted, #6b7488); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nka-su-kien {
  justify-self: start; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 11px; font-weight: 600; padding: 0 6px; border-radius: 4px;
  color: var(--nka-mau, #475066); background: var(--nka-nen, #f1f4f9);
}
.nka-noi-dung { color: var(--at-ink, #141a24); white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; min-width: 0; }

/* Tông màu sự kiện (may-in-nhan.ts MA_SU_KIEN_APP) — dùng cho chip dòng + chấm của viên lọc */
.nka-tong--do { --nka-mau: #b42318; --nka-nen: var(--at-atlas-danger-soft, #fdecea); }
.nka-tong--vang { --nka-mau: #92400e; --nka-nen: var(--at-atlas-warning-soft, #fef3dc); }
.nka-tong--xanh_la { --nka-mau: #1b6b46; --nka-nen: var(--at-atlas-success-soft, #e3f6ec); }
.nka-tong--xanh { --nka-mau: var(--at-action, #1786be); --nka-nen: var(--at-action-soft, #e4f1f8); }
.nka-tong--tim { --nka-mau: #6d28d9; --nka-nen: #f1ebfd; }
.nka-tong--xam { --nka-mau: #475066; --nka-nen: #eef1f6; }
.nka-pill-dot.nka-tong--do { background: var(--at-atlas-danger, #f04438); }
.nka-pill-dot.nka-tong--vang { background: var(--at-atlas-warning, #f5a524); }
.nka-pill-dot.nka-tong--xanh_la { background: var(--at-atlas-success, #12b76a); }
.nka-pill-dot.nka-tong--xanh { background: var(--at-action, #1786be); }
.nka-pill-dot.nka-tong--tim { background: #7c3aed; }
.nka-pill-dot.nka-tong--xam { background: #97a0b3; }

/* Hàng viên mức độ — cùng dáng hàng viên sự kiện, chấm màu như thẻ "Nhật ký in" */
.nka-muc-loc {
  display: flex; align-items: center; flex-wrap: wrap; gap: 6px;
  padding: 10px 14px; border-bottom: 1px solid var(--at-hairline, #e7eaf0);
}
.nka-nhan-loc {
  font-size: 10.5px; font-weight: 600; letter-spacing: 0.4px; text-transform: uppercase;
  color: var(--at-hint, #97a0b3); margin-right: 2px;
}
.nka-muc-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.nka-muc-dot--loi_canh_bao { background: linear-gradient(135deg, var(--at-atlas-danger, #f04438) 50%, var(--at-atlas-warning, #f5a524) 50%); }
.nka-muc-dot--loi { background: var(--at-atlas-danger, #f04438); }
.nka-muc-dot--canh_bao { background: var(--at-atlas-warning, #f5a524); }
.nka-muc-dot--thong_tin { background: var(--at-action, #1786be); }
.nka-an {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden;
  clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}

@media (max-width: 720px) {
  .nka-dong { grid-template-columns: auto minmax(0, 1fr); row-gap: 1px; }
  .nka-su-kien { grid-column: 1; }
  .nka-noi-dung { grid-column: 1 / -1; }
}

/* Trống / đang tải / không có quyền */
.nka-rong, .nka-cam { text-align: center; color: var(--at-muted, #6b7488); padding: 32px 16px; font-size: 13px; }
.nka-rong-ico {
  width: 40px; height: 40px; border-radius: 10px; margin: 0 auto 10px;
  display: flex; align-items: center; justify-content: center;
  background: var(--at-surface-soft, #f1f4f9); color: var(--at-muted, #6b7488);
}
.nka-rong-chu { font-size: 13px; font-weight: 600; color: var(--at-ink, #141a24); }
.nka-rong-phu { font-size: 12.5px; margin-top: 4px; }

.nka-them { display: flex; justify-content: center; padding: 12px 0; border-top: 1px solid var(--at-hairline, #e7eaf0); }
</style>
