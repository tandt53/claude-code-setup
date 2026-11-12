# <Area> test design

<!-- Every case proves one requirement example. A case with no example is a
     missing example: add it to the requirement first. -->

## REQ-<AREA>-001 · <rule>
Techniques: <boundary values · decision table · …> — why these
Partitions / boundaries: <the classes and limits found>

| Example | Case | Level | Where |
|---|---|---|---|
| ex1 | <input → expected> | unit | `src/<area>/<file>.test.ts` |
| ex2 | <input → expected> | e2e | `e2e/<flow>.spec.ts` |
| ex3 | <input → expected> | manual | steps below |

### Manual: ex3
Why manual: <judged by eye / too costly now, until …>
1. <step>
2. <step>
Expected: <what to see>. Record the run in `.work/test-runs/*.json` with evidence.
