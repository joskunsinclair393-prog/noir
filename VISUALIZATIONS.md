# Native chat visualizations

The website accepts validated `noir-viz` JSON fences in model replies. No HTML,
JavaScript, remote SVG, or executable mathematical expressions are accepted.
The original reply stores the blocks with the conversation; no migration is needed.

Supported types: line, bar, pie, flowchart, process, mindmap, comparison, timeline,
decision-tree, architecture, function, table. See `visualization-schema.js` for the
shared schema and model instructions. Mathematical functions support polynomials
of degree 8 or less and scaled/shifted sin, cos, exp, natural log and abs.

Limits: three blocks per answer, 24 KB per block, 100 labels, four series, 24 nodes,
40 edges and 600 table cells. Large diagrams can be expanded, zoomed and panned
with a mouse or arrow keys. SVG images and JSON data can be downloaded. Copy data
requires the browser's secure clipboard permission; Download data is the fallback.
SVG table exports abbreviate long cell strings; JSON downloads retain full values.

The schema prompt is added only to supported website chat requests that ask for a
visualization or refine an earlier diagram. Existing configured cloud adapters use
the same system instructions. Actual JSON quality depends on the selected model
and its output quota. Invalid or truncated output fails visibly. No automatic extra
model call is made to repair invalid output. Streaming text remains available;
the visualization is rendered when the completed answer validates.

Data provenance is always labelled. Supplied values are not independently verified.
Missing real data should be requested, and illustrative values must be labelled.
These labels and prompts cannot guarantee that a model never makes a factual error.

No desktop browser code, AI credentials, paid API flags, billing, entitlements or
database schemas are changed. Desktop bridge windows do not request this feature.

## Validation

Run `npm test` for schema, safety, website request, persistence and isolation tests.
With Electron available as a test runner, run:

```
electron scripts/check-visualizations.cjs
```

This runs actual website UI flows with isolated provider fixtures; it does not
verify a live model. The test reports when OS clipboard readback is unavailable.
Advanced mobile layout and touch gestures are deferred; basic overflow is checked.
