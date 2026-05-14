# Writeback Intent Schema

Authoritative schema for `writeback-router` batch intent artifacts.

The schema is owned by Noesis. Downstream execution is owned by `pamem` for memory items and `LoreForge` for wiki items.

## Artifact Path

```text
.writeback/intents/YYYY-MM-DDTHH-MM-SSZ__writeback.json
```

## Batch Object

Required fields:

```json
{
  "schema_version": "0.1",
  "intent_id": "2026-04-27T15-30-00Z__writeback",
  "created_at": "2026-04-27T15:30:00Z",
  "workspace": "/home/cambricon/noesis-agent",
  "task_summary": "Design the first version of the writeback-router skill.",
  "source_refs": [
    {
      "type": "file",
      "ref": "docs/architecture.md",
      "summary": "Noesis architecture document that defines the learning control plane boundary."
    }
  ],
  "items": []
}
```

Rules:

- `schema_version` is required.
- `intent_id` is required and should be unique within `.writeback/intents/`.
- `created_at` is required and should use ISO-8601 format.
- `workspace` is required and must be an absolute path.
- `task_summary` is required and should be short.
- `source_refs` is required and may be an empty array.
- `items` is required and must contain at least one item in a real intent.
- `agent` is intentionally omitted.

## Source Reference Object

Required fields:

```json
{
  "type": "conversation",
  "ref": "current-session",
  "summary": "User approved the writeback-router design."
}
```

Allowed `type` values:

- `conversation`
- `file`
- `url`
- `note`

Do not store full transcripts in `summary`.

## Item Object

Required fields:

```json
{
  "id": "item-1",
  "title": "Claude plugin update scope behavior",
  "summary": "The Claude plugin update command checks user scope unless project scope is explicitly supplied.",
  "category": "meta",
  "destination": "pamem-experience",
  "confidence": "high",
  "review_required": false,
  "suggested_action": "append-experience",
  "reason": "This is a reusable tool behavior discovery that affects future plugin update workflows."
}
```

Optional fields:

```json
{
  "source_refs": [
    {
      "type": "conversation",
      "ref": "current-session",
      "summary": "The update first failed at user scope, then succeeded with project scope."
    }
  ]
}
```

## Enums

`category` values:

- `meta`
- `domain`
- `mixed`
- `transient`

`destination` values:

- `pamem-experience`
- `wiki-stage` (LoreForge wiki staging)
- `split`
- `none`

`confidence` values:

- `high`
- `medium`
- `low`

`suggested_action` values:

- `append-experience`
- `stage-wiki-note`
- `split-item`
- `discard`
- `request-review`
