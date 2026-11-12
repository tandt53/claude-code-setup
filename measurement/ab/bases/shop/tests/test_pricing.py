import pytest

from shop.models import Order
from shop.pricing import price


def test_price_without_coupon():
    p = price(Order(id="x", customer_id="c", lines=[("TEA", 2), ("MUG", 1)]))
    assert p == {"subtotal": 220_000, "discount": 0, "taxable": 220_000, "tax": 17_600, "total": 237_600}


def test_coupon_discounts_before_tax():
    p = price(Order(id="x", customer_id="c", lines=[("POT", 1)], coupon="SAVE10"))
    assert (p["discount"], p["tax"], p["total"]) == (35_000, 25_200, 340_200)


def test_unknown_coupon():
    with pytest.raises(ValueError):
        price(Order(id="x", customer_id="c", lines=[("TEA", 1)], coupon="NOPE"))
