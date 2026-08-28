from __future__ import annotations

import csv
import hashlib
import json
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import xarray as xr
from rocrate.rocrate import ROCrate


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def create_fixture(path: Path) -> Path:
    times = pd.date_range("2023-01-01", periods=12, freq="MS")
    lat = np.array([10.0, 15.0, 20.0])
    lon = np.array([130.0, 135.0, 140.0, 145.0])
    month = np.arange(12, dtype=float)[:, None, None]
    values = 26.0 + month * 0.1 + lat[None, :, None] * 0.01 + lon[None, None, :] * 0.001
    values[3, 1, 2] = np.nan
    values[8, 2, 3] += 2.5
    dataset = xr.Dataset(
        {"sst": (("time", "lat", "lon"), values, {"units": "degree_Celsius", "standard_name": "sea_surface_temperature"})},
        coords={"time": times, "lat": lat, "lon": lon},
        attrs={"Conventions": "CF-1.10", "title": "Xi Ling OS smoke SST fixture"},
    )
    dataset.to_netcdf(path)
    return path


def run_analysis(input_path: Path, output_dir: Path) -> dict[str, object]:
    output_dir.mkdir(parents=True, exist_ok=True)
    with xr.open_dataset(input_path) as dataset:
        subset = dataset.sst.sel(lat=slice(10, 20), lon=slice(130, 145))
        anomaly = subset - subset.mean("time", skipna=True)
        summary = anomaly.mean(("lat", "lon"), skipna=True)
        csv_path = output_dir / "sst-anomaly.csv"
        with csv_path.open("w", newline="", encoding="utf-8") as stream:
            writer = csv.writer(stream, lineterminator="\n")
            writer.writerow(["time", "sst_anomaly_c"])
            for time, value in zip(summary.time.values, summary.values, strict=True):
                writer.writerow([str(time)[:10], f"{float(value):.8f}"])

        image_path = output_dir / "sst-anomaly.png"
        figure, axis = plt.subplots(figsize=(7, 3.5))
        axis.plot(summary.time.values, summary.values, color="#138474", marker="o")
        axis.axhline(0, color="#789097", linewidth=0.8)
        axis.set(title="Regional SST anomaly", ylabel="°C")
        figure.tight_layout()
        figure.savefig(image_path, dpi=120)
        plt.close(figure)

    manifest = {
        "input": {"path": input_path.name, "sha256": sha256(input_path)},
        "outputs": [
            {"path": csv_path.name, "sha256": sha256(csv_path)},
            {"path": image_path.name, "sha256": sha256(image_path)},
        ],
        "operation": "regional SST anomaly with skipna climate mean",
    }
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    crate = ROCrate()
    crate.name = "Xi Ling OS SST analysis"
    crate.description = "Reproducible smoke analysis generated inside the scientific runner."
    crate.add_file(str(input_path), properties={"name": input_path.name, "sha256": sha256(input_path)})
    for artifact in (csv_path, image_path, manifest_path):
        crate.add_file(str(artifact), properties={"name": artifact.name, "sha256": sha256(artifact)})
    crate_dir = output_dir / "ro-crate"
    crate.write(crate_dir)

    return {**manifest, "roCrate": str(crate_dir / "ro-crate-metadata.json")}
