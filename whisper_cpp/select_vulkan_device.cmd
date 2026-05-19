@echo off
set "GGML_VK_VISIBLE_DEVICES="
set "VK_PROBE=%~1"

if not exist "%VK_PROBE%" (
  echo Vulkan probe missing: %VK_PROBE%
  exit /b 1
)

for /f "usebackq delims=" %%D in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$out = & '%VK_PROBE%' --help 2>&1; $devices = @($out | ForEach-Object { if ($_ -match 'ggml_vulkan:\s+(\d+)\s+=\s+(.+)$') { [pscustomobject]@{ Id = $matches[1]; Name = $matches[2] } } }); $pick = $devices | Where-Object { $_.Name -match 'Intel|Arc|Iris' } | Select-Object -First 1; if ($pick) { $pick.Id }"`) do set "GGML_VK_VISIBLE_DEVICES=%%D"

if defined GGML_VK_VISIBLE_DEVICES (
  echo Vulkan device: %GGML_VK_VISIBLE_DEVICES%
) else (
  echo Vulkan device: default
)
