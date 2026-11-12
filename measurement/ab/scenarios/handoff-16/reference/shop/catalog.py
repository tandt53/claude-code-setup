PRODUCTS = {
    "TEA": {"name": "Green tea", "price": 50_000, "price_usd": 2.00},
    "MUG": {"name": "Mug", "price": 120_000, "price_usd": 5.00},
    "POT": {"name": "Teapot", "price": 350_000, "price_usd": 14.00},
}


def unit_price(sku, currency="VND"):
    if sku not in PRODUCTS:
        raise KeyError(f"unknown SKU {sku!r}")
    return PRODUCTS[sku]["price_usd" if currency == "USD" else "price"]
