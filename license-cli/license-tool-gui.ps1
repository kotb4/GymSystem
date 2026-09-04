#============================================================
#  Yassen Mohamed Kotb | 01288536381  -  License Tool GUI v7
#  Windows Forms GUI for issuing GymSystem offline licenses.
#  Zero dependencies: PowerShell 5.1 + node (signing logic stays
#  in license-tool.mjs — this is just the skin).
#
#  v7 changes:
#    - Manual HWID input: the tool NEVER auto-creates a file for
#      the machine it runs on — type/paste the HWID of ANY target
#      machine (shown inside the app's activation screen).
#    - Batch list: add unlimited machines, then generate one
#      license.lic per machine into license-cli/issued/.
#    - Owner branding (Yassen Mohamed Kotb | 01288536381) header
#      and footer, like the system.
#============================================================
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$OwnerLine = "Yassen Mohamed Kotb | 01288536381"
$ToolName  = "GymSystem - License Tool v7"
$PSScript  = $PSScriptRoot
if (-not $PSScript) { $PSScript = Split-Path -Parent $MyInvocation.MyCommand.Path }
$ToolMjs   = Join-Path $PSScript "license-tool.mjs"
$IssuedDir = Join-Path $PSScript "issued"
$HWID_RE   = "^GYM-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}$"

# ------------------------------------------------------------
#  Node helper: run license-tool.mjs, return result object
# ------------------------------------------------------------
function Invoke-LicenseCli {
  param([string[]]$ToolArgs)
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js غير موجود في مسار النظام (PATH). تأكد من تثبيت Node ثم أعد المحاولة."
  }
  $output = & node $ToolMjs @ToolArgs 2>&1 | Out-String
  return [pscustomobject]@{ Exit = $LASTEXITCODE; Out = [string]$output }
}

# ------------------------------------------------------------
#  Dark palette
# ------------------------------------------------------------
$cBg     = [System.Drawing.Color]::FromArgb(18, 18, 24)
$cPanel  = [System.Drawing.Color]::FromArgb(24, 24, 32)
$cBorder = [System.Drawing.Color]::FromArgb(52, 52, 64)
$cText   = [System.Drawing.Color]::FromArgb(220, 220, 230)
$cMuted  = [System.Drawing.Color]::FromArgb(150, 150, 160)
$cNeon   = [System.Drawing.Color]::FromArgb(64, 233, 255)
$cGreen  = [System.Drawing.Color]::FromArgb(140, 233, 160)
$cBtn    = [System.Drawing.Color]::FromArgb(42, 42, 55)
$cBtnOk  = [System.Drawing.Color]::FromArgb(20, 120, 90)
$cBtnWarn= [System.Drawing.Color]::FromArgb(150, 90, 40)
$cMon    = New-Object System.Drawing.Font("Consolas", 10)
$cMonoLt = New-Object System.Drawing.Font("Consolas", 9)

$baseFont = New-Object System.Drawing.Font("Segoe UI", 9.5)

# ------------------------------------------------------------
#  Form
# ------------------------------------------------------------
$form = New-Object System.Windows.Forms.Form
$form.Text            = $ToolName
$form.StartPosition   = "CenterScreen"
$form.FormBorderStyle = "FixedSingle"
$form.MaximizeBox     = $false
$form.ClientSize      = New-Object System.Drawing.Size(640, 700)
$form.Icon            = [System.Drawing.SystemIcons]::Application
$form.BackColor       = $cBg

# ---------------- Header ----------------
$title = New-Object System.Windows.Forms.Label
$title.Text     = "أداة إصدار تراخيص جيم سيستم"
$title.Font     = New-Object System.Drawing.Font("Segoe UI", 15, [System.Drawing.FontStyle]::Bold)
$title.ForeColor= $cNeon
$title.AutoSize = $true
$title.Location = New-Object System.Drawing.Point(20, 14)

$owner = New-Object System.Windows.Forms.Label
$owner.Text     = $OwnerLine
$owner.Font     = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
$owner.ForeColor= [System.Drawing.Color]::FromArgb(255, 210, 90)
$owner.AutoSize = $true
$owner.Location = New-Object System.Drawing.Point(20, 48)

$subtit = New-Object System.Windows.Forms.Label
$subtit.Text    = "أدخل HWID الجهاز المستهدف (يظهر داخل شاشة التفعيل في التطبيق) لإنشاء ملف ترخيص له — يمكن إضافة أجهزة بلا حدود."
$subtit.Font    = $baseFont
$subtit.ForeColor= $cMuted
$subtit.AutoSize = $true
$subtit.Location = New-Object System.Drawing.Point(20, 74)

# ---------------- Issue group ----------------
$issueGroup = New-Object System.Windows.Forms.GroupBox
$issueGroup.Text = "إضافة جهاز للقائمة"
$issueGroup.ForeColor = $cText
$issueGroup.Font = $baseFont
$issueGroup.BackColor = $cPanel
$issueGroup.Location = New-Object System.Drawing.Point(20, 104)
$issueGroup.Size = New-Object System.Drawing.Size(600, 150)

$lblHwid = New-Object System.Windows.Forms.Label
$lblHwid.Text = "HWID الجهاز:"
$lblHwid.ForeColor = $cText
$lblHwid.Location = New-Object System.Drawing.Point(16, 34)
$lblHwid.AutoSize = $true

$txtHwid = New-Object System.Windows.Forms.TextBox
$txtHwid.Location = New-Object System.Drawing.Point(120, 30)
$txtHwid.Size = New-Object System.Drawing.Size(330, 24)
$txtHwid.Font = $cMon
$txtHwid.BackColor = [System.Drawing.Color]::FromArgb(30, 30, 40)
$txtHwid.ForeColor = $cGreen
$txtHwid.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$txtHwid.CharacterCasing = [System.Windows.Forms.CharacterCasing]::Upper

$btnPaste = New-Object System.Windows.Forms.Button
$btnPaste.Text = "لصق"
$btnPaste.Location = New-Object System.Drawing.Point(462, 29)
$btnPaste.Size = New-Object System.Drawing.Size(118, 26)
$btnPaste.BackColor = $cBtn
$btnPaste.ForeColor = [System.Drawing.Color]::White
$btnPaste.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat

$lblGym = New-Object System.Windows.Forms.Label
$lblGym.Text = "اسم النادي:"
$lblGym.ForeColor = $cText
$lblGym.Location = New-Object System.Drawing.Point(16, 72)
$lblGym.AutoSize = $true

$txtGym = New-Object System.Windows.Forms.TextBox
$txtGym.Location = New-Object System.Drawing.Point(120, 68)
$txtGym.Size = New-Object System.Drawing.Size(170, 24)
$txtGym.Text = "GymSystem"

$lblDays = New-Object System.Windows.Forms.Label
$lblDays.Text = "الأيام:"
$lblDays.ForeColor = $cText
$lblDays.Location = New-Object System.Drawing.Point(310, 72)
$lblDays.AutoSize = $true

$txtDays = New-Object System.Windows.Forms.TextBox
$txtDays.Location = New-Object System.Drawing.Point(366, 68)
$txtDays.Size = New-Object System.Drawing.Size(56, 24)
$txtDays.Text = "365"
$txtDays.TextAlign = [System.Windows.Forms.HorizontalAlignment]::Center

$lblExp = New-Object System.Windows.Forms.Label
$lblExp.Text = "تاريخ الانتهاء المتوقع: -"
$lblExp.ForeColor = $cGreen
$lblExp.Location = New-Object System.Drawing.Point(438, 72)
$lblExp.AutoSize = $true

$btnAdd = New-Object System.Windows.Forms.Button
$btnAdd.Text = "+ إضافة للقائمة"
$btnAdd.Location = New-Object System.Drawing.Point(120, 106)
$btnAdd.Size = New-Object System.Drawing.Size(170, 32)
$btnAdd.BackColor = $cBtnOk
$btnAdd.ForeColor = [System.Drawing.Color]::White
$btnAdd.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$btnAdd.FlatAppearance.BorderSize = 0

# ---------------- List group ----------------
$listGroup = New-Object System.Windows.Forms.GroupBox
$listGroup.Text = "قائمة الأجهزة (توليد غير محدود)"
$listGroup.ForeColor = $cText
$listGroup.Font = $baseFont
$listGroup.BackColor = $cPanel
$listGroup.Location = New-Object System.Drawing.Point(20, 266)
$listGroup.Size = New-Object System.Drawing.Size(600, 252)

$lv = New-Object System.Windows.Forms.ListView
$lv.View = [System.Windows.Forms.View]::Details
$lv.FullRowSelect = $true
$lv.GridLines = $true
$lv.MultiSelect = $false
$lv.BackColor = [System.Drawing.Color]::FromArgb(30, 30, 40)
$lv.ForeColor = $cText
$lv.Font = $cMonoLt
$lv.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$lv.Location = New-Object System.Drawing.Point(14, 26)
$lv.Size = New-Object System.Drawing.Size(572, 150)
$null = $lv.Columns.Add("HWID", 190)
$null = $lv.Columns.Add("النادي", 130)
$null = $lv.Columns.Add("أيام", 55)
$null = $lv.Columns.Add("تاريخ الانتهاء", 100)
$null = $lv.Columns.Add("الحالة", 90)

$btnGenerate = New-Object System.Windows.Forms.Button
$btnGenerate.Text = "توليد كل التراخيص"
$btnGenerate.Location = New-Object System.Drawing.Point(14, 190)
$btnGenerate.Size = New-Object System.Drawing.Size(190, 34)
$btnGenerate.BackColor = $cBtnOk
$btnGenerate.ForeColor = [System.Drawing.Color]::White
$btnGenerate.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$btnGenerate.FlatAppearance.BorderSize = 0

$btnRemove = New-Object System.Windows.Forms.Button
$btnRemove.Text = "حذف المحدد"
$btnRemove.Location = New-Object System.Drawing.Point(216, 190)
$btnRemove.Size = New-Object System.Drawing.Size(120, 34)
$btnRemove.BackColor = $cBtnWarn
$btnRemove.ForeColor = [System.Drawing.Color]::White
$btnRemove.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$btnRemove.FlatAppearance.BorderSize = 0

$btnClear = New-Object System.Windows.Forms.Button
$btnClear.Text = "مسح الكل"
$btnClear.Location = New-Object System.Drawing.Point(348, 190)
$btnClear.Size = New-Object System.Drawing.Size(100, 34)
$btnClear.BackColor = $cBtn
$btnClear.ForeColor = [System.Drawing.Color]::White
$btnClear.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat

$btnOpenIssued = New-Object System.Windows.Forms.Button
$btnOpenIssued.Text = "فتح مجلد التراخيص"
$btnOpenIssued.Location = New-Object System.Drawing.Point(460, 190)
$btnOpenIssued.Size = New-Object System.Drawing.Size(126, 34)
$btnOpenIssued.BackColor = $cBtn
$btnOpenIssued.ForeColor = [System.Drawing.Color]::White
$btnOpenIssued.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat

# ---------------- Footer tools ----------------
$btnCopyLic = New-Object System.Windows.Forms.Button
$btnCopyLic.Text = "نسخ محتوى آخر ترخيص"
$btnCopyLic.Location = New-Object System.Drawing.Point(20, 532)
$btnCopyLic.Size = New-Object System.Drawing.Size(200, 30)
$btnCopyLic.BackColor = $cBtn
$btnCopyLic.ForeColor = [System.Drawing.Color]::White
$btnCopyLic.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat

$footer = New-Object System.Windows.Forms.Label
$footer.Text     = "صنع بواسطة " + $OwnerLine + " — GymSystem"
$footer.Font     = New-Object System.Drawing.Font("Segoe UI", 8.5)
$footer.ForeColor= $cMuted
$footer.AutoSize = $true
$footer.Location = New-Object System.Drawing.Point(20, 575)

$status = New-Object System.Windows.Forms.TextBox
$status.Multiline = $true
$status.ReadOnly = $true
$status.ScrollBars = [System.Windows.Forms.ScrollBars]::Vertical
$status.Font = $cMonoLt
$status.BackColor = [System.Drawing.Color]::FromArgb(24, 24, 32)
$status.ForeColor = [System.Drawing.Color]::FromArgb(180, 200, 220)
$status.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$status.Location = New-Object System.Drawing.Point(20, 604)
$status.Size = New-Object System.Drawing.Size(600, 76)
$status.Text = "جاهز. اكتب HWID الجهاز المطلوب ثم اضغط «+ إضافة للقائمة» — كرر لأي عدد من الأجهزة، ثم «توليد كل التراخيص»."

# ------------------------------------------------------------
#  Data + helpers
# ------------------------------------------------------------
$script:Rows = [System.Collections.ArrayList]::new()

function Write-Status([string]$Text) { $status.Text = $Text }

function Update-Preview {
  $days = 0
  if ([int]::TryParse($txtDays.Text, [ref]$days) -and $days -ge 0) {
    $exp = (Get-Date).AddDays([double]$days)
    $lblExp.Text = "تاريخ الانتهاء: " + $exp.ToString("yyyy-MM-dd")
    $lblExp.ForeColor = $cGreen
  } else {
    $lblExp.Text = "تاريخ الانتهاء: (أيام غير صالحة)"
    $lblExp.ForeColor = [System.Drawing.Color]::FromArgb(255, 120, 120)
  }
}

function New-Row($HwId, $Gym, $Days, $ExpStr, $Item) {
  [void]$script:Rows.Add([pscustomobject]@{ HwId = $HwId; Gym = $Gym; Days = $Days; Expiry = $ExpStr; Item = $Item })
}

# ------------------------------------------------------------
#  Events
# ------------------------------------------------------------
$btnPaste.Add_Click({
  try {
    $clip = [System.Windows.Forms.Clipboard]::GetText().Trim().ToUpperInvariant()
    if ($clip) { $txtHwid.Text = $clip; Write-Status "تم اللصق من الحافظة." } else { Write-Status "الحافظة فارغة." }
  } catch { Write-Status ("تعذر القراءة من الحافظة: " + $_.Exception.Message) }
})

$txtDays.Add_TextChanged({ Update-Preview })
$txtGym.Add_TextChanged({ Update-Preview })

$btnAdd.Add_Click({
  $hwid = $txtHwid.Text.Trim().ToUpperInvariant()
  if ($hwid -notmatch $HWID_RE) {
    Write-Status "HWID غير صالح. الصيغة الصحيحة: GYM-XXXX-XXXX-XXXX-XXXX (انسخه من شاشة التفعيل داخل التطبيق)."
    return
  }
  foreach ($r in $script:Rows) {
    if ($r.HwId -eq $hwid) { Write-Status "تجاهل: الجهاز $hwid موجود بالفعل في القائمة."; $txtHwid.Clear(); return }
  }
  $gym  = $txtGym.Text
  if ([string]::IsNullOrWhiteSpace($gym)) { $gym = "GymSystem" }
  $days = 365
  if (-not [int]::TryParse($txtDays.Text, [ref]$days) -or $days -lt 1) {
    Write-Status "خطأ: أدخل عدد أيام صحيح أكبر من 0."
    return
  }
  $expStr = (Get-Date).AddDays([double]$days).ToString("yyyy-MM-dd")
  $item = New-Object System.Windows.Forms.ListViewItem($hwid)
  [void]$item.SubItems.Add($gym)
  [void]$item.SubItems.Add("$days")
  [void]$item.SubItems.Add($expStr)
  [void]$item.SubItems.Add("في الانتظار")
  [void]$lv.Items.Add($item)
  New-Row $hwid $gym $days $expStr $item
  $lv.Items[$lv.Items.Count-1].EnsureVisible()
  $txtHwid.Clear()
  $txtHwid.Focus()
  Write-Status "تمت إضافة $hwid — الإجمالي: $($script:Rows.Count) جهاز."
})

$btnRemove.Add_Click({
  if ($lv.SelectedItems.Count -gt 0) {
    $sel = $lv.SelectedItems[0]
    $idx = $lv.Items.IndexOf($sel)
    if ($idx -ge 0 -and $idx -lt $script:Rows.Count) { $script:Rows.RemoveAt($idx) }
    $lv.Items.Remove($sel)
    Write-Status "تم حذف الجهاز المحدد."
  } else { Write-Status "حدد جهازاً من القائمة أولاً." }
})

$btnClear.Add_Click({
  $lv.Items.Clear()
  $script:Rows.Clear()
  Write-Status "تم مسح القائمة."
})

$btnGenerate.Add_Click({
  if ($script:Rows.Count -eq 0) { Write-Status "القائمة فارغة — أضف جهازاً واحداً على الأقل."; return }
  $btnGenerate.Enabled = $false
  try {
    if (-not (Test-Path $IssuedDir)) { New-Item -ItemType Directory -Path $IssuedDir -Force | Out-Null }
    $ok = 0; $fail = 0
    $log = New-Object System.Collections.ArrayList
    [void]$log.Add("=== إصدار تراخيص " + (Get-Date).ToString("yyyy-MM-dd HH:mm:ss") + " ===")
    foreach ($r in $script:Rows) {
      $outFile = Join-Path $IssuedDir ($r.HwId + ".lic")
      try {
        $res = Invoke-LicenseCli -ToolArgs @("issue", $r.HwId, "--gym", $r.Gym, "--days", "$($r.Days)", "--out", $outFile)
        if ($res.Exit -eq 0) {
          $r.Item.SubItems[4].Text = "تم ✓"
          $r.Item.SubItems[4].ForeColor = $cGreen
          $ok++
          [void]$log.Add("OK    " + $r.HwId + " | " + $r.Gym + " | " + $r.Days + " يوم | حتى " + $r.Expiry)
        } else {
          $r.Item.SubItems[4].Text = "خطأ"
          $r.Item.SubItems[4].ForeColor = [System.Drawing.Color]::FromArgb(255, 120, 120)
          $fail++
          [void]$log.Add("FAIL  " + $r.HwId + " | " + ($res.Out -replace "\s+", " "))
        }
      } catch {
        $r.Item.SubItems[4].Text = "خطأ"
        $r.Item.SubItems[4].ForeColor = [System.Drawing.Color]::FromArgb(255, 120, 120)
        $fail++
        [void]$log.Add("FAIL  " + $r.HwId + " | " + $_.Exception.Message)
      }
    }
    [void]$log.Add("=== ملخص: نجح " + $ok + " / إجمالي " + $script:Rows.Count + " ===")
    [System.IO.File]::WriteAllLines((Join-Path $IssuedDir "log.txt"), $log)
    $msg = "تم إنشاء " + $ok + " ترخيص من أصل " + $script:Rows.Count + " داخل:" + [Environment]::NewLine + $IssuedDir
    [System.Windows.Forms.MessageBox]::Show($msg, $ToolName, [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
  } catch {
    Write-Status ("خطأ: " + $_.Exception.Message)
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, $ToolName, [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  } finally {
    $btnGenerate.Enabled = $true
  }
})

$btnOpenIssued.Add_Click({
  if (-not (Test-Path $IssuedDir)) { New-Item -ItemType Directory -Path $IssuedDir -Force | Out-Null }
  [System.Diagnostics.Process]::Start("explorer.exe", "`"$IssuedDir`"") | Out-Null
})

$btnCopyLic.Add_Click({
  $latest = Get-ChildItem -Path $IssuedDir -Filter *.lic -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($latest) {
    [System.Windows.Forms.Clipboard]::SetText([System.IO.File]::ReadAllText($latest.FullName))
    Write-Status "تم نسخ محتوى $($latest.Name) إلى الحافظة — الصقه في شاشة التفعيل داخل التطبيق."
  } else {
    Write-Status "لا يوجد ملفات ترخيص بعد — أضف أجهزة واضغط «توليد كل التراخيص»."
  }
})

# ------------------------------------------------------------
#  Assemble the window (controls MUST be added to be visible)
# ------------------------------------------------------------
$form.Controls.AddRange(@($title, $owner, $subtit, $issueGroup, $listGroup, $btnCopyLic, $footer, $status))
$issueGroup.Controls.AddRange(@($lblHwid, $txtHwid, $btnPaste, $lblGym, $txtGym, $lblDays, $txtDays, $lblExp, $btnAdd))
$listGroup.Controls.AddRange(@($lv, $btnGenerate, $btnRemove, $btnClear, $btnOpenIssued))

# ---------------- Run ----------------
$form.Add_Shown({
  Update-Preview
  $form.Activate()
})

[System.Windows.Forms.Application]::EnableVisualStyles()
[void]$form.ShowDialog()