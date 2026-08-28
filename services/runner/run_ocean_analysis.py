from __future__ import annotations

import argparse
import json
from pathlib import Path

from xiling_runner import create_argo_fixture, run_argo_analysis


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Xi Ling OS Argo research fixture")
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--input", type=Path)
    arguments = parser.parse_args()

    arguments.workspace.mkdir(parents=True, exist_ok=True)
    plan = json.loads(arguments.plan.read_text(encoding="utf-8"))
    input_path = arguments.input if arguments.input else create_argo_fixture(arguments.workspace / "argo-fixture.nc")
    result = run_argo_analysis(input_path, plan, arguments.workspace / "artifacts")
    (arguments.workspace / "result.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"status": "ok", "review": result["review"]["verdict"]}))


if __name__ == "__main__":
    main()
