# Battle entry deploy (전투 개편 S7a, 2026-11-24): AWS SSO login (approve in the browser), then build + deploy if the login worked.
#   & C:\Users\inchul\Documents\layers\quiz-functions\deploy-battle.ps1
Set-Location -LiteralPath $PSScriptRoot
aws sso login --profile inchul
if ($LASTEXITCODE -ne 0) { Write-Host 'SSO login did not finish - nothing was deployed.'; exit 1 }
node build-battle.mjs
if ($LASTEXITCODE -ne 0) { Write-Host 'Build failed - nothing was deployed.'; exit 1 }
node deploy-battle.mjs
