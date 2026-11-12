"""Messages to customers. Sent messages land in store.outbox."""
from shop.money import fmt
from shop.storage import store

TEMPLATES = {
    "paid": "Thanks {name}! We received {amount} for order {order_id}.",
    "refunded": "{name}, we refunded {amount} for order {order_id}.",
}


def send(customer_id, template, **values):
    customer = store.customers[customer_id]
    values = {k: fmt(v) if k == "amount" else v for k, v in values.items()}
    text = TEMPLATES[template].format(name=customer.name, **values)
    store.outbox.append((customer_id, text))
    return text
