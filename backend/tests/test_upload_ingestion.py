"""Tests for Gateway-specific upload path compatibility."""

from pathlib import PureWindowsPath

from app.gateway.upload_ingestion import _max_upload_filename_bytes


def _utf16_units(value: str) -> int:
    return len(value.encode("utf-16-le")) // 2


def test_windows_filename_budget_respects_full_path_and_unicode_directory():
    uploads_dir = PureWindowsPath("C:/Users/刘少华/AppData/Local/Temp/uploads")
    max_path_chars = 120

    budget = _max_upload_filename_bytes(uploads_dir, is_windows=True, max_path_chars=max_path_chars)

    expected = max_path_chars - 2 - _utf16_units(str(uploads_dir))
    assert budget == min(255, expected)
    assert budget > 0


def test_windows_filename_budget_returns_zero_when_staging_path_cannot_fit():
    uploads_dir = PureWindowsPath("C:/" + "x" * 60)

    budget = _max_upload_filename_bytes(uploads_dir, is_windows=True, max_path_chars=70)

    assert budget == 0


def test_non_windows_filename_budget_keeps_existing_component_limit(tmp_path):
    assert _max_upload_filename_bytes("/tmp/测试/uploads", is_windows=False) == 255
