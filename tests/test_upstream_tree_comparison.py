"""Git tree comparison for safe, history-independent upstream review."""

from __future__ import annotations

import pytest

from scripts.compare_upstream_trees import (
    compare_trees,
    object_format_from_oid,
    parse_ls_tree,
)


def test_parse_ls_tree_preserves_mode_type_object_and_path() -> None:
    entries = parse_ls_tree(
        b"100644 blob abc123\tREADME.md\0"
        b"100755 blob def456\tscripts/run.sh\0"
        b"160000 commit 012345\tvendor/module\0"
    )

    assert entries[b"README.md"] == ("100644", "blob", "abc123")
    assert entries[b"scripts/run.sh"] == ("100755", "blob", "def456")
    assert entries[b"vendor/module"] == ("160000", "commit", "012345")


def test_parse_ls_tree_rejects_malformed_records() -> None:
    with pytest.raises(ValueError, match="malformed git ls-tree record"):
        parse_ls_tree(b"not-a-tree-record\0")


def test_object_format_is_inferred_from_full_object_id() -> None:
    assert object_format_from_oid("a" * 40) == "sha1"
    assert object_format_from_oid("a" * 64) == "sha256"
    with pytest.raises(ValueError, match="unexpected Git object ID"):
        object_format_from_oid("not-an-object-id")


def test_compare_trees_distinguishes_content_mode_and_presence_changes() -> None:
    local = parse_ls_tree(
        b"100644 blob same\tunchanged.txt\0"
        b"100644 blob local\tchanged.txt\0"
        b"100644 blob local-only\tlocal.txt\0"
    )
    upstream = parse_ls_tree(
        b"100644 blob same\tunchanged.txt\0"
        b"100755 blob local\tchanged.txt\0"
        b"100644 blob upstream-only\tupstream.txt\0"
    )

    comparison = compare_trees(local, upstream)

    assert comparison.identical == (b"unchanged.txt",)
    assert comparison.changed == (b"changed.txt",)
    assert comparison.local_only == (b"local.txt",)
    assert comparison.upstream_only == (b"upstream.txt",)
