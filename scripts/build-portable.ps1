param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$appRoot = Join-Path $repoRoot 'desktop/src-tauri'
$config = Get-Content -LiteralPath (Join-Path $appRoot 'tauri.conf.json') -Raw | ConvertFrom-Json
$version = $config.version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Expected a stable semantic version.' }
if (-not $SkipBuild) {
    Push-Location $appRoot
    try {
        & cargo build --release
        if ($LASTEXITCODE -ne 0) { throw 'Rust release build failed.' }
    } finally { Pop-Location }
}
$executable = Join-Path $appRoot 'target/release/local-meeting-stt.exe'
if (-not (Test-Path -LiteralPath $executable)) { throw 'Missing release executable.' }
$exeVersion = (Get-Item -LiteralPath $executable).VersionInfo.ProductVersion
if ($exeVersion -notin @($version, "$version.0")) { throw "Executable version $exeVersion does not match $version." }

# Unique staging preserves older portable folders and any recordings inside them.
$stage = Join-Path $repoRoot ("desktop/dist/release-$version-" + [guid]::NewGuid().ToString('N').Substring(0,8))
$folder = Join-Path $stage 'Local Meeting STT portable'
New-Item -ItemType Directory -Path $folder | Out-Null
Copy-Item -LiteralPath $executable -Destination (Join-Path $folder 'Local Meeting STT.exe')
foreach ($relative in @('python_backend','whisper_cpp','models','whisper_cpp/models','outputs','runtime','licenses')) {
    New-Item -ItemType Directory -Path (Join-Path $folder $relative) -Force | Out-Null
}
foreach ($backend in @('python_backend','whisper_cpp')) {
    Get-ChildItem -LiteralPath (Join-Path $repoRoot $backend) -File |
        Where-Object { $_.Extension -in @('.py','.cmd','.txt') -or $_.Name -eq 'README.md' } |
        Copy-Item -Destination (Join-Path $folder $backend)
}
foreach ($runtime in @('bin_vulkan','bin_vulkan_loopback','bin_openvino')) {
    $source = Join-Path $repoRoot "whisper_cpp/$runtime"
    if (Test-Path -LiteralPath $source) {
        Copy-Item -LiteralPath $source -Destination (Join-Path $folder 'whisper_cpp') -Recurse
    }
}
Copy-Item -LiteralPath (Join-Path $repoRoot 'LICENSE') -Destination (Join-Path $folder 'LICENSE.txt')
$whisperLicense = Join-Path $repoRoot 'whisper_cpp/src_vulkan_loopback/LICENSE'
if (Test-Path -LiteralPath $whisperLicense) {
    Copy-Item -LiteralPath $whisperLicense -Destination (Join-Path $folder 'licenses/whisper.cpp-LICENSE.txt')
}
$settings = @{
    outputDir = 'outputs'
    qwen = @{ chunkSeconds = 60; tokens = 4096; batch = 16 }
    ui = @{ locale = 'en'; theme = 'system' }
} | ConvertTo-Json -Depth 4
[IO.File]::WriteAllText((Join-Path $folder 'settings.json'), $settings, (New-Object Text.UTF8Encoding($false)))
@"
Local Meeting STT v$version - Windows x64 portable folder (Rust desktop app)

Extract the entire folder to a writable location and run Local Meeting STT.exe.
Keep the backend folders beside the executable.
The window uses the Microsoft Edge WebView2 runtime, built into Windows 11.
On Windows 10 without it, install the Evergreen runtime:
https://developer.microsoft.com/microsoft-edge/webview2/
Install uv and make it available on PATH: https://docs.astral.sh/uv/getting-started/installation/
First use requires internet access to install Python dependencies and download models.
Open Settings to download missing models and CPU/CUDA runtimes.
Vulkan, Vulkan loopback and OpenVINO runtimes are included when available at build time.
Models, Python environments, private recordings and caches are NOT included.
OpenVINO encoder files must be prepared separately; supported devices/drivers are required.

English is the default UI. Choose Traditional Chinese or Japanese in Settings.
The supplied recognition workflows remain Japanese regardless of UI language.
Outputs are saved under outputs/ unless changed in Settings.
Extract upgrades separately; copy models and recordings from your old folder if needed.

This application is unsigned. Windows may show an unknown-publisher prompt.
Source and documentation: https://github.com/kuchris/local-meeting-stt
"@ | Set-Content -LiteralPath (Join-Path $folder 'README.txt') -Encoding UTF8

$zip = Join-Path $stage "Local.Meeting.STT.portable.v$version.zip"
Compress-Archive -LiteralPath $folder -DestinationPath $zip -CompressionLevel Optimal
$digest = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
"$digest  $([IO.Path]::GetFileName($zip))" | Set-Content -LiteralPath (Join-Path $stage 'SHA256SUMS.txt') -Encoding ASCII
Write-Host "Portable folder: $folder"
Write-Host "Release archive: $zip"
Write-Host "SHA256: $digest"
