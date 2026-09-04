#============================================================
#  Yassen Mohamed Kotb | 01288536381  -  License Tool GUI
#  Windows Forms GUI for issuing GymSystem offline licenses.
#  Zero dependencies: uses PowerShell 5.1 + node (the signing
#  logic stays in license-tool.mjs — this is just the skin).
#  Run by double-clicking LicenseTool.bat (or License Tool.bat).
#============================================================
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$ToolName   = "GymSystem - License Tool v6"
$PSScript   = $PSScriptRoot
if (-not $PSScript) { $PSScript = Split-Path -Parent $MyInvocation.MyCommand.Path }
$ToolMjs    = Join-Path $PSScript "license-tool.mjs"
$LicFile    = Join-Path $PSScript "license.lic"

# ------------------------------------------------------------
#  Node helper: run license-tool.mjs and return its output text
# ------------------------------------------------------------
function Invoke-LicenseCli {
  param([string[]]$ToolArgs)
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js غير موجود في مسار النظام (PATH). تأكد من تثبيت Node ثم أعد المحاولة."
  }
  $output = & node $ToolMjs @ToolArgs 2>&1 | Out-String
  return [string]$output
}

# ------------------------------------------------------------
#  Build the form
# ------------------------------------------------------------
[void][System.Reflection.Assembly]::LoadWithPartialName("System.Windows.Forms")
[void][System.Reflection.Assembly]::LoadWithPartialName("System.Drawing")

$form = New-Object System.Windows.Forms.Form
$form.Text            = $ToolName
$form.StartPosition   = "CenterScreen"
$form.FormBorderStyle = "FixedSingle"
$form.MaximizeBox     = $false
$form.ClientSize      = New-Object System.Drawing.Size(560, 560)
$form.Icon            = [System.Drawing.SystemIcons]::Application
$form.BackColor       = [System.Drawing.Color]::FromArgb(18, 18, 24)

$baseFont = New-Object System.Drawing.Font("Segoe UI", 10)

$title = New-Object System.Windows.Forms.Label
$title.Text     = "أداة ترخيص النظام - إصدار 6"
$title.Font     = New-Object System.Drawing.Font("Segoe UI", 14, [System.Drawing.FontStyle]::Bold)
$title.ForeColor= [System.Drawing.Color]::FromArgb(64, 233, 255)
$title.AutoSize = $true
$title.Location = New-Object System.Drawing.Point(20, 16)

$sub = New-Object System.Windows.Forms.Label
$sub.Text     = "إصدار وتفعيل تراخيص جيم سيستم بدون إنترنت - مجلد الأداة: license-cli\"
$sub.Font     = $baseFont
$sub.ForeColor= [System.Drawing.Color]::FromArgb(160, 160, 170)
$sub.AutoSize = $true
$sub.Location = New-Object System.Drawing.Point(20, 48)

# ---------------- HWID group ----------------
$hwidGroup = New-Object System.Windows.Forms.GroupBox
$hwidGroup.Text = "1) معرّف هذا الجهاز (HWID)"
$hwidGroup.ForeColor = [System.Drawing.Color]::FromArgb(220, 220, 230)
$hwidGroup.Font = $baseFont
$hwidGroup.Location = New-Object System.Drawing.Point(20, 80)
$hwidGroup.Size = New-Object System.Drawing.Size(520, 88)

$txtHwid = New-Object System.Windows.Forms.TextBox
$txtHwid.Location = New-Object System.Drawing.Point(16, 30)
$txtHwid.Size = New-Object System.Drawing.Size(340, 24)
$txtHwid.Font = New-Object System.Drawing.Font("Consolas", 10)
$txtHwid.BackColor = [System.Drawing.Color]::FromArgb(30, 30, 40)
$txtHwid.ForeColor = [System.Drawing.Color]::FromArgb(140, 255, 170)
$txtHwid.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$txtHwid.ReadOnly = $true

$btnCopyHwid = New-Object System.Windows.Forms.Button
$btnCopyHwid.Text = "نسخ المعرّف"
$btnCopyHwid.Location = New-Object System.Drawing.Point(372, 28)
$btnCopyHwid.Size = New-Object System.Drawing.Size(128, 30)
$btnCopyHwid.BackColor = [System.Drawing.Color]::FromArgb(40, 40, 52)
$btnCopyHwid.ForeColor = [System.Drawing.Color]::White
$btnCopyHwid.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat

# ---------------- Issue group ----------------
$issueGroup = New-Object System.Windows.Forms.GroupBox
$issueGroup.Text = "2) إصدار رخصة لهذا الجهاز"
$issueGroup.ForeColor = [System.Drawing.Color]::FromArgb(220, 220, 230)
$issueGroup.Font = $baseFont
$issueGroup.Location = New-Object System.Drawing.Point(20, 184)
$issueGroup.Size = New-Object System.Drawing.Size(520, 176)

$lblGym = New-Object System.Windows.Forms.Label
$lblGym.Text = "اسم النادي:"
$lblGym.ForeColor = [System.Drawing.Color]::FromArgb(200, 200, 210)
$lblGym.Location = New-Object System.Drawing.Point(16, 30)
$lblGym.AutoSize = $true

$txtGym = New-Object System.Windows.Forms.TextBox
$txtGym.Location = New-Object System.Drawing.Point(120, 27)
$txtGym.Size = New-Object System.Drawing.Size(180, 24)
$txtGym.Text = "GymSystem"

$lblDays = New-Object System.Windows.Forms.Label
$lblDays.Text = "مدة التفعيل (أيام):"
$lblDays.ForeColor = [System.Drawing.Color]::FromArgb(200, 200, 210)
$lblDays.Location = New-Object System.Drawing.Point(320, 30)
$lblDays.AutoSize = $true

$txtDays = New-Object System.Windows.Forms.TextBox
$txtDays.Location = New-Object System.Drawing.Point(452, 27)
$txtDays.Size = New-Object System.Drawing.Size(50, 24)
$txtDays.Text = "365"

$lblExp = New-Object System.Windows.Forms.Label
$lblExp.Text = "تاريخ الانتهاء المتوقع: -"
$lblExp.ForeColor = [System.Drawing.Color]::FromArgb(140, 233, 160)
$lblExp.Location = New-Object System.Drawing.Point(16, 66)
$lblExp.AutoSize = $true

$btnIssue = New-Object System.Windows.Forms.Button
$btnIssue.Text = "إصدار الرخصة"
$btnIssue.Location = New-Object System.Drawing.Point(16, 128)
$btnIssue.Size = New-Object System.Drawing.Size(200, 34)
$btnIssue.BackColor = [System.Drawing.Color]::FromArgb(20, 120, 90)
$btnIssue.ForeColor = [System.Drawing.Color]::White
$btnIssue.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$btnIssue.FlatAppearance.BorderSize = 0

$lblIssueHint = New-Object System.Windows.Forms.Label
$lblIssueHint.Text = "سيكتب الملف license.lic داخل مجلد الأداة"
$lblIssueHint.ForeColor = [System.Drawing.Color]::FromArgb(150, 150, 160)
$lblIssueHint.Font = New-Object System.Drawing.Font("Segoe UI", 8.5)
$lblIssueHint.Location = New-Object System.Drawing.Point(232, 136)
$lblIssueHint.AutoSize = $true

# ---------------- Actions group ----------------
$actGroup = New-Object System.Windows.Forms.GroupBox
$actGroup.Text = "3) أدوات"
$actGroup.ForeColor = [System.Drawing.Color]::FromArgb(220, 220, 230)
$actGroup.Font = $baseFont
$actGroup.Location = New-Object System.Drawing.Point(20, 372)
$actGroup.Size = New-Object System.Drawing.Size(520, 58)

$btnCopyLic = New-Object System.Windows.Forms.Button
$btnCopyLic.Text = "نسخ محتوى license.lic"
$btnCopyLic.Location = New-Object System.Drawing.Point(16, 20)
$btnCopyLic.Size = New-Object System.Drawing.Size(180, 28)
$btnCopyLic.BackColor = [System.Drawing.Color]::FromArgb(40, 40, 52)
$btnCopyLic.ForeColor = [System.Drawing.Color]::White
$btnCopyLic.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat

$btnOpenFolder = New-Object System.Windows.Forms.Button
$btnOpenFolder.Text = "فتح مجلد الأداة"
$btnOpenFolder.Location = New-Object System.Drawing.Point(208, 20)
$btnOpenFolder.Size = New-Object System.Drawing.Size(150, 28)
$btnOpenFolder.BackColor = [System.Drawing.Color]::FromArgb(40, 40, 52)
$btnOpenFolder.ForeColor = [System.Drawing.Color]::White
$btnOpenFolder.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat

# ---------------- Status box ----------------
$status = New-Object System.Windows.Forms.TextBox
$status.Multiline = $true
$status.ReadOnly = $true
$status.ScrollBars = [System.Windows.Forms.ScrollBars]::Vertical
$status.Font = New-Object System.Drawing.Font("Consolas", 9)
$status.BackColor = [System.Drawing.Color]::FromArgb(24, 24, 32)
$status.ForeColor = [System.Drawing.Color]::FromArgb(180, 200, 220)
$status.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$status.Location = New-Object System.Drawing.Point(20, 442)
$status.Size = New-Object System.Drawing.Size(520, 100)
$status.Text = "جاهز. اضغط «إصدار الرخص» بعد ضبط البيانات."

function Write-Status([string]$Text) { $status.Text = $Text }

function Update-Preview {
  $days = 0
  if ([int]::TryParse($txtDays.Text, [ref]$days) -and $days -ge 0) {
    $exp = (Get-Date).AddDays([double]$days)
    $lblExp.Text = "تاريخ الانتهاء المتوقع: " + $exp.ToString("yyyy-MM-dd")
    $lblExp.ForeColor = [System.Drawing.Color]::FromArgb(140, 233, 160)
  } else {
    $lblExp.Text = "تاريخ الانتهاء المتوقع: (أيام غير صالحة)"
    $lblExp.ForeColor = [System.Drawing.Color]::FromArgb(255, 120, 120)
  }
}

# ---------------- Events ----------------
$btnCopyHwid.Add_Click({
  if ($txtHwid.Text) {
    [System.Windows.Forms.Clipboard]::SetText($txtHwid.Text)
    Write-Status "تم نسخ معرّف الجهاز إلى الحافظة."
  }
})

$txtDays.Add_TextChanged({ Update-Preview })
$txtGym.Add_TextChanged({ Update-Preview })

$btnIssue.Add_Click({
  $btnIssue.Enabled = $false
  try {
    $gym  = $txtGym.Text
    if ([string]::IsNullOrWhiteSpace($gym)) { $gym = "GymSystem" }
    $days = 365
    if (-not [int]::TryParse($txtDays.Text, [ref]$days) -or $days -lt 1) {
      Write-Status "خطأ: أدخل عدد أيام صحيح أكبر من 0."
      return
    }
    Write-Status "جارٍ إصدار الرخصة (node license-tool.mjs issue-here) ..."
    $out = Invoke-LicenseCli -ToolArgs @("issue-here", "--gym", $gym, "--days", "$days")
    Write-Status $out
    if (Test-Path $LicFile) {
      $msg = "تم إصدار الرخصة بنجاح:" + [Environment]::NewLine + $LicFile
      [System.Windows.Forms.MessageBox]::Show($msg, $ToolName, [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    }
  } catch {
    Write-Status ("خطأ: " + $_.Exception.Message)
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, $ToolName, [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  } finally {
    $btnIssue.Enabled = $true
  }
})

$btnCopyLic.Add_Click({
  if (Test-Path $LicFile) {
    $content = [System.IO.File]::ReadAllText($LicFile)
    [System.Windows.Forms.Clipboard]::SetText($content)
    Write-Status "تم نسخ محتوى license.lic إلى الحافظة — الصقه في شاشة التفعيل داخل التطبيق."
  } else {
    Write-Status "لا يوجد license.lic بعد — اضغط «إصدار الرخصة» أولاً."
  }
})

$btnOpenFolder.Add_Click({
  [System.Diagnostics.Process]::Start("explorer.exe", "`"$PSScript`"") | Out-Null
})

# ---------------- Load: get HWID + show ----------------
$form.Add_Shown({
  try {
    $txtHwid.Text = (Invoke-LicenseCli -ToolArgs @("hwid")).Trim()
  } catch {
    $txtHwid.Text = "(تعذر قراءة المعرّف)"
    Write-Status ("خطأ: " + $_.Exception.Message)
  }
  Update-Preview
  $form.Activate()
})

# ---------------- Assemble the window ----------------
# The controls must be ADDED to the form/groups or nothing renders.
$form.Controls.AddRange(@($title, $sub, $hwidGroup, $issueGroup, $actGroup, $status))
$hwidGroup.Controls.AddRange(@($txtHwid, $btnCopyHwid))
$issueGroup.Controls.AddRange(@($lblGym, $txtGym, $lblDays, $txtDays, $lblExp, $btnIssue, $lblIssueHint))
$actGroup.Controls.AddRange(@($btnCopyLic, $btnOpenFolder))

# ---------------- Run ----------------
[System.Windows.Forms.Application]::EnableVisualStyles()
[void]$form.ShowDialog()