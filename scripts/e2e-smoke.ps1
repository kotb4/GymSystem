# GymSystem backend E2E smoke test (spec sections 4/12/16/17/26)
$ErrorActionPreference = "Stop"
$node = (Get-Command node).Source
$dataDir = Join-Path $env:TEMP "gymsystem-e2e"

# kill leftovers from previous runs so port 8890 and data dir are truly free
Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $node } | Stop-Process -Force
Start-Sleep -Milliseconds 600

function Test-Port([int]$port) {
  try {
    $c = New-Object Net.Sockets.TcpClient
    $r = $c.ConnectAsync("127.0.0.1", $port).Wait(300)
    $c.Close(); return $r
  } catch { return $false }
}

function Wait-Port {
  foreach ($i in 1..40) {
    if (Test-Port 8890) { return $true }
    Start-Sleep -Milliseconds 250
  }
  return $false
}

function Start-Server {
  $env:GYMSYSTEM_DATA_DIR = $dataDir
  return Start-Process -FilePath $node -ArgumentList "dist-server\index.cjs" `
    -WorkingDirectory "D:\Systems\Gym" -WindowStyle Hidden -PassThru
}

$failures = New-Object System.Collections.ArrayList
function Check([string]$name, [bool]$cond, [string]$detail = "") {
  if ($cond) { Write-Output "PASS  $name" }
  else { Write-Output "FAIL  $name  $detail"; [void]$failures.Add($name) }
}

Remove-Item -Recurse -Force $dataDir -ErrorAction SilentlyContinue

# ---------- boot 1 ----------
$srv = Start-Server
Check "server boots" (Wait-Port)
$base = "http://127.0.0.1:8890"

$ping = Invoke-RestMethod "$base/api/ping"
Check "GET /api/ping" ($ping.ok -eq $true)

$meAnon = Invoke-RestMethod "$base/api/auth/me"
Check "unauthenticated /me reports needsSetup (200, no crash)" ($meAnon.ok -and $null -eq $meAnon.result.user -and $meAnon.result.needsSetup -eq $true)

# ---------- setup + session ----------
$sess = $null
$setup = Invoke-RestMethod "$base/api/auth/setup" -Method Post -ContentType "application/json" `
  -Body (@{ input = @{ gymName = "Test Gym"; ownerFullName = "Owner Test"; username = "owner1"; password = "passw0rd123" } } | ConvertTo-Json -Depth 5) `
  -SessionVariable sess
Check "POST /api/auth/setup creates owner" ($setup.ok -and $setup.result.roleId -eq "owner")

$me1 = Invoke-RestMethod "$base/api/auth/me" -WebSession $sess
Check "session cookie resolves full user" ($me1.ok -and $me1.result.user.username -eq "owner1" -and $me1.result.user.fullName -eq "Owner Test")
Check "needsSetup false after setup" ($me1.result.needsSetup -eq $false)

# ---------- business data over RPC ----------
function Rpc([string]$service, [string]$fn, [object[]]$rpcArgs, $session) {
  # build JSON manually: PS5.1 ConvertTo-Json collapses single-element arrays
  $parts = @($rpcArgs) | ForEach-Object { $_ | ConvertTo-Json -Depth 8 -Compress }
  $argsJson = "[" + ($parts -join ",") + "]"
  $bodyJson = '{"service":"' + $service + '","fn":"' + $fn + '","args":' + $argsJson + '}'
  return Invoke-RestMethod "$base/api/rpc" -Method Post -ContentType "application/json" -WebSession $session -Body $bodyJson
}

$member = Rpc "members" "createMember" @(@{ fullName = "Ahmed Hassan"; phone = "01000000001" }) $sess
Check "rpc members.createMember" ($member.ok -and $member.result.memberCode)

$list = Rpc "members" "listMembers" @(@{}) $sess
Check "rpc members.listMembers sees member" ($list.ok -and $list.result.total -eq 1)

$methods = Rpc "payments" "listActiveMethods" @() $sess
Check "plain rpc (no actor injection) works" ($methods.ok -and @($methods.result).Count -ge 3)

$trainerUser = Rpc "users" "createUser" @(@{ username = "coach1"; password = "coach12345"; fullName = "Coach One"; roleId = "trainer" }) $sess
Check "users.createUser by owner" ($trainerUser.ok)

# trainer must NOT be allowed to create members -> FORBIDDEN error surfaces
try {
  $trainerSessVarName = "tsess"
  $tlogin = Invoke-RestMethod "$base/api/auth/login" -Method Post -ContentType "application/json" `
    -Body (@{ input = @{ username = "coach1"; password = "coach12345" } } | ConvertTo-Json) `
    -SessionVariable tsess
  try {
    $denied = Rpc "members" "createMember" @(@{ fullName = "Should Fail" }) $tsess
    $deniedProperly = ($null -ne $denied -and $denied.ok -eq $false)
  } catch {
    # HTTP error status (400/401/403) is also a proper denial
    $code = $_.Exception.Response.StatusCode.value__
    $deniedProperly = ($code -eq 400 -or $code -eq 401 -or $code -eq 403)
  }
} catch { $deniedProperly = $false }
Check "permission enforcement server-side (trainer denied)" $deniedProperly

# ---------- backup snapshot ----------
$snap = Invoke-RestMethod "$base/api/backups/create" -Method Post -ContentType "application/json" -WebSession $sess `
  -Body (@{ kind = "manual" } | ConvertTo-Json)
Check "backup snapshot created" ($snap.ok -and $snap.result.fileName)
Check "snapshot downloadable" ((Invoke-RestMethod "$base/api/backups/download?file=$($snap.result.fileName)" -WebSession $sess -OutFile "$env:TEMP\snap-dl.db") -or (Test-Path "$env:TEMP\snap-dl.db"))

# ---------- RESTART: authoritative file must survive ----------
Stop-Process -Id $srv.Id -Force
Start-Sleep -Seconds 1
Check "server stopped" (-not (Test-Port 8890))

$srv = Start-Server
Check "server reboots on same data dir" (Wait-Port)

$login = Invoke-RestMethod "$base/api/auth/login" -Method Post -ContentType "application/json" -SessionVariable sess2 `
  -Body (@{ input = @{ username = "owner1"; password = "passw0rd123" } } | ConvertTo-Json)
Check "login after restart" ($login.ok -and $login.result.username -eq "owner1")

$list2 = Rpc "members" "listMembers" @(@{}) $sess2
Check "DATA SURVIVED RESTART (total=1)" ($list2.ok -and $list2.result.total -eq 1)

$dbExists = Test-Path (Join-Path $dataDir "Database\gym.db")
Check "real sqlite file exists on disk" $dbExists

# ---------- restore round-trip ----------
$snapFile = Join-Path (Join-Path $dataDir "Backups") $snap.result.fileName
Check "snapshot file exists in Backups dir" (Test-Path $snapFile)

$extra = Rpc "members" "createMember" @(@{ fullName = "Extra Person"; phone = "01000000002" }) $sess2
Check "second member added" ($extra.ok)

$bytes = [IO.File]::ReadAllBytes($snapFile)
$restore = Invoke-RestMethod "$base/api/system/restore" -Method Post -ContentType "application/octet-stream" -WebSession $sess2 -Body $bytes
Check "POST /api/system/restore accepts verified snapshot" ($restore.ok -and $null -ne $restore.result.protectedBackupFileName)
Check "restore report contains counts" ($restore.result.after.members -eq 1)

# sessions live inside the database -> after a restore everyone must log in again
$sess4 = $null
Invoke-RestMethod "$base/api/auth/login" -Method Post -ContentType "application/json" -SessionVariable sess4 `
  -Body (@{ input = @{ username = "owner1"; password = "passw0rd123" } } | ConvertTo-Json) | Out-Null

$list3 = Rpc "members" "listMembers" @(@{}) $sess4
Check "restored state back to 1 member" ($list3.ok -and $list3.result.total -eq 1)

# ---------- static frontend serving + cache policy ----------
$htmlRes = Invoke-WebRequest "$base/" -UseBasicParsing
$noStore = $htmlRes.Headers["Cache-Control"]
Check "serves index.html" ($htmlRes.Content -match "<script")
Check "index.html sent no-cache (updates without clearing cache)" ($noStore -match "no-cache")

Stop-Process -Id $srv.Id -Force -ErrorAction SilentlyContinue

Write-Output ""
$log = Join-Path (Join-Path $dataDir "Logs") "server.log"
if (Test-Path $log) { Write-Output "--- server.log tail ---"; Get-Content $log -Tail 8 }

Write-Output ""
if ($failures.Count -eq 0) { Write-Output "ALL E2E CHECKS PASSED" }
else { Write-Output "$($failures.Count) FAILURES"; exit 1 }
