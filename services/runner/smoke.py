from __future__ import annotations

import json
import tempfile
from pathlib import Path

from xiling_runner import create_fixture, run_analysis


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="xiling-runner-smoke-") as directory:
        root = Path(directory)
        fixture = create_fixture(root / "fixture.nc")
        result = run_analysis(fixture, root / "output")
        crate = Path(str(result["roCrate"]))
        assert crate.exists(), "RO-Crate metadata was not generated"
        assert len(result["outputs"]) == 2, "expected CSV and PNG artifacts"
        assert (root / "output" / "sst-anomaly.csv").read_text(encoding="utf-8").count("\n") == 13
        print(json.dumps({"status": "ok", "artifacts": 2, "roCrate": crate.name}))


if __name__ == "__main__":
    main()
