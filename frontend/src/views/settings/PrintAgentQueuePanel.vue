<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  PrintAgentQueuePanel — thẻ "Hàng đợi in" trong mục Hàng đợi & nhật ký máy in (25/09, hợp đồng
  docs/may-in/HOP-DONG-HANG-DOI-HUY-v5.md mục 8 — v5.1). Chủ giao: hoá đơn gửi lúc máy in lỗi phải
  HIỆN; huỷ được; huỷ phải báo kết quả THẬT, không bao giờ nói "đã huỷ" khi không chắc.

  Dữ liệu do trang cha nạp (`hangDoi`, GET /may-in-agents/hang-doi — cùng nguồn với chip "N đang
  chờ" trên thẻ máy); thẻ này xin nạp lại (`taiLai`) mỗi 5 giây khi đang hiện, và sau mỗi thao tác.
  Tạm dừng khi tab trình duyệt ẩn, đang mở hộp xác nhận, hoặc đang huỷ.

  Hai nhóm: "Đang chờ in" (cho_in / đang gửi — huỷ CHẮC CHẮN chỉ khi còn chờ) và "Chưa xác nhận"
  (đã xuống máy in, không rõ đã in — KHÔNG huỷ được từ xa; chỉ "Bỏ khỏi hàng đợi", thứ KHÔNG chặn
  việc in). Mọi câu chữ nói đúng việc đã xảy ra: "Đã huỷ ✓" chỉ cho kết quả ok của lệnh huỷ;
  bỏ theo dõi hiện "Đã bỏ khỏi hàng đợi".
-->
<template>
  <div class="hd-card" :aria-busy="dangTai">
    <div class="hd-toolbar">
      <v-select
        v-model="mayInId"
        class="hd-may-chon"
        :items="luaChonMayIn"
        prepend-inner-icon="mdi-printer-outline"
        variant="outlined"
        density="compact"
        hide-details
        aria-label="Lọc theo máy in"
      />
      <div class="hd-toolbar-phai">
        <span class="hd-dem" aria-live="polite">{{ dongTrangThai }}</span>
        <v-btn
          icon="mdi-refresh"
          variant="text"
          size="small"
          density="comfortable"
          aria-label="Tải lại hàng đợi"
          title="Tải lại hàng đợi"
          :loading="dangTai"
          @click="xinTaiLai(false)"
        />
      </div>
    </div>

    <div v-if="nhomChonTheoMay.length || chon.size" class="hd-chon-nhieu" role="toolbar" aria-label="Chọn nhiều lệnh">
      <button
        v-for="g in nhomChonTheoMay"
        :key="g.khoa"
        type="button"
        class="hd-pill"
        :disabled="dangHuy > 0"
        @click="chonTatCaCuaMay(g.khoa)"
      >
        <v-icon size="14" icon="mdi-checkbox-multiple-marked-outline" aria-hidden="true" />
        Chọn tất cả của {{ g.ten }} ({{ g.soLuong }})
      </button>
      <template v-if="chon.size">
        <span class="hd-da-chon">{{ chon.size }} lệnh đã chọn</span>
        <v-btn
          class="hd-nut-huy-nhieu"
          color="error"
          variant="tonal"
          size="small"
          prepend-icon="mdi-cancel"
          :disabled="dangHuy > 0"
          @click="moHopHuy([...chon])"
        >Huỷ {{ chon.size }} lệnh đã chọn</v-btn>
        <v-btn variant="text" size="small" :disabled="dangHuy > 0" @click="boChon">Bỏ chọn</v-btn>
      </template>
    </div>

    <v-alert v-if="loi" type="error" variant="tonal" density="compact" class="hd-loi">
      {{ loi }}
      <template #append>
        <v-btn size="small" variant="text" @click="xinTaiLai(false)">Thử lại</v-btn>
      </template>
    </v-alert>

    <div v-if="!hangDoi" class="hd-rong" role="status">
      <v-progress-circular v-if="dangTai" indeterminate size="18" width="2" color="primary" class="mr-2" />
      {{ dangTai ? 'Đang tải hàng đợi in…' : 'Chưa tải được hàng đợi in.' }}
    </div>

    <div v-else-if="dsChoIn.length === 0 && dsChuaXacNhan.length === 0" class="hd-rong hd-rong--ok" role="status">
      <div class="hd-rong-ico" aria-hidden="true"><v-icon size="22" icon="mdi-check-circle-outline" /></div>
      <div class="hd-rong-chu">Không có lệnh in nào đang chờ ✓</div>
      <div v-if="mayInId !== TAT_CA" class="hd-rong-phu">Chỉ đang xem một máy — chọn "Tất cả máy in" để xem các máy khác.</div>
    </div>

    <template v-else>
      <!-- ── Nhóm 1: Đang chờ in ── -->
      <section class="hd-nhom" aria-labelledby="hd-nhom-cho-in">
        <div class="hd-nhom-dau">
          <h3 id="hd-nhom-cho-in" class="hd-nhom-tieu-de">
            Đang chờ in <span class="hd-so-dem">{{ dsChoIn.length }}</span>
          </h3>
          <span class="hd-nhom-phu">Theo thứ tự sẽ in · chỉ lệnh còn đang chờ mới huỷ được chắc chắn</span>
        </div>
        <v-table v-if="dsChoIn.length" class="hd-bang">
          <thead>
            <tr>
              <th class="hd-c-chon">
                <input
                  type="checkbox"
                  class="hd-o-chon"
                  :checked="daChonHet"
                  :indeterminate.prop="chon.size > 0 && !daChonHet"
                  :disabled="dsHuyDuoc.length === 0 || dangHuy > 0"
                  aria-label="Chọn tất cả lệnh huỷ được"
                  @change="doiChonTatCa"
                >
              </th>
              <th>Hoá đơn</th>
              <th class="hd-c-may">Máy in</th>
              <th>Trạng thái</th>
              <th class="hd-c-tu" title="Giờ Việt Nam">Chờ từ</th>
              <th class="hd-c-hanh-dong"><span class="hd-an">Hành động</span></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="m in dsChoIn"
              :key="m.id"
              class="hd-dong"
              :class="lopDong(m)"
              :data-id="m.id"
            >
              <td class="hd-c-chon">
                <input
                  v-if="m.huy === 'chac_chan'"
                  type="checkbox"
                  class="hd-o-chon"
                  :checked="chon.has(m.id)"
                  :disabled="!coTheHuy(m) || dangHuy > 0"
                  :aria-label="`Chọn ${m.soHoaDon}`"
                  @change="doiChon(m.id)"
                >
              </td>
              <td>
                <div class="hd-so">{{ m.soHoaDon }}</div>
                <div v-if="m.tenKhach" class="hd-khach">{{ m.tenKhach }}</div>
              </td>
              <td class="hd-c-may">{{ m.mayInTen || '—' }}</td>
              <td class="hd-c-trang-thai">
                <template v-if="ketQuaCua(m.id)?.loai === 'da_huy'">
                  <span class="hd-chip hd-chip--xanh-la" role="status">
                    <v-icon size="14" icon="mdi-check" aria-hidden="true" />Đã huỷ ✓
                  </span>
                  <div class="hd-ly-do">{{ ketQuaCua(m.id)?.noiDung }}</div>
                </template>
                <template v-else>
                  <span class="hd-chip" :class="`hd-chip--${chipTrangThaiHangDoi(m).mau}`">
                    <v-icon size="14" :icon="chipTrangThaiHangDoi(m).bieuTuong" aria-hidden="true" />{{ chipTrangThaiHangDoi(m).chu }}
                  </span>
                  <div class="hd-ly-do">{{ m.lyDo }}</div>
                  <div v-if="ketQuaLoi(m.id)" class="hd-ket-qua-loi" role="alert">
                    <span class="hd-chip hd-chip--do">
                      <v-icon size="14" icon="mdi-close-octagon-outline" aria-hidden="true" />{{ ketQuaLoi(m.id)!.nhan }}
                    </span>
                    <p class="hd-ket-qua-chu">{{ ketQuaLoi(m.id)!.noiDung }}</p>
                    <button type="button" class="hd-link" @click="anKetQua(m.id)">Ẩn thông báo</button>
                  </div>
                </template>
              </td>
              <td class="hd-c-tu">
                <div class="hd-gio">{{ choTu(m, bayGio).gio }}</div>
                <div class="hd-tuong-doi">{{ choTu(m, bayGio).tuongDoi }}</div>
              </td>
              <td class="hd-c-hanh-dong">
                <span v-if="ketQuaCua(m.id)?.loai === 'dang_huy'" class="hd-dang" role="status">
                  <v-progress-circular indeterminate size="14" width="2" color="error" />Đang huỷ…
                </span>
                <span v-else-if="ketQuaCua(m.id)?.loai === 'da_huy'" aria-hidden="true" />
                <v-btn
                  v-else-if="m.huy === 'chac_chan'"
                  class="hd-nut-huy"
                  size="small"
                  variant="tonal"
                  color="error"
                  :disabled="dangHuy > 0"
                  :aria-label="`Huỷ lệnh in ${m.soHoaDon}`"
                  @click="moHopHuy([m.id])"
                >Huỷ</v-btn>
                <v-btn v-else size="small" variant="text" class="hd-nut-vi-sao" @click="moViSao(m)">Vì sao không huỷ được?</v-btn>
              </td>
            </tr>
          </tbody>
        </v-table>
        <p v-else class="hd-nhom-rong">Không có lệnh nào đang chờ in.</p>
      </section>

      <!-- ── Nhóm 2: Chưa xác nhận đã in ── -->
      <section v-if="dsChuaXacNhan.length" class="hd-nhom" aria-labelledby="hd-nhom-chua-xn">
        <div class="hd-nhom-dau">
          <button
            id="hd-nhom-chua-xn"
            type="button"
            class="hd-nhom-nut"
            :aria-expanded="moNhomChuaXacNhan"
            aria-controls="hd-vung-chua-xn"
            @click="moChuaXacNhan = !moNhomChuaXacNhan"
          >
            <v-icon size="16" :icon="moNhomChuaXacNhan ? 'mdi-chevron-down' : 'mdi-chevron-right'" aria-hidden="true" />
            Chưa xác nhận đã in <span class="hd-so-dem hd-so-dem--vang">{{ dsChuaXacNhan.length }}</span>
          </button>
          <span class="hd-nhom-phu">Đã gửi xuống máy in nhưng không rõ đã in chưa · 3 ngày gần nhất · không huỷ được từ xa</span>
        </div>
        <v-table v-if="moNhomChuaXacNhan" id="hd-vung-chua-xn" class="hd-bang">
          <thead>
            <tr>
              <th class="hd-c-chon" />
              <th>Hoá đơn</th>
              <th class="hd-c-may">Máy in</th>
              <th>Trạng thái</th>
              <th class="hd-c-tu" title="Giờ Việt Nam">Chờ từ</th>
              <th class="hd-c-hanh-dong"><span class="hd-an">Hành động</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in dsChuaXacNhan" :key="m.id" class="hd-dong" :class="lopDong(m)" :data-id="m.id">
              <td class="hd-c-chon" />
              <td>
                <div class="hd-so">{{ m.soHoaDon }}</div>
                <div v-if="m.tenKhach" class="hd-khach">{{ m.tenKhach }}</div>
              </td>
              <td class="hd-c-may">{{ m.mayInTen || '—' }}</td>
              <td class="hd-c-trang-thai">
                <template v-if="ketQuaCua(m.id)?.loai === 'da_bo'">
                  <span class="hd-chip hd-chip--xam" role="status">
                    <v-icon size="14" icon="mdi-eye-off-outline" aria-hidden="true" />Đã bỏ khỏi hàng đợi
                  </span>
                  <div class="hd-ly-do">{{ ketQuaCua(m.id)?.noiDung }}</div>
                </template>
                <template v-else>
                  <span class="hd-chip" :class="`hd-chip--${chipTrangThaiHangDoi(m).mau}`">
                    <v-icon size="14" :icon="chipTrangThaiHangDoi(m).bieuTuong" aria-hidden="true" />{{ chipTrangThaiHangDoi(m).chu }}
                  </span>
                  <div class="hd-ly-do">{{ m.lyDo }}</div>
                  <div v-if="ketQuaLoi(m.id)" class="hd-ket-qua-loi" role="alert">
                    <span class="hd-chip hd-chip--do">
                      <v-icon size="14" icon="mdi-close-octagon-outline" aria-hidden="true" />{{ ketQuaLoi(m.id)!.nhan }}
                    </span>
                    <p class="hd-ket-qua-chu">{{ ketQuaLoi(m.id)!.noiDung }}</p>
                    <button type="button" class="hd-link" @click="anKetQua(m.id)">Ẩn thông báo</button>
                  </div>
                </template>
              </td>
              <td class="hd-c-tu">
                <div class="hd-gio">{{ choTu(m, bayGio).gio }}</div>
                <div class="hd-tuong-doi">{{ choTu(m, bayGio).tuongDoi }}</div>
              </td>
              <td class="hd-c-hanh-dong">
                <span v-if="ketQuaCua(m.id)?.loai === 'dang_bo'" class="hd-dang" role="status">
                  <v-progress-circular indeterminate size="14" width="2" color="primary" />Đang bỏ…
                </span>
                <span v-else-if="ketQuaCua(m.id)?.loai === 'da_bo'" aria-hidden="true" />
                <div v-else class="hd-nut-cot">
                  <v-btn size="small" variant="text" class="hd-nut-vi-sao" @click="moViSao(m)">Vì sao không huỷ được?</v-btn>
                  <v-btn size="small" variant="outlined" class="hd-nut-bo" :disabled="dangBo > 0" @click="moHopBo(m)">Bỏ khỏi hàng đợi</v-btn>
                </div>
              </td>
            </tr>
          </tbody>
        </v-table>
      </section>
    </template>

    <!-- Hộp xác nhận huỷ — nút "Huỷ lệnh in" / "Giữ lại" (§8.10: không dùng chữ "Huỷ" trơn) -->
    <v-dialog :model-value="!!hopHuy" max-width="480" @update:model-value="(v: boolean) => { if (!v) hopHuy = null; }">
      <v-card v-if="hopHuy" class="pa-dlg airtable-scope hd-dlg" rounded="lg">
        <div class="pa-dlg-dau">
          <div class="hd-dlg-ico hd-dlg-ico--do" aria-hidden="true"><v-icon size="18" icon="mdi-cancel" /></div>
          <div>
            <div class="pa-dlg-tieu-de hd-dlg-tieu-de">{{ hopHuy.cau.tieuDe }}</div>
            <div class="pa-dlg-phu">Chỉ huỷ lệnh còn đang chờ — lệnh đã xuống máy in sẽ báo "Không huỷ được".</div>
          </div>
        </div>
        <v-card-text class="pa-dlg-than hd-dlg-than">
          <p class="hd-dlg-chinh">{{ hopHuy.cau.noiDung }}</p>
        </v-card-text>
        <v-card-actions class="pa-dlg-chan">
          <v-spacer />
          <v-btn variant="text" class="hd-nut-giu" @click="hopHuy = null">Giữ lại</v-btn>
          <v-btn color="error" variant="flat" class="hd-nut-xac-nhan-huy" @click="xacNhanHuy">Huỷ lệnh in</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Vì sao không huỷ được? -->
    <v-dialog :model-value="!!hopViSao" max-width="520" @update:model-value="(v: boolean) => { if (!v) hopViSao = null; }">
      <v-card v-if="hopViSao" class="pa-dlg airtable-scope hd-dlg" rounded="lg">
        <div class="pa-dlg-dau">
          <div class="hd-dlg-ico" aria-hidden="true"><v-icon size="18" icon="mdi-help-circle-outline" /></div>
          <div>
            <div class="pa-dlg-tieu-de hd-dlg-tieu-de">Vì sao không huỷ được {{ hopViSao.soHoaDon }}?</div>
            <div class="pa-dlg-phu">{{ chipTrangThaiHangDoi(hopViSao).chu }} · {{ hopViSao.lyDo }}</div>
          </div>
        </div>
        <v-card-text class="pa-dlg-than hd-dlg-than">
          <p class="hd-dlg-chinh hd-vi-sao-chu">{{ lyDoKhongHuy(hopViSao) }}</p>
        </v-card-text>
        <v-card-actions class="pa-dlg-chan">
          <v-spacer />
          <v-btn color="primary" variant="flat" @click="hopViSao = null">Đã hiểu</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Bỏ khỏi hàng đợi — nói rõ KHÔNG chặn việc in (§8.5) -->
    <v-dialog :model-value="!!hopBo" max-width="520" @update:model-value="(v: boolean) => { if (!v) hopBo = null; }">
      <v-card v-if="hopBo" class="pa-dlg airtable-scope hd-dlg" rounded="lg">
        <div class="pa-dlg-dau">
          <div class="hd-dlg-ico hd-dlg-ico--vang" aria-hidden="true"><v-icon size="18" icon="mdi-eye-off-outline" /></div>
          <div>
            <div class="pa-dlg-tieu-de hd-dlg-tieu-de">Bỏ {{ hopBo.soHoaDon }} khỏi hàng đợi?</div>
            <div class="pa-dlg-phu">Đây KHÔNG phải huỷ lệnh in.</div>
          </div>
        </div>
        <v-card-text class="pa-dlg-than hd-dlg-than">
          <p class="hd-dlg-chinh hd-bo-chu">{{ CAU_BO_THEO_DOI }}</p>
        </v-card-text>
        <v-card-actions class="pa-dlg-chan">
          <v-spacer />
          <v-btn variant="text" class="hd-nut-giu" @click="hopBo = null">Giữ lại</v-btn>
          <v-btn color="primary" variant="flat" class="hd-nut-xac-nhan-bo" @click="xacNhanBo">Bỏ khỏi hàng đợi</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useToast } from '@/composables/use-toast';
import {
  huyLenhIn, boTheoDoiLenhIn,
  type HangDoiIn, type MayIn, type MucHangDoi,
} from '@/api/print-agents';
import {
  chipTrangThaiHangDoi, lyDoKhongHuy, choTu, tomTatHuy, cauXacNhanHuy, khoaMay, CAU_BO_THEO_DOI,
} from './may-in-hang-doi';

const props = withDefaults(defineProps<{
  /** Snapshot trang cha nạp; null = chưa tải lần nào. */
  hangDoi: HangDoiIn | null;
  mayIns: MayIn[];
  /** false khi thẻ không được chọn — nghỉ tự làm mới. */
  hoatDong?: boolean;
  dangTai?: boolean;
  loi?: string;
  /** Lọc sẵn một máy (bấm chip "N đang chờ" trên thẻ máy); `lan` đổi = áp lại. */
  locMay?: { mayInId: string | null; lan: number } | null;
}>(), { hoatDong: true, dangTai: false, loi: '', locMay: null });

const emit = defineEmits<{
  /** Xin trang cha nạp lại hàng đợi. `ngam` = nhịp tự làm mới (lỗi 5xx không toast). */
  taiLai: [tuy: { ngam: boolean }];
}>();

const toast = useToast();
const TAT_CA = '__tat_ca__';
const NHIP_TU_LAM_MOI_MS = 5_000;
/** "Đã huỷ ✓" / "Đã bỏ khỏi hàng đợi" hiện chừng này rồi dòng rời danh sách. */
const MS_HIEN_KET_QUA = 3_000;

// ── Lọc máy ───────────────────────────────────────────────────────────────
const mayInId = ref<string>(TAT_CA);
const luaChonMayIn = computed(() => [
  { title: 'Tất cả máy in', value: TAT_CA },
  ...props.mayIns.map((m) => ({ title: m.ten, value: m.id })),
]);
watch(
  () => props.locMay?.lan,
  () => {
    if (props.locMay) mayInId.value = props.locMay.mayInId ?? TAT_CA;
  },
  { immediate: true },
);
watch(
  () => props.mayIns,
  (ds) => {
    if (mayInId.value !== TAT_CA && !ds.some((m) => m.id === mayInId.value)) mayInId.value = TAT_CA;
  },
);

// ── Kết quả từng dòng (chỉ ở giao diện) ────────────────────────────────────
type LoaiKetQua = 'dang_huy' | 'da_huy' | 'khong_huy' | 'chua_ro' | 'dang_bo' | 'da_bo' | 'khong_bo';
interface KetQuaDong {
  loai: LoaiKetQua;
  noiDung?: string;
}
const ketQua = ref(new Map<string, KetQuaDong>());
/** Dòng đã rời danh sách (hết 3 s "Đã huỷ ✓") — ẩn kể cả khi snapshot cũ còn mang nó. */
const daRoi = ref(new Set<string>());
/**
 * Bản sao dòng đang hiện "Đã huỷ ✓" / "Đã bỏ khỏi hàng đợi": trang cha nạp lại NGAY sau thao
 * tác và máy chủ không còn trả lệnh đó — không giữ bản sao thì dòng biến mất tức khắc, người
 * dùng không kịp thấy kết quả. Hết MS_HIEN_KET_QUA thì bỏ.
 */
const giuLai = ref(new Map<string, MucHangDoi>());
const dangHuy = ref(0);
const dangBo = ref(0);
const henGioRoi = new Set<ReturnType<typeof setTimeout>>();

function datKetQua(id: string, kq: KetQuaDong | null): void {
  const m = new Map(ketQua.value);
  if (kq) m.set(id, kq);
  else m.delete(id);
  ketQua.value = m;
}
const ketQuaCua = (id: string): KetQuaDong | undefined => ketQua.value.get(id);
/** Kết quả lỗi đang hiện trên dòng (chip đỏ + câu đầy đủ). */
function ketQuaLoi(id: string): { nhan: string; noiDung: string } | null {
  const k = ketQua.value.get(id);
  if (!k) return null;
  if (k.loai === 'khong_huy') return { nhan: 'Không huỷ được', noiDung: k.noiDung ?? '' };
  if (k.loai === 'khong_bo') return { nhan: 'Không bỏ được', noiDung: k.noiDung ?? '' };
  if (k.loai === 'chua_ro') return { nhan: 'Chưa rõ kết quả', noiDung: k.noiDung ?? '' };
  return null;
}
const anKetQua = (id: string): void => datKetQua(id, null);

function hen(fn: () => void, ms: number): void {
  const h = setTimeout(() => {
    henGioRoi.delete(h);
    fn();
  }, ms);
  henGioRoi.add(h);
}

/** Dòng giữ nguyên chỗ (kể cả khi snapshot mới không còn nó) rồi rời danh sách sau MS_HIEN_KET_QUA. */
function roiSau(id: string): void {
  const m = mucTheoId(id);
  if (m) giuLai.value = new Map(giuLai.value).set(id, m);
  hen(() => {
    daRoi.value = new Set([...daRoi.value, id]);
    const g = new Map(giuLai.value);
    g.delete(id);
    giuLai.value = g;
    datKetQua(id, null);
  }, MS_HIEN_KET_QUA);
}

// ── Danh sách hiện ────────────────────────────────────────────────────────
const theoMay = (m: MucHangDoi): boolean => mayInId.value === TAT_CA || m.mayInId === mayInId.value;
/** Snapshot của nhóm + bản sao đang hiện kết quả (vào đúng chỗ theo lúc tạo — thứ tự máy chủ). */
function dsNhom(tuMayChu: readonly MucHangDoi[], nhom: MucHangDoi['nhom']): MucHangDoi[] {
  const co = new Set(tuMayChu.map((m) => m.id));
  const bu = [...giuLai.value.values()].filter((m) => m.nhom === nhom && !co.has(m.id));
  const ds = bu.length ? [...tuMayChu, ...bu].sort((a, b) => (a.tao < b.tao ? -1 : a.tao > b.tao ? 1 : 0)) : [...tuMayChu];
  return ds.filter((m) => theoMay(m) && !daRoi.value.has(m.id));
}
const dsChoIn = computed(() => dsNhom(props.hangDoi?.choIn ?? [], 'cho_in'));
const dsChuaXacNhan = computed(() => dsNhom(props.hangDoi?.chuaXacNhan ?? [], 'chua_xac_nhan'));

/** Nhóm "Chưa xác nhận": thu gọn sẵn khi có lệnh đang chờ; người dùng mở/đóng thì nhớ. */
const moChuaXacNhan = ref<boolean | null>(null);
const moNhomChuaXacNhan = computed(() => moChuaXacNhan.value ?? dsChoIn.value.length === 0);

const dongTrangThai = computed(() => {
  if (!props.hangDoi) return props.dangTai ? 'Đang tải…' : '';
  const n = dsChoIn.value.length;
  const k = dsChuaXacNhan.value.length;
  return `${n} đang chờ${k ? ` · ${k} chưa xác nhận` : ''}`;
});

function lopDong(m: MucHangDoi): Record<string, boolean> {
  const k = ketQua.value.get(m.id)?.loai;
  return {
    'hd-dong--tam-giu': m.tamGiu,
    'hd-dong--dang': k === 'dang_huy' || k === 'dang_bo',
    'hd-dong--da-huy': k === 'da_huy',
    'hd-dong--da-bo': k === 'da_bo',
    'hd-dong--loi': k === 'khong_huy' || k === 'khong_bo',
  };
}

// ── Chọn nhiều ────────────────────────────────────────────────────────────
const chon = ref(new Set<string>());
/** Dòng huỷ CHẮC CHẮN được và chưa có thao tác đang/đã xong. */
function coTheHuy(m: MucHangDoi): boolean {
  const k = ketQua.value.get(m.id)?.loai;
  return m.huy === 'chac_chan' && k !== 'dang_huy' && k !== 'da_huy';
}
const dsHuyDuoc = computed(() => dsChoIn.value.filter(coTheHuy));
const daChonHet = computed(() => dsHuyDuoc.value.length > 0 && dsHuyDuoc.value.every((m) => chon.value.has(m.id)));

function doiChon(id: string): void {
  const s = new Set(chon.value);
  if (s.has(id)) s.delete(id);
  else s.add(id);
  chon.value = s;
}
function doiChonTatCa(): void {
  chon.value = daChonHet.value ? new Set() : new Set(dsHuyDuoc.value.map((m) => m.id));
}
function boChon(): void {
  chon.value = new Set();
}

/** "Chọn tất cả của máy X" — mỗi máy có ít nhất một lệnh huỷ được một nút. */
const nhomChonTheoMay = computed(() => {
  const nhom = new Map<string, { khoa: string; ten: string; soLuong: number }>();
  for (const m of dsHuyDuoc.value) {
    const k = khoaMay(m);
    const g = nhom.get(k) ?? { khoa: k, ten: m.mayInTen || 'máy không rõ tên', soLuong: 0 };
    g.soLuong += 1;
    nhom.set(k, g);
  }
  return [...nhom.values()];
});
function chonTatCaCuaMay(khoa: string): void {
  chon.value = new Set([...chon.value, ...dsHuyDuoc.value.filter((m) => khoaMay(m) === khoa).map((m) => m.id)]);
}

// ── Huỷ ───────────────────────────────────────────────────────────────────
const hopHuy = ref<{ ids: string[]; cau: { tieuDe: string; noiDung: string } } | null>(null);

function mucTheoId(id: string): MucHangDoi | undefined {
  return [...(props.hangDoi?.choIn ?? []), ...(props.hangDoi?.chuaXacNhan ?? [])].find((m) => m.id === id)
    ?? giuLai.value.get(id);
}

function moHopHuy(ids: string[]): void {
  const cac = ids.map(mucTheoId).filter((m): m is MucHangDoi => !!m && coTheHuy(m));
  if (cac.length === 0) return;
  hopHuy.value = { ids: cac.map((m) => m.id), cau: cauXacNhanHuy(cac.map((m) => m.soHoaDon)) };
}

async function xacNhanHuy(): Promise<void> {
  const ids = hopHuy.value?.ids ?? [];
  hopHuy.value = null;
  if (ids.length === 0) return;
  for (const id of ids) datKetQua(id, { loai: 'dang_huy' });
  chon.value = new Set([...chon.value].filter((id) => !ids.includes(id)));
  dangHuy.value += 1;
  try {
    const kq = await huyLenhIn(ids);
    for (const k of kq) {
      if (k.ok) {
        datKetQua(k.id, { loai: 'da_huy', noiDung: k.cach === 'da_huy_truoc' ? 'Đã được huỷ trước đó — hoá đơn chắc chắn không in' : 'Hoá đơn chắc chắn không in' });
        roiSau(k.id);
      } else {
        datKetQua(k.id, { loai: 'khong_huy', noiDung: k.noiDung });
      }
    }
    // Id không có trong kết quả (không nên xảy ra) → không đoán, báo chưa rõ.
    for (const id of ids) if (!kq.some((k) => k.id === id)) datKetQua(id, { loai: 'chua_ro', noiDung: 'Máy chủ không trả kết quả cho lệnh này — xem lại sau khi hàng đợi tải lại.' });
    const tt = tomTatHuy(kq);
    toast[tt.loai](tt.chu);
  } catch {
    // Không biết lệnh huỷ đã tới máy chủ hay chưa → KHÔNG nói "đã huỷ", KHÔNG nói "không huỷ được".
    for (const id of ids) datKetQua(id, { loai: 'chua_ro', noiDung: 'Không liên lạc được máy chủ — chưa rõ đã huỷ được chưa. Hàng đợi đang tải lại: lệnh biến mất là đã huỷ, còn "Chờ in" thì thử lại.' });
    toast.error('Chưa rõ kết quả huỷ (lỗi kết nối) — đang tải lại hàng đợi, kiểm lại từng dòng');
  } finally {
    dangHuy.value -= 1;
    emit('taiLai', { ngam: false });
  }
}

// ── Vì sao không huỷ được / Bỏ khỏi hàng đợi ──────────────────────────────
const hopViSao = ref<MucHangDoi | null>(null);
const moViSao = (m: MucHangDoi): void => {
  hopViSao.value = m;
};

const hopBo = ref<MucHangDoi | null>(null);
const moHopBo = (m: MucHangDoi): void => {
  hopBo.value = m;
};

async function xacNhanBo(): Promise<void> {
  const m = hopBo.value;
  hopBo.value = null;
  if (!m) return;
  datKetQua(m.id, { loai: 'dang_bo' });
  dangBo.value += 1;
  try {
    const [kq] = await boTheoDoiLenhIn([m.id]);
    if (kq?.ok) {
      // KHÔNG BAO GIỜ "đã huỷ": bỏ theo dõi không chặn việc in.
      datKetQua(m.id, { loai: 'da_bo', noiDung: 'Hệ thống KHÔNG biết hoá đơn đã in hay chưa — kiểm khay giấy trước khi in lại' });
      roiSau(m.id);
      toast.success(`Đã bỏ ${m.soHoaDon} khỏi hàng đợi — hệ thống không biết đã in hay chưa`);
    } else {
      datKetQua(m.id, { loai: 'khong_bo', noiDung: kq?.noiDung || 'Máy chủ không trả kết quả.' });
      toast.error(`Không bỏ được ${m.soHoaDon} khỏi hàng đợi — xem lý do ở dòng`);
    }
  } catch {
    datKetQua(m.id, { loai: 'chua_ro', noiDung: 'Không liên lạc được máy chủ — chưa rõ đã bỏ khỏi hàng đợi chưa. Hàng đợi đang tải lại.' });
    toast.error('Chưa rõ kết quả (lỗi kết nối) — đang tải lại hàng đợi');
  } finally {
    dangBo.value -= 1;
    emit('taiLai', { ngam: false });
  }
}

// ── Snapshot mới: dọn lựa chọn / kết quả của dòng đã rời ───────────────────
const bayGio = ref(Date.now());
watch(
  () => props.hangDoi,
  (hd) => {
    bayGio.value = Date.now();
    if (!hd) return;
    const conLai = new Set([...hd.choIn, ...hd.chuaXacNhan].map((m) => m.id));
    const huyDuoc = new Set(hd.choIn.filter((m) => m.huy === 'chac_chan').map((m) => m.id));
    chon.value = new Set([...chon.value].filter((id) => huyDuoc.has(id)));
    daRoi.value = new Set([...daRoi.value].filter((id) => conLai.has(id)));
    const m = new Map(ketQua.value);
    for (const [id, k] of m) {
      // Dòng đã rời hàng đợi: bỏ thông báo lỗi/chưa rõ (dòng "Đã huỷ ✓" tự rời sau 3 s).
      if (!conLai.has(id) && k.loai !== 'da_huy' && k.loai !== 'da_bo' && k.loai !== 'dang_huy' && k.loai !== 'dang_bo') m.delete(id);
    }
    ketQua.value = m;
  },
);

// ── Tự làm mới 5 giây ─────────────────────────────────────────────────────
const coHopMo = computed(() => !!hopHuy.value || !!hopViSao.value || !!hopBo.value);
let henGioLamMoi: ReturnType<typeof setInterval> | null = null;

function xinTaiLai(ngam: boolean): void {
  emit('taiLai', { ngam });
}

function nhipLamMoi(): void {
  bayGio.value = Date.now();
  // Tab ẩn / hộp xác nhận đang mở / đang huỷ → nghỉ: danh sách không được đổi dưới tay người đang quyết.
  if (!props.hoatDong || document.hidden || coHopMo.value || dangHuy.value > 0 || dangBo.value > 0) return;
  xinTaiLai(true);
}

// Thẻ vừa mở (lần đầu hay quay lại): lấy ngay phần đã lỡ, không bắt chờ nhịp 5 giây.
watch(
  () => props.hoatDong,
  (hd) => {
    if (hd) xinTaiLai(true);
  },
  { immediate: true },
);

onMounted(() => {
  henGioLamMoi = setInterval(nhipLamMoi, NHIP_TU_LAM_MOI_MS);
});

onBeforeUnmount(() => {
  if (henGioLamMoi) clearInterval(henGioLamMoi);
  henGioLamMoi = null;
  for (const h of henGioRoi) clearTimeout(h);
  henGioRoi.clear();
});
</script>

<style scoped>
/* Cùng bộ token Atlas với trang Máy in (.airtable-scope); giá trị dự phòng nếu gắn chỗ khác. */
.hd-card {
  background: var(--at-canvas, #fff); border: 1px solid var(--at-hairline, #e7eaf0); border-radius: 12px;
  box-shadow: var(--at-shadow-card, 0 1px 2px rgba(20, 26, 36, 0.05)); overflow: hidden;
}
.hd-toolbar {
  display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
  padding: 12px 14px 8px;
}
.hd-may-chon { flex: 0 1 260px; min-width: 190px; }
.hd-toolbar :deep(.v-field) { border-radius: 8px; font-size: 13px; }
.hd-toolbar :deep(.v-field__input) { font-size: 13px; }
.hd-toolbar-phai { display: flex; align-items: center; gap: 4px 10px; }
.hd-dem { font-size: 12px; color: var(--at-muted, #6b7488); font-variant-numeric: tabular-nums; }

.hd-chon-nhieu {
  display: flex; align-items: center; flex-wrap: wrap; gap: 6px 8px; padding: 0 14px 12px;
}
.hd-pill {
  display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 11px;
  border-radius: 9999px; border: 1px solid var(--at-hairline, #e7eaf0); background: var(--at-canvas, #fff);
  font: inherit; font-size: 12.5px; font-weight: 500; color: var(--at-body, #475066); cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}
.hd-pill:hover:not(:disabled) { background: var(--at-surface-soft, #f1f4f9); }
.hd-pill:disabled { opacity: 0.55; cursor: default; }
.hd-pill:focus-visible { outline: 2px solid var(--at-action, #1786be); outline-offset: 2px; }
.hd-da-chon { font-size: 12.5px; font-weight: 600; color: var(--at-ink, #141a24); margin-left: 4px; }

.hd-loi { margin: 0 14px 12px; }

/* Nhóm */
.hd-nhom { border-top: 1px solid var(--at-hairline, #e7eaf0); }
.hd-nhom-dau {
  display: flex; align-items: baseline; flex-wrap: wrap; gap: 2px 12px; padding: 12px 14px 8px;
}
.hd-nhom-tieu-de, .hd-nhom-nut {
  display: inline-flex; align-items: center; gap: 6px; margin: 0;
  font: inherit; font-size: 13px; font-weight: 700; color: var(--at-ink, #141a24);
}
.hd-nhom-nut { border: 0; background: transparent; padding: 0; cursor: pointer; }
.hd-nhom-nut:focus-visible { outline: 2px solid var(--at-action, #1786be); outline-offset: 2px; border-radius: 4px; }
.hd-nhom-phu { font-size: 12px; color: var(--at-muted, #6b7488); }
.hd-so-dem {
  font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 9999px;
  background: var(--at-surface-soft, #f1f4f9); color: var(--at-muted, #6b7488);
}
.hd-so-dem--vang { background: var(--at-atlas-warning-soft, #fdf3e2); color: #92400e; }
.hd-nhom-rong { font-size: 12.5px; color: var(--at-muted, #6b7488); margin: 0; padding: 0 14px 14px; }

/* Bảng */
.hd-bang :deep(table) { table-layout: auto; }
.hd-bang :deep(th) {
  white-space: nowrap; height: 34px !important;
  font-size: 11px !important; font-weight: 600 !important; letter-spacing: 0.4px; text-transform: uppercase;
  color: var(--at-muted, #6b7488) !important; background: #fafbfd;
}
.hd-bang :deep(td) {
  font-size: 13px; color: var(--at-body, #475066); vertical-align: top;
  padding-top: 9px !important; padding-bottom: 9px !important; height: auto !important;
  border-bottom-color: var(--at-hairline, #e7eaf0) !important;
}
.hd-dong { transition: background 0.2s, opacity 0.2s; }
.hd-dong:hover td { background: #f7f9fc; }
/* Vạch mép trái theo tình trạng dòng */
.hd-dong > td:first-child { box-shadow: inset 3px 0 0 transparent; }
.hd-dong--tam-giu > td:first-child { box-shadow: inset 3px 0 0 var(--at-atlas-warning, #f5a524); }
.hd-dong--loi > td:first-child { box-shadow: inset 3px 0 0 var(--at-atlas-danger, #f04438); }
.hd-dong--dang td { opacity: 0.75; }
.hd-dong--da-huy td { background: var(--at-atlas-success-soft, #e7f7ef) !important; }
.hd-dong--da-huy > td:first-child { box-shadow: inset 3px 0 0 var(--at-atlas-success, #12b76a); }
.hd-dong--da-bo td { background: var(--at-surface-soft, #f1f4f9) !important; }

.hd-c-chon { width: 1%; padding-right: 0 !important; }
.hd-o-chon { width: 16px; height: 16px; margin-top: 2px; accent-color: var(--at-action, #1786be); cursor: pointer; }
.hd-o-chon:disabled { cursor: default; }
.hd-c-may { white-space: nowrap; }
.hd-c-tu { white-space: nowrap; width: 1%; }
.hd-c-hanh-dong { width: 1%; white-space: nowrap; text-align: right; }
.hd-c-trang-thai { min-width: 240px; }
.hd-so {
  font-family: var(--mono, 'Roboto Mono', ui-monospace, monospace); font-size: 12.5px;
  color: var(--at-ink, #141a24); white-space: nowrap; font-weight: 600;
}
.hd-khach { font-size: 12px; color: var(--at-muted, #6b7488); margin-top: 1px; }
.hd-gio { font-variant-numeric: tabular-nums; color: var(--at-ink, #141a24); font-size: 12.5px; }
.hd-tuong-doi { font-size: 11.5px; color: var(--at-muted, #6b7488); margin-top: 1px; }
.hd-ly-do { font-size: 12px; color: var(--at-body, #475066); margin-top: 4px; line-height: 1.45; }

.hd-chip {
  display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px; border-radius: 9999px;
  font-size: 11.5px; font-weight: 600; line-height: 1.6; white-space: nowrap;
  background: var(--at-surface-soft, #f1f4f9); color: var(--at-body, #475066); border: 1px solid var(--at-hairline, #e7eaf0);
}
.hd-chip--cam { background: var(--at-atlas-warning-soft, #fdf3e2); color: #92400e; border-color: #fcd34d; }
.hd-chip--vang { background: var(--at-atlas-warning-soft, #fdf3e2); color: #92400e; border-color: #fde68a; }
.hd-chip--xanh { background: var(--at-action-soft, #e4f1f8); color: var(--at-action, #1786be); border-color: #bfdbfe; }
.hd-chip--xanh-la { background: var(--at-atlas-success-soft, #e7f7ef); color: #1b6b46; border-color: #86efac; }
.hd-chip--do { background: var(--at-atlas-danger-soft, #fdeceb); color: #b42318; border-color: #fca5a5; }
.hd-chip--xam { background: var(--at-surface-soft, #f1f4f9); color: var(--at-body, #475066); }

.hd-ket-qua-loi {
  margin-top: 6px; padding: 6px 8px; border-radius: 8px;
  background: #fff8f7; border: 1px solid #fecaca;
}
.hd-ket-qua-chu { margin: 4px 0 2px; font-size: 12.5px; color: #7a271a; line-height: 1.5; white-space: pre-wrap; }
.hd-link {
  border: 0; background: transparent; padding: 0; cursor: pointer;
  font: inherit; font-size: 12px; color: var(--at-action, #1786be); text-decoration: underline;
}
.hd-dang { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; color: var(--at-body, #475066); }
.hd-nut-cot { display: inline-flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.hd-an {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden;
  clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}

/* Trống / đang tải */
.hd-rong { text-align: center; color: var(--at-muted, #6b7488); padding: 32px 16px; font-size: 13px; }
.hd-rong-ico {
  width: 40px; height: 40px; border-radius: 10px; margin: 0 auto 10px;
  display: flex; align-items: center; justify-content: center;
  background: var(--at-atlas-success-soft, #e7f7ef); color: #1b6b46;
}
.hd-rong-chu { font-size: 13.5px; font-weight: 600; color: var(--at-ink, #141a24); }
.hd-rong-phu { font-size: 12.5px; margin-top: 4px; }

/* Hộp xác nhận — v-dialog dời ra <body>: v-card tự gắn .airtable-scope (như trang cha) */
.hd-dlg .pa-dlg-dau { display: flex; align-items: flex-start; gap: 12px; padding: 20px 24px 4px; }
.hd-dlg .pa-dlg-tieu-de { font-size: 16px; font-weight: 700; color: var(--at-ink, #141a24); line-height: 1.3; }
.hd-dlg .pa-dlg-phu { font-size: 12.5px; color: var(--at-muted, #6b7488); margin-top: 2px; }
.hd-dlg .pa-dlg-than { padding: 14px 24px 6px !important; font-size: 13.5px; color: var(--at-body, #475066); }
.hd-dlg .pa-dlg-chan { padding: 8px 16px 14px; }
.hd-dlg-ico {
  width: 34px; height: 34px; border-radius: 8px; flex: none;
  display: flex; align-items: center; justify-content: center;
  background: var(--at-action-soft, #e4f1f8); color: var(--at-action, #1786be);
}
.hd-dlg-ico--do { background: var(--at-atlas-danger-soft, #fdeceb); color: var(--at-atlas-danger, #f04438); }
.hd-dlg-ico--vang { background: var(--at-atlas-warning-soft, #fdf3e2); color: #92400e; }
.hd-dlg-chinh { margin: 0; line-height: 1.55; white-space: pre-wrap; }

@media (max-width: 720px) {
  .hd-c-may, .hd-c-tu { white-space: normal; }
  .hd-c-trang-thai { min-width: 180px; }
}
</style>
