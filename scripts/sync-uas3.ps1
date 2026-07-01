<#
  sync-uas3.ps1  -  Push UAS3 data into the IME Supabase dashboard.

  Runs on the UAS3 machine. Reads the locally-hosted UAS3 PostgreSQL with the
  psql.exe that already ships with that PostgreSQL install (nothing to install),
  flattens each schema's node tree into the existing Supabase hierarchy, and
  writes over plain HTTPS using the Supabase service key.

  One UAS3 Postgres holds many schemas named <id>_<company><location>
  (e.g. 115150520_rccbalsip). For each schema the script:
    1. parses company + location from the schema name and matches them to
       Supabase companies/locations,
    2. reads tbl_mast_nodes + tbl_tran_measur_ultraextended + tbl_mast_categorydetail,
    3. flattens type-3 groups -> lines/sections/equipment/components,
       type-4 -> measurement_points.name, type-0/5 sensor -> sensor_model,
    4. upserts on the UAS3 uid GUID (rename/move-safe), stamping synced_at = run start,
    5. hard-deletes this location's rows older than the run (mark-and-sweep).

  Hierarchy matches on the stable uid, so renames/re-parents update in place
  instead of delete+recreate. Synthesized shallow levels get a deterministic uid.

  crest_factor and alarm_level are computed by the database (generated columns).
  Requires the uas3_live_sync migration to be applied first (already done).
#>

# === CONFIG (internal use - hardcoded on purpose) ============================
$LocalPg = @{
  Host = 'localhost'; Port = 5423; Db = 'postgres'; User = 'postgres'
  Password = 'PasswordPassword123'
}
$Supabase = @{
  Url        = 'https://gszfyelaezdftlwtzrjw.supabase.co'
  ServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdzemZ5ZWxhZXpkZnRsd3R6cmp3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODEwNDM0MiwiZXhwIjoyMDkzNjgwMzQyfQ.VtiEsBc2UuSjc5KrfffDcmAxSX1rSExiVQlGrxaeK10'
}
# Optional explicit path to psql.exe; left blank = auto-detect from the PG install
$PsqlExe = 'C:\Program Files\S.D.T. INTERNATIONAL\Ultranalysis Suite 3\Resources\BacRec\PostgreSQL18\psql.exe'


$ErrorActionPreference = 'Stop'

# === Helpers =================================================================
function Key { $args -join '|' }   # composite map key (avoids pipe-in-string parsing)
function Normalize([string]$s) { ($s -replace '[^A-Za-z0-9]', '').ToLower() }
function NZ($v) { if ($null -eq $v -or $v -eq '') { $null } else { $v } }          # null if empty (uuid/text)
function ND($v) { if ($null -eq $v -or $v -eq '') { $null } else { [double]$v } }   # null if empty (numeric)

# Deterministic GUID from a string (MD5 -> uuid). Used to give synthesized levels
# (shallow-tree padding with no source node) a stable uas_uid across syncs.
function DetGuid([string]$s) {
  $md5 = [System.Security.Cryptography.MD5]::Create()
  try { $b = $md5.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($s)) } finally { $md5.Dispose() }
  ([guid]::new($b)).ToString()
}

# Retry transient gateway/timeout errors (Supabase occasionally 502/503/504s under load).
function Invoke-Retry([scriptblock]$Action, [int]$Tries = 5) {
  for ($a = 1; $a -le $Tries; $a++) {
    try { return & $Action }
    catch {
      $m = $_.Exception.Message
      if ($a -eq $Tries -or $m -notmatch '50[234]|Bad Gateway|Service Unavailable|Gateway Time|timed out|timeout|actively refused') { throw }
      Start-Sleep -Seconds ([Math]::Min(30, [Math]::Pow(2, $a)))
    }
  }
}

function Resolve-Psql {
  if ($script:PsqlExe -and (Test-Path $script:PsqlExe)) { return $script:PsqlExe }
  $cmd = Get-Command psql.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $hit = Get-ChildItem 'C:\Program Files\PostgreSQL','C:\Program Files (x86)\PostgreSQL' `
           -Recurse -Filter psql.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($hit) { return $hit.FullName }
  throw 'psql.exe not found. Set $PsqlExe to its full path.'
}

function Invoke-LocalQuery([string]$Sql) {
  $env:PGPASSWORD = $LocalPg.Password
  # Feed SQL via stdin (-f -); passing it with -c lets PowerShell strip the
  # double-quotes around the schema identifier, which breaks numeric-named schemas.
  $out = $Sql | & $script:Psql -h $LocalPg.Host -p $LocalPg.Port -U $LocalPg.User -d $LocalPg.Db `
           -q -t -A --csv -f - 2>&1
  if ($LASTEXITCODE -ne 0) { throw "psql failed: $out" }
  if (-not $out) { return @() }
  return ($out -join "`n")
}

function Get-LocalRows([string]$Sql, [string[]]$Columns) {
  $csv = Invoke-LocalQuery $Sql
  if (-not $csv) { return @() }
  return ($csv | ConvertFrom-Csv -Header $Columns)
}

function Supa-Headers {
  @{ apikey = $Supabase.ServiceKey; Authorization = "Bearer $($Supabase.ServiceKey)" }
}

function Supa-Get([string]$Path) {
  Invoke-RestMethod -Method Get -Uri "$($Supabase.Url)/rest/v1/$Path" -Headers (Supa-Headers)
}

function Supa-Upsert([string]$Table, [string]$OnConflict, [array]$Rows) {
  if (-not $Rows -or $Rows.Count -eq 0) { return @() }
  $h = Supa-Headers
  $h['Content-Type'] = 'application/json'
  $h['Prefer'] = 'resolution=merge-duplicates,return=representation'
  $body = ConvertTo-Json @($Rows) -Depth 12
  $uri = "$($Supabase.Url)/rest/v1/$Table" + "?on_conflict=$OnConflict"
  Invoke-Retry { Invoke-RestMethod -Method Post -Uri $uri -Headers $h -Body $body }
}

function Supa-Sweep([string]$Table, [string]$LocationId, [string]$RunStamp) {
  $stamp = [uri]::EscapeDataString($RunStamp)
  $uri = "$($Supabase.Url)/rest/v1/$Table" + "?location_id=eq.$LocationId" + "&synced_at=lt.$stamp"
  Invoke-RestMethod -Method Delete -Uri $uri -Headers (Supa-Headers) | Out-Null
}

function Supa-Patch([string]$Table, [string]$Query, $Obj) {
  $h = Supa-Headers; $h['Content-Type'] = 'application/json'; $h['Prefer'] = 'return=minimal'
  $uri = "$($Supabase.Url)/rest/v1/$Table" + "?$Query"
  Invoke-Retry { Invoke-RestMethod -Method Patch -Uri $uri -Headers $h -Body (ConvertTo-Json $Obj -Depth 5) } | Out-Null
}

function Supa-UploadBytes([string]$Bucket, [string]$Path, [byte[]]$Bytes, [string]$ContentType) {
  $h = Supa-Headers; $h['Content-Type'] = $ContentType; $h['x-upsert'] = 'true'
  $uri = "$($Supabase.Url)/storage/v1/object/$Bucket/$Path"
  Invoke-Retry { Invoke-RestMethod -Method Post -Uri $uri -Headers $h -Body $Bytes } | Out-Null
}

# === Resolve company + location from a schema name ===========================
function Resolve-Scope([string]$SchemaName, $Companies) {
  $token = Normalize(($SchemaName -split '_', 2)[-1])   # part after the first underscore
  # Company token may sit anywhere (rccbalsip = rccb+alsip, nilesrccb = niles+rccb),
  # so match company as a substring and treat the remainder as the location.
  foreach ($c in ($Companies | Sort-Object { (Normalize $_.name).Length } -Descending)) {
    $cn = Normalize $c.name
    if (-not $cn -or -not $token.Contains($cn)) { continue }
    $rest = $token.Replace($cn, '')
    $locs = Supa-Get "locations?company_id=eq.$($c.id)&select=id,name"
    $loc = $locs | Where-Object { (Normalize $_.name) -eq $rest } | Select-Object -First 1
    if ($loc) { return [pscustomobject]@{ CompanyId = $c.id; LocationId = $loc.id; LocationName = $loc.name } }
  }
  return $null
}

# === Flatten one schema's node tree into point records =======================
function Build-PointRecords($Nodes) {
  $byId = @{}; foreach ($n in $Nodes) { $byId[$n.node_id] = $n }

  $records = @{}   # leaf node_id -> point record
  foreach ($leaf in ($Nodes | Where-Object { $_.node_type_340 -in @('0','5') })) {
    # walk leaf -> root, collecting the full chain
    $chain = New-Object System.Collections.ArrayList
    $cur = $leaf; $i = 0
    while ($cur -and $i -lt 50) {
      [void]$chain.Add($cur)
      if ($cur.node_parentid -eq '-1') { break }
      $cur = $byId[$cur.node_parentid]; $i++
    }

    $comp = $chain | Where-Object { $_.node_type_340 -eq '4' } | Select-Object -First 1
    if (-not $comp) { continue }

    # type-3 groups top-down. Drop the first (the per-schema location/site level,
    # e.g. 'Alsip' or 'Niles RCCB'); the rest map to line/section/equipment/component.
    $groupsAll = @($chain | Where-Object { $_.node_type_340 -eq '3' })
    [array]::Reverse($groupsAll)
    if ($groupsAll.Count -le 1) { $g = @() } else { $g = @($groupsAll[1..($groupsAll.Count - 1)]) }

    $line      = if ($g.Count -ge 1) { $g[0].node_name } else { $comp.node_name }
    $section   = if ($g.Count -ge 2) { $g[1].node_name } else { $line }
    $equipment = if ($g.Count -ge 3) { $g[2].node_name } else { $section }
    $component = if ($g.Count -ge 4) { ($g[3..($g.Count-1)] | ForEach-Object { $_.node_name }) -join ' / ' } else { $equipment }

    # Every level gets a stable uas_uid: the real UAS3 node uid where it exists,
    # else a deterministic uid from the name path (for synthesized shallow levels).
    $lineUid = if ($g.Count -ge 1) { $g[0].uid } else { DetGuid("L~$line") }
    $secUid  = if ($g.Count -ge 2) { $g[1].uid } else { DetGuid("S~$line~$section") }
    $eqUid   = if ($g.Count -ge 3) { $g[2].uid } else { DetGuid("E~$line~$section~$equipment") }
    $compUid = if ($g.Count -ge 4) { $g[3].uid } else { DetGuid("C~$line~$section~$equipment~$component") }

    $path = (@($groupsAll | ForEach-Object { $_.node_name }) + @($comp.node_name, $leaf.node_name)) -join ' \ '

    $records[$leaf.node_id] = [pscustomobject]@{
      LeafId = $leaf.node_id
      Line = $line; Section = $section; Equipment = $equipment; Component = $component
      MpName = $comp.node_name; SensorModel = $leaf.node_name
      LineUid = $lineUid; SectionUid = $secUid; EquipmentUid = $eqUid; ComponentUid = $compUid
      MpUid = $comp.uid; SensorUid = $leaf.uid; FullPath = $path
    }
  }
  return $records
}

# === Upload FLAC waveform + FFT signals (idempotent, append-only) ============
function Sync-Signals([string]$Schema, [string]$lid, $WantIds) {
  # mes_ids are handled as STRINGS end-to-end (hashtable keys, SQL IN list, paths)
  # to avoid any int-array cast surprises from the REST/CSV layers.
  $want = @($WantIds | ForEach-Object { "$_" } | Where-Object { $_ })
  if ($want.Count -eq 0) { return }

  $uploaded = 0; $skipped = 0; $seen = 0
  for ($i = 0; $i -lt $want.Count; $i += 100) {
    $chunk  = @($want[$i..([Math]::Min($i + 99, $want.Count - 1))])
    $inList = ($chunk -join ',')

    # Let the DB tell us which of these still LACK a signal (server-side filter, so
    # there is no client-side id matching to get wrong). Only those get uploaded.
    $needRows = @(Supa-Get "measurements?location_id=eq.$lid&uas_mes_id=in.($inList)&waveform_path=is.null&select=uas_mes_id") |
                Where-Object { $_ -and $null -ne $_.uas_mes_id }
    $need = @($needRows | ForEach-Object { "$($_.uas_mes_id)" })
    $seen += $chunk.Count
    $skipped += ($chunk.Count - $need.Count)
    if ($need.Count -eq 0) { continue }

    $nlist = ($need -join ',')
    $rows = Get-LocalRows `
      "select w.mes_id, w.sample_rate, encode(w.wave_data,'base64') wav, encode(f.fft_data,'base64') fftd, f.fft_length, f.fft_windows_type from ""$Schema"".tbl_trans_wavefiles w left join ""$Schema"".tbl_trans_fft f on f.mes_id=w.mes_id where w.mes_id in ($nlist)" `
      @('mes_id','sample_rate','wav','fftd','fft_length','fft_win')
    foreach ($row in $rows) {
      $mesId = $row.mes_id
      $patch = @{}
      if ($row.wav) {
        Supa-UploadBytes 'uas-signals' "$lid/$mesId.flac" ([Convert]::FromBase64String($row.wav)) 'audio/flac'
        $patch['waveform_path'] = "$lid/$mesId.flac"
        $patch['sample_rate']   = if ($row.sample_rate) { [int]$row.sample_rate } else { $null }
      }
      if ($row.fftd) {
        Supa-UploadBytes 'uas-signals' "$lid/$mesId.fft" ([Convert]::FromBase64String($row.fftd)) 'application/octet-stream'
        $patch['fft_path']   = "$lid/$mesId.fft"
        $patch['fft_length'] = if ($row.fft_length) { [int]$row.fft_length } else { $null }
        $patch['fft_window'] = (NZ $row.fft_win)
      }
      if ($patch.Count -gt 0) { Supa-Patch 'measurements' "location_id=eq.$lid&uas_mes_id=eq.$mesId" $patch; $uploaded++ }
    }
    Write-Host "    signals: $seen/$($want.Count) checked · $uploaded uploaded · $skipped already present"
  }
  Write-Host "  signals: $uploaded uploaded, $skipped already present"
}

# === Sync one schema =========================================================
function Sync-Schema([string]$Schema, $Scope) {
  $cid = $Scope.CompanyId; $lid = $Scope.LocationId
  $run = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')

  $nodes = Get-LocalRows `
    "select node_id, node_name, node_parentid, node_type_340, node_order, uid from ""$Schema"".tbl_mast_nodes where active" `
    @('node_id','node_name','node_parentid','node_type_340','node_order','uid')
  $meas = Get-LocalRows `
    "select mes_id, node_id, mes_rms, mes_peak, mes_realpeak, mes_datetime from ""$Schema"".tbl_tran_measur_ultraextended where active" `
    @('mes_id','node_id','rms','peak','realpeak','dt')

  # per-point config: bearing rotating speed, keyed by the sensor-leaf node_id
  $cat = Get-LocalRows `
    "select node_id, bearing_rotating_speed from ""$Schema"".tbl_mast_categorydetail where active" `
    @('node_id','rot')
  $catMap = @{}; foreach ($c in $cat) { $catMap[$c.node_id] = (ND $c.rot) }

  $typeCounts = ($nodes | Group-Object node_type_340 | ForEach-Object { "t$($_.Name)=$($_.Count)" }) -join ' '
  Write-Host ("  nodes {0} ({1}); measurement rows {2}" -f @($nodes).Count, $typeCounts, @($meas).Count)

  $records = Build-PointRecords $nodes
  if ($records.Count -eq 0) {
    $leaf = $nodes | Where-Object { $_.node_type_340 -in @('0','5') } | Select-Object -First 1
    if ($leaf) {
      $byId2 = @{}; foreach ($n in $nodes) { $byId2[$n.node_id] = $n }
      $chain = @(); $cur = $leaf; $i = 0
      while ($cur -and $i -lt 15) { $chain += "$($cur.node_name)[t$($cur.node_type_340)]"; $cur = $byId2[$cur.node_parentid]; $i++ }
      [array]::Reverse($chain)
      Write-Host ("  sample leaf path: " + ($chain -join ' \ '))
    }
    Write-Host "  no measurement points under location - skipping"; return
  }

  $base = @{ company_id = $cid; location_id = $lid; synced_at = $run }

  # All hierarchy levels upsert on the UAS3 uid GUID (rename/move-safe), and every
  # returned row is mapped back by that same uid.

  # 1 lines
  $lineRows = $records.Values | Sort-Object LineUid -Unique | ForEach-Object {
    $base + @{ name = $_.Line; uas_uid = $_.LineUid } }
  $lineMap = @{}
  (Supa-Upsert 'lines' 'uas_uid' $lineRows) | ForEach-Object { $lineMap[$_.uas_uid] = $_.id }

  # 2 sections
  $secRows = $records.Values | Sort-Object SectionUid -Unique | ForEach-Object {
    $base + @{ line_id = $lineMap[$_.LineUid]; uas_name = $_.Section; uas_uid = $_.SectionUid } }
  $secMap = @{}
  (Supa-Upsert 'sections' 'uas_uid' $secRows) | ForEach-Object { $secMap[$_.uas_uid] = $_.id }

  # 3 equipment
  $eqRows = $records.Values | Sort-Object EquipmentUid -Unique | ForEach-Object {
    $base + @{ section_id = $secMap[$_.SectionUid]; tag = $_.Equipment; uas_uid = $_.EquipmentUid } }
  $eqMap = @{}
  (Supa-Upsert 'equipment' 'uas_uid' $eqRows) | ForEach-Object { $eqMap[$_.uas_uid] = $_.id }

  # 4 components
  $compRows = $records.Values | Sort-Object ComponentUid -Unique | ForEach-Object {
    $base + @{ equipment_id = $eqMap[$_.EquipmentUid]; name = $_.Component; uas_uid = $_.ComponentUid } }
  $compMap = @{}
  (Supa-Upsert 'components' 'uas_uid' $compRows) | ForEach-Object { $compMap[$_.uas_uid] = $_.id }

  # 5 measurement_points (key: uas_uid = the type-4 node uid)
  $mpRows = $records.Values | Sort-Object MpUid -Unique | ForEach-Object {
    $base + @{ component_id = $compMap[$_.ComponentUid]; name = $_.MpName; sensor_model = $_.SensorModel
      uas_uid = $_.MpUid; uas_sensor_uid = $_.SensorUid; uas_full_path = $_.FullPath
      bearing_rotating_speed = $catMap[$_.LeafId] } }
  $mpMap = @{}
  (Supa-Upsert 'measurement_points' 'uas_uid' $mpRows) | ForEach-Object { $mpMap[$_.uas_uid] = $_.id }

  # sensor-leaf node_id -> measurement_point id (via the type-4 MpUid)
  $leafToMp = @{}
  foreach ($r in $records.Values) { $leafToMp[$r.LeafId] = $mpMap[$r.MpUid] }

  # 6 measurements - dedupe to latest reading per (point, day)
  $best = @{}
  foreach ($m in $meas) {
    $mpId = $leafToMp[$m.node_id]; if (-not $mpId) { continue }
    $dt = [datetime]::Parse($m.dt, [Globalization.CultureInfo]::InvariantCulture)
    $day = $dt.ToString('yyyy-MM-dd')
    $k = (Key $mpId $day)
    if (-not $best.ContainsKey($k) -or $dt -gt $best[$k].DT) {
      $best[$k] = [pscustomobject]@{ M = $m; DT = $dt; MpId = $mpId; Day = $day }
    }
  }
  $measRows = $best.Values | ForEach-Object {
    @{ measurement_point_id = $_.MpId; company_id = $cid; location_id = $lid; synced_at = $run
       overall_rms = (ND $_.M.rms); max_rms = (ND $_.M.peak); peak = (ND $_.M.realpeak)
       uas_mes_id = [int]$_.M.mes_id
       measured_at = $_.Day; measured_datetime = $_.DT.ToString('o') } }
  Supa-Upsert 'measurements' 'measurement_point_id,measured_at' $measRows | Out-Null

  # 7 mark-and-sweep: hard delete anything for this location not touched this run
  #    (signals in the uas-signals bucket are append-only and never swept)
  foreach ($t in 'measurements','measurement_points','components','equipment','sections','lines') {
    Supa-Sweep $t $lid $run
  }

  # 8 signals: FLAC waveform + FFT per kept measurement (idempotent, append-only)
  Sync-Signals $Schema $lid @($best.Values | ForEach-Object { $_.M.mes_id })

  Write-Host ("  lines {0}  sections {1}  equipment {2}  components {3}  points {4}  measurements {5}" -f `
    $lineMap.Count, $secMap.Count, $eqMap.Count, $compMap.Count, $mpMap.Count, @($measRows).Count)
}

# === Main ====================================================================
$script:Psql = Resolve-Psql
Write-Host "Using psql: $script:Psql"

$companies = Supa-Get 'companies?select=id,name'
$schemas = (Get-LocalRows `
  "select schema_name from information_schema.schemata where schema_name ~ '^[0-9]+_'" `
  @('schema_name')) | ForEach-Object { $_.schema_name }

if (-not $schemas) { Write-Host 'No UAS3 schemas (<id>_<name>) found.'; return }

foreach ($schema in $schemas) {
  Write-Host "Schema: $schema"
  $scope = Resolve-Scope $schema $companies
  if (-not $scope) { Write-Host "  could not match company/location - skipping"; continue }
  Write-Host "  -> location '$($scope.LocationName)'"
  try { Sync-Schema $schema $scope }
  catch { Write-Warning "  sync failed: $($_.Exception.Message)" }
}
Write-Host 'Done.'
