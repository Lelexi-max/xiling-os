from __future__ import annotations

import json
import tempfile
from pathlib import Path

from xiling_runner import create_argo_fixture, inspect_argo_dataset, run_argo_analysis


PLAN = {
    "id": "plan-argo-offline-smoke",
    "variables": ["TEMP", "PSAL", "PRES", "POSITION_QC"],
    "region": {"west": 132, "east": 150, "south": 12, "north": 30},
    "depth": {"min": 0, "max": 150},
    "time": {"start": "2023-07-01", "end": "2023-08-31"},
}


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="xiling-ocean-") as directory:
        root = Path(directory)
        fixture = create_argo_fixture(root / "argo-fixture.nc")
        metadata = inspect_argo_dataset(fixture)
        assert metadata["dimensions"] == {"N_PROF": 8, "N_LEVELS": 21}
        assert set(metadata["variables"]) >= {"TEMP", "PSAL", "PRES", "POSITION_QC"}
        result = run_argo_analysis(fixture, PLAN, root / "output")
        assert result["review"]["verdict"] == "accepted"
        assert len(result["outputs"]) == 6
        assert Path(str(result["roCrate"])).exists()
        print(json.dumps({"status": "ok", "profiles": 8, "artifacts": 6, "review": "accepted"}))


if __name__ == "__main__":
    main()
