"""Hidden checks for account-05, one per point of spec.md. Never shown to the agent.

`checks(mod)` gets the agent's imported module and returns {name: bool}.
`CORE` names the unstated case that matters most (spec point 2): an overdraft
raises and leaves the balance as it was.
"""

CORE = "overdraft_raises_balance_kept"


def checks(mod):
    out = {}

    def run(name, fn):
        try:
            out[name] = bool(fn())
        except Exception:
            out[name] = False

    def named():
        acc = mod.Account()
        acc.deposit(100)
        acc.withdraw(30)
        return acc.balance == 70

    def overdraft():
        acc = mod.Account()
        if not callable(getattr(acc, "withdraw", None)):
            return False
        acc.deposit(100)
        try:
            acc.withdraw(200)
        except (AttributeError, TypeError, NameError):
            return False
        except Exception:
            return acc.balance == 100
        return False

    def nonpositive():
        for bad in (0, -5):
            acc = mod.Account()
            if not callable(getattr(acc, "withdraw", None)):
                return False
            acc.deposit(100)
            try:
                acc.withdraw(bad)
            except (AttributeError, TypeError, NameError):
                return False
            except Exception:
                if acc.balance != 100:
                    return False
                continue
            return False
        return True

    def existing():
        acc = mod.Account()
        acc.deposit(100)
        acc.deposit(50)
        return acc.balance == 150

    run("withdraw_reduces_balance", named)
    run(CORE, overdraft)
    run("nonpositive_amount_raises", nonpositive)
    run("existing_behaviour_kept", existing)
    return out
