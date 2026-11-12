# Task: USD orders

We are opening to customers in the US, so orders can now be in US dollars.
`shop/catalog.py` already has each product's USD price (`price_usd`). Add USD
orders: `create_order(..., currency="USD")`. VND stays the default.

Add it and run the tests.
