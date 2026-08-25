from __future__ import annotations

import json
import tempfile
from pathlib import Path

import xiling_runner.connectors as connectors
from xiling_runner.connectors import ConnectorError, build_erddap_subset_url, build_execution_spec, execute_download, load_argopy_data_fetcher, probe_harmony


REQUEST = {
    "connectorId": "erddap", "datasetId": "jplMURSST41", "variables": ["analysed_sst"],
    "region": {"west": 130, "east": 131, "south": 10, "north": 11},
    "depth": {"min": 0, "max": 0}, "time": {"start": "2023-07-01", "end": "2023-07-02"},
    "outputFormat": "NetCDF",
}


def main() -> None:
    first = build_execution_spec(REQUEST)
    second = build_execution_spec(REQUEST)
    assert first == second and len(first["planHash"]) == 64
    assert "password" not in json.dumps(first).lower()
    load_argopy_data_fetcher()
    with tempfile.TemporaryDirectory(prefix="xiling-connector-smoke-") as directory:
        root = Path(directory)
        fixture = root / "中文 fixture.nc"
        fixture.write_bytes(b"CDF\x01offline-connector-fixture")
        result = execute_download(REQUEST, root / "workspace with spaces", {}, fixture)
        artifact = result["outputs"][0]
        assert result["source"] == "fixture" and artifact["bytes"] == fixture.stat().st_size
        assert len(artifact["sha256"]) == 64
        try:
            build_execution_spec({**REQUEST, "region": {"west": 131, "east": 130, "south": 10, "north": 11}})
        except ConnectorError:
            pass
        else:
            raise AssertionError("invalid bounds were accepted")
        original = connectors._read_json
        connectors._read_json = lambda _url: {"services": [{"name": "subset"}]}
        try:
            harmony = probe_harmony({**REQUEST, "connectorId": "nasa-harmony"}, {"token": "never-persist-this"})
            assert harmony["estimateKind"] == "unknown" and "estimatedBytes" not in harmony
            assert "never-persist-this" not in json.dumps(harmony)
        finally:
            connectors._read_json = original

        ncml = b'''<netcdf xmlns="https://www.unidata.ucar.edu/namespaces/netcdf/ncml-2.2">
          <dimension name="time" length="2"/><dimension name="latitude" length="3"/><dimension name="longitude" length="3"/>
          <variable name="time"><attribute name="actual_range" value="1 2"/></variable>
          <variable name="latitude"><attribute name="actual_range" value="-90 90"/></variable>
          <variable name="longitude"><attribute name="actual_range" value="-180 180"/></variable>
          <variable name="analysed_sst" shape="time latitude longitude"/>
        </netcdf>'''
        subset_url = build_erddap_subset_url(REQUEST, ncml)
        assert "depth" not in subset_url and "analysed_sst" in subset_url
        assert "2023-07-01T00:00:00Z" in subset_url
    print(json.dumps({"status": "ok", "adapters": 4, "network": "disabled"}))


if __name__ == "__main__":
    main()
