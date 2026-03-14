param(
  [string]$SourceDir = $PSScriptRoot,
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'

$installRoot = Join-Path $env:LOCALAPPDATA 'Programs\Forge\bin'
$managedBinaries = @('forge.exe', 'forged.exe')

function Normalize-ForgePathSegment {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return $null
  }

  $expanded = [Environment]::ExpandEnvironmentVariables($Value).Trim()
  return $expanded.TrimEnd('\').ToLowerInvariant()
}

function Get-ForgeUserPathSegments {
  $current = [Environment]::GetEnvironmentVariable('Path', 'User')
  if ([string]::IsNullOrWhiteSpace($current)) {
    return @()
  }

  return @($current -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function Set-ForgeUserPathSegments {
  param([string[]]$Segments)

  $joined = ($Segments | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -join ';'
  [Environment]::SetEnvironmentVariable('Path', $joined, 'User')

  $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  if ([string]::IsNullOrWhiteSpace($machinePath)) {
    $env:Path = $joined
  } elseif ([string]::IsNullOrWhiteSpace($joined)) {
    $env:Path = $machinePath
  } else {
    $env:Path = "$joined;$machinePath"
  }
}

function Publish-ForgeEnvironmentChange {
  $signature = @"
using System;
using System.Runtime.InteropServices;

public static class ForgeEnvironmentBroadcast {
  [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern IntPtr SendMessageTimeout(
    IntPtr hWnd,
    int Msg,
    IntPtr wParam,
    string lParam,
    int fuFlags,
    int uTimeout,
    out IntPtr lpdwResult
  );
}
"@

  if (-not ([System.Management.Automation.PSTypeName]'ForgeEnvironmentBroadcast').Type) {
    Add-Type -TypeDefinition $signature | Out-Null
  }

  $HWND_BROADCAST = [IntPtr]0xffff
  $WM_SETTINGCHANGE = 0x1A
  $SMTO_ABORTIFHUNG = 0x2
  $result = [IntPtr]::Zero
  [ForgeEnvironmentBroadcast]::SendMessageTimeout(
    $HWND_BROADCAST,
    $WM_SETTINGCHANGE,
    [IntPtr]::Zero,
    'Environment',
    $SMTO_ABORTIFHUNG,
    5000,
    [ref]$result
  ) | Out-Null
}

New-Item -ItemType Directory -Path $installRoot -Force | Out-Null

foreach ($binary in $managedBinaries) {
  $source = Join-Path $SourceDir $binary
  if (-not (Test-Path $source)) {
    throw "Missing required Forge binary at $source"
  }

  Copy-Item -Path $source -Destination (Join-Path $installRoot $binary) -Force
}

$currentSegments = Get-ForgeUserPathSegments
$normalizedInstallRoot = Normalize-ForgePathSegment $installRoot
$alreadyPresent = $false

foreach ($segment in $currentSegments) {
  if ((Normalize-ForgePathSegment $segment) -eq $normalizedInstallRoot) {
    $alreadyPresent = $true
    break
  }
}

if (-not $alreadyPresent) {
  $currentSegments += $installRoot
}

Set-ForgeUserPathSegments -Segments $currentSegments
Publish-ForgeEnvironmentChange

if (-not $Quiet) {
  Write-Host "Forge CLI installed."
  Write-Host ""
  Write-Host "Location: $installRoot"
  Write-Host "Restart the terminal if 'forge' is not yet available in the current session."
  Write-Host ""
  Write-Host "Try:"
  Write-Host "  forge --help"
  Write-Host "  forge doctor"
  Write-Host "  forge today"
  Write-Host "  forge task add ""Example task"""
}
