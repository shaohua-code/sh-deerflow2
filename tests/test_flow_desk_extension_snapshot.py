"""The deployed wheel must contain the same package as the product source."""

from pathlib import Path


def test_deployed_extension_snapshot_matches_source():
    root = Path(__file__).resolve().parents[1]
    source = root / "product/backend-extension/flow_desk_product_extension"
    snapshot = root / "backend/extensions/sources/flow-desk-product-extension/flow_desk_product_extension"
    files = {file.relative_to(source) for file in source.rglob("*.py")}
    assert files == {file.relative_to(snapshot) for file in snapshot.rglob("*.py")}
    for name in files:
        assert (snapshot / name).read_bytes() == (source / name).read_bytes(), name
