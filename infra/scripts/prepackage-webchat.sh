#!/usr/bin/env sh
set -eu

repo_root="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
staging_dir="${repo_root}/.deployment-staging"
frontend_dir="${repo_root}/src/frontend"
npm_config_cache="${NPM_CONFIG_CACHE:-${repo_root}/.npm-cache}"
export npm_config_cache

echo "building frontend assets"
if [ ! -d "${frontend_dir}/node_modules" ]; then
  npm ci --prefix "${frontend_dir}"
fi
npm run build --prefix "${frontend_dir}"

echo "preparing deployment staging area"
rm -rf "${staging_dir}"
mkdir -p "${staging_dir}"
cp -R "${repo_root}/src/backend" "${staging_dir}/backend"
find "${staging_dir}/backend" -type d -name __pycache__ -prune -exec rm -rf {} +
mkdir -p "${staging_dir}/frontend"
cp "${frontend_dir}/index.html" "${staging_dir}/frontend/index.html"
cp -R "${frontend_dir}/dist" "${staging_dir}/frontend/dist"
cp "${repo_root}/pyproject.toml" "${staging_dir}/pyproject.toml"
cp "${repo_root}/uv.lock" "${staging_dir}/uv.lock"

if command -v uv >/dev/null 2>&1; then
  uv export \
    --project "${repo_root}" \
    --format requirements-txt \
    --no-dev \
    --no-hashes \
    --output-file "${staging_dir}/requirements.txt"
else
  cat > "${staging_dir}/requirements.txt" <<'EOF'
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
EOF
fi
