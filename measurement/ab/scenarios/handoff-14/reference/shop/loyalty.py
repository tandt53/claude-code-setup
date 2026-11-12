"""Loyalty points: 1 per full 10,000 VND of taxable amount, earned at capture,
taken back in proportion to refunds; spent in hundreds at 100 VND a point.
The balance never goes negative."""
from shop.pricing import price
from shop.storage import store

PER_POINT = 10_000
VND_PER_POINT = 100


def order_points(order):
    if order.paid <= 0:
        return 0
    earned = price(order)["taxable"] // PER_POINT
    return earned * (order.paid - order.refunded) // order.paid


def _spent(customer_id):
    return sum(ev["points"] for kind, ev in store.events if kind == "points_redeemed"
               and ev["customer_id"] == customer_id)


def points_balance(customer_id):
    earned = sum(order_points(o) for o in store.orders.values() if o.customer_id == customer_id)
    return max(0, earned - _spent(customer_id))


def redeem_points(customer_id, points):
    if points <= 0 or points % 100:
        raise ValueError("points are spent in multiples of 100")
    if points > points_balance(customer_id):
        raise ValueError("not enough points")
    store.emit("points_redeemed", customer_id=customer_id, points=points)
    return points * VND_PER_POINT
