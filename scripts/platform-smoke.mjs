import { readFileSync } from "node:fs";

const required = [
  "scripts/smoke.ps1",
  "scripts/windows/install.ps1",
  "scripts/windows/xiling-doctor.ps1",
  "scripts/windows/xiling-import.ps1",
  "scripts/windows/xiling-start.ps1",
  "scripts/windows/xiling-stop.ps1",
  "scripts/windows-import.sh",
  "scripts/smoke.sh",
  "scripts/xiling-start.sh",
];

for (const path of required) {
  const content = readFileSync(path, "utf8");
  if (content.includes("\r\n")) throw new Error(`${path} must use LF line endings`);
  if (content.includes("\uFFFD")) throw new Error(`${path} is not valid UTF-8`);
}

const doctor = readFileSync("scripts/windows/xiling-doctor.ps1", "utf8");
for (const check of ["wsl.exe", "docker.exe", "Get-NetTCPConnection", "Get-PSDrive", "VirtualizationFirmwareEnabled", "docker-linux", "network-config"]) {
  if (!doctor.includes(check)) throw new Error(`Windows Doctor is missing ${check}`);
}

console.log("Cross-platform entrypoint smoke: ok");
