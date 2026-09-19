# BrownSpot installer for Windows Terminal / PowerShell — safe for: irm <URL> | iex
$ErrorActionPreference = "Stop"

$Repo = "KhriseanStewart/brownspot"
$BinName = "dotstart"
$InstallDir = if ($env:BROWNSPOT_INSTALL_DIR) { $env:BROWNSPOT_INSTALL_DIR } else {
  Join-Path $env:LOCALAPPDATA "BrownSpot\bin"
}
$Api = if ($env:GITHUB_API) { $env:GITHUB_API } else { "https://api.github.com" }
$DownloadHost = if ($env:GITHUB_DOWNLOAD) { $env:GITHUB_DOWNLOAD } else { "https://github.com" }

function Write-Info([string]$Msg) { Write-Host "brownspot-install: $Msg" }
function Write-Err([string]$Msg) { throw "brownspot-install: $Msg" }

function Get-Target {
  $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
  switch ($arch) {
    "x64" { return "windows-x64" }
    "arm64" { return "windows-arm64" }
    default { Write-Err "unsupported architecture: $arch (need x64 or arm64)" }
  }
}

function Get-Version {
  if ($env:BROWNSPOT_VERSION) {
    return ($env:BROWNSPOT_VERSION -replace '^v', '')
  }
  $rel = Invoke-RestMethod -Uri "$Api/repos/$Repo/releases/latest" -Headers @{ "User-Agent" = "BrownSpot-Installer" }
  if (-not $rel.tag_name) { Write-Err "could not resolve latest release for $Repo" }
  return ($rel.tag_name -replace '^v', '')
}

$target = Get-Target
$version = Get-Version
$tag = "v$version"
$asset = "$BinName-$target.exe"
$url = "$DownloadHost/$Repo/releases/download/$tag/$asset"

Write-Info "installing $BinName $tag ($target)"
Write-Info "downloading $url"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("$asset." + [guid]::NewGuid().ToString("n"))
try {
  Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing
  if (-not (Test-Path $tmp) -or ((Get-Item $tmp).Length -lt 1024)) {
    Write-Err "download failed or file too small — is release $tag published with $asset?"
  }
  $dest = Join-Path $InstallDir "$BinName.exe"
  Move-Item -Force -Path $tmp -Destination $dest
  Write-Info "installed $dest"

  $onPath = ($env:PATH -split ';' | Where-Object { $_ -and ($_ -ieq $InstallDir) })
  if (-not $onPath) {
    Write-Info "note: $InstallDir is not on your PATH"
    Write-Info "add it for this user (PowerShell), then reopen the terminal:"
    Write-Info "  [Environment]::SetEnvironmentVariable('Path', `$env:Path + ';$InstallDir', 'User')"
  }
  Write-Info "run: $BinName"
  Write-Info "Clerk login uses http://127.0.0.1:8788/callback — keep that port free."
}
finally {
  if (Test-Path $tmp) { Remove-Item -Force $tmp -ErrorAction SilentlyContinue }
}
