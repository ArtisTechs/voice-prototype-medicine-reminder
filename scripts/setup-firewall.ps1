# One-time, needs admin: let phones and the MIRA device reach this laptop on any network
# (phone hotspots and the Windows Mobile hotspot are usually "Public" networks).
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  exit
}
foreach ($r in @(@{Name = 'MIRA API 5055'; Port = 5055 }, @{Name = 'MIRA Expo 8081'; Port = 8081 })) {
  Get-NetFirewallRule -DisplayName $r.Name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -DisplayName $r.Name -Direction Inbound -Protocol TCP -LocalPort $r.Port -Action Allow -Profile Any | Out-Null
  Write-Host "Opened port $($r.Port)"
}
Read-Host 'Done. Press Enter to close'
