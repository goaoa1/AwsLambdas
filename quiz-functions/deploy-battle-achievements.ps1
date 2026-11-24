# Battle achievements deploy (2026-11-24): AWS SSO login (approve in the browser), then build + deploy if the login worked.
#   FinishBattle (battle finish adds achievement progress, role gets PlayerStats) + GetAchievements/ClaimAchievement (new catalog).
#   & C:\Users\inchul\Documents\layers\quiz-functions\deploy-battle-achievements.ps1
Set-Location -LiteralPath $PSScriptRoot
aws sso login --profile inchul
if ($LASTEXITCODE -ne 0) { Write-Host 'SSO login did not finish - nothing was deployed.'; exit 1 }
node build-battle.mjs
if ($LASTEXITCODE -ne 0) { Write-Host 'Battle build failed - nothing was deployed.'; exit 1 }
node build-achievements.mjs
if ($LASTEXITCODE -ne 0) { Write-Host 'Achievements build failed - nothing was deployed.'; exit 1 }
node deploy-battle.mjs
if ($LASTEXITCODE -ne 0) { Write-Host 'Battle deploy failed - achievements were not deployed.'; exit 1 }
node deploy-achievement-code.mjs
