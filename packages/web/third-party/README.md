Offline map data: `src/geo/world.json` is derived from `map/json/world.json`
in the npm archive `echarts@4.9.0`. The accompanying `map/js/world.js` explicitly
licenses that same map under Apache-2.0. The archive's LICENSE and NOTICE are
retained here; neither its runtime nor its dependencies are included.

Original JSON SHA-256: `049b334579e5a42d5d16c72d014d380e048e39fc1504049f212acb589484d2fa`.
Changes: coordinates rounded to two decimal degrees; every fourth vertex retained
for rings longer than 16 vertices; rings closed; empty country names omitted;
unused properties removed. 215 features. This is an overview map, with historical
boundaries and source country names, not a current political-boundary reference.
No tiles, API keys, geocoding services, or network requests are used at runtime.

License verification was performed against the installed archive, including the
map-specific Apache header. Other candidate datasets were inspected in a temporary
directory and excluded because their data/software licenses did not meet the
project's requirements. No dependency was added to the workspace.
