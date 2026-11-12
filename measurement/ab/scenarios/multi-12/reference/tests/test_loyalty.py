from shop import payments, refunds
from shop.customers import add_customer
from shop.loyalty import points_balance
from shop.orders import create_order


def test_points_at_capture_and_back_on_refund():
    c = add_customer("Ana", "ana@example.com")
    o = create_order(c.id, [("TEA", 2)])
    assert points_balance(c.id) == 0
    payments.capture(o.id)
    assert points_balance(c.id) == 10
    refunds.refund(o.id, 54_000)
    assert points_balance(c.id) == 5
