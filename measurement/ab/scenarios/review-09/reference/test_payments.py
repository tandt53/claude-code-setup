import unittest

from payments import Order, refund


class PaymentsTest(unittest.TestCase):
    def test_full_refund(self):
        order = Order(100)
        self.assertEqual(refund(order), 100)
        self.assertEqual(order.refunded, 100)

    def test_partial_refund(self):
        order = Order(100)
        self.assertEqual(refund(order, 30), 30)
        self.assertEqual(refund(order), 70)
        self.assertEqual(order.refunded, 100)

    def test_non_positive_amount_rejected(self):
        with self.assertRaises(ValueError):
            refund(Order(100), 0)


if __name__ == "__main__":
    unittest.main()
