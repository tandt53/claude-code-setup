"""HTTP-ish handlers: dict in, (status, dict) out."""
from shop import payments, refunds, reports
from shop.orders import create_order


def post_order(body):
    try:
        order = create_order(body["customer_id"], [tuple(x) for x in body["lines"]], body.get("coupon"))
    except (KeyError, ValueError) as exc:
        return 400, {"error": str(exc)}
    return 201, {"order_id": order.id}


def post_capture(order_id):
    try:
        return 200, {"amount": payments.capture(order_id)}
    except (KeyError, ValueError) as exc:
        return 400, {"error": str(exc)}


def post_refund(order_id, body):
    try:
        return 200, refunds.refund(order_id, body.get("amount"))
    except (KeyError, ValueError) as exc:
        return 400, {"error": str(exc)}


def get_report():
    return 200, {"revenue": reports.revenue(), "tax": reports.tax_collected()}
