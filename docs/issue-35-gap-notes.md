# Issue #35: P2 polish

Branch `work/issue-35-p2-polish` starts at published master `a91cd789`.
The reboot left no completed issue checkpoints and one baseline browser script.
All six items were inspected against that unchanged starting point. The run
brief is the polish contract; `SOLUTION_DESIGN.md` remains unchanged.

## Baseline audit

1. Author rendered two JSON export buttons and two .qs download buttons when
   File was open. Confirmed in Chromium against the actual local API and Vite.
2. Definition previews displayed the circular `◌` loading-like symbol even
   when settled. The symbol had no CSS animation, but conveyed waiting.
3. Local uploads/prep already work through #29; #33 routes local deterministic
   O through dataset queries. `/api/o/*` remains reserved for hosted O. The
   fixture-only library API and the default CLI local workspace are distinct.
4. `Definition explorer` is absent from `packages/web/src`; the browser header
   reads OpenSight, product navigation and the current page title after #31.
5. TotalDeathByCountry has no attached rows. Local preview already hides O;
   offline preview still showed O while silently answering against sales.
   A browser question returned synthetic East 500 / West 400 under that heading.
6. First-run local Author showed `No successful refresh recorded`. #32 replaced
   the old restore path in Author, but unreadable legacy storage could still
   expose validation/JSON diagnostics. Source recovery already supplies retry,
   re-upload and reconnect controls and must retain them.

## Checkpoints

- **1 — Fixed:** File is the single home for Export JSON and Download .qs.
  Their existing handlers, disabled states and export explanation remain.
  Author and bundle UI tests: 15 passed, 0 failed, 0 skipped. The browser
  acceptance script checks DOM counts and real downloads in local/static modes.
