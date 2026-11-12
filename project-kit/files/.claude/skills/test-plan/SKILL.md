---
name: test-plan
description: Plans the testing for a release, a large feature or a risky change - scope, ranked risks, levels, environments and data, entry and exit criteria, who decides go / no-go - in .work/test-plans. Use when testing spans several tasks or people, or when the user asks for a test plan.
when_to_use: test plan, test strategy, how do we test this release, QA plan, exit criteria, go / no-go, regression scope
---

# Test plan

A test plan decides where testing effort goes, and says in advance what
"ready to release" means, so the decision is not made under pressure at the
end. One task needs no plan: its spec and trace-check are enough.

## Workflow

```
Test plan <name>:
- [ ] 1. Scope: REQ ids in, and out with why
- [ ] 2. Risks ranked by cost of failure x likelihood
- [ ] 3. Levels and approach per risk; what is manual and why; what regression reruns
- [ ] 4. Environments and data; no real personal data
- [ ] 5. Entry criteria
- [ ] 6. Exit criteria, each checkable (trace-check --strict, open bugs, manual evidence)
- [ ] 7. Who does what, who decides go / no-go
- [ ] 8. Approved; approval recorded in the plan
```

## Start when

Testing will span several tasks, people, or a risky release, and the scope — which
requirements are in and which are out — can be named. A single task needs no plan;
its spec and trace-check are enough.

## Steps

1. **Scope**: the requirements in (REQ ids) and out, and why out.
2. **Risks**, ranked by cost of failure × likelihood: money, data loss,
   security, many users, code changed often, areas with past bugs (lessons,
   incidents). The ranking decides depth.
3. **Levels and approach** per risk: which levels, which techniques
   (`test-design`), what is manual and why, what regression is rerun.
4. **Environments and data**: where tests run, what data they need, how it
   is made and reset. Real personal data is never copied into tests.
5. **Entry criteria**: what must be true to start (build deploys, examples
   confirmed, test data ready).
6. **Exit criteria**, checkable, for example:
   - `trace-check --strict` exits 0 for the scope
   - no open bug of severity high or above in scope
   - manual runs recorded with evidence
7. **Who** does what, and who decides go / no-go.
8. Present the plan for approval; record the approval in it.

## File

`.work/test-plans/<yyyy-mm-dd>-<name>.md`. It is work, not product: when the
release is done the plan stays as the record, and lasting cases have moved
into `docs/product/test-cases/`.

## Report at the end

Against the exit criteria: met, not met (with the evidence). A criterion not
met is either fixed or explicitly waived by the person who decides, with the
reason, never quietly dropped.
