<#
.SYNOPSIS
  Removes the first MicroPOS (version 1.0.0, a Squirrel install) from this Windows user account.

.DESCRIPTION
  Steps (the same as WINDOWS-CLEANUP.txt):
    1. Closes the old app (only micropos.exe running from %LOCALAPPDATA%\micropos).
    2. Copies the old database to a backup folder (on the Desktop unless -BackupTo is given; skip with -NoBackup).
    3. Runs the old app's uninstaller (%LOCALAPPDATA%\micropos\Update.exe --uninstall).
    4. Deletes what is left: %LOCALAPPDATA%\micropos (app files) and %APPDATA%\micropos (data).
    5. Deletes leftover shortcuts that point into %LOCALAPPDATA%\micropos (Desktop, Start Menu, taskbar pins)
       and the old Installed apps entry (HKCU ...\Uninstall\micropos).

  The new MicroPOS (2.21 and later, Inno Setup) keeps its data in the same %APPDATA%\micropos folder and is also
  called micropos.exe, so this script only touches what belongs to the old install: processes and shortcuts are
  matched by their path, and the data folder is left alone when it looks like the new app's (it has a backups
  folder or the new app is installed) unless -Force is given. The new app's own files are never touched.

  Run it as the Windows user who used the old MicroPOS (its files are per user). Double-click
  remove-old-micropos.cmd, or in PowerShell:
    powershell -ExecutionPolicy Bypass -File .\remove-old-micropos.ps1
  Add -WhatIf to see what it would do without changing anything.

.PARAMETER BackupTo
  Folder to put the database backup in. Default: the Desktop.

.PARAMETER NoBackup
  Do not copy the old database before deleting it.

.PARAMETER Force
  Delete %APPDATA%\micropos even when it looks like the new MicroPOS's data.

.PARAMETER Yes
  Do not ask for confirmation.

.PARAMETER KeepData
  Only remove the old program, shortcuts and Installed apps entry; leave %APPDATA%\micropos alone. The MicroPOS
  setup wizard runs the script this way and handles the data on its own Existing data page.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$BackupTo = [Environment]::GetFolderPath('Desktop'),
  [switch]$NoBackup,
  [switch]$Force,
  [switch]$Yes,
  [switch]$KeepData
)

$ErrorActionPreference = 'Stop'

$AppDir = Join-Path $env:LOCALAPPDATA 'micropos'
$DataDir = Join-Path $env:APPDATA 'micropos'
$OldUninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\micropos'
$NewAppId = '{AC933739-ED4B-4281-93EE-725399434856}_is1'
$NewUninstallKeys = @(
  "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$NewAppId",
  "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$NewAppId"
)

function Write-Step([string]$Text) { Write-Host ''; Write-Host "== $Text" -ForegroundColor Cyan }
function Write-Done([string]$Text) { Write-Host "   $Text" -ForegroundColor Green }
function Write-Note([string]$Text) { Write-Host "   $Text" -ForegroundColor Yellow }

# True when the path is the old app folder or inside it.
function Test-InOldApp([string]$Path) {
  if (-not $Path) { return $false }
  $full = [IO.Path]::GetFullPath($Path).TrimEnd('\')
  $root = [IO.Path]::GetFullPath($AppDir).TrimEnd('\')
  return $full -ieq $root -or $full.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)
}

function Test-HasContent([string]$Dir) {
  return (Test-Path -LiteralPath $Dir) -and [bool](Get-ChildItem -LiteralPath $Dir -Force -ErrorAction SilentlyContinue | Select-Object -First 1)
}

# --- What is here --------------------------------------------------------------------------------------------------

$newInstalled = [bool]($NewUninstallKeys | Where-Object { Test-Path $_ })
# The new app makes an automatic backup at every first start of the day, in backups\micropos-auto-*.db; builds 2.0 to
# 2.20.0 also wrote micropos-data.json. The old app had neither.
$dataLooksNew = (Test-Path -LiteralPath (Join-Path $DataDir 'backups')) -or (Test-Path -LiteralPath (Join-Path $DataDir 'micropos-data.json'))
$hasOldApp = Test-Path -LiteralPath $AppDir
$hasData = Test-HasContent $DataDir
$hasOldKey = Test-Path $OldUninstallKey
$deleteData = $hasData -and -not $KeepData -and ($Force -or -not ($dataLooksNew -or $newInstalled))

Write-Host 'Remove the old MicroPOS (1.0.0)' -ForegroundColor White
Write-Host "  Old app folder   $AppDir  $(if ($hasOldApp) { '(found)' } else { '(not found)' })"
Write-Host "  Data folder      $DataDir  $(if ($hasData) { '(found)' } else { '(not found)' })"
Write-Host "  Installed apps   micropos  $(if ($hasOldKey) { '(listed)' } else { '(not listed)' })"
if ($newInstalled) { Write-Note 'The new MicroPOS is installed on this computer. Its files are not touched.' }
if ($hasData -and $KeepData) {
  Write-Note 'The data folder is left alone (-KeepData).'
}
elseif ($hasData -and -not $deleteData) {
  Write-Note 'The data folder looks like the new MicroPOS''s data, so it will be KEPT.'
  Write-Note 'Run again with -Force to delete it anyway (the new app then starts with no data).'
}

if (($hasOldApp -or $hasOldKey -or $deleteData) -and -not $Yes -and -not $WhatIfPreference) {
  Write-Host ''
  $what = @()
  if ($hasOldApp -or $hasOldKey) { $what += 'uninstall the old MicroPOS' }
  if ($deleteData) { $what += "delete its data in $DataDir" + $(if ($NoBackup) { ' (NO backup)' } else { " (database backed up to $BackupTo first)" }) }
  Write-Host "This will $($what -join ' and ')." -ForegroundColor White
  $answer = Read-Host 'Continue? Type Y and press Enter'
  if ($answer -notmatch '^(y|yes)$') { Write-Host 'Nothing was changed.'; exit 1 }
}

# --- 1. Close the old app ------------------------------------------------------------------------------------------

Write-Step 'Closing the old MicroPOS'
$old = @(Get-Process -Name micropos, Update -ErrorAction SilentlyContinue | Where-Object { Test-InOldApp $_.Path })
if ($old.Count -eq 0) { Write-Done 'Not running.' }
foreach ($p in $old) {
  if ($PSCmdlet.ShouldProcess("$($p.Path) (pid $($p.Id))", 'Stop process')) {
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    Write-Done "Closed $($p.Path)"
  }
}
if ($deleteData) {
  $other = @(Get-Process -Name micropos -ErrorAction SilentlyContinue | Where-Object { -not (Test-InOldApp $_.Path) })
  if ($other.Count -gt 0) {
    Write-Note 'Another MicroPOS is running and would keep the data folder in use. Quit it (tray icon > Quit) and run this again.'
    exit 1
  }
}
if ($old.Count -gt 0 -and -not $WhatIfPreference) { Start-Sleep -Seconds 2 }

# --- 2. Back up the database ---------------------------------------------------------------------------------------

if ($deleteData -and -not $NoBackup) {
  Write-Step 'Backing up the old database'
  $dbFiles = @(Get-ChildItem -LiteralPath $DataDir -Filter 'micropos.db*' -File -ErrorAction SilentlyContinue)
  if ($dbFiles.Count -eq 0) {
    Write-Done 'No database found, nothing to back up.'
  }
  else {
    $dest = Join-Path $BackupTo ('MicroPOS 1.0.0 backup ' + (Get-Date -Format 'yyyy-MM-dd HHmmss'))
    if ($PSCmdlet.ShouldProcess($dest, 'Copy micropos.db')) {
      New-Item -ItemType Directory -Path $dest -Force | Out-Null
      $dbFiles | Copy-Item -Destination $dest
      $logo = Join-Path $DataDir 'user\logo'
      if (Test-Path -LiteralPath $logo) { Copy-Item -LiteralPath $logo -Destination (Join-Path $dest 'logo') -Recurse }
      Write-Done "Copied to $dest"
    }
  }
}

# --- 3. Run the old uninstaller ------------------------------------------------------------------------------------

Write-Step 'Uninstalling'
$updateExe = Join-Path $AppDir 'Update.exe'
if (Test-Path -LiteralPath $updateExe) {
  if ($PSCmdlet.ShouldProcess($updateExe, 'Run --uninstall')) {
    $proc = Start-Process -FilePath $updateExe -ArgumentList '--uninstall' -PassThru
    if (-not $proc.WaitForExit(120000)) {
      Write-Note 'The uninstaller is taking long; carrying on and removing the files directly.'
      Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    }
    else { Write-Done "Uninstaller finished (exit code $($proc.ExitCode))." }
    Start-Sleep -Seconds 2
  }
}
else { Write-Done 'No old uninstaller found (already uninstalled).' }

# --- 4. Delete what is left ----------------------------------------------------------------------------------------

Write-Step 'Deleting leftover files'
$failed = @()
$targets = @($AppDir)
if ($deleteData) { $targets += $DataDir }
foreach ($dir in $targets) {
  if (-not (Test-Path -LiteralPath $dir)) { Write-Done "$dir (already gone)"; continue }
  try {
    Remove-Item -LiteralPath $dir -Recurse -Force
    if (-not $WhatIfPreference) { Write-Done "Deleted $dir" }
  }
  catch {
    $failed += $dir
    Write-Note "Could not delete everything in $dir : $($_.Exception.Message)"
  }
}
if ($hasData -and -not $deleteData) { Write-Done "Kept $DataDir" }

# --- 5. Shortcuts and the Installed apps entry ---------------------------------------------------------------------

Write-Step 'Removing old shortcuts and the Installed apps entry'
$shell = New-Object -ComObject WScript.Shell
$places = @(
  [Environment]::GetFolderPath('Desktop'),
  [Environment]::GetFolderPath('CommonDesktopDirectory'),
  [Environment]::GetFolderPath('Programs'),
  (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'),
  (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\StartMenu')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
$removed = 0
foreach ($place in $places) {
  foreach ($lnk in Get-ChildItem -LiteralPath $place -Filter '*.lnk' -Recurse -File -ErrorAction SilentlyContinue) {
    $target = $null
    try { $target = $shell.CreateShortcut($lnk.FullName).TargetPath } catch { continue }
    if (Test-InOldApp $target) {
      try {
        Remove-Item -LiteralPath $lnk.FullName -Force
        if (-not $WhatIfPreference) { Write-Done "Deleted shortcut $($lnk.FullName)" }
        $removed++
      }
      catch { Write-Note "Could not delete $($lnk.FullName): $($_.Exception.Message)" }
    }
  }
}
if ($removed -eq 0) { Write-Done 'No old shortcuts left.' }

if (Test-Path $OldUninstallKey) {
  Remove-Item -Path $OldUninstallKey -Recurse -Force
  if (-not $WhatIfPreference) { Write-Done 'Removed "micropos" from Installed apps.' }
}
else { Write-Done 'Not listed in Installed apps.' }

# --- Done ----------------------------------------------------------------------------------------------------------

Write-Host ''
if ($WhatIfPreference) {
  Write-Host 'That is what would happen (-WhatIf). Nothing was changed.' -ForegroundColor White
}
elseif ($failed.Count -gt 0) {
  Write-Host 'Done, but some files are still in use. Restart Windows and run this again to finish.' -ForegroundColor Yellow
  exit 2
}
else {
  Write-Host 'The old MicroPOS has been removed.' -ForegroundColor Green
}
