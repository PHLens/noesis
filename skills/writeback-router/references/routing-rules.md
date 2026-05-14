# Routing Rules

Rules for classifying writeback candidate items.

## Category Rules

Use `meta` for:

- agent operating experience
- tool behavior discoveries
- workflow tips
- corrected assumptions
- user preferences
- rules that affect future agent behavior

Use `domain` for LoreForge/wiki-worthy knowledge:

- technical concepts
- facts about a subject area
- source summaries
- paper or article notes
- MOC or wiki-worthy synthesis

Use `mixed` only when:

- an item contains both meta and domain content
- splitting would lose meaning
- the boundary is uncertain

Use `transient` for:

- one-off command output
- current task chatter
- temporary file paths with no future value
- details useful only inside the current interaction

## Destination Rules

Use `pamem-experience` when `category` is `meta`.

Use `wiki-stage` when `category` is `domain`. This means "send to LoreForge's wiki staging flow"; Noesis does not stage the note itself.

Use `split` when `category` is `mixed`.

Use `none` when `category` is `transient`.

## Review Policy

Set `review_required: false` only for low-risk meta items.

Low-risk meta examples:

- tool behavior discovery
- environment path or CLI default behavior
- clear corrected assumption
- low-risk workflow tip

Set `review_required: true` for:

- user preference
- rule or workflow change
- item that supersedes old experience
- domain/wiki content
- `mixed/split` item
- low-confidence item
- anything that significantly changes long-term agent behavior

## Suggested Action Rules

Use `append-experience` for low-risk or approved meta items.

Use `stage-wiki-note` for domain items that should enter LoreForge wiki staging.

Use `split-item` for mixed items that need decomposition.

Use `discard` for transient items.

Use `request-review` when confidence is low or policy requires human approval before action.

## Mixed Handling

Split mixed content by default.

Example split:

- `meta`: "The agent should refresh a plugin marketplace before plugin update."
- `domain`: "LoreForge should stage domain knowledge before promotion."

Use `mixed/split` only when a safe split is not clear.

## Error Handling

When uncertain:

```json
{
  "confidence": "low",
  "review_required": true,
  "suggested_action": "request-review"
}
```

When mixed and unsafe to split:

```json
{
  "category": "mixed",
  "destination": "split",
  "suggested_action": "split-item",
  "review_required": true
}
```

When not durable:

```json
{
  "category": "transient",
  "destination": "none",
  "suggested_action": "discard"
}
```
