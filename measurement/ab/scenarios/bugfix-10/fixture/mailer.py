from customers import contact_email


def recipients(customers):
    """Newsletter addresses of subscribed customers."""
    return [contact_email(c) for c in customers if c.get("subscribed")]
