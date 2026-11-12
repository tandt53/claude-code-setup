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
    lines: list
    coupon: str = None
    status: str = "new"
    paid: float = 0
    refunded: float = 0
    meta: dict = field(default_factory=dict)
    currency: str = "VND"
