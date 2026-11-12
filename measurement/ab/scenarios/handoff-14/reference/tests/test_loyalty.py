from shop import payments, refunds
from shop.customers import add_customer
from shop.loyalty import points_balance, redeem_points
from shop.orders import create_order


def test_spend_then_refund_never_negative():
    c = add_customer("Ana", "a@x")
    o = create_order(c.id, [("POT", 3)])
    payments.capture(o.id)
    assert redeem_points(c.id, 100) == 10_000
    refunds.refund(o.id)
    assert points_balance(c.id) == 0
