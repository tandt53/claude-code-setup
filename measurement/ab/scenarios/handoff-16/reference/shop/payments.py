from shop import notifications
from shop.orders import get_order
from shop.pricing import price
from shop.storage import store


def capture(order_id):
    order = get_order(order_id)
    if order.status != "new":
        raise ValueError(f"order {order_id} is already {order.status}")
    amount = price(order)["total"]
    order.paid = amount
    order.status = "paid"
    store.emit("paid", order_id=order_id, amount=amount, currency=order.currency)
    notifications.send(order.customer_id, "paid", currency=order.currency, amount=amount, order_id=order_id)
    return amount
