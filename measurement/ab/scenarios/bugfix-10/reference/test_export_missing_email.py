import unittest

from export import export_rows
from mailer import recipients


class MissingEmailTest(unittest.TestCase):
    def test_export_shows_dash(self):
        self.assertEqual(export_rows([{"name": "Cy", "email": None}]), ["Cy,-"])

    def test_mailer_skips(self):
        self.assertEqual(recipients([{"name": "Cy", "email": None, "subscribed": True}]), [])
