# Pressure Rules Spec

This spec translates Gerard J. Holzmann's "The Power of 10: Rules for Developing Safety-Critical Code" into Code Atlas product language.

The source paper is engineering context, not the user-facing product model. Code Atlas should guide users toward code that is easier to inspect, bound, reason about, and change. It should not become a NASA compliance dashboard.

## Product Position

Code Atlas leads with pressure.

The graph says:
- Look here.

The metadata panel says:
- Here is why.

The pressure analysis flow says:
- Here is what the pressure means.
- Here is how it could move.
- Here is the impact of reducing it.

The Power of 10 rules are evidence behind pressure signals. They are not the headline.

Use:
- Large Function
- High Complexity
- Responsibility Overlap
- Dependency Concentration
- Orchestration Hub
- Function Sprawl
- State Pressure

Avoid leading with:
- Rule 4 violation
- Rule 6 violation
- Rule 10 failed
- Compliance score

## Current Panel Contract

For a focused file, the panel hierarchy is:

1. Pressure
2. Structure

Pressure is the primary reason the user was brought to the file.

Structure explains what the file is: name, path, source actions, wires, file metrics, role, functions, imports, and dependency count.

There is no standalone Health section. Health-style evidence can still contribute to pressure internally, but it should not compete as a separate top-level panel concept.

## Pressure Section

The Pressure section owns the signal.

Requirements:
- It appears first.
- It contains the pulsing pressure dot.
- It lists compact active signals.
- It opens Pressure Analysis.
- It contains Engineering Basis as a secondary expandable surface.

Example:

```text
PRESSURE *

3 Active Signals

- Large Function
- Responsibility Overlap
- High Complexity

[Pressure Analysis]

Engineering Basis
```

The pressure dot and graph pulse represent the same signal. If a file pulses on the graph, the panel must show the matching pressure owner.

## Engineering Basis

Engineering Basis is secondary evidence.

It can show rule references, but only after the user has seen the pressure problem first.

Example:

```text
Engineering Basis

Watch Rule 4  Function length      84 line function
OK    Rule 6  Narrow scope         Responsibilities contained
Watch Rule 7  Interface checks     18 dependencies
OK    Rule 10 Static analysis      No analyzer pressure
```

Rules should appear as basis, not blame.

Use:
- Rule 4 supports the Large Function signal.
- Rule 6 supports Responsibility Overlap and State Pressure.
- Rule 7 supports Dependency Concentration and Orchestration Hub.
- Rule 10 supports analyzer-driven pressure and zero-warning expectations.

Avoid:
- Red violation tables.
- Compliance percentages.
- "NASA says" framing.
- Full rule text in the panel.

## Pressure Analysis Flow

Pressure Analysis remains the primary investigation workflow.

Pages:

1. Pressure
   - What signal is active?
   - How strong is it?
   - Which compact signals explain it?

2. Simulation
   - How could pressure move if responsibilities were separated?
   - Show projected smaller surfaces.
   - Treat the graph preview as a projection, not an automatic refactor.

3. Impact
   - What improves if pressure is reduced?
   - Examples: review surface, change isolation, dependency clarity, AI edit risk, context required.

The flow should feel like:

```text
Problem
-> Investigation
-> Analysis
```

Not:

```text
Rule list
-> Score
-> More rule list
```

## Power of 10 Mapping

The following mappings define how Code Atlas should interpret the rules.

### Rule 1: Simple Control Flow

Engineering intent:
- Keep control flow simple enough to analyze.
- Avoid recursion and unstructured jumps that make execution paths hard to bound.

Code Atlas language:
- High Complexity
- Orchestration Hub
- Runaway Flow

UI guidance:
- Surface as pressure when functions have high branch complexity, broad call spread, or recursive-looking call structure.
- Show the problem as "hard to follow" or "large orchestration path", not as a control-flow citation.

### Rule 2: Bounded Loops

Engineering intent:
- Loops should have statically understandable bounds.
- Unbounded execution is pressure because it weakens predictability.

Code Atlas language:
- Runaway Loop Risk
- Execution Bound Pressure
- Runtime Uncertainty

UI guidance:
- If loop analysis exists, report it as runtime or complexity pressure.
- Do not require users to read loop-bound proofs in the metadata panel.

### Rule 3: No Dynamic Allocation After Initialization

Engineering intent:
- Reduce unpredictable memory behavior.
- Keep resource usage bounded and easier to verify.

Code Atlas language:
- Resource Pressure
- Allocation Hotspot
- Runtime Uncertainty

UI guidance:
- For languages where this applies directly, treat late allocation patterns as runtime pressure.
- For managed languages, translate the spirit into unbounded growth, cache expansion, uncontrolled object creation, or lifecycle complexity.

### Rule 4: Short Functions

Engineering intent:
- A function should fit in one understandable review unit.
- Long functions are harder to verify as logical units.

Code Atlas language:
- Large Function
- Review Surface
- Function Sprawl

UI guidance:
- This is one of the strongest Code Atlas pressure sources.
- Lead with "Large Function".
- Put "Rule 4" only in Engineering Basis.

### Rule 5: Assertion Density

Engineering intent:
- Critical assumptions should be checked.
- Assertions make anomalous states explicit and testable.

Code Atlas language:
- Missing Guardrails
- Weak Boundary Checks
- Assumption Pressure

UI guidance:
- If static extraction can detect defensive checks, show lack of checks as pressure near risky inputs, outputs, or state transitions.
- Do not make assertion count a dashboard metric unless it directly explains an active pressure signal.

### Rule 6: Smallest Possible Scope

Engineering intent:
- Keep data visible only where it is needed.
- Smaller scope reduces accidental mutation and diagnostic cost.

Code Atlas language:
- Responsibility Overlap
- State Pressure
- Scope Spread

UI guidance:
- Surface when a file or function owns too many concerns, state surfaces, or mutable paths.
- Prefer "Responsibility Overlap" over "scope violation".

### Rule 7: Check Returns and Validate Parameters

Engineering intent:
- Interfaces must defend their boundaries.
- Callers should not ignore meaningful results.

Code Atlas language:
- Interface Pressure
- Dependency Concentration
- Orchestration Hub

UI guidance:
- Use this as basis when a file has broad fan-in/fan-out, many calls, or complex boundary behavior.
- The user sees "Dependency Concentration" or "Orchestration Hub" first.

### Rule 8: Restrict Preprocessor Use

Engineering intent:
- Avoid code generation and conditional compilation patterns that obscure what code exists.
- Reduce the number of variants that must be reasoned about.

Code Atlas language:
- Hidden Variant Pressure
- Conditional Surface
- Analysis Blind Spot

UI guidance:
- For C/C++ repositories, macro and conditional compilation complexity should become pressure.
- For JS/TS/Python, apply the spirit to build-time indirection, generated code, environment gates, and opaque configuration switches.

### Rule 9: Restrict Pointer Use

Engineering intent:
- Keep data flow understandable to people and tools.
- Avoid indirection that blocks static reasoning.

Code Atlas language:
- Indirection Pressure
- Data Flow Ambiguity
- Analysis Blind Spot

UI guidance:
- In pointer-heavy languages, expose deep indirection as pressure.
- In JS/TS/Python, translate to dynamic dispatch, opaque callbacks, reflection, monkey patching, or unresolved function routing.

### Rule 10: Zero Warnings and Static Analysis

Engineering intent:
- Compile with strict warnings.
- Run static analyzers.
- Treat analyzer confusion as a reason to rewrite unclear code.

Code Atlas language:
- Analyzer Pressure
- Static Signal
- Unclear Surface

UI guidance:
- Rule 10 supports the idea that pressure should be mechanically detectable.
- Code Atlas should prefer verifiable signals over vibes.
- If a detector cannot explain a signal compactly, it should not dominate the UI.

## Detection Principles

Pressure signals should be:

- Compact: a few words, not paragraphs.
- Mechanical: derived from code structure, metrics, history, or relationships.
- Explainable: every signal can point to evidence.
- Secondary-rule-backed: rules can support a signal without becoming the signal.
- Actionable: the next step is inspect, trace wires, or run Pressure Analysis.

Pressure signals should not be:

- A moral judgment.
- A certification claim.
- A generic health score.
- A table of violations.
- A raw dump of static analyzer output.

## UI Language Rules

Use Code Atlas language in primary UI:

- Pressure
- Signal
- Surface
- Review surface
- Responsibility
- Wires
- Structure
- Projection
- Impact
- Evidence

Use rule language only in secondary UI:

- Engineering Basis
- Rule 4
- Rule 6
- Rule 7
- Rule 10

Never make the first screen say:

- NASA compliance
- Certification
- Violation
- Pass/fail
- Safety-critical score

## UX Contract

When a user clicks a flagged file:

1. They see Pressure first.
2. The pulsing dot owns the signal.
3. They see compact reasons before tools.
4. They can open Pressure Analysis.
5. Structure comes next and contains Inspect Code and Wires.
6. Engineering Basis is available but secondary.
7. The experience stays exploratory, not punitive.

## Future Work

Potential detectors:

- Function span over a review-unit threshold.
- Max cyclomatic or cognitive complexity.
- Concern count per file or function.
- Fan-in and fan-out concentration.
- State mutation concentration.
- Recursive or cyclic call paths.
- Unbounded loop patterns.
- Generated or conditional variant surfaces.
- Dynamic dispatch or unresolved call targets.
- Missing boundary checks around high-pressure interfaces.

Potential UI additions:

- Inline evidence chips inside Pressure Analysis.
- Engineering Basis drawer with only active supporting rules.
- Source modal annotations for exact pressure evidence lines.
- Wires view filtered to pressure-relevant relationships.
- Simulation page that previews pressure redistribution without claiming to refactor automatically.

