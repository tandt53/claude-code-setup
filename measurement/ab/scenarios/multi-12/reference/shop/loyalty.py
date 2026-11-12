"""Loyalty points: 1 per full 10,000 VND of taxable amount, earned at capture,
taken back in proportion to refunds. Derived from orders, so it can't drift."""
from shop.pricing import price
from shop.storage import store

PER_POINT = 10_000


def order_points(order):
    if order.paid <= 0:
        return 0
    earned = price(order)["taxable"] // PER_POINT
    return max(0, earned * (order.paid - order.refunded) // order.paid)


def points_balance(customer_id):
    return sum(order_points(o) for o in store.orders.values() if o.customer_id == customer_id)
