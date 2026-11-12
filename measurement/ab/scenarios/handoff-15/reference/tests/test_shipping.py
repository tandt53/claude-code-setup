from shop.models import Order
from shop.shipping import shipping_fee


def order(lines, coupon=None):
    return Order(id="x", customer_id="c", lines=lines, coupon=coupon)


def test_free_from_500k_inclusive_and_remote_never_free():
    assert shipping_fee(order([("TEA", 10)]), "HN") == 0
    assert shipping_fee(order([("TEA", 10)]), "HG") == 50_000


def test_express_on_top():
    assert shipping_fee(order([("TEA", 10)]), "HN", express=True) == 40_000
