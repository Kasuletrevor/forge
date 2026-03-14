param()

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

foreach ($binary in $managedBinaries) {
  $installed = Join-Path $installRoot $binary
  if (Test-Path $installed) {
    Remove-Item -Path $installed -Force
  }
}

$normalizedInstallRoot = Normalize-ForgePathSegment $installRoot
$remainingSegments = @()

foreach ($segment in Get-ForgeUserPathSegments) {
  if ((Normalize-ForgePathSegment $segment) -ne $normalizedInstallRoot) {
    $remainingSegments += $segment
  }
}

Set-ForgeUserPathSegments -Segments $remainingSegments
Publish-ForgeEnvironmentChange

if ((Test-Path $installRoot) -and -not (Get-ChildItem -Path $installRoot -Force | Select-Object -First 1)) {
  Remove-Item -Path $installRoot -Force
}

Write-Host "Removed Forge CLI from $installRoot"
