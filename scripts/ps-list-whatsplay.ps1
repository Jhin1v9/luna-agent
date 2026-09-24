Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'whatsplay' } |
  Select-Object ProcessId, ParentProcessId,
    @{ N = 'Started'; E = { $_.CreationDate } },
    @{ N = 'Cmd'; E = { $_.CommandLine.Substring(0, [Math]::Min(160, $_.CommandLine.Length)) } } |
  Format-List
