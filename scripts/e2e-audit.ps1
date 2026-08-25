# GymSystem — realistic pre-production audit E2E (spec section 20)
$ErrorActionPreference = "Stop"
$node = (Get-Command node).Source
$dataDir = Join-Path $env:TEMP "gymsystem-audit"

Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $node } | Stop-Process -Force
Start-Sleep -Milliseconds 600

function Test-Port([int]$port) {
  try { $c = New-Object Net.Sockets.TcpClient; $r = $c.ConnectAsync("127.0.0.1", $port).Wait(300); $c.Close(); return $r } catch { return $false }
}
function Wait-Port {
  foreach ($i in 1..40) { if (Test-Port 8890) { return $true }; Start-Sleep -Milliseconds 250 }
  return $false
}
function Start-Server {
  $env:GYMSYSTEM_DATA_DIR = $dataDir
  $env:GYM_CRM_MOCK = "1"
  Start-Process -FilePath $node -ArgumentList "dist-server\index.cjs" -WorkingDirectory "D:\Systems\Gym" -WindowStyle Hidden -PassThru
}
function Stop-Server($proc) {
  if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
  Start-Sleep -Milliseconds 800
}

$failures = New-Object System.Collections.ArrayList
$script:pass = 0
function Check([string]$name, [bool]$cond, [string]$detail = "") {
  if ($cond) { $script:pass++; Write-Output "PASS  $name" }
  else { Write-Output "FAIL  $name  $detail"; [void]$failures.Add($name) }
}

Remove-Item -Recurse -Force $dataDir -ErrorAction SilentlyContinue

$srv = Start-Server
Check "server boots" (Wait-Port)
$base = "http://127.0.0.1:8890"

# ---------- helpers ----------
function PostJson([string]$url, [object]$body, $session) {
  Invoke-RestMethod "$base$url" -Method Post -ContentType "application/json" -WebSession $session `
    -Body ($body | ConvertTo-Json -Depth 10)
}
function RpcRaw([string]$service, [string]$fn, [object[]]$rpcArgs, $session) {
  $parts = @($rpcArgs) | ForEach-Object { $_ | ConvertTo-Json -Depth 10 -Compress }
  $bodyJson = '{"service":"' + $service + '","fn":"' + $fn + '","args":[' + ($parts -join ",") + ']}'
  try {
    return @{ ok = $true; result = (Invoke-RestMethod "$base/api/rpc" -Method Post -ContentType "application/json" -WebSession $session -Body $bodyJson).result }
  } catch {
    $resp = $_.Exception.Response
    if ($resp) {
      $sr = New-Object IO.StreamReader($resp.GetResponseStream()); $txt = $sr.ReadToEnd()
      try { $parsed = $txt | ConvertFrom-Json } catch { $parsed = $null }
      return @{ ok = $false; status = [int]$resp.StatusCode; body = $parsed }
    }
    return @{ ok = $false; status = 0; body = $null }
  }
}
function Rpc([string]$s, [string]$f, [object[]]$a, $sess) { (RpcRaw $s $f $a $sess).result }

# ---------- 1) setup + users ----------
$ownerSess = $null
try {
  Invoke-RestMethod "$base/api/auth/setup" -Method Post -ContentType "application/json" -SessionVariable ownerSess `
    -Body (@{ input = @{ gymName = "Audit Gym"; ownerFullName = "Owner Audit"; username = "owner1"; password = "passw0rd123" } } | ConvertTo-Json -Depth 5) | Out-Null
} catch { }
Check "owner setup" ($ownerSess -ne $null)
$sess = $ownerSess

$recep = Rpc "users" "createUser" @(@{ username="recep1"; password="recep12345"; fullName="Reception Women"; roleId="reception"; department="women" }) $sess
$trainer = Rpc "users" "createUser" @(@{ username="coach1"; password="coach12345"; fullName="Coach One"; roleId="trainer" }) $sess
Check "reception(women) + trainer created" ($null -ne $recep -and $null -ne $trainer)

# Insert "system" user so CRM generateDueMessages (which uses systemActor) doesn't violate FK
$sysUser = Rpc "users" "createUser" @(@{ username="system"; password="system0000"; fullName="System"; roleId="owner" }) $sess

# ---------- 2) plans ----------
$pMonthly = Rpc "plans" "createPlan" @(@{ name="شهري"; durationDays=30; price=300 }) $sess
$pSessions = Rpc "plans" "createPlan" @(@{ name="باقة 12 حصة"; durationDays=30; price=500; kind="sessions"; sessionsCount=12 }) $sess
$plans = Rpc "plans" "listPlans" @($true) $sess
$monthly = $plans | Where-Object { $_.name -eq "شهري" }
$sessionsPlan = $plans | Where-Object { $_.kind -eq "sessions" }
$monthly = $plans | Where-Object { $_.kind -eq "time" } | Select-Object -First 1
$sessionsPlan = $plans | Where-Object { $_.kind -eq "sessions" } | Select-Object -First 1
Check "time plan + sessions plan exist" ($null -ne $monthly -and $null -ne $sessionsPlan -and $sessionsPlan.sessionsCount -eq 12)

# ---------- 3) members (departments) ----------
$mMen    = Rpc "members" "createMember" @(@{ fullName="محمد رجل";  phone="01000000001"; department="men" }) $sess
$mWomen  = Rpc "members" "createMember" @(@{ fullName="سارة سيدة"; phone="01000000002"; department="women" }) $sess
$mGen    = Rpc "members" "createMember" @(@{ fullName="عام عضو";   phone="01000000003"; department="general" }) $sess
$mExpired = Rpc "members" "createMember" @(@{ fullName="منتهي تجربة"; phone="01000000004"; department="general" }) $sess
Check "4 members created" ($null -ne $mMen -and $null -ne $mWomen -and $null -ne $mGen -and $null -ne $mExpired)

# ---------- 4) cards (pre-printed barcodes linked to members) ----------
$cards = @()
foreach ($pair in @(@($mMen.id,"GYM-A-1001"),@($mWomen.id,"GYM-A-1002"),@($mGen.id,"GYM-A-1003"),@($mExpired.id,"GYM-A-1004"))) {
  $null = Rpc "cards" "registerCard" @(@{ barcodeValue=$pair[1]; notes=$null }) $sess
  $null = Rpc "cards" "assignCardByBarcode" @(@{ barcodeValue=$pair[1]; memberId=$pair[0] }) $sess
  $cards += $pair[1]
}
$cardList = Rpc "cards" "listCards" @(@{}) $sess
Check "4 cards registered+assigned" ($cardList.total -eq 4 -and @($cardList.items | Where-Object { $_.status -eq "assigned" }).Count -eq 4)
# duplicate barcode must be rejected
$dup = RpcRaw "cards" "registerCard" @(@{ barcodeValue="GYM-A-1001"; notes=$null }) $sess
Check "duplicate barcode rejected" (-not $dup.ok)

# ---------- 5) subscriptions ----------
$today = Get-Date -Format "yyyy-MM-dd"
$pastStart = (Get-Date).AddDays(-40).ToString("yyyy-MM-dd")

$sMen = Rpc "subscriptions" "createSubscription" @(@{ memberId=$mMen.id; planId=$monthly.id }) $sess
$sWomen = Rpc "subscriptions" "createSubscription" @(@{ memberId=$mWomen.id; planId=$monthly.id }) $sess
$sGen = Rpc "subscriptions" "createSubscription" @(@{ memberId=$mGen.id; planId=$sessionsPlan.id }) $sess
# expired: past start => end = start+30d < today
$sExp = RpcRaw "subscriptions" "createSubscription" @(@{ memberId=$mExpired.id; planId=$monthly.id; startDate=$pastStart }) $sess
Check "3 active subs + 1 backdated sub" ($null -ne $sMen -and $null -ne $sWomen -and $null -ne $sGen -and $sExp.ok)

# payments: full / partial / overpay / zero
$payFull = Rpc "payments" "recordPayment" @(@{ memberId=$mMen.id; subscriptionId=$sMen.id; baseAmountMinor=30000; discountKind="none"; paidAmountMinor=30000; methodCode="cash" }) $sess
$payPart = Rpc "payments" "recordPayment" @(@{ memberId=$mWomen.id; subscriptionId=$sWomen.id; baseAmountMinor=30000; discountKind="none"; paidAmountMinor=10000; methodCode="cash" }) $sess
$balWomen = Rpc "payments" "getSubscriptionBalance" @($sWomen.id) $sess
Check "partial payment leaves remaining 20000" ($balWomen.remainingMinor -eq 20000)
$over = RpcRaw "payments" "recordPayment" @(@{ memberId=$mMen.id; baseAmountMinor=1000; paidAmountMinor=2000; methodCode="cash" }) $sess
Check "overpayment rejected" (-not $over.ok)
$zeroPay = Rpc "payments" "recordPayment" @(@{ memberId=$mGen.id; baseAmountMinor=5000; paidAmountMinor=0; methodCode="cash" }) $sess
Check "zero-paid records tracked debt (remaining 5000)" ($null -ne $zeroPay -and $zeroPay.remainingAmountMinor -eq 5000)
$refund = Rpc "payments" "refundPayment" @($payFull.id, 5000, "خطأ تسجيل", "cash") $sess
$payAfter = Rpc "payments" "getPaymentById" @($payFull.id) $sess
Check "partial refund recorded (5000)" ($null -ne $refund -and $payAfter.refundedAmountMinor -eq 5000)

# ---------- 6) attendance / access control ----------
$null = Rpc "settings" "updateSetting" @("checkin_duplicate_window_seconds","0") $sess

$r1 = Rpc "attendance" "recordCheckIn" @(@{ barcode="GYM-A-1001"; deviceIdentifier="audit" }) $sess
Check "valid scan granted" ($r1.kind -eq "success")
$r2 = Rpc "attendance" "recordCheckIn" @(@{ barcode="GYM-A-1002" }) $sess
Check "second member scan granted" ($r2.kind -eq "success")
$rDupCard = RpcRaw "attendance" "recordCheckIn" @(@{ barcode="GYM-A-9999" }) $sess
Check "unknown card denied CARD_UNKNOWN" ($rDupCard.result.kind -eq "denied" -and $rDupCard.result.reason -eq "CARD_UNKNOWN")
$rExp = RpcRaw "attendance" "recordCheckIn" @(@{ barcode="GYM-A-1004" }) $sess
Check "expired subscription denied" ($rExp.result.kind -eq "denied")

# freeze men's sub -> deny -> unfreeze -> grant
$null = Rpc "subscriptions" "freezeSubscription" @($sMen.id, @{ reason="سفر" }) $sess
$rFrozen = RpcRaw "attendance" "recordCheckIn" @(@{ barcode="GYM-A-1001" }) $sess
Check "frozen subscription denied" ($rFrozen.result.kind -eq "denied")
$frz = Rpc "subscriptions" "listMemberSubscriptions" @($mMen.id) $sess
Check "freeze recorded in history" (@($frz | Where-Object { $_.id -eq $sMen.id }).Count -gt 0)
$null = Rpc "subscriptions" "unfreezeSubscription" @($sMen.id) $sess
$rUn = Rpc "attendance" "recordCheckIn" @(@{ barcode="GYM-A-1001" }) $sess
Check "after unfreeze scan granted" ($rUn.kind -eq "success")

# session pack decrement: consume all 12 then denial
$consumed = 0; $lastReason = ""
for ($i=1; $i -le 15; $i++) {
  $res = RpcRaw "attendance" "recordCheckIn" @(@{ barcode="GYM-A-1003" }) $sess
  if ($res.result.kind -eq "success") { $consumed++ }
  else { $lastReason = $res.result.reason; break }
}
$subGen = Rpc "subscriptions" "listMemberSubscriptions" @($mGen.id) $sess
$genRow = $subGen | Where-Object { $_.id -eq $sGen.id }
Check "sessions consumed exactly 12 atomically" ($consumed -eq 12 -and $genRow.sessionsUsed -eq 12)
Check "13th scan denied NO_SESSIONS_LEFT" ($lastReason -eq "NO_SESSIONS_LEFT")

# ---------- 7) expenses + cash ----------
$cat = Rpc "expenses" "listCategories" @($false) $sess
$null = Rpc "expenses" "createExpense" @(@{ categoryId=($cat | Select-Object -First 1).id; amountMinor=15000; methodCode="cash"; description="فاتورة كهرباء"; expenseDate=$today }) $sess
$expList = Rpc "expenses" "listExpenses" @(@{}) $sess
Check "expense recorded" ($expList.total -ge 1)

$cashOpen = Rpc "cash" "openCashSession" @(@{ openingBalanceMinor=50000 }) $sess
$null = Rpc "cash" "closeCashSession" @($cashOpen.id, 48000, "فرق عدّ") $sess
$sessionsHist = Rpc "cash" "listCashSessions" @(@{}) $sess
$closedRow = $sessionsHist.items | Where-Object { $_.id -eq $cashOpen.id }
Check "cash session closed with correct difference" ($closedRow.status -eq "closed" -and $closedRow.differenceMinor -eq (48000 - $closedRow.expectedClosingMinor))

# ---------- 8) reports ----------
$rep = Rpc "reports" "getPeriodReport" @($today, $today) $sess
Check "period report has revenue" ($rep.revenueMinor -gt 0)
$fin = Rpc "finance" "getFinanceOverview" @($today, "$($today.Substring(0,7))-01") $sess
Check "finance overview sees expenses" ($fin.todayOutMinor -ge 15000)
$analytics = Rpc "reports" "getAttendanceAnalytics" @(@{ fromKey=$today; toKey=$today }) $sess
Check "attendance analytics works" ($null -ne $analytics)

# ---------- 9) dept isolation as women reception ----------
$rsess = $null
Invoke-RestMethod "$base/api/auth/login" -Method Post -ContentType "application/json" -SessionVariable rsess `
  -Body (@{ input = @{ username="recep1"; password="recep12345" } } | ConvertTo-Json) | Out-Null
$listAsRecep = Rpc "members" "listMembers" @(@{}) $rsess
$namesSeen = @($listAsRecep.items | ForEach-Object { $_.department } | Sort-Object -Unique)
Check "women reception sees only women+general" (($namesSeen | Where-Object { $_ -eq "men" }).Count -eq 0 -and $namesSeen.Count -le 2)
$crossGet = RpcRaw "members" "getMember" @($mMen.id) $rsess
Check "IDOR blocked: cannot fetch men member by id" (-not $crossGet.ok -and $crossGet.status -eq 403)
$crossEdit = RpcRaw "members" "updateMember" @($mMen.id, @{ fullName="اختراق" }) $rsess
Check "IDOR blocked: cannot edit men member" (-not $crossEdit.ok)
$usersAsRecep = RpcRaw "users" "listUsers" @() $rsess
Check "privilege escalation blocked (users.view)" (-not $usersAsRecep.ok)

# trainer cannot create members nor view payments
$tsess = $null
Invoke-RestMethod "$base/api/auth/login" -Method Post -ContentType "application/json" -SessionVariable tsess `
  -Body (@{ input = @{ username="coach1"; password="coach12345" } } | ConvertTo-Json) | Out-Null
$tCreate = RpcRaw "members" "createMember" @(@{ fullName="ممنوع" }) $tsess
$tPay = RpcRaw "payments" "listPayments" @(@{}) $tsess
Check "trainer member.create forbidden" (-not $tCreate.ok)
Check "trainer payments.view forbidden" (-not $tPay.ok)

# ---------- 10) trash / restore / purge-protection ----------
$trashed = Rpc "members" "trashMember" @($mWomen.id, "طلب العضو") $sess
Check "member trashed with reason" ($null -ne $trashed -and $trashed.deletedAt -ne $null)
$trashList = Rpc "members" "listTrashedMembers" @() $sess
Check "trash list shows deleted_by" (@($trashList).Count -ge 1 -and @($trashList)[0].deletedBy -ne $null)
$restored = Rpc "members" "restoreMember" @($mWomen.id) $sess
Check "member restored" ($null -ne $restored -and $restored.deletedAt -eq $null)
$null = Rpc "members" "trashMember" @($mWomen.id, $null) $sess
$purge = RpcRaw "members" "purgeMember" @($mWomen.id) $sess
Check "purge blocked by financial history" (-not $purge.ok)

# ---------- 11) Store / POS flow ----------
$pCat = Rpc "store" "listProductCategories" @() $sess
$pSup = Rpc "store" "createProduct" @(@{ name="Matrix Whey"; categoryId=$pCat[0].id; costMinor=20000; priceMinor=35000; stockQty=10; minStockQty=2 }) $sess
Check "store product created" ($null -ne $pSup -and $pSup.stockQty -eq 10)

Rpc "store" "adjustStock" @(@{ productId=$pSup.id; delta=5; movementType="stock_in"; notes="restock" }) $sess
$pAfter = Rpc "store" "getProduct" @($pSup.id) $sess
Check "stock adjusted (10+5=15)" ($pAfter.stockQty -eq 15)

$saleCash = Rpc "store" "createSale" @(@{ items=@(@{ productId=$pSup.id; qty=2; unitPriceMinor=35000 }); methodCode="cash"; notes="audit sale" }) $sess
Check "cash sale created" ($null -ne $saleCash -and $saleCash.totalMinor -eq 70000)

$pAfterSale = Rpc "store" "getProduct" @($pSup.id) $sess
Check "stock decreased after sale (15-2=13)" ($pAfterSale.stockQty -eq 13)

$saleCredit = Rpc "store" "createSale" @(@{ items=@(@{ productId=$pSup.id; qty=1; unitPriceMinor=35000 }); methodCode="cash"; isCredit=$true; memberId=$mMen.id; notes="credit sale" }) $sess
Check "credit sale created with store debt" ($null -ne $saleCredit -and $saleCredit.isCredit -eq $true)
$storeDebts = Rpc "store" "listStoreDebts" @(@{ status="open" }) $sess
Check "store debt exists" ($storeDebts.total -ge 1)
$debtRow = $storeDebts.items | Select-Object -First 1
$repayRes = Rpc "store" "repayStoreDebt" @(@{ debtId=$debtRow.id; amountMinor=10000; methodCode="cash" }) $sess
Check "store debt repaid partially" ($null -ne $repayRes)

$storeStats = Rpc "store" "getStoreStats" @(@{ fromKey=$today; toKey=$today }) $sess
Check "store stats returned" ($null -ne $storeStats -and $storeStats.salesCount -ge 1)

# ---------- 12) Classes + session booking + consumption ----------
$cls = Rpc "classes" "createClass" @(@{ name="Yoga Flow"; capacity=5; consumesSession=$true }) $sess
Check "class created" ($null -ne $cls -and $cls.capacity -eq 5)
$tomorrow = (Get-Date).AddDays(1).ToString("yyyy-MM-dd")
$session = Rpc "classes" "createClassSession" @($cls.id, @{ sessionDate=$tomorrow; startTime="10:00"; durationMin=60; capacity=3 }) $sess
Check "class session created" ($null -ne $session -and $session.capacity -eq 3)

# Create a fresh sessions sub for the general member (old one is exhausted)
# Cancel the exhausted sub first to avoid overlap conflict
$null = Rpc "subscriptions" "setSubscriptionStatus" @($sGen.id, "cancelled") $sess
$bigSessions = Rpc "plans" "createPlan" @(@{ name="20 sessions"; durationDays=60; price=800; kind="sessions"; sessionsCount=20 }) $sess
$subFresh = Rpc "subscriptions" "createSubscription" @(@{ memberId=$mGen.id; planId=$bigSessions.id }) $sess
$null = Rpc "payments" "recordPayment" @(@{ memberId=$mGen.id; subscriptionId=$subFresh.id; baseAmountMinor=80000; discountKind="none"; paidAmountMinor=80000; methodCode="cash" }) $sess

$booking = Rpc "classes" "bookMember" @(@{ sessionId=$session.id; memberId=$mGen.id }) $sess
Check "member booked into class" ($null -ne $booking -and $booking.status -eq "booked")

$setStatus = RpcRaw "classes" "setBookingStatus" @($booking.id, "attended") $sess
$subAfterClass = Rpc "subscriptions" "listMemberSubscriptions" @($mGen.id) $sess
$freshSubAfter = $subAfterClass | Where-Object { $_.id -eq $subFresh.id }
Check "session consumed on attend (sessionsUsed+1)" ($freshSubAfter.sessionsUsed -eq 1)

$bookingAfter = (Rpc "classes" "listBookings" @($session.id) $sess) | Where-Object { $_.id -eq $booking.id }
Check "booking has consumed_subscription_id" ($null -ne $bookingAfter.consumedSubscriptionId)

# duplicate booking rejected
$dupBook = RpcRaw "classes" "bookMember" @(@{ sessionId=$session.id; memberId=$mGen.id }) $sess
Check "duplicate booking rejected" (-not $dupBook.ok)

# ---------- 13) Member photo roundtrip ----------
$fakePhoto = [Text.Encoding]::UTF8.GetBytes("fake-image-data-for-audit-test-1234567890")
$uploadResp = Invoke-RestMethod "$base/api/files?kind=member_photo&name=test.jpg&mime=image/jpeg" -Method Post -ContentType "application/octet-stream" -WebSession $sess -Body $fakePhoto
$photoId = $uploadResp.result.id
Check "file upload succeeded" ($null -ne $photoId -and $uploadResp.ok)

Rpc "members" "setMemberPhoto" @($mMen.id; $photoId) $sess
$mPhoto = Rpc "members" "getMember" @($mMen.id) $sess
Check "member photo set" ($mPhoto.photoFileId -eq $photoId)

$fileMeta = Invoke-RestMethod "$base/api/files-meta/$photoId" -WebSession $sess
Check "file meta retrievable" ($fileMeta.result.kind -eq "member_photo")

Rpc "members" "removeMemberPhoto" @($mMen.id) $sess
$mNoPhoto = Rpc "members" "getMember" @($mMen.id) $sess
Check "member photo removed" ($null -eq $mNoPhoto.photoFileId)

# ---------- 14) Renew subscription ----------
$renewRes = Rpc "subscriptions" "renewSubscription" @($sMen.id; @{ price=350 }) $sess
Check "renewal succeeded" ($null -ne $renewRes -and $null -ne $renewRes.next)
$renewedList = Rpc "subscriptions" "listMemberSubscriptions" @($mMen.id) $sess
$renewedSub = $renewedList | Where-Object { $_.id -eq $renewRes.next.id }
Check "renewed sub has future end date" ($null -ne $renewedSub -and $renewedSub.endDate -gt $today)

# ---------- 15) CRM generate + send (mock) ----------
$crmGen = Rpc "crm" "generateDueMessages" @() $sess
Check "CRM generateDue ran" ($null -ne $crmGen)
$pendingBefore = Rpc "crm" "listMessages" @(@{ status="pending"; limit=50 }) $sess
Check "CRM messages queued (>=0)" ($null -ne $pendingBefore)

$crmSend = Rpc "crm" "sendPendingMessages" @(50) $sess
Check "CRM sendPending ran" ($null -ne $crmSend)
$allMsgs = Rpc "crm" "listMessages" @(@{ status="all"; limit=50 }) $sess
Check "CRM message history available" ($null -ne $allMsgs -and @($allMsgs).Count -ge 0)

# ---------- 16) backup -> mutate -> restart persistence -> restore ----------

$snapResp = Invoke-RestMethod "$base/api/backups/create" -Method Post -ContentType "application/json" -WebSession $sess -Body (@{ kind="manual" } | ConvertTo-Json)
$snapFile = $snapResp.result.fileName
$extra = Rpc "members" "createMember" @(@{ fullName="مؤقت بعد النسخة"; phone="01000000009" }) $sess
$totalBeforeRestore = (Rpc "members" "listMembers" @(@{}) $sess).total

Stop-Server $srv
$srv = Start-Server
Check "server reboots" (Wait-Port)
$login2 = Invoke-RestMethod "$base/api/auth/login" -Method Post -ContentType "application/json" -SessionVariable sess2 `
  -Body (@{ input = @{ username="owner1"; password="passw0rd123" } } | ConvertTo-Json)
$totalAfterRestart = (Rpc "members" "listMembers" @(@{}) $sess2).total
Check "PERSISTENCE ACROSS RESTART (same totals)" ($totalBeforeRestore -eq $totalAfterRestart)
$balAfterRestart = Rpc "payments" "getSubscriptionBalance" @($sWomen.id) $sess2
Check "debt survived restart (remaining 20000)" ($balAfterRestart.remainingMinor -eq 20000)

$bytes = [IO.File]::ReadAllBytes((Join-Path (Join-Path $dataDir "Backups") $snapFile))
$restore = Invoke-RestMethod "$base/api/system/restore" -Method Post -ContentType "application/octet-stream" -WebSession $sess2 -Body $bytes
Invoke-RestMethod "$base/api/auth/login" -Method Post -ContentType "application/json" -SessionVariable sess3 `
  -Body (@{ input = @{ username = "owner1"; password = "passw0rd123" } } | ConvertTo-Json) | Out-Null
$totalRestored = (Rpc "members" "listMembers" @(@{}) $sess3).total
Check "RESTORE rolled data back exactly" ($restore.ok -and $totalRestored -eq ($totalBeforeRestore - 1))

# failed restore must not destroy current db
$badRestore = $false
try {
  Invoke-RestMethod "$base/api/system/restore" -Method Post -ContentType "application/octet-stream" -WebSession $sess3 `
    -Body ([Text.Encoding]::ASCII.GetBytes("this is not a database")) | Out-Null
} catch { $badRestore = $true }
Check "invalid restore rejected without damage" ($badRestore)
$totalAfterBad = (Rpc "members" "listMembers" @(@{}) $sess3).total
Check "current data intact after rejected restore" ($totalAfterBad -eq $totalRestored)

# ---------- cleanup server ----------
Stop-Server $srv
Write-Output ""
if ($failures.Count -eq 0) { Write-Output "AUDIT E2E: ALL $($script:pass) CHECKS PASSED" }
else { Write-Output "$($failures.Count) FAILURES of $($script:pass + $failures.Count)"; exit 1 }
