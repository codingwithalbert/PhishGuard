$ErrorActionPreference = "Stop"

# Resolve the repository root from this script's own location so the harness
# can be invoked from any working directory. The caller's location is never
# permanently changed; every location change is scoped by Push-Location.
if ([string]::IsNullOrWhiteSpace($PSScriptRoot)) {
    throw "Unable to determine the harness script directory."
}

$repoRoot = (Get-Item -LiteralPath (Join-Path -Path $PSScriptRoot -ChildPath "..")).FullName

Write-Host ""
Write-Host "========================================"
Write-Host "       PhishGuard Verification"
Write-Host "========================================"
Write-Host ""

$failed = $false

function Run-Check {
    param (
        [string]$Name,
        [scriptblock]$Action
    )

    Write-Host "[CHECK] $Name"

    try {
        & $Action

        Write-Host "  PASS"
        Write-Host ""
    }
    catch {
        Write-Host "  FAIL: $($_.Exception.Message)"
        Write-Host ""
        $script:failed = $true
    }
}

# 1. Repository safety
Run-Check "Required project files exist" {
    $requiredFiles = @(
        "AI_RULES.md",
        ".gitignore",
        "apps/api/package.json"
    )

    foreach ($file in $requiredFiles) {
        $filePath = Join-Path -Path $repoRoot -ChildPath $file

        if (-not (Test-Path -LiteralPath $filePath)) {
            throw "Missing required file: $file"
        }
    }
}

# 2. API tests
Run-Check "API test suite" {
    # apps/api "npm test" runs "node --test", which auto-discovers suites that
    # can depend on a running localhost API, a configured MongoDB, persistent
    # writes/cleanup, inherited environment configuration, and login
    # rate-limit state. Execution therefore requires deliberate authorization.
    if ($env:PHISHGUARD_ALLOW_LIVE_TESTS -ne "1") {
        $gateMessage = @(
            "Broad backend tests were NOT authorized, so they were not executed.",
            "apps/api ""npm test"" runs ""node --test"", which auto-discovers suites that may use:",
            "  - a running localhost API",
            "  - a configured MongoDB/database",
            "  - persistent test data (writes and cleanup)",
            "",
            "Authorization: set PHISHGUARD_ALLOW_LIVE_TESTS=1 for this session.",
            "This authorizes execution only; it does NOT prove the environment is safe.",
            "You are responsible for confirming that a localhost API is intentionally",
            "configured, the database target is disposable/approved, no production data",
            "or production configuration is used, and required configuration is suitable.",
            "",
            "Opt-in MongoDB integration suites keep their own individual flags and are",
            "not enabled by this gate."
        ) -join [System.Environment]::NewLine

        throw $gateMessage
    }

    Push-Location (Join-Path -Path $repoRoot -ChildPath "apps/api")

    try {
        npm test

        if ($LASTEXITCODE -ne 0) {
            throw "API tests failed."
        }
    }
    finally {
        Pop-Location
    }
}

# 3. Frontend checks
Run-Check "Frontend lint" {
    Push-Location (Join-Path -Path $repoRoot -ChildPath "apps/web")

    try {
        npm run lint

        if ($LASTEXITCODE -ne 0) {
            throw "Frontend lint failed."
        }
    }
    finally {
        Pop-Location
    }
}

Run-Check "Frontend production build" {
    Push-Location (Join-Path -Path $repoRoot -ChildPath "apps/web")

    try {
        npm run build

        if ($LASTEXITCODE -ne 0) {
            throw "Frontend build failed."
        }
    }
    finally {
        Pop-Location
    }
}

# 4. Tracked secret-file check
Run-Check "No secret environment files are tracked by Git" {
    Push-Location $repoRoot

    try {
        $trackedFiles = git ls-files

        if ($LASTEXITCODE -ne 0) {
            throw "Unable to inspect tracked Git files."
        }
    }
    finally {
        Pop-Location
    }

    $trackedEnvFiles = $trackedFiles |
        Where-Object {
            $_ -match '(^|/)\.env($|\.)' -and
            $_ -notmatch '\.env\.example$'
        }

    if ($trackedEnvFiles.Count -gt 0) {
        $paths = $trackedEnvFiles -join ", "
        throw "Secret environment file is tracked by Git: $paths"
    }
}

# 5. Git staged-file safety
Run-Check "No obvious secret files are staged" {
    Push-Location $repoRoot

    try {
        $stagedFiles = git diff --cached --name-only

        if ($LASTEXITCODE -ne 0) {
            throw "Unable to inspect staged Git files."
        }
    }
    finally {
        Pop-Location
    }

    $blockedPatterns = @(
        '(^|/)\.env($|\.)',
        '(^|/)id_rsa($|\.)',
        '(^|/)id_ed25519($|\.)',
        '(^|/)credentials\.json$',
        '(^|/)secrets\.json$'
    )

    foreach ($file in $stagedFiles) {
        # .env.example is a committed configuration template, not a secret,
        # and is already permitted by the tracked-file check above.
        if ($file -match '\.env\.example$') {
            continue
        }

        foreach ($pattern in $blockedPatterns) {
            if ($file -match $pattern) {
                throw "Potential secret file is staged: $file"
            }
        }
    }
}

# Final result
Write-Host "========================================"

if ($failed) {
    Write-Host "PHISHGUARD VERIFICATION: FAIL"
    Write-Host "========================================"
    exit 1
}

Write-Host "PHISHGUARD VERIFICATION: PASS"
Write-Host "========================================"
Write-Host ""

exit 0
