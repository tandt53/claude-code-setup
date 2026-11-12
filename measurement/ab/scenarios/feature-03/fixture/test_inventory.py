import unittest

from inventory import Inventory


class InventoryTest(unittest.TestCase):
    def test_total_value(self):
        inv = Inventory()
        inv.add_item("apple", 10, 2)
        inv.add_item("pear", 5, 4)
        self.assertEqual(inv.total_value(), 40)

    def test_remove(self):
        inv = Inventory()
        inv.add_item("apple", 10, 2)
        inv.remove_item("apple")
        self.assertEqual(inv.total_value(), 0)


if __name__ == "__main__":
    unittest.main()
