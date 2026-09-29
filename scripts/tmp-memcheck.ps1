Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 14 Name,Id,@{N='MemMB';E={[math]::Round($_.WorkingSet64/1MB)}} | Format-Table -AutoSize
$os = Get-CimInstance Win32_OperatingSystem
"TotalMB: {0} / FreeMB: {1}" -f [math]::Round($os.TotalVisibleMemorySize/1024), [math]::Round($os.FreePhysicalMemory/1024)
