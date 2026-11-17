param(
    [ValidateRange(1, 65535)]
    [int]$Port = 9781
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$python = Join-Path $projectRoot "venv\Scripts\python.exe"
$logs = Join-Path $projectRoot "logs\windows"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
New-Item -ItemType Directory -Path $logs -Force | Out-Null
$startupLog = Join-Path $logs "startup-$stamp.log"
$serverLog = Join-Path $logs "uvicorn-$stamp.log"

function Write-StartupLog([string]$message) {
    Add-Content -LiteralPath $startupLog -Value ("{0} {1}" -f (Get-Date -Format o), $message)
}

try {
    foreach ($file in @($python, (Join-Path $projectRoot "app\main.py"), (Join-Path $projectRoot "requirements.txt"))) {
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
            throw "Required file is missing: $file"
        }
    }

    $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $_.LocalAddress -in @("127.0.0.1", "0.0.0.0", "::1", "::") })
    foreach ($listener in $listeners) {
        $ownerProcess = Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $listener.OwningProcess) -ErrorAction SilentlyContinue
        $samePython = $ownerProcess -and $ownerProcess.ExecutablePath -and
            [string]::Equals($ownerProcess.ExecutablePath, $python, [StringComparison]::OrdinalIgnoreCase)
        $sameCommand = $ownerProcess -and $ownerProcess.CommandLine -and
            $ownerProcess.CommandLine.IndexOf("app.main:app", [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
            $ownerProcess.CommandLine.IndexOf($projectRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
            $ownerProcess.CommandLine.IndexOf("--port $Port", [StringComparison]::OrdinalIgnoreCase) -ge 0
        if (-not ($samePython -and $sameCommand)) {
            throw "Port $Port is already in use by another or unverified process (PID $($listener.OwningProcess))."
        }
    }
    if ($listeners.Count -gt 0) {
        Write-StartupLog "Image Toolkit is already listening on port $Port; no duplicate was started."
        exit 0
    }

    Write-StartupLog "Starting Image Toolkit from $projectRoot on 127.0.0.1:$Port."
    Set-Location -LiteralPath $projectRoot
    $arguments = @("-m", "uvicorn", "app.main:app", "--app-dir", ('"{0}"' -f $projectRoot),
        "--host", "127.0.0.1", "--port", $Port, "--lifespan", "on", "--log-level", "info")
    $server = Start-Process -FilePath $python -ArgumentList $arguments -WorkingDirectory $projectRoot `
        -RedirectStandardOutput $serverLog -RedirectStandardError (Join-Path $logs "uvicorn-$stamp.error.log") `
        -PassThru -Wait
    $serverExitCode = $server.ExitCode
    Write-StartupLog "Uvicorn exited with code $serverExitCode."
    exit $serverExitCode
} catch {
    Write-StartupLog "Startup failed: $($_.Exception.Message)"
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
