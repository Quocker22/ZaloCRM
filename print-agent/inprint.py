# SPDX-License-Identifier: AGPL-3.0-or-later
"""In file PDF qua driver HP bang SumatraPDF CLI (chay tren Windows).

Phan logic thuan (dung argv lenh in, decode base64 -> file tam) tach
rieng de test duoc khong can may in / khong can Windows:
  - lenh_in(): thuan, chi build list[str] argv.
  - in_pdf(): co side-effect (ghi file tam, goi subprocess) nhung ho tro
    che do DRY_RUN (env AGENT_DRY_RUN=1) de test tren moi he dieu hanh
    ma khong can SumatraPDF / may in that.

QUYET DINH khay giay: SumatraPDF -print-settings ho tro `bin=<n>`.
Ta map tray dang 'tray-<n>' -> bin=<n> (vi du 'tray-2' -> bin=2).
CAN VERIFY tren may Windows that voi driver HP that xem chi so bin co
khop dung khay vat ly hay khong (xem README).
"""
from __future__ import annotations

import base64
import os
import subprocess
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

SUMATRA_EXE = "SumatraPDF.exe"

DRY_RUN_ENV_VAR = "AGENT_DRY_RUN"
DRY_RUN_OUTPUT_DIR_ENV_VAR = "AGENT_DRY_RUN_DIR"
DEFAULT_DRY_RUN_DIR = "dry-run-output"


class TrayFormatError(ValueError):
    """tray khong dung dinh dang 'tray-<n>'."""


@dataclass(frozen=True)
class KetQuaIn:
    ok: bool
    loi: Optional[str] = None


def _tray_to_bin(tray: str) -> str:
    """Map 'tray-2' -> '2'. Nem TrayFormatError neu sai dinh dang."""
    prefix = "tray-"
    if not tray.startswith(prefix):
        raise TrayFormatError(
            f"tray phai co dang 'tray-<n>', nhan duoc: {tray!r}"
        )
    so = tray[len(prefix):]
    if not so.isdigit():
        raise TrayFormatError(
            f"tray phai co dang 'tray-<n>' voi n la so, nhan duoc: {tray!r}"
        )
    return so


def lenh_in(
    pdf_path: str,
    printer: str,
    paper_size: str,
    tray: str,
    sumatra_path: str = SUMATRA_EXE,
) -> list[str]:
    """Dung argv de goi SumatraPDF in file pdf_path qua printer.

    Vi du: lenh_in("a.pdf", "HP LaserJet", "A5", "tray-2")
      -> [SUMATRA, "-print-to", "HP LaserJet",
          "-print-settings", "paper=A5,bin=2", "-silent", "a.pdf"]
    """
    binso = _tray_to_bin(tray)
    print_settings = f"paper={paper_size},bin={binso}"
    return [
        sumatra_path,
        "-print-to",
        printer,
        "-print-settings",
        print_settings,
        "-silent",
        pdf_path,
    ]


def _ghi_pdf_tam(pdf_bytes: bytes, thu_muc: Optional[str] = None) -> str:
    """Ghi pdf_bytes ra file .pdf tam, tra ve duong dan."""
    ten_file = f"in-{uuid.uuid4().hex}.pdf"
    if thu_muc:
        Path(thu_muc).mkdir(parents=True, exist_ok=True)
        duong_dan = os.path.join(thu_muc, ten_file)
    else:
        duong_dan = os.path.join(tempfile.gettempdir(), ten_file)
    with open(duong_dan, "wb") as f:
        f.write(pdf_bytes)
    return duong_dan


def _dang_dry_run() -> bool:
    return os.environ.get(DRY_RUN_ENV_VAR) == "1"


def in_pdf(
    pdf_bytes: bytes,
    printer: str,
    paper_size: str,
    tray: str,
    sumatra_path: str = SUMATRA_EXE,
    copies: int = 1,
) -> KetQuaIn:
    """In pdf_bytes qua SumatraPDF (hoac ghi file neu DRY_RUN=1).

    - Ghi pdf_bytes ra file tam.
    - Neu AGENT_DRY_RUN=1: KHONG goi subprocess that, chi ghi file ra
      thu muc AGENT_DRY_RUN_DIR (mac dinh 'dry-run-output') de test
      duoc tren moi may khong can SumatraPDF / may in that.
    - Nguoc lai: goi subprocess SumatraPDF that (copies lan, vi
      SumatraPDF CLI khong co co --copies chuan nen ta lap lenh).
    """
    if copies < 1:
        return KetQuaIn(ok=False, loi=f"copies phai >= 1, nhan duoc {copies}")

    if _dang_dry_run():
        thu_muc = os.environ.get(DRY_RUN_OUTPUT_DIR_ENV_VAR, DEFAULT_DRY_RUN_DIR)
        try:
            duong_dan = _ghi_pdf_tam(pdf_bytes, thu_muc=thu_muc)
        except OSError as e:
            return KetQuaIn(ok=False, loi=f"khong ghi duoc file dry-run: {e}")
        # Van dung lenh_in de dam bao argv hop le (khong thuc thi).
        lenh_in(duong_dan, printer, paper_size, tray, sumatra_path)
        return KetQuaIn(ok=True)

    try:
        duong_dan = _ghi_pdf_tam(pdf_bytes)
    except OSError as e:
        return KetQuaIn(ok=False, loi=f"khong ghi duoc file tam: {e}")

    argv = lenh_in(duong_dan, printer, paper_size, tray, sumatra_path)

    try:
        for _ in range(copies):
            ket_qua = subprocess.run(
                argv,
                capture_output=True,
                timeout=60,
            )
            if ket_qua.returncode != 0:
                loi = ket_qua.stderr.decode(errors="replace").strip() or (
                    f"SumatraPDF thoat voi code {ket_qua.returncode}"
                )
                return KetQuaIn(ok=False, loi=loi)
    except FileNotFoundError:
        return KetQuaIn(
            ok=False,
            loi=f"khong tim thay SumatraPDF tai '{sumatra_path}'",
        )
    except subprocess.TimeoutExpired:
        return KetQuaIn(ok=False, loi="SumatraPDF timeout")
    finally:
        try:
            os.remove(duong_dan)
        except OSError:
            pass

    return KetQuaIn(ok=True)


def base64_to_bytes(pdf_base64: str) -> bytes:
    """Decode chuoi base64 (co the co prefix data URI) thanh bytes."""
    if "," in pdf_base64 and pdf_base64.strip().startswith("data:"):
        pdf_base64 = pdf_base64.split(",", 1)[1]
    return base64.b64decode(pdf_base64)
