"""Products for sale, by SKU. price is VND; price_usd is US dollars."""

PRODUCTS = {
    "TEA": {"name": "Green tea", "price": 50_000, "price_usd": 2.00},
    "MUG": {"name": "Mug", "price": 120_000, "price_usd": 5.00},
    "POT": {"name": "Teapot", "price": 350_000, "price_usd": 14.00},
}


def unit_price(sku):
    if sku not in PRODUCTS:
        raise KeyError(f"unknown SKU {sku!r}")
    return PRODUCTS[sku]["price"]
