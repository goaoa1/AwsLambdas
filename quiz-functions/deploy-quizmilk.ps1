# Quiz-end milk deploy (2026-11-18): AWS SSO login (approve in the browser), then node deploy-quizmilk.mjs if the login worked.
#   & C:\Users\inchul\Documents\layers\quiz-functions\deploy-quizmilk.ps1
Set-Location -LiteralPath $PSScriptRoot
aws sso login --profile inchul
if ($LASTEXITCODE -ne 0) { Write-Host 'SSO login did not finish - nothing was deployed.'; exit 1 }
node deploy-quizmilk.mjs
