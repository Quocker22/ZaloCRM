// SPDX-License-Identifier: AGPL-3.0-or-later
// print-agents.ts — API client trang setup máy in nhiều chi nhánh (Task 7).
//
// Khớp response backend print-agent-routes.ts (Task 6, mount /may-in-agents):
//   GET    /may-in-agents           -> { mayIn: MayIn[] }
//   GET    /may-in-agents/khos      -> { khos: Kho[] }
//   POST   /may-in-agents           -> { mayIn, token, serverUrl } (token đầy đủ CHỈ LẦN NÀY)
//   PUT    /may-in-agents/:id       -> { mayIn }
//   DELETE /may-in-agents/:id       -> { ok: true }
import { api } from '@/api/index';

export interface MayIn {
  id: string;
  ten: string;
  warehouseIds: number[];
  laMacDinh: boolean;
  tokenDuoi: string;
  online: boolean;
}

export interface Kho {
  id: number;
  ma: string;
  ten: string;
}

export interface TaoMayInPayload {
  ten: string;
  warehouseIds: number[];
  laMacDinh?: boolean;
}

export interface TaoMayInKetQua {
  mayIn: MayIn;
  token: string;
  serverUrl: string;
}

export async function layDanhSach(): Promise<MayIn[]> {
  const { data } = await api.get('/may-in-agents');
  return data?.mayIn ?? [];
}

export async function layKhos(): Promise<Kho[]> {
  const { data } = await api.get('/may-in-agents/khos');
  return data?.khos ?? [];
}

export async function tao(payload: TaoMayInPayload): Promise<TaoMayInKetQua> {
  const { data } = await api.post('/may-in-agents', payload);
  return data;
}

export async function sua(id: string, payload: TaoMayInPayload): Promise<MayIn> {
  const { data } = await api.put(`/may-in-agents/${id}`, payload);
  return data?.mayIn;
}

export async function xoa(id: string): Promise<void> {
  await api.delete(`/may-in-agents/${id}`);
}
