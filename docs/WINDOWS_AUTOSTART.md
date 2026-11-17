# Windows Auto-Start

Image Toolkit can start when the **current Windows user signs in**. This optional native Windows 10/11 setup uses Task Scheduler and the existing project virtual environment. It does not install a Windows service or require administrator rights for a normal per-user task. Read the [main installation guide](../README.md) first.

## Prerequisites

- A native Windows 10/11 installation with a working Image Toolkit copy and Python 3.11+ virtual environment.
- Installed packages from `requirements.txt` and permission to write the project job data directory and `logs\windows`.
- A free localhost port, normally `9781` in this guide. If the app already uses another port, enter that port consistently below.
- The task runs at **user logon**, not before a user signs in. Keep the project and virtual environment at their chosen location.

## Confirm an Existing Installation

In PowerShell, use the actual project directory. Each `Test-Path` should return `True`:

```powershell
Set-Location (Read-Host "Enter the full path to the Image Toolkit project")
Test-Path .\app\main.py
Test-Path .\requirements.txt
Test-Path .\venv\Scripts\python.exe
Test-Path .\tools\windows\start-image-toolkit.ps1
```

Do not replace an existing `.env`, `data\image-jobs`, or `jobs.sqlite3` while setting up auto-start.

## How the Startup Script Works

[The startup script](../tools/windows/start-image-toolkit.ps1) derives the project root from its own location and accepts `-Port` (default `9781`). It validates the virtual-environment Python and project files, creates `logs\windows`, then checks listeners for the chosen localhost port. If the listener belongs to Uvicorn from the same virtual environment and project root, it exits successfully without starting a duplicate. If another or unverified process owns the port, it exits with an error and does not stop that process.

For a free port, it starts `venv\Scripts\python.exe -m uvicorn app.main:app` with the project root as the working directory, `127.0.0.1` as the bind address, and one worker. It waits for the child to exit, records the exit code, and returns it to Task Scheduler. The script does not change `.env`, SQLite, user images, packages, or machine-wide PowerShell settings. Normal app startup and cleanup may update job data as described in the [README](../README.md#privacy-and-file-processing).

## Run the Script Manually

```powershell
Set-Location (Read-Host "Enter the full path to the Image Toolkit project")
& .\tools\windows\start-image-toolkit.ps1 -Port 9781
```

If local execution policy blocks the file, this process-scoped invocation does not change a global policy:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\windows\start-image-toolkit.ps1 -Port 9781
```

The script stays active while the server runs. From another PowerShell window, the user may check `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:9781/healthz` and open `http://127.0.0.1:9781/`. Stop a manually launched server with Ctrl+C in its console and check whether its child process has exited.

## Register Auto-Start at User Logon

Run the following in a normal, non-elevated PowerShell window. It prompts for the installation path and port and refuses to overwrite a task with the same name. Review the values before running it:

```powershell
$projectRoot = (Resolve-Path (Read-Host "Enter the full path to the Image Toolkit project")).Path
$portText = Read-Host "Local port [9781]"
if ([string]::IsNullOrWhiteSpace($portText)) { $portText = "9781" }
$port = 0
if (-not [int]::TryParse($portText, [ref]$port) -or $port -lt 1 -or $port -gt 65535) {
    throw "Enter a TCP port from 1 to 65535."
}
$scriptPath = Join-Path $projectRoot "tools\windows\start-image-toolkit.ps1"
$taskName = "Image Toolkit - Current User"
$userId = "{0}\{1}" -f $env:USERDOMAIN, $env:USERNAME
$powershellPath = (Get-Command powershell.exe -CommandType Application).Path
if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) { throw "Startup script not found: $scriptPath" }
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    throw "A task named '$taskName' already exists; inspect it before changing it."
}
$action = New-ScheduledTaskAction `
    -Execute $powershellPath `
    -Argument ('-NoProfile -ExecutionPolicy Bypass -File "{0}" -Port {1}' -f $scriptPath, $port) `
    -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType InteractiveToken -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal -Description "Starts local Image Toolkit at user logon."
```

This document does not register the task for you. To inspect the definition or request a run without signing out, use `Get-ScheduledTask -TaskName "Image Toolkit - Current User" | Format-List *` and `Start-ScheduledTask -TaskName "Image Toolkit - Current User"`. The task's action retains the port selected during registration.

## Restart and Failure Policy

The task requests up to three restarts at one-minute intervals when its script exits with an error. A normal exit code `0`, including detection of an already-running matching server, is a success. An invalid path, port conflict, or non-zero Uvicorn exit is a failure. The script never kills the current port owner or silently changes the selected port. Task Scheduler also ignores a second launch of the same running task.

## Logs

Per-run files are written in the project directory:

```text
logs\windows\startup-YYYYMMDD-HHMMSS.log
logs\windows\uvicorn-YYYYMMDD-HHMMSS.log
logs\windows\uvicorn-YYYYMMDD-HHMMSS.error.log
```

The startup log records validation, duplicate/port handling, and exit status. Uvicorn stdout and stderr use separate files. No automatic log rotation or deletion is implemented; review disk use and retain needed diagnostics before manually archiving old logs.

## Verify After Restart or Re-Login

After the user signs in again, inspect the task and health endpoint using the port registered above (replace `9781` if different):

```powershell
Get-ScheduledTask -TaskName "Image Toolkit - Current User" | Select-Object TaskName, State
Get-ScheduledTaskInfo -TaskName "Image Toolkit - Current User" | Select-Object LastRunTime, LastTaskResult
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:9781/healthz
```

Open the local UI in a browser. A health response confirms only that the app responded; image conversion and downloads need a separate manual browser check. This documentation task did not perform a restart or sign-in test.

## Stop, Disable, Re-Enable, or Remove Auto-Start

```powershell
Stop-ScheduledTask -TaskName "Image Toolkit - Current User"
Disable-ScheduledTask -TaskName "Image Toolkit - Current User"
Enable-ScheduledTask -TaskName "Image Toolkit - Current User"
Unregister-ScheduledTask -TaskName "Image Toolkit - Current User" -Confirm:$true
```

Use only the command needed for the intended action. `Stop-ScheduledTask` stops the task invocation; verify the task-managed Uvicorn child has also exited before changing the installation or port. A child left running must be identified by its executable and command line before stopping that specific process. Disabling or removing the task does not remove `.env`, SQLite, job files, downloaded images, or logs.

## Troubleshooting

- **Missing Python or project files:** Confirm `venv\Scripts\python.exe`, `app\main.py`, and `requirements.txt` in the selected project. Repair the installation without deleting `data` or `.env`.
- **Port already occupied:** Run `Get-NetTCPConnection -LocalPort 9781 -State Listen | Select-Object LocalAddress, OwningProcess` with the registered port. Inspect the process before taking any action; the script will not terminate it.
- **Immediate task failure:** Read the newest startup and Uvicorn logs. Check the saved task action, chosen port, `.env`, and write permissions for `JOB_DATA_DIR` and `logs\windows`.
- **Task registration blocked:** Use the current user's Task Scheduler permissions and local organization policy. Do not weaken machine-wide execution policy or request administrator elevation as a default remedy.

## Local Security and Data Preservation

The script binds to `127.0.0.1`; it does not open a firewall port or publish the app to a network. Keep `.env` and `data\image-jobs` private to the intended user. Do not delete the job directory or SQLite WAL files to resolve startup problems. The app's normal result expiration policy remains active after launch.

## Limitations

The task requires that the user sign in and that Windows PowerShell, Task Scheduler, `Get-NetTCPConnection`, and `Get-CimInstance` are available. Windows-native startup, process termination behavior, and HEIF/AVIF codecs have **not** been tested in this documentation task. An unexpected child process surviving a task stop requires manual identification; the script does not terminate arbitrary processes.
