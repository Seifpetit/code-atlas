# Bugs / Failure Log

## Connection stubs and hover tracing

1. I kept changing the stub UI instead of isolating the edge identity problem first.
2. I mixed page-local `laidOut.edges` with graph-wide `graph.edges`, which made counts and hover traces diverge.
3. I assumed React Flow would infer enough from shared endpoints, but the edge ids still had to match exactly.
4. I normalized ids after the fact instead of auditing the actual rendered edge objects end-to-end.
5. I kept applying partial fixes without proving the exact visible edge set in the browser.

## Root issue

The unresolved problem was that the rendered connections still were not matching the hover trace layer in the way the UI expected.

## Status

Code fix applied; visual verification still needed.

The trace/count/port maps now derive from `laidOut.edges`, the same visible-context
edge collection rendered by React Flow. This avoids asking stubs to trace raw
graph-wide file edge ids that are not present in the current canvas.
