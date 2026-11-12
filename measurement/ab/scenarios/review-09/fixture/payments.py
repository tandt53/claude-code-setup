class Order:
    """An order and how much of what was paid has been refunded, in VND."""

    def __init__(self, paid):
        self.paid = paid
        self.refunded = 0


def refund(order):
    """Refund an order in full. Returns the amount refunded."""
    amount = order.paid - order.refunded
    order.refunded = order.paid
    return amount
