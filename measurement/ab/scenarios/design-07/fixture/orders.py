def list_orders(orders):
    """Orders newest first. orders: list of dicts with "id" and "created" (ISO date)."""
    return sorted(orders, key=lambda o: o["created"], reverse=True)
