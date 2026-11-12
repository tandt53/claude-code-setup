import unittest

from payments import Order, refund


class PaymentsTest(unittest.TestCase):
    def test_full_refund(self):
        order = Order(100)
        self.assertEqual(refund(order), 100)
        self.assertEqual(order.refunded, 100)


if __name__ == "__main__":
    unittest.main()
