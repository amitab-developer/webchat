$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$directories = @(
    (Join-Path $root ".venv"),
    (Join-Path $root "src\frontend\node_modules")
)
$cacheNames = @(
    "__pycache__",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".npm-cache"
)

$directories += Get-ChildItem -Path $root -Directory -Recurse -Force -ErrorAction SilentlyContinue |
    Where-Object { $cacheNames -contains $_.Name } |
    Select-Object -ExpandProperty FullName

$directories = $directories | Sort-Object Length -Descending -Unique
foreach ($directory in $directories) {
    if (Test-Path -LiteralPath $directory) {
        Remove-Item -LiteralPath $directory -Recurse -Force
        $relativePath = [System.IO.Path]::GetRelativePath($root, $directory)
        Write-Host "[clean] removed $relativePath"
    }
}

Write-Host "[clean] workspace dependencies and caches cleared"