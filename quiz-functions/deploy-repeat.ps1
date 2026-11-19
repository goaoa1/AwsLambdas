# Easy/normal 18 questions deploy (2026-11-19): AWS SSO login only if the session expired (approve in the browser), then node deploy-repeat.mjs.
#   & C:\Users\inchul\Documents\layers\quiz-functions\deploy-repeat.ps1
Set-Location -LiteralPath $PSScriptRoot
aws sts get-caller-identity --profile inchul *> $null
if ($LASTEXITCODE -ne 0) {
  aws sso login --profile inchul
  if ($LASTEXITCODE -ne 0) { Write-Host 'SSO login did not finish - nothing was deployed.'; exit 1 }
}
node deploy-repeat.mjs
