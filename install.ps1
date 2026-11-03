<#
.SYNOPSIS
  Dominion installer for Windows.

.DESCRIPTION
  irm https://raw.githubusercontent.com/guilyx/dominion/main/install.ps1 | iex

  Downloads the latest release and runs the installer silently. It installs for
  the current user, so no administrator rights are needed. The app is not
  code-signed, so SmartScreen may still warn the first time it runs.

.PARAMETER Version
  Install a specific version (for example 1.1.0) instead of the latest.

.PARAMETER Portable
  Download the portable build to a folder instead of installing it.

.PARAMETER DryRun
  Print what would be downloaded and installed, then stop.
#>
[CmdletBinding()]
param(
  [string]$Version,
  [switch]$Portable,
  [switch]$DryRun,
  [string]$Destination = "$env:LOCALAPPDATA\Dominion"
)

$ErrorActionPreference = 'Stop'
$Repo = 'guilyx/dominion'

if ([Environment]::Is64BitOperatingSystem -eq $false) {
  throw "Dominion needs a 64-bit version of Windows. Use the portable HTML file from https://github.com/$Repo/releases/latest instead."
}

# TLS 1.2 for Windows PowerShell 5.1, whose default is often too old for GitHub.
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

if (-not $Version) {
  # /releases/latest redirects to the newest tag: no API rate limit, no JSON.
  try {
    $resp = Invoke-WebRequest "https://github.com/$Repo/releases/latest" -UseBasicParsing
    $tag = ([uri]$resp.BaseResponse.ResponseUri).Segments[-1].TrimEnd('/')
  } catch {
    throw "Could not reach GitHub: $($_.Exception.Message)"
  }
  if ($tag -notmatch '^v\d') {
    throw "This repository has no published release yet. Build it yourself instead: git clone https://github.com/$Repo; cd baw; npm start"
  }
  $Version = $tag.TrimStart('v')
}

$asset = if ($Portable) { "dominion-$Version-win-x64-portable.exe" } else { "dominion-$Version-win-x64-setup.exe" }
$url   = "https://github.com/$Repo/releases/download/v$Version/$asset"

Write-Host "Dominion $Version for Windows x64"
Write-Host "  from $url"

if ($DryRun) {
  if ($Portable) { Write-Host "  would save to $Destination\$asset" }
  else           { Write-Host "  would run the installer silently (per-user, no admin needed)" }
  return
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ("dominion-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
$file = Join-Path $tmp $asset

try {
  Write-Host "  downloading..."
  try {
    Invoke-WebRequest $url -OutFile $file -UseBasicParsing
  } catch {
    throw "Download failed. Check that $asset exists at https://github.com/$Repo/releases/tag/v$Version"
  }

  if ($Portable) {
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    $target = Join-Path $Destination $asset
    Move-Item $file $target -Force
    Write-Host "Installed to $target"
    Write-Host "Run it by double-clicking that file. Nothing was written to the registry."
  } else {
    # /S is the NSIS silent switch; the build is per-user so it needs no elevation.
    $p = Start-Process -FilePath $file -ArgumentList '/S' -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "The installer exited with code $($p.ExitCode)." }
    Write-Host "Installed. Launch Dominion from the Start menu."
  }
} finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
