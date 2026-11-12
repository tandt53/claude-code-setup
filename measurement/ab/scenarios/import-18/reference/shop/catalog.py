"""Products for sale, by SKU."""

PRODUCTS = {
    "TEA": {"name": "Green tea", "price": 50_000},
    "MUG": {"name": "Mug", "price": 120_000},
    "POT": {"name": "Teapot", "price": 350_000},
}


def unit_price(sku):
    if sku not in PRODUCTS:
        raise KeyError(f"unknown SKU {sku!r}")
    return PRODUCTS[sku]["price"]


def import_products(csv_text):
    """Add or update products from 'sku,name,price' lines. All or nothing: a bad
    line raises ValueError naming its line number and nothing is imported."""
    rows = []
    for n, line in enumerate(csv_text.splitlines(), 1):
        if not line.strip():
            continue
        parts = [p.strip() for p in line.split(",")]
        if len(parts) != 3 or not parts[2].isdigit():
            raise ValueError(f"line {n}: expected sku,name,price with a whole price, got {line!r}")
        rows.append((parts[0], parts[1], int(parts[2])))
    for sku, name, price in rows:
        PRODUCTS[sku] = {"name": name, "price": price}
    return len(rows)
