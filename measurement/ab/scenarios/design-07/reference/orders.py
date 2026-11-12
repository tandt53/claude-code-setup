def list_orders(orders):
    return sorted(orders, key=lambda o: o["created"], reverse=True)


def paginate_orders(orders, page=1, page_size=20):
    if page < 1 or page_size < 1:
        raise ValueError("page and page_size must be >= 1")
    page_size = min(page_size, 100)
    ordered = list_orders(orders)
    start = (page - 1) * page_size
    return {"items": ordered[start:start + page_size], "page": page,
            "page_size": page_size, "total": len(ordered)}
