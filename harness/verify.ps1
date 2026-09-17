$ErrorActionPreference = "Stop"

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

        if ($LASTEXITCODE -ne 0) {
            throw "Command exited with code $LASTEXITCODE"
        }

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
        if (-not (Test-Path $file)) {
            throw "Missing required file: $file"
        }
    }
}

# 2. API tests
Run-Check "API test suite" {
    Push-Location "apps/api"

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

# 3. Basic secret-file check
Run-Check "No unexpected .env files exist" {
    $envFiles = Get-ChildItem -Path . -Recurse -Force -File `
        -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Name -match '^\.env($|\.)' -and
            $_.Name -ne ".env.example" -and
            $_.FullName -notmatch '\\node_modules\\'
        }

    if ($envFiles.Count -gt 0) {
        $paths = $envFiles.FullName -join ", "
        throw "Potential secret environment file found: $paths"
    }
}

# 4. Git staged-file safety
Run-Check "No obvious secret files are staged" {
    $stagedFiles = git diff --cached --name-only

    if ($LASTEXITCODE -ne 0) {
        throw "Unable to inspect staged Git files."
    }

    $blockedPatterns = @(
        '(^|/)\.env($|\.)',
        '(^|/)id_rsa($|\.)',
        '(^|/)id_ed25519($|\.)',
        '(^|/)credentials\.json$',
        '(^|/)secrets\.json$'
    )

    foreach ($file in $stagedFiles) {
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
