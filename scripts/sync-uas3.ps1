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
    2. reads tbl_mast_nodes + tbl_tran_measur_ultraextended,
    3. flattens type-3 groups -> lines/sections/equipment/components,
       type-4 -> measurement_points.name, type-0/5 sensor -> sensor_model,
    4. upserts (on the existing name keys), stamping synced_at = run start,
    5. hard-deletes this location's rows older than the run (mark-and-sweep).

  crest_factor and alarm_level are computed by the database (generated columns).
  Requires the uas3_live_sync migration to be applied first (already done).
#>

# === CONFIG (internal use - hardcoded on purpose) ============================
$LocalPg = @{
  Host = 'localhost'; Port = 5423; Db = 'postgres'; User = 'postgres'
  Password = 'CHANGE_ME_local_uas3_password'
}
$Supabase = @{
  Url        = 'https://gszfyelaezdftlwtzrjw.supabase.co'
  ServiceKey = 'CHANGE_ME_supabase_service_role_key'
}
# Optional explicit path to psql.exe; left blank = auto-detect from the PG install
$PsqlExe = ''

$ErrorActionPreference = 'Stop'

# === Helpers =================================================================
function Key { $args -join '|' }   # composite map key (avoids pipe-in-string parsing)
function Normalize([string]$s) { ($s -replace '[^A-Za-z0-9]', '').ToLower() }
function NZ($v) { if ($null -eq $v -or $v -eq '') { $null } else { $v } }          # null if empty (uuid/text)
function ND($v) { if ($null -eq $v -or $v -eq '') { $null } else { [double]$v } }   # null if empty (numeric)

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
  Invoke-RestMethod -Method Post -Uri $uri -Headers $h -Body $body
}

function Supa-Sweep([string]$Table, [string]$LocationId, [string]$RunStamp) {
  $stamp = [uri]::EscapeDataString($RunStamp)
  $uri = "$($Supabase.Url)/rest/v1/$Table" + "?location_id=eq.$LocationId" + "&synced_at=lt.$stamp"
  Invoke-RestMethod -Method Delete -Uri $uri -Headers (Supa-Headers) | Out-Null
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

    $path = (@($groupsAll | ForEach-Object { $_.node_name }) + @($comp.node_name, $leaf.node_name)) -join ' \ '

    $records[$leaf.node_id] = [pscustomobject]@{
      LeafId = $leaf.node_id
      Line = $line; Section = $section; Equipment = $equipment; Component = $component
      MpName = $comp.node_name; SensorModel = $leaf.node_name
      LineUid = $(if ($g.Count -ge 1) { $g[0].uid }); SectionUid = $(if ($g.Count -ge 2) { $g[1].uid })
      EquipmentUid = $(if ($g.Count -ge 3) { $g[2].uid }); ComponentUid = $(if ($g.Count -ge 4) { $g[3].uid })
      MpUid = $comp.uid; SensorUid = $leaf.uid; FullPath = $path
    }
  }
  return $records
}

# === Sync one schema =========================================================
function Sync-Schema([string]$Schema, $Scope) {
  $cid = $Scope.CompanyId; $lid = $Scope.LocationId
  $run = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')

  $nodes = Get-LocalRows `
    "select node_id, node_name, node_parentid, node_type_340, node_order, uid from ""$Schema"".tbl_mast_nodes where active" `
    @('node_id','node_name','node_parentid','node_type_340','node_order','uid')
  $meas = Get-LocalRows `
    "select mes_id, node_id, mes_rms, mes_peak, mes_realpeak, mes_avgrpm, mes_op_id, mes_senserial, mes_instserial, mes_datetime from ""$Schema"".tbl_tran_measur_ultraextended where active" `
    @('mes_id','node_id','rms','peak','realpeak','rpm','op','senserial','instserial','dt')

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

  # 1 lines
  $lineRows = $records.Values | Sort-Object Line -Unique | ForEach-Object {
    $base + @{ name = $_.Line; uas_uid = (NZ $_.LineUid) } }
  $lineMap = @{}
  (Supa-Upsert 'lines' 'location_id,name' $lineRows) | ForEach-Object { $lineMap[$_.name] = $_.id }

  # 2 sections (key: line_id, uas_name)
  $secRows = $records.Values | Sort-Object Line,Section -Unique | ForEach-Object {
    $base + @{ line_id = $lineMap[$_.Line]; uas_name = $_.Section; uas_uid = (NZ $_.SectionUid) } }
  $secMap = @{}
  (Supa-Upsert 'sections' 'line_id,uas_name' $secRows) | ForEach-Object {
    $secMap[(Key $_.line_id $_.uas_name)] = $_.id }

  # 3 equipment (key: section_id, tag)
  $eqRows = $records.Values | Sort-Object Line,Section,Equipment -Unique | ForEach-Object {
    $sid = $secMap[(Key $lineMap[$_.Line] $_.Section)]
    $base + @{ section_id = $sid; tag = $_.Equipment; uas_uid = (NZ $_.EquipmentUid) } }
  $eqMap = @{}
  (Supa-Upsert 'equipment' 'section_id,tag' $eqRows) | ForEach-Object {
    $eqMap[(Key $_.section_id $_.tag)] = $_.id }

  # 4 components (key: equipment_id, name)
  $compRows = $records.Values | Sort-Object Line,Section,Equipment,Component -Unique | ForEach-Object {
    $sid = $secMap[(Key $lineMap[$_.Line] $_.Section)]
    $eid = $eqMap[(Key $sid $_.Equipment)]
    $base + @{ equipment_id = $eid; name = $_.Component; uas_uid = (NZ $_.ComponentUid) } }
  $compMap = @{}
  (Supa-Upsert 'components' 'equipment_id,name' $compRows) | ForEach-Object {
    $compMap[(Key $_.equipment_id $_.name)] = $_.id }

  # 5 measurement_points (key: component_id, name)
  $mpRows = New-Object System.Collections.ArrayList
  $leafToMpKey = @{}
  foreach ($r in $records.Values) {
    $sid = $secMap[(Key $lineMap[$r.Line] $r.Section)]
    $eid = $eqMap[(Key $sid $r.Equipment)]
    $compId = $compMap[(Key $eid $r.Component)]
    [void]$mpRows.Add($base + @{
      component_id = $compId; name = $r.MpName; sensor_model = $r.SensorModel
      uas_uid = (NZ $r.MpUid); uas_sensor_uid = (NZ $r.SensorUid); uas_full_path = $r.FullPath })
    $leafToMpKey[$r.LeafId] = (Key $compId $r.MpName)
  }
  $mpDistinct = $mpRows | Sort-Object { Key $_.component_id $_.name } -Unique
  $mpMap = @{}
  (Supa-Upsert 'measurement_points' 'component_id,name' $mpDistinct) | ForEach-Object {
    $mpMap[(Key $_.component_id $_.name)] = $_.id }

  # 6 measurements - dedupe to latest reading per (point, day)
  $best = @{}
  foreach ($m in $meas) {
    $mpKey = $leafToMpKey[$m.node_id]; if (-not $mpKey) { continue }
    $dt = [datetime]::Parse($m.dt, [Globalization.CultureInfo]::InvariantCulture)
    $day = $dt.ToString('yyyy-MM-dd')
    $k = (Key $mpKey $day)
    if (-not $best.ContainsKey($k) -or $dt -gt $best[$k].DT) {
      $best[$k] = [pscustomobject]@{ M = $m; DT = $dt; MpKey = $mpKey; Day = $day }
    }
  }
  $measRows = $best.Values | ForEach-Object {
    @{ measurement_point_id = $mpMap[$_.MpKey]; company_id = $cid; location_id = $lid; synced_at = $run
       overall_rms = (ND $_.M.rms); max_rms = (ND $_.M.peak); peak = (ND $_.M.realpeak)
       uas_mes_id = [int]$_.M.mes_id
       measured_at = $_.Day; measured_datetime = $_.DT.ToString('o') } }
  Supa-Upsert 'measurements' 'measurement_point_id,measured_at' $measRows | Out-Null

  # 7 mark-and-sweep: hard delete anything for this location not touched this run
  foreach ($t in 'measurements','measurement_points','components','equipment','sections','lines') {
    Supa-Sweep $t $lid $run
  }

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
