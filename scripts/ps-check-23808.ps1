try {
  $p = Get-Process -Id 23808 -ErrorAction Stop
  Write-Output ("23808 VIVO: " + $p.ProcessName + " started " + $p.StartTime)
} catch {
  Write-Output "23808 MORTO"
}
Write-Output "---- node.exe ----"
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Select-Object ProcessId, ParentProcessId,
    @{ N = 'Started'; E = { $_.CreationDate } },
    @{ N = 'Cmd'; E = { $_.CommandLine.Substring(0, [Math]::Min(200, $_.CommandLine.Length)) } } |
  Format-List
