from shop.models import Order
from shop.pricing import price
from shop.storage import store


def create_order(customer_id, lines, coupon=None):
    if customer_id not in store.customers:
        raise KeyError(f"unknown customer {customer_id!r}")
    if not lines:
        raise ValueError("an order needs at least one line")
    order = Order(id=store.next_id("O"), customer_id=customer_id, lines=list(lines), coupon=coupon)
    price(order)  # validates SKUs and coupon now, not at payment
    store.orders[order.id] = order
    store.emit("order_created", order_id=order.id)
    return order


def get_order(order_id):
    return store.orders[order_id]
