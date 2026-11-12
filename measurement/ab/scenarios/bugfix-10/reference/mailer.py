from customers import contact_email


def recipients(customers):
    return [contact_email(c) for c in customers if c.get("subscribed") and c.get("email")]
