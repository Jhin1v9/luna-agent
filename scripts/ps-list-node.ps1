Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Select-Object ProcessId, ParentProcessId,
    @{ N = 'Started'; E = { $_.CreationDate } },
    @{ N = 'Cmd'; E = { $_.CommandLine.Substring(0, [Math]::Min(200, $_.CommandLine.Length)) } } |
  Format-List
