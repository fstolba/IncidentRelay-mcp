# Regenerating `src/openapi/snapshot.json`

The bundled snapshot is the offline fallback catalog used when the target
IncidentRelay server's `/api/openapi.json` cannot be fetched at startup.
Regenerate it from a checkout of the IncidentRelay repo when its API changes.

```bash
# from the IncidentRelay repo root
python3 -m venv /tmp/irvenv && /tmp/irvenv/bin/pip install -r requirements.txt

cat > /tmp/ir.conf <<'CONF'
[main]
secret_key = 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
[database]
type = sqlite
path = /tmp/ir_dummy.db
CONF

INCIDENTRELAY_CONFIG_FILE=/tmp/ir.conf /tmp/irvenv/bin/python -c \
  "import json; from app.api.openapi.spec import build_openapi_spec; \
   json.dump(build_openapi_spec(), open('snapshot.json','w'), indent=2)"
```

Copy the resulting `snapshot.json` to `src/openapi/snapshot.json` in this repo, then:

```bash
npx vitest run test/curated.test.ts   # confirms every curated tool still maps to a real operationId
npx vitest run test/catalog.test.ts   # confirms the snapshot parses and has the expected operations
npm run build                          # copies the new snapshot into dist/
```

If a curated tool's `operationId` disappeared or was renamed upstream, the
contract test in `test/curated.test.ts` fails loudly — update the matching
entry in `src/tools/curated.ts` to the new id.
