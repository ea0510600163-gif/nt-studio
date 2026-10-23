$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$mutex = $null
$ownsMutex = $false

try {
    $mutex = New-Object System.Threading.Mutex($false, 'Local\NTStudioLatestBuildLauncher')
    try {
        $ownsMutex = $mutex.WaitOne(0)
    } catch [System.Threading.AbandonedMutexException] {
        $ownsMutex = $true
    }
    if (-not $ownsMutex) {
        throw 'The latest-build launcher is already running.'
    }

    $packagePath = Join-Path $projectRoot 'package.json'
    if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
        throw 'package.json was not found. No files were changed.'
    }

    $package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
    if ($package.name -ne 'nt-studio' -or
        $package.scripts.build -notlike 'electron-vite build*' -or
        $package.scripts.start -notlike 'electron-vite preview*') {
        throw 'Project identity or build scripts do not match NT Studio. No files were changed.'
    }

    $managedNpm = $null
    $managedRoot = Join-Path $env:USERPROFILE '.workbuddy-ai\binaries\node\versions'
    if (Test-Path -LiteralPath $managedRoot -PathType Container) {
      $latest = Get-ChildItem -LiteralPath $managedRoot -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
      if ($latest) {
        $candidate = Join-Path $latest.FullName 'npm.cmd'
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { $managedNpm = $candidate }
      }
    }
    if ($managedNpm) {
      $env:PATH = "$([System.IO.Path]::GetDirectoryName($managedNpm));$env:PATH"
      $npmCommand = $managedNpm
    } else {
      $npmCommand = (Get-Command 'npm.cmd' -ErrorAction Stop).Source
    }
    $electronViteCommand = Join-Path $projectRoot 'node_modules\.bin\electron-vite.cmd'
    if (-not (Test-Path -LiteralPath $electronViteCommand -PathType Leaf)) {
        throw 'Project dependencies are missing. Run npm install once, then try again.'
    }

    $runningApps = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq 'NT Studio' })
    foreach ($runningApp in $runningApps) {
        Write-Host 'Closing the currently open NT Studio safely...'
        if (-not $runningApp.CloseMainWindow()) {
            throw 'Could not close the existing NT Studio window. Close it manually; no build files were deleted.'
        }
        if (-not $runningApp.WaitForExit(15000)) {
            throw 'NT Studio did not close within 15 seconds. Close it manually; no build files were deleted.'
        }
    }

    $outRoot = Join-Path $projectRoot 'out'
    $outRootItem = Get-Item -LiteralPath $outRoot -Force -ErrorAction SilentlyContinue
    if ($null -ne $outRootItem) {
        if (-not $outRootItem.PSIsContainer -or ($outRootItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
            throw 'The out path is not a normal generated-build folder. No files were changed.'
        }
    } else {
        New-Item -ItemType Directory -Path $outRoot | Out-Null
    }

    Get-ChildItem -LiteralPath $outRoot -Directory -Filter 'launcher-*' -ErrorAction SilentlyContinue |
        Sort-Object CreationTime -Descending |
        Select-Object -Skip 2 |
        ForEach-Object {
            try { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction Stop } catch { }
        }

    $runId = (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
    $outDir = Join-Path $outRoot "launcher-$runId"
    if (Test-Path -LiteralPath $outDir) {
        throw 'Unique build output already exists. No files were changed.'
    }

    $env:ELECTRON_RUN_AS_NODE = ''
    $env:NODE_OPTIONS = ''
    Push-Location $projectRoot
    try {
        Write-Host "Building the latest source into: $outDir"
        & $npmCommand run build -- --outDir $outDir
        if ($LASTEXITCODE -ne 0) {
            throw "Build failed with exit code $LASTEXITCODE. The app was not launched."
        }

        $mainOutput = Join-Path $outDir 'main\index.js'
        $requiredOutputs = @(
            $mainOutput,
            (Join-Path $outDir 'preload\index.js'),
            (Join-Path $outDir 'renderer\index.html')
        )
        foreach ($requiredOutput in $requiredOutputs) {
            if (-not (Test-Path -LiteralPath $requiredOutput -PathType Leaf)) {
                throw "Build finished but required output is missing: $requiredOutput"
            }
        }

        Write-Host 'Starting the freshly built NT Studio...'
        & $npmCommand run start -- --skipBuild --outDir $outDir --entry $mainOutput
        if ($LASTEXITCODE -ne 0) {
            throw "NT Studio exited with code $LASTEXITCODE."
        }
    } finally {
        Pop-Location
    }
} catch {
    $message = $_.Exception.Message
    Write-Host "NT Studio launcher error: $message" -ForegroundColor Red
    try {
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.MessageBox]::Show($message, 'NT Studio launcher', 'OK', 'Error') | Out-Null
    } catch {}
    exit 1
} finally {
    if ($ownsMutex -and $null -ne $mutex) {
        $mutex.ReleaseMutex()
    }
    if ($null -ne $mutex) {
        $mutex.Dispose()
    }
}
