import unittest

from orders import list_orders


class OrdersTest(unittest.TestCase):
    def test_newest_first(self):
        orders = [{"id": 1, "created": "2026-01-01"}, {"id": 2, "created": "2026-03-01"},
                  {"id": 3, "created": "2026-02-01"}]
        self.assertEqual([o["id"] for o in list_orders(orders)], [2, 3, 1])


if __name__ == "__main__":
    unittest.main()
