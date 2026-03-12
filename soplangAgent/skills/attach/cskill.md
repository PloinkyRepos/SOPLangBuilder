# attach

### Summary
Builds and returns a media attachment object from the provided key/value pairs (`id`, `path`, `volume`, `loop`, `start`, `end`, etc.) so the Soplang `attach` command can store the resulting payload as the variable value.

## Input Format
Provide a JSON object as `input`. Example:

```json
{
  "id": "blob-id",
  "name": "hero.png",
  "width": 1024,
  "height": 768,
  "duration": 3
}
```

## Output Format
Returns the normalized attachment payload as a JSON object.
