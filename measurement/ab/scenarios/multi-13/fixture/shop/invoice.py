"""The invoice a customer downloads."""
from shop.catalog import PRODUCTS
from shop.money import fmt, round_money
from shop.orders import get_order
from shop.pricing import price, subtotal
from shop.tax import VAT_RATE


def invoice(order_id):
    order = get_order(order_id)
    p = price(order)
    sub = subtotal(order.lines)
    tax = round_money(sub * VAT_RATE)  # VAT on the listed prices
    lines = [f'{PRODUCTS[sku]["name"]} x{qty}' for sku, qty in order.lines]
    return {"order_id": order_id, "lines": lines, "subtotal": sub,
            "discount": p["discount"], "tax": tax, "total": p["total"],
            "text": f"Total {fmt(p['total'])} (VAT {fmt(tax)})"}
