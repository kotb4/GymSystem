#============================================================
#  Yassen Mohamed Kotb | 01288536381  -  License Tool GUI v8
#  Windows Forms GUI for issuing GymSystem offline licenses
#  and developer emergency intervention tokens.
#  Zero dependencies: PowerShell 5.1 + node (signing logic stays
#  in license-tool.mjs — this is just the skin).
#
#  v8 changes:
#    - Fixed HWID calculation to match server exactly (no hostname).
#    - Added quick duration preset buttons: 7d, 30d, 90d, 180d, 365d, Lifetime.
#    - Added License Inspector: inspect, decode and verify any .lic file.
#    - Added Developer Emergency Tools: generate signed action tokens
#      for clock reset, owner password recovery, and emergency grace.
#============================================================
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

try {
  $win32Def = @'
[DllImport("Kernel32.dll")]
public static extern IntPtr GetConsoleWindow();
[DllImport("user32.dll")]
public static extern bool ShowWindow(IntPtr hWnd, Int32 nCmdShow);
'@
  Add-Type -MemberDefinition $win32Def -Name Win32Console -Namespace NativeMethods -ErrorAction SilentlyContinue
  $consoleHwnd = [NativeMethods.Win32Console]::GetConsoleWindow()
  if ($consoleHwnd -ne [IntPtr]::Zero) {
    [void][NativeMethods.Win32Console]::ShowWindow($consoleHwnd, 0)
  }
} catch {}

$OwnerLine = "Yassen Mohamed Kotb | 01288536381"
$ToolName  = "GymSystem - License Tool v8"
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
$cBtnDev = [System.Drawing.Color]::FromArgb(110, 40, 150)
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
$form.ClientSize      = New-Object System.Drawing.Size(680, 760)
$form.Icon            = [System.Drawing.SystemIcons]::Application
$form.BackColor       = $cBg

# ---------------- Header ----------------
$title = New-Object System.Windows.Forms.Label
$title.Text     = "أداة إصدار تراخيص جيم سيستم والدعم الفني"
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
$subtit.Text    = "إصدار التراخيص دون اتصال بالإنترنت، فحص الملفات، وإجراءات المطور للطوارئ واستعادة الحسابات."
$subtit.Font    = $baseFont
$subtit.ForeColor= $cMuted
$subtit.AutoSize = $true
$subtit.Location = New-Object System.Drawing.Point(20, 74)

# ---------------- Issue group ----------------
$issueGroup = New-Object System.Windows.Forms.GroupBox
$issueGroup.Text = "بيانات الترخيص والجهاز"
$issueGroup.ForeColor = $cText
$issueGroup.Font = $baseFont
$issueGroup.BackColor = $cPanel
$issueGroup.Location = New-Object System.Drawing.Point(20, 102)
$issueGroup.Size = New-Object System.Drawing.Size(640, 185)

$lblHwid = New-Object System.Windows.Forms.Label
$lblHwid.Text = "HWID الجهاز:"
$lblHwid.ForeColor = $cText
$lblHwid.Location = New-Object System.Drawing.Point(16, 30)
$lblHwid.AutoSize = $true

$txtHwid = New-Object System.Windows.Forms.TextBox
$txtHwid.Location = New-Object System.Drawing.Point(120, 26)
$txtHwid.Size = New-Object System.Drawing.Size(370, 24)
$txtHwid.Font = $cMon
$txtHwid.BackColor = [System.Drawing.Color]::FromArgb(30, 30, 40)
$txtHwid.ForeColor = $cGreen
$txtHwid.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$txtHwid.CharacterCasing = [System.Windows.Forms.CharacterCasing]::Upper

$btnPaste = New-Object System.Windows.Forms.Button
$btnPaste.Text = "لصق"
$btnPaste.Location = New-Object System.Drawing.Point(500, 25)
$btnPaste.Size = New-Object System.Drawing.Size(120, 26)
$btnPaste.BackColor = $cBtn
$btnPaste.ForeColor = [System.Drawing.Color]::White
$btnPaste.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat

$lblGym = New-Object System.Windows.Forms.Label
$lblGym.Text = "اسم النادي:"
$lblGym.ForeColor = $cText
$lblGym.Location = New-Object System.Drawing.Point(16, 66)
$lblGym.AutoSize = $true

$txtGym = New-Object System.Windows.Forms.TextBox
$txtGym.Location = New-Object System.Drawing.Point(120, 62)
$txtGym.Size = New-Object System.Drawing.Size(180, 24)
$txtGym.Text = "GymSystem"

$lblDays = New-Object System.Windows.Forms.Label
$lblDays.Text = "الأيام:"
$lblDays.ForeColor = $cText
$lblDays.Location = New-Object System.Drawing.Point(315, 66)
$lblDays.AutoSize = $true

$txtDays = New-Object System.Windows.Forms.TextBox
$txtDays.Location = New-Object System.Drawing.Point(365, 62)
$txtDays.Size = New-Object System.Drawing.Size(65, 24)
$txtDays.Text = "365"
$txtDays.TextAlign = [System.Windows.Forms.HorizontalAlignment]::Center

$lblExp = New-Object System.Windows.Forms.Label
$lblExp.Text = "تاريخ الانتهاء: -"
$lblExp.ForeColor = $cGreen
$lblExp.Location = New-Object System.Drawing.Point(440, 66)
$lblExp.AutoSize = $true

# Quick Presets
$lblPresets = New-Object System.Windows.Forms.Label
$lblPresets.Text = "مدد جاهزة:"
$lblPresets.ForeColor = $cMuted
$lblPresets.Location = New-Object System.Drawing.Point(16, 104)
$lblPresets.AutoSize = $true

function Add-PresetBtn($Text, $DaysVal, $X) {
  $b = New-Object System.Windows.Forms.Button
  $b.Text = $Text
  $b.Location = New-Object System.Drawing.Point($X, 98)
  $b.Size = New-Object System.Drawing.Size(78, 26)
  $b.BackColor = $cBtn
  $b.ForeColor = [System.Drawing.Color]::White
  $b.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
  $b.Font = New-Object System.Drawing.Font("Segoe UI", 8.5)
  $b.Add_Click({ $txtDays.Text = "$DaysVal" })
  return $b
}

$p1 = Add-PresetBtn "7 أيام" 7 120
$p2 = Add-PresetBtn "شهر (30)" 30 204
$p3 = Add-PresetBtn "3 شهور" 90 288
$p4 = Add-PresetBtn "6 شهور" 180 372
$p5 = Add-PresetBtn "سنة (365)" 365 456
$p6 = Add-PresetBtn "مدى الحياة" 36500 540

$btnAdd = New-Object System.Windows.Forms.Button
$btnAdd.Text = "+ إضافة الجهاز للقائمة"
$btnAdd.Location = New-Object System.Drawing.Point(120, 138)
$btnAdd.Size = New-Object System.Drawing.Size(180, 32)
$btnAdd.BackColor = $cBtnOk
$btnAdd.ForeColor = [System.Drawing.Color]::White
$btnAdd.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$btnAdd.FlatAppearance.BorderSize = 0

# ---------------- List group ----------------
$listGroup = New-Object System.Windows.Forms.GroupBox
$listGroup.Text = "قائمة الأجهزة (توليد متعدد)"
$listGroup.ForeColor = $cText
$listGroup.Font = $baseFont
$listGroup.BackColor = $cPanel
$listGroup.Location = New-Object System.Drawing.Point(20, 298)
$listGroup.Size = New-Object System.Drawing.Size(640, 230)

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
$lv.Size = New-Object System.Drawing.Size(612, 140)
$null = $lv.Columns.Add("HWID", 200)
$null = $lv.Columns.Add("النادي", 140)
$null = $lv.Columns.Add("أيام", 60)
$null = $lv.Columns.Add("تاريخ الانتهاء", 110)
$null = $lv.Columns.Add("الحالة", 90)

$btnGenerate = New-Object System.Windows.Forms.Button
$btnGenerate.Text = "توليد كل التراخيص"
$btnGenerate.Location = New-Object System.Drawing.Point(14, 178)
$btnGenerate.Size = New-Object System.Drawing.Size(170, 34)
$btnGenerate.BackColor = $cBtnOk
$btnGenerate.ForeColor = [System.Drawing.Color]::White
$btnGenerate.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$btnGenerate.FlatAppearance.BorderSize = 0

$btnRemove = New-Object System.Windows.Forms.Button
$btnRemove.Text = "حذف المحدد"
$btnRemove.Location = New-Object System.Drawing.Point(194, 178)
$btnRemove.Size = New-Object System.Drawing.Size(100, 34)
$btnRemove.BackColor = $cBtnWarn
$btnRemove.ForeColor = [System.Drawing.Color]::White
$btnRemove.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$btnRemove.FlatAppearance.BorderSize = 0

$btnClear = New-Object System.Windows.Forms.Button
$btnClear.Text = "مسح الكل"
$btnClear.Location = New-Object System.Drawing.Point(304, 178)
$btnClear.Size = New-Object System.Drawing.Size(90, 34)
$btnClear.BackColor = $cBtn
$btnClear.ForeColor = [System.Drawing.Color]::White
$btnClear.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat

$btnOpenIssued = New-Object System.Windows.Forms.Button
$btnOpenIssued.Text = "مجلد التراخيص"
$btnOpenIssued.Location = New-Object System.Drawing.Point(404, 178)
$btnOpenIssued.Size = New-Object System.Drawing.Size(110, 34)
$btnOpenIssued.BackColor = $cBtn
$btnOpenIssued.ForeColor = [System.Drawing.Color]::White
$btnOpenIssued.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat

$btnInspect = New-Object System.Windows.Forms.Button
$btnInspect.Text = "فحص رخصة .lic"
$btnInspect.Location = New-Object System.Drawing.Point(524, 178)
$btnInspect.Size = New-Object System.Drawing.Size(102, 34)
$btnInspect.BackColor = $cBtn
$btnInspect.ForeColor = [System.Drawing.Color]::White
$btnInspect.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat

# ---------------- Dev Actions & Tools ----------------
$devGroup = New-Object System.Windows.Forms.GroupBox
$devGroup.Text = "أدوات المطور والدعم الفني للطوارئ (Developer Emergency Tools)"
$devGroup.ForeColor = [System.Drawing.Color]::FromArgb(210, 160, 255)
$devGroup.Font = $baseFont
$devGroup.BackColor = $cPanel
$devGroup.Location = New-Object System.Drawing.Point(20, 538)
$devGroup.Size = New-Object System.Drawing.Size(640, 80)

$lblAction = New-Object System.Windows.Forms.Label
$lblAction.Text = "نوع الإجراء:"
$lblAction.ForeColor = $cText
$lblAction.Location = New-Object System.Drawing.Point(14, 32)
$lblAction.AutoSize = $true

$cmbAction = New-Object System.Windows.Forms.ComboBox
$cmbAction.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDownList
$cmbAction.Location = New-Object System.Drawing.Point(90, 28)
$cmbAction.Size = New-Object System.Drawing.Size(260, 26)
$cmbAction.Font = New-Object System.Drawing.Font("Segoe UI", 9)
[void]$cmbAction.Items.Add("تصفير تلاعب الوقت (إلغاء قفل الساعة)")
[void]$cmbAction.Items.Add("استعادة حساب المالك (Owner@123456)")
[void]$cmbAction.Items.Add("تمديد طوارئ مؤقت (7 أيام)")
[void]$cmbAction.Items.Add("إلغاء الترخيص والقفل الإجباري")
$cmbAction.SelectedIndex = 0

$btnMakeAction = New-Object System.Windows.Forms.Button
$btnMakeAction.Text = "⚡ توليد كود الدعم الفني"
$btnMakeAction.Location = New-Object System.Drawing.Point(365, 26)
$btnMakeAction.Size = New-Object System.Drawing.Size(160, 32)
$btnMakeAction.BackColor = $cBtnDev
$btnMakeAction.ForeColor = [System.Drawing.Color]::White
$btnMakeAction.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat

$btnCopyLic = New-Object System.Windows.Forms.Button
$btnCopyLic.Text = "نسخ آخر ترخيص"
$btnCopyLic.Location = New-Object System.Drawing.Point(535, 26)
$btnCopyLic.Size = New-Object System.Drawing.Size(95, 32)
$btnCopyLic.BackColor = $cBtn
$btnCopyLic.ForeColor = [System.Drawing.Color]::White
$btnCopyLic.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat

# ---------------- Status & Footer ----------------
$status = New-Object System.Windows.Forms.TextBox
$status.Multiline = $true
$status.ReadOnly = $true
$status.ScrollBars = [System.Windows.Forms.ScrollBars]::Vertical
$status.Font = $cMonoLt
$status.BackColor = [System.Drawing.Color]::FromArgb(24, 24, 32)
$status.ForeColor = [System.Drawing.Color]::FromArgb(180, 200, 220)
$status.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$status.Location = New-Object System.Drawing.Point(20, 626)
$status.Size = New-Object System.Drawing.Size(640, 80)
$status.Text = "جاهز. اكتب HWID الجهاز المطلوب ثم اضغط «+ إضافة الجهاز للقائمة» أو اختر أحد إجراءات المطور."

$footer = New-Object System.Windows.Forms.Label
$footer.Text     = "صنع بواسطة " + $OwnerLine + " — GymSystem v8"
$footer.Font     = New-Object System.Drawing.Font("Segoe UI", 8.5)
$footer.ForeColor= $cMuted
$footer.AutoSize = $true
$footer.Location = New-Object System.Drawing.Point(20, 715)

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

$btnInspect.Add_Click({
  $ofd = New-Object System.Windows.Forms.OpenFileDialog
  $ofd.Filter = "ملفات الترخيص (*.lic)|*.lic|All files (*.*)|*.*"
  $ofd.Title = "اختر ملف ترخيص لفحصه"
  if ($ofd.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    try {
      $res = Invoke-LicenseCli -ToolArgs @("inspect", $ofd.FileName)
      Write-Status $res.Out
      [System.Windows.Forms.MessageBox]::Show($res.Out, "فحص الترخيص", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    } catch {
      Write-Status ("خطأ في الفحص: " + $_.Exception.Message)
    }
  }
})

$btnMakeAction.Add_Click({
  $targetHwid = $txtHwid.Text.Trim().ToUpperInvariant()
  if (-not $targetHwid -and $lv.SelectedItems.Count -gt 0) {
    $targetHwid = $lv.SelectedItems[0].Text
  }
  if ($targetHwid -notmatch $HWID_RE) {
    Write-Status "أدخل كود HWID صحيح أولاً في خانة HWID أو حدد جهازاً من القائمة."
    return
  }
  $actType = "reset_clock"
  switch ($cmbAction.SelectedIndex) {
    0 { $actType = "reset_clock" }
    1 { $actType = "reset_owner" }
    2 { $actType = "emergency_grace" }
    3 { $actType = "force_deactivate" }
  }
  try {
    $res = Invoke-LicenseCli -ToolArgs @("action", $targetHwid, $actType)
    if ($res.Exit -eq 0) {
      $lines = $res.Out -split "`r?`n"
      $tokenLine = ""
      foreach ($l in $lines) {
        if ($l.Trim().StartsWith('{"payload":')) { $tokenLine = $l.Trim(); break }
      }
      if ($tokenLine) {
        [System.Windows.Forms.Clipboard]::SetText($tokenLine)
        Write-Status "تم توليد ونسخ كود الدعم الفني ($actType) بنجاح إلى الحافظة! أرسله للعميل ليدخله في التطبيق."
        [System.Windows.Forms.MessageBox]::Show("تم نسخ كود الدعم الفني ($actType) إلى الحافظة بنجاح!`n`nالصقه وأرسله للعميل ليدخله في شاشة الدعم الفني داخل التطبيق.", "كود دعم المطور", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
      } else {
        Write-Status $res.Out
      }
    } else {
      Write-Status ("خطأ: " + $res.Out)
    }
  } catch {
    Write-Status ("خطأ: " + $_.Exception.Message)
  }
})

# ------------------------------------------------------------
#  Assemble the window
# ------------------------------------------------------------
$form.Controls.AddRange(@($title, $owner, $subtit, $issueGroup, $listGroup, $devGroup, $status, $footer))
$issueGroup.Controls.AddRange(@($lblHwid, $txtHwid, $btnPaste, $lblGym, $txtGym, $lblDays, $txtDays, $lblExp, $lblPresets, $p1, $p2, $p3, $p4, $p5, $p6, $btnAdd))
$listGroup.Controls.AddRange(@($lv, $btnGenerate, $btnRemove, $btnClear, $btnOpenIssued, $btnInspect))
$devGroup.Controls.AddRange(@($lblAction, $cmbAction, $btnMakeAction, $btnCopyLic))

# ---------------- Run ----------------
$form.Add_Shown({
  Update-Preview
  $form.Activate()
})

[System.Windows.Forms.Application]::EnableVisualStyles()
[void]$form.ShowDialog()