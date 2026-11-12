"""The invoice a customer downloads."""
from shop.money import fmt
from shop.orders import get_order
from shop.pricing import price, COUPONS
from shop.catalog import PRODUCTS


def invoice(order_id):
    order = get_order(order_id)
    p = price(order)
    lines = [f'{PRODUCTS[sku]["name"]} x{qty}' for sku, qty in order.lines]
    return {"order_id": order_id, "lines": lines, "subtotal": p["subtotal"],
            "discount": p["discount"], "tax": p["tax"], "total": p["total"],
            "text": f"Total {fmt(p['total'])} (VAT {fmt(p['tax'])})"}
