# SPDX-License-Identifier: AGPL-3.0-or-later
import base64
import os
import shutil

import pytest

from inprint import (
    KetQuaIn,
    TrayFormatError,
    base64_to_bytes,
    in_pdf,
    lenh_in,
)

FAKE_PDF_BYTES = b"%PDF-1.4 fake pdf content for test\n%%EOF"


def test_lenh_in_a5_tray2():
    argv = lenh_in(
        "C:/tmp/in-abc.pdf",
        "HP LaserJet M1005",
        "A5",
        "tray-2",
        sumatra_path="SumatraPDF.exe",
    )
    assert argv == [
        "SumatraPDF.exe",
        "-print-to",
        "HP LaserJet M1005",
        "-print-settings",
        "paper=A5,bin=2",
        "-silent",
        "C:/tmp/in-abc.pdf",
    ]


def test_lenh_in_a4_tray1():
    argv = lenh_in("x.pdf", "Printer1", "A4", "tray-1")
    assert "-print-settings" in argv
    idx = argv.index("-print-settings")
    assert argv[idx + 1] == "paper=A4,bin=1"


def test_lenh_in_tray_dinh_dang_sai_nem_loi():
    with pytest.raises(TrayFormatError):
        lenh_in("x.pdf", "Printer1", "A4", "khay-so-2")


def test_lenh_in_tray_khong_co_so_nem_loi():
    with pytest.raises(TrayFormatError):
        lenh_in("x.pdf", "Printer1", "A4", "tray-")


def test_base64_to_bytes_giai_ma_dung():
    encoded = base64.b64encode(FAKE_PDF_BYTES).decode()
    assert base64_to_bytes(encoded) == FAKE_PDF_BYTES


def test_base64_to_bytes_ho_tro_data_uri_prefix():
    encoded = base64.b64encode(FAKE_PDF_BYTES).decode()
    data_uri = f"data:application/pdf;base64,{encoded}"
    assert base64_to_bytes(data_uri) == FAKE_PDF_BYTES


class TestInPdfDryRun:
    """Test in_pdf() qua DRY_RUN=1 — khong can SumatraPDF / may in that."""

    @pytest.fixture(autouse=True)
    def dry_run_dir(self, tmp_path, monkeypatch):
        thu_muc = tmp_path / "dry-run-output"
        monkeypatch.setenv("AGENT_DRY_RUN", "1")
        monkeypatch.setenv("AGENT_DRY_RUN_DIR", str(thu_muc))
        yield thu_muc

    def test_dry_run_ghi_file_pdf_dung_noi_dung(self, dry_run_dir):
        ket_qua = in_pdf(
            FAKE_PDF_BYTES,
            printer="HP LaserJet M1005",
            paper_size="A5",
            tray="tray-2",
        )
        assert ket_qua == KetQuaIn(ok=True, loi=None)

        files = list(dry_run_dir.glob("*.pdf"))
        assert len(files) == 1
        assert files[0].read_bytes() == FAKE_PDF_BYTES

    def test_dry_run_decode_base64_roi_ghi_file_dung(self, dry_run_dir):
        encoded = base64.b64encode(FAKE_PDF_BYTES).decode()
        pdf_bytes = base64_to_bytes(encoded)
        ket_qua = in_pdf(
            pdf_bytes,
            printer="P1",
            paper_size="A4",
            tray="tray-1",
        )
        assert ket_qua.ok is True
        files = list(dry_run_dir.glob("*.pdf"))
        assert files[0].read_bytes() == FAKE_PDF_BYTES

    def test_dry_run_copies_nho_hon_1_bao_loi(self, dry_run_dir):
        ket_qua = in_pdf(
            FAKE_PDF_BYTES,
            printer="P1",
            paper_size="A4",
            tray="tray-1",
            copies=0,
        )
        assert ket_qua.ok is False
        assert "copies" in ket_qua.loi


class TestInPdfSubprocessMocked:
    """Test nhanh khong-dry-run bang cach mock subprocess.run (van khong
    can may in that / khong can Windows)."""

    def test_in_pdf_goi_dung_argv_va_thanh_cong(self, monkeypatch, tmp_path):
        monkeypatch.delenv("AGENT_DRY_RUN", raising=False)
        goi_argv = {}

        class FakeCompletedProcess:
            returncode = 0
            stderr = b""

        def fake_run(argv, capture_output, timeout):
            goi_argv["argv"] = argv
            return FakeCompletedProcess()

        monkeypatch.setattr("inprint.subprocess.run", fake_run)

        ket_qua = in_pdf(
            FAKE_PDF_BYTES,
            printer="HP LaserJet M1005",
            paper_size="A5",
            tray="tray-2",
            sumatra_path="SumatraPDF.exe",
        )

        assert ket_qua.ok is True
        argv = goi_argv["argv"]
        assert argv[0] == "SumatraPDF.exe"
        assert argv[1:4] == ["-print-to", "HP LaserJet M1005", "-print-settings"]
        assert argv[4] == "paper=A5,bin=2"
        assert argv[5] == "-silent"
        # file tam da bi xoa sau khi in
        assert not os.path.exists(argv[-1])

    def test_in_pdf_sumatra_loi_tra_ve_loi(self, monkeypatch):
        monkeypatch.delenv("AGENT_DRY_RUN", raising=False)

        class FakeCompletedProcess:
            returncode = 1
            stderr = b"printer offline"

        monkeypatch.setattr(
            "inprint.subprocess.run",
            lambda *a, **k: FakeCompletedProcess(),
        )

        ket_qua = in_pdf(
            FAKE_PDF_BYTES,
            printer="P1",
            paper_size="A4",
            tray="tray-1",
        )
        assert ket_qua.ok is False
        assert "printer offline" in ket_qua.loi

    def test_in_pdf_khong_tim_thay_sumatra(self, monkeypatch):
        monkeypatch.delenv("AGENT_DRY_RUN", raising=False)

        def fake_run(*a, **k):
            raise FileNotFoundError()

        monkeypatch.setattr("inprint.subprocess.run", fake_run)

        ket_qua = in_pdf(
            FAKE_PDF_BYTES,
            printer="P1",
            paper_size="A4",
            tray="tray-1",
            sumatra_path="C:/khong-ton-tai/SumatraPDF.exe",
        )
        assert ket_qua.ok is False
        assert "SumatraPDF" in ket_qua.loi
