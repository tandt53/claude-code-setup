import pytest

from shop import catalog


def test_bad_line_rejects_whole_import():
    with pytest.raises(ValueError, match="line 2"):
        catalog.import_products("CUP,Cup,30000\nBAD,Only two")
    assert "CUP" not in catalog.PRODUCTS
