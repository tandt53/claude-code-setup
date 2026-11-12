from dataclasses import dataclass, field


@dataclass
class Customer:
    id: str
    name: str
    email: str


@dataclass
class Order:
    id: str
    customer_id: str
    lines: list            # [(sku, qty)]
    coupon: str = None
    status: str = "new"    # new -> paid -> (partially_)refunded
    paid: int = 0
    refunded: int = 0
    meta: dict = field(default_factory=dict)
