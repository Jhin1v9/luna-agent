$os = Get-CimInstance Win32_OperatingSystem
Write-Output ('LastBoot: ' + $os.LastBootUpTime)
Write-Output ('Now:      ' + (Get-Date))
Write-Output '--- Kernel-Power ultimos 14 (42=sono 107=hibernar 1/109=boot 506=resumo energia):'
Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='Microsoft-Windows-Kernel-Power'} -MaxEvents 14 -ErrorAction SilentlyContinue | ForEach-Object {
  $msg = $_.Message
  if ($msg.Length -gt 90) { $msg = $msg.Substring(0,90) }
  Write-Output ($_.Id.ToString().PadRight(6) + $_.TimeCreated.ToString('MM-dd HH:mm:ss') + '  ' + $msg)
}
