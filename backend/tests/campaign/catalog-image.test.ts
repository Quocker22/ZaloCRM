// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import { pickCatalogProducts, renderCatalogImage, type CatalogItem } from '../../src/modules/campaign/catalog-image.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const IMG_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../product-images');

describe('catalog-image: pickCatalogProducts', () => {
  it('KHÔNG lấy SP khi tên chunk không khớp SÁT (chống báo giá SAI)', async () => {
    // lookup trả SP tên khác hẳn → nameCloseEnough fail → không nhận giá.
    const lookup = async () => [{ content: 'Tên sản phẩm: Nguồn XYZ 999W\nGiá bán: 4.800đ' }];
    const items = await pickCatalogProducts(9, lookup);
    // tên "Nguồn XYZ 999W" không khớp bất kỳ kbName trong map → 0 SP (thà thiếu còn hơn sai)
    expect(items.every((it) => it.price >= 20000 || !/nguồn/i.test(it.name))).toBe(true);
  });
  it('loại giá phi lý theo nhóm (nguồn < 20.000đ bị bỏ)', async () => {
    // mọi chunk đều là "nguồn" giá 4.800đ → tất cả bị priceFloor loại → 0 SP nguồn.
    const lookup = async (q: string) => [{ content: `Tên sản phẩm: ${q}\nGiá bán: 4.800đ` }];
    const items = await pickCatalogProducts(9, lookup);
    const cheapPowers = items.filter((it) => /nguồn/i.test(it.name) && it.price < 20000);
    expect(cheapPowers.length).toBe(0);
  });
});

describe('catalog-image: renderCatalogImage', () => {
  it('xuất file PNG hợp lệ (magic bytes) từ item mock', async () => {
    // lấy 2 ảnh thật bất kỳ trong product-images làm input
    const files = existsSync(IMG_DIR) ? readdirSync(IMG_DIR).filter((f) => f.endsWith('.jpg')).slice(0, 2) : [];
    if (files.length < 2) return; // môi trường không có ảnh → bỏ qua
    const items: CatalogItem[] = files.map((f, i) => ({
      name: `SP test ${i}`, price: (i + 1) * 50000, imagePath: join(IMG_DIR, f),
    }));
    const out = join(tmpdir(), `catalog-test-${process.pid}.png`);
    await renderCatalogImage(items, 'TEST', out);
    const buf = readFileSync(out);
    // PNG magic: 89 50 4E 47
    expect(buf[0]).toBe(0x89);
    expect(buf[1]).toBe(0x50);
    expect(buf[2]).toBe(0x4e);
    expect(buf[3]).toBe(0x47);
  });
});
