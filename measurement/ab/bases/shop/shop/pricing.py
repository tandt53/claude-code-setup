"""What an order costs. One place computes it; everything else asks here."""
from shop.catalog import unit_price
from shop.money import round_money
from shop.tax import tax_for

COUPONS = {"SAVE10": 0.10, "SAVE20": 0.20}


def subtotal(lines):
    return sum(unit_price(sku) * qty for sku, qty in lines)


def discount(amount, coupon):
    if coupon is None:
        return 0
    if coupon not in COUPONS:
        raise ValueError(f"unknown coupon {coupon!r}")
    return round_money(amount * COUPONS[coupon])


def price(order):
    """{'subtotal', 'discount', 'taxable', 'tax', 'total'} for an order."""
    sub = subtotal(order.lines)
    disc = discount(sub, order.coupon)
    taxable = sub - disc
    tax = tax_for(taxable)
    return {"subtotal": sub, "discount": disc, "taxable": taxable, "tax": tax, "total": taxable + tax}
