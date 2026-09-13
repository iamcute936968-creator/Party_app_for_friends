# Watch Party — Development Rules

## Golden rule

**Small, reversible, reviewed changes only.**

This project has already been used successfully by real people, including international friends. Existing behavior must be treated as valuable.

## Before coding

For every milestone:

1. Read the relevant current source.
2. Confirm the current git branch and clean baseline.
3. Define exactly what the milestone changes.
4. Define what it explicitly does NOT change.
5. Identify rollback behavior.
6. Implement only after the design is approved.

## Agent workflow

Preferred pattern:

```text
Architecture
   ↓
Implementation
   ↓
Independent review
   ↓
Build
   ↓
Manual scenario validation
   ↓
Commit
```

Do not ask multiple agents to rewrite the same feature simultaneously.

## Model roles

### Claude Opus

Use for:

- major architecture decisions
- difficult production-level reasoning
- final architecture review
- high-risk debugging

### Claude Sonnet

Use for:

- normal feature implementation
- focused code changes
- complex but well-defined tasks

### Gemini Pro

Use for:

- independent architecture review
- independent implementation review
- finding disagreements or hidden risks

### Gemini Flash

Use for:

- fast focused implementation
- smaller investigations

### GLM / DeepSeek

Use when a second implementation/reasoning model is useful.

### CodeRabbit

Use as an additional code-review layer.

CodeRabbit is not the sole architectural authority.

## Coding restrictions

Do not:

- rewrite the whole application
- rewrite App.jsx unnecessarily
- split everything into dozens of hooks
- replace Firebase without a concrete reason
- introduce a backend without a concrete requirement
- introduce an SFU without evidence that the room-size target requires it
- change styling architecture during backend/sync work
- install dependencies without a milestone-specific reason
- modify unrelated files

## Verification

Every implementation milestone should run:

```bash
npm run build
```

Also inspect:

```bash
git status
git diff
git log --oneline -8
```

The working tree should be clean after committing.

## Review policy

For risky changes:

- implementation agent writes the code
- independent agent reviews it
- review should be read-only
- fix only findings relevant to the current milestone
- do not expand scope because a reviewer discovered unrelated technical debt

## Git policy

Use one focused commit per milestone.

Commit messages should describe the actual change, for example:

```text
fix(sync): reduce paused playback writes
```

Do not bundle unrelated cleanup into milestone commits.

## Production mindset

A feature that is theoretically cleaner but makes existing real-world usage less reliable is not an improvement.

Prefer boring, understandable, testable behavior over clever abstractions.
