# getActiveSession strongly consistent read deploy (2026-11-25): AWS SSO login only if the session expired (approve in the browser),
#   then python deploy-consistent-read.py (new quiz-utils layer version + the seven quiz-session Lambdas switched to it).
#   & C:\Users\inchul\Documents\layers\quiz-functions\deploy-consistent-read.ps1 [-Dry]
param([switch]$Dry)
Set-Location -LiteralPath $PSScriptRoot
aws sts get-caller-identity --profile inchul *> $null
if ($LASTEXITCODE -ne 0) {
  aws sso login --profile inchul
  if ($LASTEXITCODE -ne 0) { Write-Host 'SSO login did not finish - nothing was deployed.'; exit 1 }
}
if ($Dry) { python deploy-consistent-read.py --dry } else { python deploy-consistent-read.py }
