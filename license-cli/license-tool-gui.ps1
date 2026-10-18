#============================================================
#  Yassen Mohamed Kotb | 01288536381  -  License Tool GUI v9 Pro
#  Windows Forms GUI for issuing GymSystem offline licenses
#  and developer emergency intervention tokens.
#  Zero dependencies: PowerShell 5.1 + Node.js (Ed25519).
#
#  v9 Pro upgrades:
#    - Pre-configured & auto-synced Ed25519 keypair (works out of the box!).
#    - 1-Click Instant Issue & Copy ("⚡ إصدار ونسخ فوري").
#    - 1-Click Current Machine HWID Fetch ("🖥️ هذا الجهاز").
#    - License Tier Selector (Full / Pro / Basic).
#    - Customizable Owner Password & Emergency Grace Days in Dev Tools.
#    - Full Arabic RTL support and status log.
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
$ToolName  = "GymSystem - License Tool v9 Pro"
$PSScript  = $PSScriptRoot
if (-not $PSScript) { $PSScript = Split-Path -Parent $MyInvocation.MyCommand.Path }
$ToolMjs   = Join-Path $PSScript "license-tool.mjs"
$IssuedDir = Join-Path $PSScript "issued"
$HWID_RE   = "^GYM-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}$"

function Invoke-LicenseCli {
  param([string[]]$ToolArgs)
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js غير موجود في مسار النظام (PATH). تأكد من تثبيت Node ثم أعد المحاولة."
  }
  $output = & node $ToolMjs @ToolArgs 2>&1 | Out-String
  return [pscustomobject]@{ Exit = $LASTEXITCODE; Out = [string]$output }
}

# ------------------------------------------------------------
#  Dark Pro Palette
# ------------------------------------------------------------
$cBg      = [System.Drawing.Color]::FromArgb(15, 16, 22)
$cPanel   = [System.Drawing.Color]::FromArgb(22, 24, 34)
$cText    = [System.Drawing.Color]::FromArgb(230, 232, 240)
$cMuted   = [System.Drawing.Color]::FromArgb(150, 155, 170)
$cNeon    = [System.Drawing.Color]::FromArgb(56, 235, 255)
$cGreen   = [System.Drawing.Color]::FromArgb(52, 211, 153)
$cBtn     = [System.Drawing.Color]::FromArgb(40, 43, 58)
$cBtnOk   = [System.Drawing.Color]::FromArgb(16, 135, 95)
$cBtnFast = [System.Drawing.Color]::FromArgb(14, 116, 144)
$cBtnWarn = [System.Drawing.Color]::FromArgb(160, 85, 35)
$cBtnDev  = [System.Drawing.Color]::FromArgb(115, 45, 165)
$cMon     = New-Object System.Drawing.Font("Consolas", 10, [System.Drawing.FontStyle]::Bold)
$cMonoLt  = New-Object System.Drawing.Font("Consolas", 9)
$baseFont = New-Object System.Drawing.Font("Segoe UI", 9.5)
$boldFont = New-Object System.Drawing.Font("Segoe UI", 9.5, [System.Drawing.FontStyle]::Bold)

# ------------------------------------------------------------
#  Main Form
# ------------------------------------------------------------
$form = New-Object System.Windows.Forms.Form
$form.Text            = $ToolName
$form.StartPosition   = "CenterScreen"
$form.FormBorderStyle = "FixedSingle"
$form.MaximizeBox     = $false
$form.ClientSize      = New-Object System.Drawing.Size(720, 800)
$form.Icon            = [System.Drawing.SystemIcons]::Shield
$form.BackColor       = $cBg
$form.RightToLeft     = [System.Windows.Forms.RightToLeft]::Yes
$form.RightToLeftLayout = $true

# ---------------- Header ----------------
$title = New-Object System.Windows.Forms.Label
$title.Text      = "أداة إصدار التراخيص والدعم الفني — GymSystem v9 Pro"
$title.Font      = New-Object System.Drawing.Font("Segoe UI", 14.5, [System.Drawing.FontStyle]::Bold)
$title.ForeColor = $cNeon
$title.AutoSize  = $true
$title.Location  = New-Object System.Drawing.Point(20, 14)

$owner = New-Object System.Windows.Forms.Label
$owner.Text      = $OwnerLine + "  |  Ed25519 Offline Crypto Ready ✓"
$owner.Font      = New-Object System.Drawing.Font("Segoe UI", 9.5, [System.Drawing.FontStyle]::Bold)
$owner.ForeColor = [System.Drawing.Color]::FromArgb(255, 210, 90)
$owner.AutoSize  = $true
$owner.Location  = New-Object System.Drawing.Point(20, 44)

$subtit = New-Object System.Windows.Forms.Label
$subtit.Text      = "إصدار فوري للتراخيص دون اتصال بالإنترنت، توليد متعدد، فحص التوقيع الرقمي، وأكواد طوارئ المطور."
$subtit.Font      = $baseFont
$subtit.ForeColor = $cMuted
$subtit.AutoSize  = $true
$subtit.Location  = New-Object System.Drawing.Point(20, 68)

# ---------------- Issue Group ----------------
$issueGroup = New-Object System.Windows.Forms.GroupBox
$issueGroup.Text      = "بيانات الترخيص والجهاز"
$issueGroup.ForeColor = $cText
$issueGroup.Font      = $boldFont
$issueGroup.BackColor = $cPanel
$issueGroup.Location  = New-Object System.Drawing.Point(20, 96)
$issueGroup.Size      = New-Object System.Drawing.Size(680, 195)

$lblHwid = New-Object System.Windows.Forms.Label
$lblHwid.Text      = "كود الجهاز (HWID):"
$lblHwid.Font      = $baseFont
$lblHwid.ForeColor = $cText
$lblHwid.Location  = New-Object System.Drawing.Point(16, 30)
$lblHwid.AutoSize  = $true

$txtHwid = New-Object System.Windows.Forms.TextBox
$txtHwid.Location        = New-Object System.Drawing.Point(135, 26)
$txtHwid.Size            = New-Object System.Drawing.Size(315, 26)
$txtHwid.Font            = $cMon
$txtHwid.RightToLeft     = [System.Windows.Forms.RightToLeft]::No
$txtHwid.BackColor       = [System.Drawing.Color]::FromArgb(30, 32, 44)
$txtHwid.ForeColor       = $cGreen
$txtHwid.BorderStyle     = [System.Windows.Forms.BorderStyle]::FixedSingle
$txtHwid.CharacterCasing = [System.Windows.Forms.CharacterCasing]::Upper

$btnPaste = New-Object System.Windows.Forms.Button
$btnPaste.Text      = "📋 لصق"
$btnPaste.Font      = $baseFont
$btnPaste.Location  = New-Object System.Drawing.Point(460, 25)
$btnPaste.Size      = New-Object System.Drawing.Size(95, 28)
$btnPaste.BackColor = $cBtn
$btnPaste.ForeColor = [System.Drawing.Color]::White
$btnPaste.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat

$btnHere = New-Object System.Windows.Forms.Button
$btnHere.Text      = "🖥️ هذا الجهاز"
$btnHere.Font      = $baseFont
$btnHere.Location  = New-Object System.Drawing.Point(563, 25)
$btnHere.Size      = New-Object System.Drawing.Size(102, 28)
$btnHere.BackColor = $cBtn
$btnHere.ForeColor = $cNeon
$btnHere.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat

$lblGym = New-Object System.Windows.Forms.Label
$lblGym.Text      = "اسم النادي:"
$lblGym.Font      = $baseFont
$lblGym.ForeColor = $cText
$lblGym.Location  = New-Object System.Drawing.Point(16, 66)
$lblGym.AutoSize  = $true

$txtGym = New-Object System.Windows.Forms.TextBox
$txtGym.Location = New-Object System.Drawing.Point(135, 62)
$txtGym.Size     = New-Object System.Drawing.Size(165, 25)
$txtGym.Font     = $baseFont
$txtGym.Text     = "GymSystem"

$lblDays = New-Object System.Windows.Forms.Label
$lblDays.Text      = "الأيام:"
$lblDays.Font      = $baseFont
$lblDays.ForeColor = $cText
$lblDays.Location  = New-Object System.Drawing.Point(310, 66)
$lblDays.AutoSize  = $true

$txtDays = New-Object System.Windows.Forms.TextBox
$txtDays.Location  = New-Object System.Drawing.Point(355, 62)
$txtDays.Size      = New-Object System.Drawing.Size(65, 25)
$txtDays.Font      = $baseFont
$txtDays.Text      = "365"
$txtDays.TextAlign = [System.Windows.Forms.HorizontalAlignment]::Center

$lblTier = New-Object System.Windows.Forms.Label
$lblTier.Text      = "الباقة:"
$lblTier.Font      = $baseFont
$lblTier.ForeColor = $cText
$lblTier.Location  = New-Object System.Drawing.Point(430, 66)
$lblTier.AutoSize  = $true

$cmbTier = New-Object System.Windows.Forms.ComboBox
$cmbTier.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDownList
$cmbTier.Location      = New-Object System.Drawing.Point(475, 62)
$cmbTier.Size          = New-Object System.Drawing.Size(90, 25)
$cmbTier.Font          = New-Object System.Drawing.Font("Segoe UI", 9)
[void]$cmbTier.Items.Add("full")
[void]$cmbTier.Items.Add("pro")
[void]$cmbTier.Items.Add("basic")
$cmbTier.SelectedIndex = 0

$lblExp = New-Object System.Windows.Forms.Label
$lblExp.Text      = "ينتهي: -"
$lblExp.Font      = New-Object System.Drawing.Font("Segoe UI", 8.5, [System.Drawing.FontStyle]::Bold)
$lblExp.ForeColor = $cGreen
$lblExp.Location  = New-Object System.Drawing.Point(572, 66)
$lblExp.AutoSize  = $true

# Quick Presets
$lblPresets = New-Object System.Windows.Forms.Label
$lblPresets.Text      = "مدد سريعة:"
$lblPresets.Font      = $baseFont
$lblPresets.ForeColor = $cMuted
$lblPresets.Location  = New-Object System.Drawing.Point(16, 104)
$lblPresets.AutoSize  = $true

function Add-PresetBtn($Text, $DaysVal, $X) {
  $b = New-Object System.Windows.Forms.Button
  $b.Text      = $Text
  $b.Location  = New-Object System.Drawing.Point($X, 98)
  $b.Size      = New-Object System.Drawing.Size(82, 27)
  $b.BackColor = $cBtn
  $b.ForeColor = [System.Drawing.Color]::White
  $b.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
  $b.Font      = New-Object System.Drawing.Font("Segoe UI", 8.5)
  $b.Add_Click({ $txtDays.Text = "$DaysVal" }.GetNewClosure())
  return $b
}

$p1 = Add-PresetBtn "7 أيام" 7 135
$p2 = Add-PresetBtn "شهر (30)" 30 223
$p3 = Add-PresetBtn "3 شهور" 90 311
$p4 = Add-PresetBtn "6 شهور" 180 399
$p5 = Add-PresetBtn "سنة (365)" 365 487
$p6 = Add-PresetBtn "مدى الحياة" 36500 575

$btnQuickIssue = New-Object System.Windows.Forms.Button
$btnQuickIssue.Text      = "⚡ إصدار ونسخ فوري للترخيص (1-Click)"
$btnQuickIssue.Font      = $boldFont
$btnQuickIssue.Location  = New-Object System.Drawing.Point(135, 140)
$btnQuickIssue.Size      = New-Object System.Drawing.Size(270, 36)
$btnQuickIssue.BackColor = $cBtnFast
$btnQuickIssue.ForeColor = [System.Drawing.Color]::White
$btnQuickIssue.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$btnQuickIssue.FlatAppearance.BorderSize = 0

$btnAdd = New-Object System.Windows.Forms.Button
$btnAdd.Text      = "+ إضافة للقائمة (توليد متعدد)"
$btnAdd.Font      = $baseFont
$btnAdd.Location  = New-Object System.Drawing.Point(415, 140)
$btnAdd.Size      = New-Object System.Drawing.Size(242, 36)
$btnAdd.BackColor = $cBtnOk
$btnAdd.ForeColor = [System.Drawing.Color]::White
$btnAdd.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$btnAdd.FlatAppearance.BorderSize = 0

# ---------------- Batch List Group ----------------
$listGroup = New-Object System.Windows.Forms.GroupBox
$listGroup.Text      = "قائمة الأجهزة (التوليد المتعدد وإدارة الملفات)"
$listGroup.ForeColor = $cText
$listGroup.Font      = $boldFont
$listGroup.BackColor = $cPanel
$listGroup.Location  = New-Object System.Drawing.Point(20, 300)
$listGroup.Size      = New-Object System.Drawing.Size(680, 220)

$lv = New-Object System.Windows.Forms.ListView
$lv.View          = [System.Windows.Forms.View]::Details
$lv.FullRowSelect = $true
$lv.GridLines     = $true
$lv.MultiSelect   = $false
$lv.BackColor     = [System.Drawing.Color]::FromArgb(30, 32, 44)
$lv.ForeColor     = $cText
$lv.Font          = $cMonoLt
$lv.BorderStyle   = [System.Windows.Forms.BorderStyle]::FixedSingle
$lv.Location      = New-Object System.Drawing.Point(14, 26)
$lv.Size          = New-Object System.Drawing.Size(652, 135)
$null = $lv.Columns.Add("HWID", 200)
$null = $lv.Columns.Add("النادي", 150)
$null = $lv.Columns.Add("الباقة", 65)
$null = $lv.Columns.Add("أيام", 60)
$null = $lv.Columns.Add("تاريخ الانتهاء", 95)
$null = $lv.Columns.Add("الحالة", 75)

$btnGenerate = New-Object System.Windows.Forms.Button
$btnGenerate.Text      = "توليد كل التراخيص"
$btnGenerate.Font      = $boldFont
$btnGenerate.Location  = New-Object System.Drawing.Point(14, 170)
$btnGenerate.Size      = New-Object System.Drawing.Size(165, 34)
$btnGenerate.BackColor = $cBtnOk
$btnGenerate.ForeColor = [System.Drawing.Color]::White
$btnGenerate.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$btnGenerate.FlatAppearance.BorderSize = 0

$btnRemove = New-Object System.Windows.Forms.Button
$btnRemove.Text      = "حذف المحدد"
$btnRemove.Font      = $baseFont
$btnRemove.Location  = New-Object System.Drawing.Point(188, 170)
$btnRemove.Size      = New-Object System.Drawing.Size(95, 34)
$btnRemove.BackColor = $cBtnWarn
$btnRemove.ForeColor = [System.Drawing.Color]::White
$btnRemove.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$btnRemove.FlatAppearance.BorderSize = 0

$btnClear = New-Object System.Windows.Forms.Button
$btnClear.Text      = "مسح الكل"
$btnClear.Font      = $baseFont
$btnClear.Location  = New-Object System.Drawing.Point(292, 170)
$btnClear.Size      = New-Object System.Drawing.Size(85, 34)
$btnClear.BackColor = $cBtn
$btnClear.ForeColor = [System.Drawing.Color]::White
$btnClear.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat

$btnOpenIssued = New-Object System.Windows.Forms.Button
$btnOpenIssued.Text      = "📂 مجلد التراخيص"
$btnOpenIssued.Font      = $baseFont
$btnOpenIssued.Location  = New-Object System.Drawing.Point(386, 170)
$btnOpenIssued.Size      = New-Object System.Drawing.Size(130, 34)
$btnOpenIssued.BackColor = $cBtn
$btnOpenIssued.ForeColor = [System.Drawing.Color]::White
$btnOpenIssued.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat

$btnInspect = New-Object System.Windows.Forms.Button
$btnInspect.Text      = "🔍 فحص ملف .lic"
$btnInspect.Font      = $baseFont
$btnInspect.Location  = New-Object System.Drawing.Point(525, 170)
$btnInspect.Size      = New-Object System.Drawing.Size(140, 34)
$btnInspect.BackColor = $cBtn
$btnInspect.ForeColor = $cNeon
$btnInspect.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat

# ---------------- Dev Actions & Emergency Tools ----------------
$devGroup = New-Object System.Windows.Forms.GroupBox
$devGroup.Text      = "أدوات المطور والدعم الفني للطوارئ (Developer Emergency Tokens)"
$devGroup.ForeColor = [System.Drawing.Color]::FromArgb(215, 165, 255)
$devGroup.Font      = $boldFont
$devGroup.BackColor = $cPanel
$devGroup.Location  = New-Object System.Drawing.Point(20, 528)
$devGroup.Size      = New-Object System.Drawing.Size(680, 115)

$lblAction = New-Object System.Windows.Forms.Label
$lblAction.Text      = "الإجراء:"
$lblAction.Font      = $baseFont
$lblAction.ForeColor = $cText
$lblAction.Location  = New-Object System.Drawing.Point(14, 32)
$lblAction.AutoSize  = $true

$cmbAction = New-Object System.Windows.Forms.ComboBox
$cmbAction.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDownList
$cmbAction.Location      = New-Object System.Drawing.Point(75, 28)
$cmbAction.Size          = New-Object System.Drawing.Size(305, 26)
$cmbAction.Font          = New-Object System.Drawing.Font("Segoe UI", 9.5)
[void]$cmbAction.Items.Add("تصفير تلاعب الوقت (إلغاء قفل الساعة)")
[void]$cmbAction.Items.Add("استعادة حساب المالك (تعيين كلمة مرور جديدة)")
[void]$cmbAction.Items.Add("تمديد طوارئ مؤقت (أيام إضافية فورية)")
[void]$cmbAction.Items.Add("إلغاء الترخيص والقفل الإجباري عن بُعد")
$cmbAction.SelectedIndex = 0

$lblActionParam = New-Object System.Windows.Forms.Label
$lblActionParam.Text      = "قيمة مخصصة (كلمة المرور / الأيام):"
$lblActionParam.Font      = $baseFont
$lblActionParam.ForeColor = $cMuted
$lblActionParam.Location  = New-Object System.Drawing.Point(14, 72)
$lblActionParam.AutoSize  = $true

$txtActionParam = New-Object System.Windows.Forms.TextBox
$txtActionParam.Location    = New-Object System.Drawing.Point(225, 68)
$txtActionParam.Size        = New-Object System.Drawing.Size(155, 25)
$txtActionParam.Font        = $cMon
$txtActionParam.RightToLeft = [System.Windows.Forms.RightToLeft]::No
$txtActionParam.Text        = ""
$txtActionParam.Enabled     = $false

$btnMakeAction = New-Object System.Windows.Forms.Button
$btnMakeAction.Text      = "⚡ توليد ونسخ كود الدعم الفني"
$btnMakeAction.Font      = $boldFont
$btnMakeAction.Location  = New-Object System.Drawing.Point(395, 27)
$btnMakeAction.Size      = New-Object System.Drawing.Size(270, 34)
$btnMakeAction.BackColor = $cBtnDev
$btnMakeAction.ForeColor = [System.Drawing.Color]::White
$btnMakeAction.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat

$btnCopyLic = New-Object System.Windows.Forms.Button
$btnCopyLic.Text      = "📋 نسخ آخر ترخيص تم إصداره"
$btnCopyLic.Font      = $baseFont
$btnCopyLic.Location  = New-Object System.Drawing.Point(395, 67)
$btnCopyLic.Size      = New-Object System.Drawing.Size(270, 32)
$btnCopyLic.BackColor = $cBtn
$btnCopyLic.ForeColor = [System.Drawing.Color]::White
$btnCopyLic.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat

# ---------------- Status & Footer ----------------
$status = New-Object System.Windows.Forms.TextBox
$status.Multiline   = $true
$status.ReadOnly    = $true
$status.ScrollBars  = [System.Windows.Forms.ScrollBars]::Vertical
$status.Font        = $cMonoLt
$status.BackColor   = [System.Drawing.Color]::FromArgb(20, 22, 30)
$status.ForeColor   = [System.Drawing.Color]::FromArgb(185, 210, 235)
$status.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$status.Location    = New-Object System.Drawing.Point(20, 652)
$status.Size        = New-Object System.Drawing.Size(680, 105)
$status.Text        = "جاهز للعمل ✓ المفاتيح الرقمية (Ed25519) متزامنة وجاهزة.`r`nالصق كود HWID أو اضغط «🖥️ هذا الجهاز» ثم اضغط «⚡ إصدار ونسخ فوري للترخيص»."

$footer = New-Object System.Windows.Forms.Label
$footer.Text      = "صنع بواسطة " + $OwnerLine + " — GymSystem License Suite v9 Pro"
$footer.Font      = New-Object System.Drawing.Font("Segoe UI", 8.5)
$footer.ForeColor = $cMuted
$footer.AutoSize  = $true
$footer.Location  = New-Object System.Drawing.Point(20, 768)

# ------------------------------------------------------------
#  State & Helpers
# ------------------------------------------------------------
$script:Rows = [System.Collections.ArrayList]::new()

function Write-Status([string]$Text) { $status.Text = $Text }

function Update-Preview {
  $days = 0
  if ([int]::TryParse($txtDays.Text, [ref]$days) -and $days -ge 0) {
    $exp = (Get-Date).AddDays([double]$days)
    $lblExp.Text = "ينتهي: " + $exp.ToString("yyyy-MM-dd")
    $lblExp.ForeColor = $cGreen
  } else {
    $lblExp.Text = "أيام غير صالحة"
    $lblExp.ForeColor = [System.Drawing.Color]::FromArgb(255, 120, 120)
  }
}

$cmbAction.Add_SelectedIndexChanged({
  switch ($cmbAction.SelectedIndex) {
    1 {
      $txtActionParam.Enabled = $true
      $txtActionParam.Text = "Owner@123456"
      $lblActionParam.Text = "كلمة المرور الجديدة للمالك:"
    }
    2 {
      $txtActionParam.Enabled = $true
      $txtActionParam.Text = "7"
      $lblActionParam.Text = "عدد أيام التمديد الطارئ:"
    }
    default {
      $txtActionParam.Enabled = $false
      $txtActionParam.Text = ""
      $lblActionParam.Text = "لا توجد معاملات إضافية لهذا الإجراء:"
    }
  }
})

# ------------------------------------------------------------
#  Event Handlers
# ------------------------------------------------------------
$btnPaste.Add_Click({
  try {
    $clip = [System.Windows.Forms.Clipboard]::GetText().Trim().ToUpperInvariant()
    if ($clip) { $txtHwid.Text = $clip; Write-Status "تم لصق كود HWID من الحافظة: $clip" } else { Write-Status "الحافظة فارغة." }
  } catch { Write-Status ("تعذر القراءة من الحافظة: " + $_.Exception.Message) }
})

$btnHere.Add_Click({
  try {
    $res = Invoke-LicenseCli -ToolArgs @("hwid")
    if ($res.Exit -eq 0) {
      $id = $res.Out.Trim().ToUpperInvariant()
      $txtHwid.Text = $id
      Write-Status "تم سحب كود HWID الخاص بهذا الجهاز بنجاح: $id"
    } else {
      Write-Status ("تعذر سحب HWID: " + $res.Out)
    }
  } catch {
    Write-Status ("خطأ: " + $_.Exception.Message)
  }
})

$txtDays.Add_TextChanged({ Update-Preview })
$txtGym.Add_TextChanged({ Update-Preview })

$btnQuickIssue.Add_Click({
  $hwid = $txtHwid.Text.Trim().ToUpperInvariant()
  if ($hwid -notmatch $HWID_RE) {
    Write-Status "⚠️ كود HWID غير صالح. الصيغة الصحيحة: GYM-XXXX-XXXX-XXXX-XXXX (اضغط «🖥️ هذا الجهاز» أو الصق كود العميل)."
    return
  }
  $gym = $txtGym.Text.Trim()
  if ([string]::IsNullOrWhiteSpace($gym)) { $gym = "GymSystem" }
  $days = 365
  if (-not [int]::TryParse($txtDays.Text, [ref]$days) -or $days -lt 1) {
    Write-Status "⚠️ أدخل عدد أيام صحيح أكبر من 0."
    return
  }
  $tier = [string]$cmbTier.SelectedItem
  if (-not $tier) { $tier = "full" }

  try {
    if (-not (Test-Path $IssuedDir)) { New-Item -ItemType Directory -Path $IssuedDir -Force | Out-Null }
    $outFile = Join-Path $IssuedDir ($hwid + ".lic")
    $res = Invoke-LicenseCli -ToolArgs @("issue", $hwid, "--gym", $gym, "--days", "$days", "--tier", $tier, "--out", $outFile)
    if ($res.Exit -eq 0 -and (Test-Path $outFile)) {
      $licContent = [System.IO.File]::ReadAllText($outFile)
      [System.Windows.Forms.Clipboard]::SetText($licContent)
      $expStr = (Get-Date).AddDays([double]$days).ToString("yyyy-MM-dd")
      Write-Status "✅ تم إصدار الترخيص ونسخه إلى الحافظة فوراً!`r`nالجهاز: $hwid | النادي: $gym | الباقة: $tier | ينتهي: $expStr`r`nالملف محفوظ في: $outFile"
      [System.Windows.Forms.MessageBox]::Show("تم إصدار الترخيص ونسخ كود التفعيل إلى الحافظة بنجاح! ✅`n`n• الجهاز: $hwid`n• النادي: $gym`n• الصلاحية: $days يوم (حتى $expStr)`n`nيمكنك الآن لصق الكود مباشرة في شاشة التفعيل أو إرسال ملف ($hwid.lic) للعميل.", $ToolName, [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    } else {
      Write-Status ("❌ فشل الإصدار: " + $res.Out)
    }
  } catch {
    Write-Status ("❌ خطأ: " + $_.Exception.Message)
  }
})

$btnAdd.Add_Click({
  $hwid = $txtHwid.Text.Trim().ToUpperInvariant()
  if ($hwid -notmatch $HWID_RE) {
    Write-Status "⚠️ كود HWID غير صالح. الصيغة الصحيحة: GYM-XXXX-XXXX-XXXX-XXXX."
    return
  }
  foreach ($r in $script:Rows) {
    if ($r.HwId -eq $hwid) { Write-Status "الجهاز $hwid موجود بالفعل في القائمة."; $txtHwid.Clear(); return }
  }
  $gym = $txtGym.Text.Trim()
  if ([string]::IsNullOrWhiteSpace($gym)) { $gym = "GymSystem" }
  $days = 365
  if (-not [int]::TryParse($txtDays.Text, [ref]$days) -or $days -lt 1) {
    Write-Status "خطأ: أدخل عدد أيام صحيح أكبر من 0."
    return
  }
  $tier = [string]$cmbTier.SelectedItem
  if (-not $tier) { $tier = "full" }
  $expStr = (Get-Date).AddDays([double]$days).ToString("yyyy-MM-dd")
  $item = New-Object System.Windows.Forms.ListViewItem($hwid)
  [void]$item.SubItems.Add($gym)
  [void]$item.SubItems.Add($tier)
  [void]$item.SubItems.Add("$days")
  [void]$item.SubItems.Add($expStr)
  [void]$item.SubItems.Add("في الانتظار")
  [void]$lv.Items.Add($item)
  [void]$script:Rows.Add([pscustomobject]@{ HwId = $hwid; Gym = $gym; Tier = $tier; Days = $days; Expiry = $expStr; Item = $item })
  $lv.Items[$lv.Items.Count-1].EnsureVisible()
  $txtHwid.Clear()
  $txtHwid.Focus()
  Write-Status "تمت إضافة $hwid — الإجمالي في القائمة: $($script:Rows.Count) جهاز."
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
  Write-Status "تم مسح القائمة بالكامل."
})

$btnGenerate.Add_Click({
  if ($script:Rows.Count -eq 0) { Write-Status "القائمة فارغة — أضف جهازاً واحداً على الأقل أو استخدم زر «⚡ إصدار ونسخ فوري»."; return }
  $btnGenerate.Enabled = $false
  try {
    if (-not (Test-Path $IssuedDir)) { New-Item -ItemType Directory -Path $IssuedDir -Force | Out-Null }
    $ok = 0; $fail = 0
    $log = New-Object System.Collections.ArrayList
    [void]$log.Add("=== إصدار تراخيص " + (Get-Date).ToString("yyyy-MM-dd HH:mm:ss") + " ===")
    foreach ($r in $script:Rows) {
      $outFile = Join-Path $IssuedDir ($r.HwId + ".lic")
      try {
        $res = Invoke-LicenseCli -ToolArgs @("issue", $r.HwId, "--gym", $r.Gym, "--days", "$($r.Days)", "--tier", $r.Tier, "--out", $outFile)
        if ($res.Exit -eq 0) {
          $r.Item.SubItems[5].Text = "تم ✓"
          $r.Item.SubItems[5].ForeColor = $cGreen
          $ok++
          [void]$log.Add("OK    " + $r.HwId + " | " + $r.Gym + " | " + $r.Tier + " | " + $r.Days + " يوم | حتى " + $r.Expiry)
        } else {
          $r.Item.SubItems[5].Text = "خطأ"
          $r.Item.SubItems[5].ForeColor = [System.Drawing.Color]::FromArgb(255, 120, 120)
          $fail++
          [void]$log.Add("FAIL  " + $r.HwId + " | " + ($res.Out -replace "\s+", " "))
        }
      } catch {
        $r.Item.SubItems[5].Text = "خطأ"
        $r.Item.SubItems[5].ForeColor = [System.Drawing.Color]::FromArgb(255, 120, 120)
        $fail++
        [void]$log.Add("FAIL  " + $r.HwId + " | " + $_.Exception.Message)
      }
    }
    [void]$log.Add("=== ملخص: نجح " + $ok + " / إجمالي " + $script:Rows.Count + " ===")
    [System.IO.File]::WriteAllLines((Join-Path $IssuedDir "log.txt"), $log)
    Write-Status "تم إنشاء $ok ترخيص بنجاح في المجلد: $IssuedDir"
    $msg = "تم إنشاء " + $ok + " ترخيص من أصل " + $script:Rows.Count + " داخل:" + [Environment]::NewLine + $IssuedDir
    [System.Windows.Forms.MessageBox]::Show($msg, $ToolName, [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
  } catch {
    Write-Status ("خطأ: " + $_.Exception.Message)
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
    Write-Status "لا توجد ملفات ترخيص مصدرة بعد — اضغط «⚡ إصدار ونسخ فوري» أولاً."
  }
})

$btnInspect.Add_Click({
  $ofd = New-Object System.Windows.Forms.OpenFileDialog
  $ofd.Filter = "ملفات الترخيص (*.lic)|*.lic|All files (*.*)|*.*"
  $ofd.Title = "اختر ملف ترخيص لفحصه والتحقق من توقيعه الرقمي"
  if (Test-Path $IssuedDir) { $ofd.InitialDirectory = $IssuedDir }
  if ($ofd.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    try {
      $res = Invoke-LicenseCli -ToolArgs @("inspect", $ofd.FileName)
      Write-Status $res.Out
      [System.Windows.Forms.MessageBox]::Show($res.Out, "فحص الترخيص الرقمي", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
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
    Write-Status "⚠️ أدخل كود HWID صحيح أولاً في خانة HWID أو اضغط «🖥️ هذا الجهاز» أو حدد جهازاً من القائمة."
    return
  }
  $actType = "reset_clock"
  $extraArgs = @()
  switch ($cmbAction.SelectedIndex) {
    0 { $actType = "reset_clock" }
    1 {
      $actType = "reset_owner"
      $pwd = $txtActionParam.Text.Trim()
      if (-not $pwd) { $pwd = "Owner@123456" }
      $extraArgs = @("--new-pass", $pwd)
    }
    2 {
      $actType = "emergency_grace"
      $gDays = 7
      if ([int]::TryParse($txtActionParam.Text.Trim(), [ref]$gDays) -and $gDays -gt 0) {
        $extraArgs = @("--days", "$gDays")
      } else {
        $extraArgs = @("--days", "7")
      }
    }
    3 { $actType = "force_deactivate" }
  }
  try {
    $allArgs = @("action", $targetHwid, $actType) + $extraArgs
    $res = Invoke-LicenseCli -ToolArgs $allArgs
    if ($res.Exit -eq 0) {
      $lines = $res.Out -split "`r?`n"
      $tokenLine = ""
      foreach ($l in $lines) {
        if ($l.Trim().StartsWith('{"payload":')) { $tokenLine = $l.Trim(); break }
      }
      if ($tokenLine) {
        [System.Windows.Forms.Clipboard]::SetText($tokenLine)
        Write-Status ("✅ تم توليد ونسخ كود الدعم الفني ($actType) إلى الحافظة!`r`n" + $res.Out)
        [System.Windows.Forms.MessageBox]::Show("تم توليد ونسخ كود الدعم الفني ($actType) إلى الحافظة بنجاح! ✅`n`nالصق الكود في شاشة التفعيل/الدعم الفني داخل التطبيق.", "كود طوارئ المطور", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
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
#  Assemble Window
# ------------------------------------------------------------
$form.Controls.AddRange(@($title, $owner, $subtit, $issueGroup, $listGroup, $devGroup, $status, $footer))
$issueGroup.Controls.AddRange(@($lblHwid, $txtHwid, $btnPaste, $btnHere, $lblGym, $txtGym, $lblDays, $txtDays, $lblTier, $cmbTier, $lblExp, $lblPresets, $p1, $p2, $p3, $p4, $p5, $p6, $btnQuickIssue, $btnAdd))
$listGroup.Controls.AddRange(@($lv, $btnGenerate, $btnRemove, $btnClear, $btnOpenIssued, $btnInspect))
$devGroup.Controls.AddRange(@($lblAction, $cmbAction, $lblActionParam, $txtActionParam, $btnMakeAction, $btnCopyLic))

$form.Add_Shown({
  Update-Preview
  $form.Activate()
})

[System.Windows.Forms.Application]::EnableVisualStyles()
[void]$form.ShowDialog()