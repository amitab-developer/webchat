$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$stagingDir = Join-Path $repoRoot ".deployment-staging"
$frontendDir = Join-Path $repoRoot "src\frontend"
$env:npm_config_cache = Join-Path $repoRoot ".npm-cache"

function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)]
        [string] $FilePath,
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]] $Arguments
    )
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FilePath exited with code $LASTEXITCODE"
    }
}

Write-Host "building frontend assets"
if (Test-Path (Join-Path $frontendDir "node_modules")) {
    Invoke-Native npm run build --prefix $frontendDir
} else {
    Invoke-Native npm ci --prefix $frontendDir
    Invoke-Native npm run build --prefix $frontendDir
}

Write-Host "preparing deployment staging area"
if (Test-Path $stagingDir) {
    Remove-Item -Recurse -Force $stagingDir
}
New-Item -ItemType Directory -Force $stagingDir | Out-Null
Copy-Item -Recurse (Join-Path $repoRoot "src\backend") (Join-Path $stagingDir "backend")
Get-ChildItem -Path (Join-Path $stagingDir "backend") -Directory -Filter "__pycache__" -Recurse |
    Remove-Item -Recurse -Force
New-Item -ItemType Directory -Force (Join-Path $stagingDir "frontend") | Out-Null
Copy-Item (Join-Path $frontendDir "index.html") (Join-Path $stagingDir "frontend\index.html")
Copy-Item -Recurse (Join-Path $frontendDir "dist") (Join-Path $stagingDir "frontend\dist")
Copy-Item (Join-Path $repoRoot "pyproject.toml") (Join-Path $stagingDir "pyproject.toml")
Copy-Item (Join-Path $repoRoot "uv.lock") (Join-Path $stagingDir "uv.lock")

$requirementsPath = Join-Path $stagingDir "requirements.txt"
if (Get-Command uv -ErrorAction SilentlyContinue) {
    Invoke-Native uv export `
        --project $repoRoot `
        --format requirements-txt `
        --no-dev `
        --no-hashes `
        --output-file $requirementsPath
} else {
    @"
aiohttp>=3.12.0
azure-cosmos>=4.7.0
azure-identity>=1.17.1
fastapi>=0.115.0
openai>=1.59.0
pydantic-settings>=2.6.0
pypdf>=5.1.0
python-docx>=1.1.2
python-dotenv>=1.0.1
python-multipart>=0.0.12
uvicorn[standard]>=0.32.0
"@ | Set-Content -Encoding UTF8 $requirementsPath
}
