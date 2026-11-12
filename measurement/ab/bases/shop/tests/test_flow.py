import pytest

from shop import api, payments, refunds, reports
from shop.customers import add_customer
from shop.orders import create_order
from shop.storage import store


def paid_order(lines=(("TEA", 2),), coupon=None):
    c = add_customer("Ana", "ana@example.com")
    o = create_order(c.id, list(lines), coupon)
    payments.capture(o.id)
    return o


def test_capture_pays_total_and_notifies():
    o = paid_order()
    assert (o.status, o.paid) == ("paid", 108_000)
    assert store.outbox[-1][1] == "Thanks Ana! We received 108,000 ₫ for order O2."


def test_double_capture_rejected():
    o = paid_order()
    with pytest.raises(ValueError):
        payments.capture(o.id)


def test_partial_then_full_refund():
    o = paid_order()
    assert refunds.refund(o.id, 54_000) == {"amount": 54_000, "tax": 4_000}
    assert o.status == "partially_refunded"
    assert refunds.refund(o.id)["amount"] == 54_000
    assert o.status == "refunded"


def test_refund_cannot_exceed_paid():
    o = paid_order()
    with pytest.raises(ValueError):
        refunds.refund(o.id, 200_000)


def test_reports():
    o = paid_order()
    refunds.refund(o.id, 54_000)
    assert reports.revenue() == 54_000
    assert reports.tax_collected() == 4_000


def test_api_round_trip():
    c = add_customer("Bo", "bo@example.com")
    status, body = api.post_order({"customer_id": c.id, "lines": [["MUG", 1]]})
    assert status == 201
    assert api.post_capture(body["order_id"]) == (200, {"amount": 129_600})
    assert api.post_order({"customer_id": c.id, "lines": []})[0] == 400
