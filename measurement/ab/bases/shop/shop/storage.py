"""In-memory storage. One global `store`; tests reset it."""


class Store:
    def __init__(self):
        self.reset()

    def reset(self):
        self.customers = {}
        self.orders = {}
        self.events = []    # (kind, payload) in the order they happened
        self.outbox = []    # (customer_id, text) messages sent
        self._seq = 0

    def next_id(self, prefix):
        self._seq += 1
        return f"{prefix}{self._seq}"

    def emit(self, kind, **payload):
        self.events.append((kind, payload))


store = Store()
