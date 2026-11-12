import unittest

from export import export_rows
from mailer import recipients

ANA = {"name": "Ana", "email": " Ana@Example.com ", "subscribed": True}
BO = {"name": "Bo", "email": "bo@example.com", "subscribed": False}


class CustomersTest(unittest.TestCase):
    def test_export(self):
        self.assertEqual(export_rows([ANA, BO]), ["Ana,ana@example.com", "Bo,bo@example.com"])

    def test_recipients(self):
        self.assertEqual(recipients([ANA, BO]), ["ana@example.com"])


if __name__ == "__main__":
    unittest.main()
