from shop.models import Customer
from shop.storage import store


def add_customer(name, email):
    c = Customer(id=store.next_id("C"), name=name, email=email)
    store.customers[c.id] = c
    return c


def get_customer(customer_id):
    return store.customers[customer_id]
