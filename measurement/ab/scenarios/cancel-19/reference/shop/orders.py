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


def cancel_order(order_id):
    """Cancel an order. A paid one is refunded what remains, through the refund
    path (notification, VAT reversal), so reports stop counting it."""
    from shop import refunds  # refunds imports this module
    order = get_order(order_id)
    if order.status in ("cancelled", "refunded"):
        raise ValueError(f"order {order_id} has nothing left to cancel: {order.status}")
    if order.status in ("paid", "partially_refunded"):
        refunds.refund(order_id)
    order.status = "cancelled"
    store.emit("cancelled", order_id=order_id)
    return order
