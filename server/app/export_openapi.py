"""Emit the OpenAPI schema to a JSON file for the client type-gen step (AD-3).

Run: ``uv run python -m app.export_openapi [out_path]``
Default out: ``server/openapi.json``. ``openapi-typescript`` reads this file, so
type generation needs no running server.
"""

import json
import sys
from pathlib import Path

from app.main import app


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent.parent / "openapi.json"
    out.write_text(json.dumps(app.openapi(), indent=2) + "\n")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
