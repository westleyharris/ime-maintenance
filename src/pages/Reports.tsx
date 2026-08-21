import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Download, Loader2, FileBarChart2, RefreshCw, Building2, FileText, Activity, Search, Calendar, ChevronDown,
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { supabase } from '../lib/supabase';
import { fetchAllRows } from '../lib/fetchAll';
import { useScope } from '../context/ScopeContext';
import { ALARM_COLUMNS, effectiveAlarm, overrideOf, overrideSummary, type AlarmOverride } from '../utils/alarm';

// ── Types ─────────────────────────────────────────────────────────────────────

interface MeasurementRow {
  id: string;
  overall_rms: number | null;
  max_rms: number | null;
  peak: number | null;
  crest_factor: number | null;
  alarm_level: string | null;
  alarm_override: string | null;
  override_reason: string | null;
  overridden_by_name: string | null;
  overridden_at: string | null;
  measured_at: string | null;
  measurement_point_id: string;
  measurement_points: {
    name: string;
    components: {
      name: string;
      equipment: {
        tag: string;
        sections: {
          uas_name: string;
          lines: { name: string } | null;
        } | null;
      } | null;
    } | null;
  } | null;
}

interface ReportRow {
  pointId: string;
  label: string;
  line: string;
  section: string;
  equipment: string;
  component: string;
  point: string;
  rms: number;
  maxRms: number;
  peak: number;
  crest: number;
  alarmLevel: string;
  override: AlarmOverride | null;
  measuredAt: string;
}

type MetricKey = 'rms' | 'maxRms' | 'peak' | 'crest';

// ── Constants ─────────────────────────────────────────────────────────────────

const ALARM_COLORS: Record<string, string> = {
  Danger:  '#ef4444',
  Warning: '#f97316',
  Alert:   '#60a5fa',
  Normal:  '#22c55e',
};

const ALARM_RANK: Record<string, number> = { Danger: 0, Warning: 1, Alert: 2, Normal: 3 };
const ALARM_ORDER = ['Danger', 'Warning', 'Alert', 'Normal'];

const ALARM_PILL: Record<string, [string, string]> = {
  Danger:  ['#fde8e8', '#b42318'],
  Warning: ['#fef0dd', '#a16207'],
  Alert:   ['#dbeafe', '#1d4ed8'],
  Normal:  ['#dcf5e7', '#1a7a33'],
};

const ALARM_DOT: Record<string, string> = {
  Danger:  'bg-red-500',
  Warning: 'bg-orange-500',
  Alert:   'bg-blue-400',
  Normal:  'bg-green-500',
};

const ALARM_TEXT: Record<string, string> = {
  Danger:  'text-red-600',
  Warning: 'text-orange-600',
  Alert:   'text-blue-500',
  Normal:  'text-green-600',
};

const ALARM_BADGE_BG: Record<string, string> = {
  Danger:  'bg-red-50 text-red-700',
  Warning: 'bg-orange-50 text-orange-700',
  Alert:   'bg-blue-50 text-blue-700',
  Normal:  'bg-green-50 text-green-700',
};

const METRICS: { key: MetricKey; label: string; shortLabel: string; pdfLabel: string }[] = [
  { key: 'rms',    label: 'Overall RMS',  shortLabel: 'US RMS',        pdfLabel: 'US RMS (dBµV)'   },
  { key: 'maxRms', label: 'Max RMS',      shortLabel: 'Max RMS',       pdfLabel: 'US Max RMS'      },
  { key: 'peak',   label: 'Peak',         shortLabel: 'Peak',          pdfLabel: 'US Peak'         },
  { key: 'crest',  label: 'Crest Factor', shortLabel: 'Crest Factor',  pdfLabel: 'US Crest Factor' },
];

const INTRO_PARAGRAPHS = [
  'Ultrasound inspection is a predictive maintenance technique used to diagnose, monitor, and identify mechanical, electrical, and leak-related problems at very early stages. By detecting faults before they develop into more serious failures, it supports reliability-based maintenance strategies and helps reduce unplanned maintenance costs. It is also highly effective for detecting leaks in compressed air and vacuum systems, enabling maintenance teams to identify and quantify energy losses.',
  'This technique detects sound waves that are inaudible to the human ear. The human hearing range is approximately 20 Hz to 20 kHz, while ultrasound refers to frequencies above 20 kHz. The signals detected are commonly associated with friction, impacting, and turbulence; the main sources of ultrasound in mechanical and industrial applications.',
  'Modern ultrasound equipment can record and store measurements for later analysis using specialized software. This provides technical support for inspection results and allows the analyst to evaluate waveform data, frequency content, and condition indicators such as RMS, Peak, and Crest Factor. Historically, evaluations depended primarily on the inspector\'s interpretation of what was heard during the inspection.',
  'For bearing analysis, ultrasound is especially useful for detecting abnormal lubrication conditions and early-stage defects, particularly in low-speed equipment. Ultrasound can detect friction and impacting at an early stage of failure, making it very effective in cases where vibration analysis may be less sensitive during the earliest stages. For this reason, ultrasound is widely used for bearings, lubrication monitoring, valves, steam traps, electrical inspections, leak detection, and tightness checks.',
];

const METHODOLOGY_ROWS: [string, string, string][] = [
  ['Danger',  'CF > 14',       'Unexpected stoppage or possible catastrophic failure that generates a prolonged stoppage in the operation of the unit. This designation is intended to protect the integrity of the unit and production, requiring immediate corrective action.'],
  ['Warning', '12 ≤ CF < 14', 'Unexpected stoppage or a significant increase in the ultrasonic trend according to the TWF/Spectral pattern. The unit exhibits symptoms of failure that may evolve over short periods. It is essential to schedule follow-up inspections at short intervals or initiate corrective work.'],
  ['Alert',   '10 ≤ CF < 12', 'Minor failure state or possible indication of an anomaly. The primary objective of this designation is preventive observation, to monitor the specific component and determine its trend. No immediate corrective action is required.'],
  ['Normal',  'CF < 10',       'No anomalies affecting production or damage identifiable by ultrasound are detected.'],
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(v: number | null, d = 2) { return v != null ? v.toFixed(d) : '—'; }

function dateKey(iso: string | null) {
  return iso ? iso.slice(0, 10) : '';
}

function fmtDate(iso: string | null) {
  const key = dateKey(iso);
  if (!key) return '—';
  const [y, m, d] = key.split('-').map(Number);
  if (!y || !m || !d) return '—';
  // Parse as local calendar date so YYYY-MM-DD is not shifted by UTC.
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function inDateRange(iso: string, from: string, to: string) {
  const d = dateKey(iso);
  if (!d) return false;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

function latestPerPoint(measurements: ReportRow[]): ReportRow[] {
  const seen = new Set<string>();
  const out: ReportRow[] = [];
  for (const m of measurements) {
    if (seen.has(m.pointId)) continue;
    seen.add(m.pointId);
    out.push(m);
  }
  return out;
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

// ── Canvas chart renderers ────────────────────────────────────────────────────

function renderBarChart(chartRows: ReportRow[], metricKey: MetricKey, metricLabel: string): string {
  const W = 2400, H = 900;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  const ML = 130, MR = 60, MT = 70, MB = 230;
  const chartW = W - ML - MR;
  const chartH = H - MT - MB;
  const n = chartRows.length;

  if (n === 0) {
    ctx.font = 'bold 36px Arial';
    ctx.fillStyle = '#9ca3af';
    ctx.textAlign = 'center';
    ctx.fillText('No Danger or Warning readings', W / 2, H / 2);
    return canvas.toDataURL('image/png');
  }

  const maxVal = Math.max(...chartRows.map(r => r[metricKey] ?? 0), 0.001) * 1.15;
  const nGrid = 5;

  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 2;
  for (let i = 0; i <= nGrid; i++) {
    const val = (maxVal * i) / nGrid;
    const y = MT + chartH - (chartH * i / nGrid);
    ctx.beginPath(); ctx.moveTo(ML, y); ctx.lineTo(W - MR, y); ctx.stroke();
    ctx.font = '22px Arial'; ctx.fillStyle = '#6b7280';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(val.toFixed(1), ML - 12, y);
  }

  ctx.save();
  ctx.translate(38, MT + chartH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.font = 'bold 26px Arial'; ctx.fillStyle = '#374151';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(metricLabel, 0, 0);
  ctx.restore();

  const barSlot = chartW / n;
  const barW = Math.min(90, barSlot * 0.68);

  for (let i = 0; i < n; i++) {
    const row = chartRows[i];
    const val = row[metricKey] ?? 0;
    const barH = (val / maxVal) * chartH;
    const bx = ML + i * barSlot + (barSlot - barW) / 2;
    const by = MT + chartH - barH;

    ctx.fillStyle = ALARM_COLORS[row.alarmLevel] ?? '#6b7280';
    ctx.beginPath();
    ctx.roundRect(bx, by, barW, barH, [4, 4, 0, 0]);
    ctx.fill();

    ctx.font = 'bold 16px Arial'; ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(`#${i + 1}`, bx + barW / 2, by + barH - 6);

    if (n <= 25) {
      ctx.font = 'bold 20px Arial'; ctx.fillStyle = '#111827';
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(val.toFixed(1), bx + barW / 2, by - 6);
    }

    ctx.save();
    ctx.translate(bx + barW / 2, MT + chartH + 18);
    ctx.rotate(-Math.PI / 5);
    ctx.font = '18px Arial'; ctx.fillStyle = '#4b5563';
    ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    const lbl = `${row.equipment}`;
    ctx.fillText(lbl.length > 20 ? lbl.slice(0, 20) + '…' : lbl, 0, 0);
    ctx.restore();
  }

  const legendLevels = (['Danger', 'Warning'] as const).filter(l => chartRows.some(r => r.alarmLevel === l));
  const ly = MT + 16;
  legendLevels.reverse().forEach((lvl, i) => {
    const idx = legendLevels.length - 1 - i;
    const itemX = W - MR - 20 - (legendLevels.length - 1 - idx) * 180;
    ctx.fillStyle = ALARM_COLORS[lvl];
    ctx.beginPath(); ctx.roundRect(itemX - 140, ly + 4, 22, 22, 4); ctx.fill();
    ctx.font = '22px Arial'; ctx.fillStyle = '#374151';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(lvl, itemX - 110, ly + 4);
  });

  ctx.font = 'italic 20px Arial'; ctx.fillStyle = '#9ca3af';
  ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
  ctx.fillText('See table for full equipment labels', W - MR, H - 8);

  return canvas.toDataURL('image/png');
}

function renderPieChart(rows: ReportRow[]): string {
  const W = 900, H = 900;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.alarmLevel] = (counts[r.alarmLevel] ?? 0) + 1;
  const present = ALARM_ORDER.filter(l => counts[l] > 0);
  const total = present.reduce((s, l) => s + counts[l], 0);

  const cx = W / 2, cy = 360, r = 270;
  let startAngle = -Math.PI / 2;

  present.forEach(lvl => {
    const fraction = counts[lvl] / total;
    const endAngle = startAngle + fraction * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, startAngle, endAngle);
    ctx.closePath();
    ctx.fillStyle = ALARM_COLORS[lvl];
    ctx.fill();
    ctx.strokeStyle = 'white'; ctx.lineWidth = 4; ctx.stroke();

    if (fraction > 0.04) {
      const mid = startAngle + (endAngle - startAngle) / 2;
      const lr = r * 0.65;
      ctx.font = 'bold 30px Arial'; ctx.fillStyle = 'white';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`${(fraction * 100).toFixed(1)}%`, cx + lr * Math.cos(mid), cy + lr * Math.sin(mid));
    }
    startAngle = endAngle;
  });

  const legendY = cy + r + 40;
  const colW = W / Math.min(present.length, 2);
  present.forEach((lvl, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const lx = col * colW + 60, ly = legendY + row * 52;
    ctx.fillStyle = ALARM_COLORS[lvl];
    ctx.beginPath(); ctx.roundRect(lx, ly + 4, 28, 28, 5); ctx.fill();
    ctx.font = '26px Arial'; ctx.fillStyle = '#374151';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(`${lvl} — ${counts[lvl]}  (${((counts[lvl] / total) * 100).toFixed(1)}%)`, lx + 42, ly + 6);
  });

  return canvas.toDataURL('image/png');
}

// ── PDF generator ─────────────────────────────────────────────────────────────

async function generateReport(
  tableRows: ReportRow[],
  chartRows: ReportRow[],
  metricKey: MetricKey,
  metricLabel: string,
  locationName: string,
  companyName: string,
  periodLabel: string,
  fileStamp: string,
) {
  const sorted = [...tableRows].sort(
    (a, b) => ALARM_RANK[a.alarmLevel] - ALARM_RANK[b.alarmLevel] || (b[metricKey] ?? 0) - (a[metricKey] ?? 0)
  );
  const chartSorted = [...chartRows].sort(
    (a, b) => ALARM_RANK[a.alarmLevel] - ALARM_RANK[b.alarmLevel] || (b[metricKey] ?? 0) - (a[metricKey] ?? 0)
  );
  // Charts ignore the alarm-level filter so a Danger-only table does not
  // collapse the pie to 100% and the bar chart to a single color.
  const dw = chartSorted.filter(r => r.alarmLevel === 'Danger' || r.alarmLevel === 'Warning');

  const barImg = renderBarChart(dw, metricKey, metricLabel);
  const pieImg = renderPieChart(chartSorted);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'in', format: 'letter' });
  const PW = 8.5, PH = 11.0, M = 0.75;
  const CW = PW - 2 * M;
  const totalDataPages = Math.ceil(sorted.length / 30);
  const totalPages = 2 + totalDataPages;

  function addFooter(pageNum: number) {
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(150, 150, 160);
    doc.text(`${pageNum} / ${totalPages}`, PW / 2, PH - M * 0.45, { align: 'center' });
  }

  function addHeader(title: string) {
    doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(29, 29, 31);
    doc.text('ULTRASOUND CONDITION REPORT', M, M + 0.22);
    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(90, 90, 111);
    doc.text(title, M, M + 0.44);
    doc.setFontSize(8);
    doc.text(`${companyName} — ${locationName}`, PW - M, M + 0.22, { align: 'right' });
    doc.text(periodLabel, PW - M, M + 0.44, { align: 'right' });
  }

  // ─── Page 1 ───────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold').setFontSize(15).setTextColor(29, 29, 31);
  doc.text('ULTRASOUND CONDITION REPORT', M, M + 0.3);
  doc.setFont('helvetica', 'normal').setFontSize(11).setTextColor(90, 90, 111);
  doc.text('Introduction', M, M + 0.55);
  doc.setFontSize(8);
  doc.text(`${companyName} — ${locationName}`, PW - M, M + 0.3, { align: 'right' });
  doc.text(periodLabel, PW - M, M + 0.55, { align: 'right' });
  doc.setDrawColor(220, 220, 230).setLineWidth(0.008).line(M, M + 0.68, PW - M, M + 0.68);

  let y = M + 0.90;
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(29, 29, 31);
  for (const para of INTRO_PARAGRAPHS) {
    const lines = doc.splitTextToSize(para, CW);
    doc.text(lines, M, y);
    y += lines.length * 0.145 + 0.10;
  }

  y += 0.08;
  doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(29, 29, 31);
  doc.text('Alarm Level Methodology — Crest Factor (CF)', M, y);
  y += 0.22;

  doc.setFont('helvetica', 'normal').setFontSize(9);
  const cfText = 'Alarm levels are based on the Crest Factor (CF), which is the ratio between the peak value of the ultrasonic signal and its RMS value. In practical terms, the Crest Factor indicates how pronounced the peaks are relative to the average signal level, helping detect changes in machine condition and the presence of impacting or friction-related activity.';
  const cfLines = doc.splitTextToSize(cfText, CW);
  doc.text(cfLines, M, y);
  y += cfLines.length * 0.145 + 0.20;

  autoTable(doc, {
    head: [['ALARM LEVEL', 'CREST FACTOR', 'DESCRIPTION']],
    body: METHODOLOGY_ROWS,
    startY: y,
    margin: { left: M, right: M },
    styles: { fontSize: 8, cellPadding: 0.07, textColor: [29, 29, 31], lineColor: [212, 212, 224], lineWidth: 0.005 },
    headStyles: { fillColor: [235, 235, 242], textColor: [44, 44, 62], fontStyle: 'bold', halign: 'center' },
    columnStyles: {
      0: { cellWidth: 1.05, halign: 'center', fontStyle: 'bold' },
      1: { cellWidth: 1.10, halign: 'center' },
      2: { cellWidth: CW - 2.15 },
    },
    alternateRowStyles: { fillColor: [245, 245, 248] },
    // Make alarm level text invisible before didDrawCell paints the pill over it
    willDrawCell: (data) => {
      if (data.column.index === 0 && data.section === 'body') {
        data.cell.text = [];  // suppress autotable text — pill drawn in didDrawCell
      }
    },
    didDrawCell: (data) => {
      if (data.column.index === 0 && data.section === 'body') {
        const lvl = METHODOLOGY_ROWS[data.row.index]?.[0];
        const [bg, fg] = ALARM_PILL[lvl] ?? ['#ebebf2', '#3d3d3f'];
        const cell = data.cell;
        const cx2 = cell.x + cell.padding('left');
        const cy2 = cell.y + cell.padding('top');
        const cw2 = cell.width - cell.padding('left') - cell.padding('right');
        const ch2 = cell.height - cell.padding('top') - cell.padding('bottom');
        const [br, bg2, bb] = hexToRgb(bg);
        const [fr, fg2, fb] = hexToRgb(fg);
        doc.setFillColor(br, bg2, bb);
        doc.roundedRect(cx2 + cw2 * 0.05, cy2 + ch2 * 0.18, cw2 * 0.90, ch2 * 0.64, 0.04, 0.04, 'F');
        doc.setTextColor(fr, fg2, fb).setFontSize(7.5).setFont('helvetica', 'bold');
        doc.text(lvl, cell.x + cell.width / 2, cell.y + cell.height / 2 + 0.01, { align: 'center', baseline: 'middle' });
      }
    },
  });

  // Legend for the asterisk used in the data table — only printed when the
  // report actually contains a reclassified reading.
  const overridden = sorted.filter(r => r.override);
  if (overridden.length) {
    const ty = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 0.22;
    doc.setFont('helvetica', 'bold').setFontSize(8.5).setTextColor(29, 29, 31);
    doc.text('* Analyst reclassification', M, ty);
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(90, 90, 111);
    const note = `${overridden.length} reading${overridden.length === 1 ? '' : 's'} in this report carry an analyst reclassification, marked with an asterisk in the ALARM column. The measured values are unchanged — a certified analyst reviewed the signal and judged the computed alarm level unrepresentative of the machine's condition (for example a transient crest-factor spike from impulsive noise during capture). The computed level, the reason and the analyst are recorded against each reading.`;
    const noteLines = doc.splitTextToSize(note, CW);
    doc.text(noteLines, M, ty + 0.16);
  }

  addFooter(1);

  // ─── Page 2: Charts ───────────────────────────────────────────────────────
  doc.addPage();
  addHeader(metricLabel);
  const chartTopY = M + 0.68;
  const barH = 3.20;
  const pieH = PH - M - chartTopY - barH - 0.5;
  doc.addImage(barImg, 'PNG', M, chartTopY, CW, barH);
  const pieLabelY = chartTopY + barH + 0.20;
  doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(90, 90, 111);
  doc.text(`Alarm Level Distribution  —  ${chartSorted.length} total readings`, M, pieLabelY);
  const pieW = Math.min(CW, pieH * 1.0);
  const pieX = M + (CW - pieW) / 2;
  doc.addImage(pieImg, 'PNG', pieX, pieLabelY + 0.15, pieW, pieH - 0.22);
  addFooter(2);

  // ─── Pages 3+: Data table ─────────────────────────────────────────────────
  const colNames = ['#', 'ASSET PATH', 'DATE', 'ALARM', 'RMS', 'MAX RMS', 'PEAK', 'CREST FACTOR'];
  const colWidths = [0.22, 2.38, 0.72, 0.70, 0.62, 0.62, 0.62, 0.72];
  let pageNum = 3;

  for (let offset = 0; offset < sorted.length; offset += 30) {
    doc.addPage();
    const chunk = sorted.slice(offset, offset + 30);
    const sectionLabel = totalDataPages > 1
      ? `All Equipment — Sorted by Severity & ${metricLabel}  (${pageNum - 2} / ${totalDataPages})`
      : `All Equipment — Sorted by Severity & ${metricLabel}`;
    addHeader(sectionLabel);

    autoTable(doc, {
      head: [colNames],
      body: chunk.map((r, i) => [
        String(offset + i + 1), r.label, fmtDate(r.measuredAt), r.alarmLevel,
        fmt(r.rms), fmt(r.maxRms), fmt(r.peak), fmt(r.crest),
      ]),
      startY: M + 0.68,
      margin: { left: M, right: M },
      styles: { fontSize: 7.5, cellPadding: 0.055, textColor: [29, 29, 31], lineColor: [212, 212, 224], lineWidth: 0.004 },
      headStyles: { fillColor: [235, 235, 242], textColor: [44, 44, 62], fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: colWidths[0], halign: 'center' },
        1: { cellWidth: colWidths[1] },
        2: { cellWidth: colWidths[2], halign: 'center' },
        3: { cellWidth: colWidths[3], halign: 'center' },
        4: { cellWidth: colWidths[4], halign: 'center', fontStyle: 'bold' },
        5: { cellWidth: colWidths[5], halign: 'center' },
        6: { cellWidth: colWidths[6], halign: 'center' },
        7: { cellWidth: colWidths[7], halign: 'center' },
      },
      alternateRowStyles: { fillColor: [245, 245, 248] },
      willDrawCell: (data) => {
        if (data.column.index === 3 && data.section === 'body') {
          data.cell.text = [];  // suppress autotable text — pill drawn in didDrawCell
        }
      },
      didDrawCell: (data) => {
        if (data.column.index === 3 && data.section === 'body') {
          const row = chunk[data.row.index];
          const lvl = row?.alarmLevel;
          if (!lvl) return;
          const [bg, fg] = ALARM_PILL[lvl] ?? ['#ebebf2', '#3d3d3f'];
          const cell = data.cell;
          const [br, bg2, bb] = hexToRgb(bg);
          const [fr, fg2, fb] = hexToRgb(fg);
          doc.setFillColor(br, bg2, bb);
          const pw = cell.width * 0.82, ph = cell.height * 0.58;
          doc.roundedRect(cell.x + (cell.width - pw) / 2, cell.y + (cell.height - ph) / 2, pw, ph, 0.04, 0.04, 'F');
          doc.setTextColor(fr, fg2, fb).setFontSize(6.5).setFont('helvetica', 'bold');
          // Asterisk marks an analyst reclassification — a client must never read
          // an overridden level as the raw computed one. Legend on page 2.
          doc.text(lvl + (row.override ? ' *' : ''), cell.x + cell.width / 2, cell.y + cell.height / 2 + 0.008, { align: 'center', baseline: 'middle' });
        }
      },
    });

    addFooter(pageNum++);
  }

  doc.save(`US_Report_${locationName.replace(/\s+/g, '_')}_${fileStamp}.pdf`);
}

// ── Panel label ───────────────────────────────────────────────────────────────

function PanelLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <span className="text-[10px] font-bold tracking-[0.08em] text-gray-400 uppercase whitespace-nowrap">{children}</span>
      <div className="flex-1 h-px bg-gray-200" />
    </div>
  );
}

// ── React component ───────────────────────────────────────────────────────────

export default function Reports() {
  const { selectedCompanyId, selectedLocationId, locations, companies } = useScope();

  const [allRows, setAllRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [chartUrl, setChartUrl]                 = useState<string | null>(null);
  const [chartStatus, setChartStatus]           = useState<{ type: 'idle' | 'loading' | 'success' | 'error'; msg: string }>({ type: 'idle', msg: '' });
  const [generatingChart, setGeneratingChart]   = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [metric, setMetric] = useState<MetricKey>('rms');
  const [search, setSearch] = useState('');
  const [filterLine, setFilterLine]   = useState('');
  const [filterAlarms, setFilterAlarms] = useState<string[]>([]);
  const [alarmMenuOpen, setAlarmMenuOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');
  const chartUrlRef = useRef<string | null>(null);
  const alarmMenuRef = useRef<HTMLDivElement>(null);

  const locationName = locations.find(l => l.id === selectedLocationId)?.name ?? 'All Locations';
  const companyName  = (companies as { id: string; name: string }[])?.find(c => c.id === selectedCompanyId)?.name ?? 'IME';

  useEffect(() => { chartUrlRef.current = chartUrl; }, [chartUrl]);

  useEffect(() => {
    if (!alarmMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (alarmMenuRef.current && !alarmMenuRef.current.contains(e.target as Node)) {
        setAlarmMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [alarmMenuOpen]);

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!selectedCompanyId) { setAllRows([]); return; }
    setLoading(true);

    const { rows: raw } = await fetchAllRows<MeasurementRow>((from, to) => {
      let q = supabase
        .from('measurements')
        .select(`
          id, overall_rms, max_rms, peak, crest_factor, ${ALARM_COLUMNS}, measured_at, measurement_point_id,
          measurement_points (
            name,
            components (
              name,
              equipment ( tag, sections ( uas_name, lines ( name ) ) )
            )
          )
        `)
        .eq('company_id', selectedCompanyId)
        .order('measured_at', { ascending: false })
        .range(from, to);
      if (selectedLocationId) q = q.eq('location_id', selectedLocationId);
      return q as unknown as PromiseLike<{ data: MeasurementRow[] | null; error: unknown }>;
    });

    const flat: ReportRow[] = [];
    for (const m of raw) {
      if (!m.measurement_points) continue;
      const eq  = m.measurement_points.components?.equipment;
      const sec = eq?.sections;
      flat.push({
        pointId:    m.measurement_point_id,
        label:      `${sec?.lines?.name ?? '—'} \\ ${sec?.uas_name ?? '—'} \\ ${eq?.tag ?? '—'} \\ ${m.measurement_points.components?.name ?? '—'} \\ ${m.measurement_points.name}`,
        line:       sec?.lines?.name    ?? '—',
        section:    sec?.uas_name       ?? '—',
        equipment:  eq?.tag             ?? '—',
        component:  m.measurement_points.components?.name ?? '—',
        point:      m.measurement_points.name,
        rms:        m.overall_rms    ?? 0,
        maxRms:     m.max_rms        ?? 0,
        peak:       m.peak           ?? 0,
        crest:      m.crest_factor   ?? 0,
        alarmLevel: effectiveAlarm(m),
        override:   overrideOf(m),
        measuredAt: m.measured_at    ?? '',
      });
    }

    setAllRows(flat);
    setChartUrl(null);
    setChartStatus({ type: 'idle', msg: '' });
    setSearch('');
    setFilterLine('');
    setFilterAlarms([]);
    setLoading(false);
  }, [selectedCompanyId, selectedLocationId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Derived ───────────────────────────────────────────────────────────────
  let dateMin = '';
  let dateMax = '';
  for (const r of allRows) {
    const d = dateKey(r.measuredAt);
    if (!d) continue;
    if (!dateMin || d < dateMin) dateMin = d;
    if (!dateMax || d > dateMax) dateMax = d;
  }

  const hasPeriod = Boolean(dateFrom || dateTo);
  const ranged = hasPeriod
    ? allRows.filter(r => inDateRange(r.measuredAt, dateFrom, dateTo))
    : allRows;
  // Latest reading per point within the selected window (or all time if unset).
  const rows = latestPerPoint(ranged);

  const periodLabel = hasPeriod
    ? (dateFrom && dateTo
        ? `${fmtDate(dateFrom)} – ${fmtDate(dateTo)}`
        : dateFrom ? `From ${fmtDate(dateFrom)}` : `Through ${fmtDate(dateTo)}`)
    : new Date().toLocaleDateString('en-US', { dateStyle: 'long' });
  const fileStamp = hasPeriod
    ? `${dateFrom || dateMin || 'start'}_${dateTo || dateMax || 'end'}`
    : new Date().toISOString().slice(0, 10);

  const counts = ALARM_ORDER.reduce<Record<string, number>>((acc, lvl) => {
    acc[lvl] = rows.filter(r => r.alarmLevel === lvl).length;
    return acc;
  }, {});

  const lineOptions = Array.from(new Set(rows.map(r => r.line)))
    .filter(l => l && l !== '—')
    .sort();

  // Line filter applies everywhere. Alarm filter is table/CSV only — charts
  // keep the full alarm mix so filtering to Danger does not produce a 100% pie.
  const lineRows = rows.filter(r => !filterLine || r.line === filterLine);
  const hasAlarmFilter = filterAlarms.length > 0;
  const baseRows = lineRows.filter(r => !hasAlarmFilter || filterAlarms.includes(r.alarmLevel));

  const chartSorted = [...lineRows].sort(
    (a, b) => ALARM_RANK[a.alarmLevel] - ALARM_RANK[b.alarmLevel] || (b[metric] ?? 0) - (a[metric] ?? 0)
  );

  const sortedRows = [...baseRows].sort(
    (a, b) => ALARM_RANK[a.alarmLevel] - ALARM_RANK[b.alarmLevel] || (b[metric] ?? 0) - (a[metric] ?? 0)
  );

  const visibleRows = search
    ? sortedRows.filter(r =>
        r.equipment.toLowerCase().includes(search.toLowerCase()) ||
        r.component.toLowerCase().includes(search.toLowerCase()) ||
        r.point.toLowerCase().includes(search.toLowerCase()) ||
        r.section.toLowerCase().includes(search.toLowerCase())
      )
    : sortedRows;

  // ── Chart ─────────────────────────────────────────────────────────────────
  const handleGenerateChart = () => {
    if (!rows.length) return;
    setGeneratingChart(true);
    setChartStatus({ type: 'loading', msg: 'Generating chart…' });
    try {
      const dw = chartSorted.filter(r => r.alarmLevel === 'Danger' || r.alarmLevel === 'Warning');
      if (!dw.length) {
        setChartStatus({ type: 'error', msg: 'No Danger or Warning assets to plot.' });
        setGeneratingChart(false);
        return;
      }
      const url = renderBarChart(dw, metric, METRICS.find(m => m.key === metric)!.pdfLabel);
      setChartUrl(url);
      const parts = (['Danger', 'Warning', 'Alert', 'Normal'] as const)
        .filter(l => counts[l] > 0).map(l => `${counts[l]} ${l}`);
      setChartStatus({ type: 'success', msg: `✓ ${rows.length} assets${hasPeriod ? ` · ${periodLabel}` : ''} · ${parts.join(' · ')}` });
    } catch {
      setChartStatus({ type: 'error', msg: 'Chart generation failed.' });
    } finally {
      setGeneratingChart(false);
    }
  };

  // Auto-refresh chart when metric, line, or period changes (not alarm filter)
  useEffect(() => {
    if (!chartUrlRef.current) return;
    const dw = chartSorted.filter(r => r.alarmLevel === 'Danger' || r.alarmLevel === 'Warning');
    if (dw.length) setChartUrl(renderBarChart(dw, metric, METRICS.find(m => m.key === metric)!.pdfLabel));
    else setChartUrl(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metric, filterLine, dateFrom, dateTo]);

  const handleDownloadPNG = () => {
    if (!chartUrl) return;
    const a = document.createElement('a');
    a.href = chartUrl;
    a.download = `US_Chart_${metric}_${fileStamp}.png`;
    a.click();
  };

  const handleGenerateReport = async () => {
    if (!sortedRows.length) return;
    setGeneratingReport(true);
    try {
      const m = METRICS.find(x => x.key === metric)!;
      await generateReport(sortedRows, chartSorted, metric, m.pdfLabel, locationName, companyName, periodLabel, fileStamp);
    } finally {
      setGeneratingReport(false);
    }
  };

  const exportCSV = () => {
    const headers = ['Line', 'Section', 'Equipment', 'Component', 'Point', 'RMS', 'Max RMS', 'Peak', 'Crest Factor', 'Alarm Level', 'Computed Level', 'Override Reason', 'Overridden By', 'Date'];
    const csvRows = sortedRows.map(r =>
      [r.line, r.section, r.equipment, r.component, r.point, r.rms, r.maxRms, r.peak, r.crest, r.alarmLevel,
       r.override?.computed ?? '', r.override?.reason ?? '', r.override?.by ?? '', fmtDate(r.measuredAt)]
        // Escape embedded quotes — an override reason is free text.
        .map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
    );
    const blob = new Blob([headers.join(',') + '\n' + csvRows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `measurements_${fileStamp}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const statusColor = { idle: 'text-gray-400', loading: 'text-blue-500', success: 'text-emerald-600', error: 'text-red-500' }[chartStatus.type];

  // ── No company ────────────────────────────────────────────────────────────
  if (!selectedCompanyId) {
    return (
      <div className="flex flex-col items-center justify-center h-72 text-gray-400 gap-3">
        <Building2 size={36} className="opacity-30" />
        <p className="text-sm">Select a company to generate a report</p>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    // single column on phones; the 260px control rail only makes sense with room beside it
    <div className="grid gap-6 lg:gap-8 w-full grid-cols-1 lg:grid-cols-[260px_1fr]">

      {/* ════ SIDEBAR ════ */}
      <aside className="flex flex-col gap-0">

        {/* Period */}
        <PanelLabel>Period</PanelLabel>
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5 mb-5">
          <div className="flex items-center gap-2 mb-3">
            <Calendar size={13} className={hasPeriod ? 'text-primary' : 'text-gray-400'} />
            <p className="text-[10px] font-bold tracking-widest text-gray-400 uppercase">
              {hasPeriod ? periodLabel : 'All dates'}
            </p>
          </div>
          <label className="block mb-3">
            <span className="text-[10px] font-bold tracking-widest text-gray-400 uppercase">From</span>
            <input
              type="date"
              value={dateFrom}
              min={dateMin || undefined}
              max={dateTo || dateMax || undefined}
              onChange={e => setDateFrom(e.target.value)}
              className="mt-1 w-full py-2 px-2.5 border border-gray-200 rounded-xl bg-white text-[13px] text-gray-700 outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/[0.08] transition-all"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-bold tracking-widest text-gray-400 uppercase">To</span>
            <input
              type="date"
              value={dateTo}
              min={dateFrom || dateMin || undefined}
              max={dateMax || undefined}
              onChange={e => setDateTo(e.target.value)}
              className="mt-1 w-full py-2 px-2.5 border border-gray-200 rounded-xl bg-white text-[13px] text-gray-700 outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/[0.08] transition-all"
            />
          </label>
          {hasPeriod && (
            <button
              onClick={() => { setDateFrom(''); setDateTo(''); }}
              className="mt-3 w-full text-[12px] font-semibold text-primary hover:underline"
            >
              Clear dates
            </button>
          )}
        </div>

        {/* Metric selection */}
        <PanelLabel>Metric</PanelLabel>
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5 mb-5">
          <p className="text-[10px] font-bold tracking-widest text-gray-400 uppercase mb-3">Reading to plot</p>
          <div className="flex flex-col gap-2">
            {METRICS.map(m => (
              <button
                key={m.key}
                onClick={() => setMetric(m.key)}
                className={`px-3.5 py-2.5 rounded-xl text-[13px] font-semibold border transition-all text-left ${
                  metric === m.key
                    ? 'bg-primary text-white border-transparent shadow-[0_4px_12px_rgba(0,113,227,0.25)]'
                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:border-gray-300'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <button
            onClick={handleGenerateChart}
            disabled={!rows.length || generatingChart}
            className="mt-4 w-full py-3 px-4 rounded-xl bg-primary text-white text-[13px] font-semibold flex items-center justify-center gap-2 shadow-[0_8px_20px_rgba(10,132,255,0.2)] hover:bg-primary-light disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {generatingChart
              ? <><Loader2 size={13} className="animate-spin" /> Generating…</>
              : <><Activity size={13} /> Generate Chart</>
            }
          </button>
        </div>

        {/* Alarm distribution */}
        <PanelLabel>Distribution</PanelLabel>
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-gray-400 py-1">
              <Loader2 size={11} className="animate-spin" /> Loading…
            </div>
          ) : rows.length === 0 ? (
            <p className="text-xs text-gray-400">
              {allRows.length > 0 && hasPeriod ? 'No data in this date range' : 'No data loaded'}
            </p>
          ) : (
            <div className="space-y-3">
              {ALARM_ORDER.map(lvl => {
                const count = counts[lvl];
                const pct = rows.length > 0 ? count / rows.length : 0;
                return (
                  <div key={lvl} className="flex items-center gap-2.5">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${ALARM_DOT[lvl]}`} />
                    <span className="text-xs text-gray-500 w-14 shrink-0">{lvl}</span>
                    <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden min-w-0">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct * 100}%`, backgroundColor: ALARM_COLORS[lvl] }}
                      />
                    </div>
                    <span className={`text-xs font-bold w-7 text-right shrink-0 ${ALARM_TEXT[lvl]}`}>{count}</span>
                  </div>
                );
              })}
              <p className="text-[10px] text-gray-300 pt-1 border-t border-gray-100 mt-2">
                {rows.length} total · most recent per point{hasPeriod ? ' in range' : ''}
              </p>
            </div>
          )}
        </div>

        {/* Refresh */}
        <button
          onClick={() => fetchData()}
          className="mt-4 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-gray-200 text-xs font-semibold text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh data
        </button>

      </aside>

      {/* ════ MAIN ════ */}
      <section className="flex flex-col gap-5 min-w-0">

        {/* Action bar */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            {chartStatus.msg ? (
              <p className={`text-[13px] font-medium truncate ${statusColor}`}>{chartStatus.msg}</p>
            ) : (
              <p className="text-[13px] text-gray-400">
                {loading ? 'Loading data…' : rows.length ? 'Select a metric and generate a chart.' : hasPeriod ? 'No measurements in this date range.' : 'No measurements for this selection.'}
              </p>
            )}
          </div>
          {chartUrl && (
            <button
              onClick={handleDownloadPNG}
              className="flex items-center gap-1.5 px-3.5 py-2 border border-gray-200 rounded-xl bg-white text-[13px] font-semibold text-gray-700 hover:bg-gray-50 hover:-translate-y-px transition-all shadow-sm whitespace-nowrap"
            >
              <Download size={13} /> PNG
            </button>
          )}
          <button
            onClick={exportCSV}
            disabled={!rows.length}
            className="flex items-center gap-1.5 px-3.5 py-2 border border-gray-200 rounded-xl bg-white text-[13px] font-semibold text-gray-700 hover:bg-gray-50 hover:-translate-y-px transition-all shadow-sm disabled:opacity-40 whitespace-nowrap"
          >
            <Download size={13} /> CSV
          </button>
          <button
            onClick={handleGenerateReport}
            disabled={!rows.length || generatingReport}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-white text-[13px] font-semibold hover:bg-primary-light disabled:opacity-40 transition-all shadow-[0_4px_14px_rgba(0,113,227,0.2)] whitespace-nowrap"
          >
            {generatingReport ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
            {generatingReport ? 'Generating…' : 'Generate Report'}
          </button>
        </div>

        {/* Chart area */}
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6 min-h-[340px] flex items-center justify-center overflow-hidden">
          {!chartUrl ? (
            <div className="flex flex-col items-center gap-3 select-none">
              <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.3" width="52" height="52" className="text-gray-200">
                <polyline points="4,32 10,16 16,48 22,22 28,38 34,8 40,52 46,26 52,36 60,32" />
              </svg>
              <p className="text-[13px] text-gray-400">
                {loading ? 'Loading data…' : rows.length ? 'Select a metric and click Generate Chart' : hasPeriod ? 'No measurements in this date range' : 'No measurements for this selection'}
              </p>
            </div>
          ) : (
            <img src={chartUrl} alt="Ultrasound bar chart" className="max-w-full rounded-lg" />
          )}
        </div>

        {/* Table section */}
        {allRows.length > 0 && (
          <>
            {/* Table toolbar */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex-1 relative min-w-[180px]">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search equipment, component, point…"
                  className="w-full py-2.5 pl-9 pr-3 border border-gray-200 rounded-xl bg-white text-[13px] text-gray-800 outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/[0.08] transition-all"
                />
              </div>
              <select
                value={filterLine}
                onChange={e => setFilterLine(e.target.value)}
                className="py-2.5 px-3 border border-gray-200 rounded-xl bg-white text-[13px] text-gray-700 outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/[0.08] transition-all"
              >
                <option value="">All lines</option>
                {lineOptions.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
              <div className="relative" ref={alarmMenuRef}>
                <button
                  type="button"
                  onClick={() => setAlarmMenuOpen(o => !o)}
                  className={`flex items-center gap-2 py-2.5 px-3 border rounded-xl bg-white text-[13px] outline-none transition-all whitespace-nowrap ${
                    alarmMenuOpen
                      ? 'border-primary/40 ring-2 ring-primary/[0.08] text-gray-800'
                      : 'border-gray-200 text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <span className="max-w-[160px] truncate">
                    {hasAlarmFilter
                      ? ALARM_ORDER.filter(l => filterAlarms.includes(l)).join(', ')
                      : 'All alarms'}
                  </span>
                  <ChevronDown size={14} className={`text-gray-400 shrink-0 transition-transform ${alarmMenuOpen ? 'rotate-180' : ''}`} />
                </button>
                {alarmMenuOpen && (
                  <div className="absolute z-30 top-full right-0 mt-1.5 min-w-[200px] bg-white border border-gray-200 rounded-xl shadow-lg py-1.5">
                    <p className="px-3 pt-1 pb-1.5 text-[10px] font-bold tracking-widest text-gray-400 uppercase">
                      Select multiple
                    </p>
                    {ALARM_ORDER.map(l => {
                      const on = filterAlarms.includes(l);
                      return (
                        <label
                          key={l}
                          className="flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => setFilterAlarms(prev =>
                              prev.includes(l) ? prev.filter(x => x !== l) : [...prev, l]
                            )}
                            className="w-3.5 h-3.5 rounded border-gray-300 text-primary focus:ring-primary/30 cursor-pointer"
                          />
                          <span className={`w-2 h-2 rounded-full shrink-0 ${ALARM_DOT[l]}`} />
                          <span className={`text-[13px] ${on ? 'font-semibold text-gray-800' : 'text-gray-600'}`}>{l}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
              {(filterLine || hasAlarmFilter || search) && (
                <button
                  onClick={() => { setFilterLine(''); setFilterAlarms([]); setSearch(''); }}
                  className="text-[12px] font-semibold text-primary hover:underline whitespace-nowrap px-1"
                >
                  Clear
                </button>
              )}
              <span className="text-[12px] text-gray-500 whitespace-nowrap px-3 py-2.5 border border-gray-200 rounded-xl bg-white shadow-sm">
                <strong className="text-gray-800">{visibleRows.length}</strong>
                {(search || filterLine || hasAlarmFilter) ? ` / ${rows.length}` : ''} rows
              </span>
            </div>

            {/* Table */}
            <div className="overflow-x-auto border border-gray-100 rounded-2xl bg-white shadow-sm">
              {loading ? (
                <div className="flex justify-center py-14"><Loader2 size={20} className="animate-spin text-gray-300" /></div>
              ) : (
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="px-3 py-3 text-left text-[10px] font-bold tracking-[0.06em] uppercase text-gray-400 bg-gray-50/60 w-8">#</th>
                      <th className="px-3 py-3 text-left text-[10px] font-bold tracking-[0.06em] uppercase text-gray-400 bg-gray-50/60">Equipment</th>
                      <th className="px-3 py-3 text-left text-[10px] font-bold tracking-[0.06em] uppercase text-gray-400 bg-gray-50/60">Component</th>
                      <th className="px-3 py-3 text-left text-[10px] font-bold tracking-[0.06em] uppercase text-gray-400 bg-gray-50/60">Point</th>
                      <th className="px-3 py-3 text-left text-[10px] font-bold tracking-[0.06em] uppercase text-gray-400 bg-gray-50/60">Date</th>
                      <th className="px-3 py-3 text-left text-[10px] font-bold tracking-[0.06em] uppercase text-gray-400 bg-gray-50/60">Alarm</th>
                      {METRICS.map(m => (
                        <th
                          key={m.key}
                          className={`px-3 py-3 text-center text-[10px] font-bold tracking-[0.06em] bg-gray-50/60 whitespace-nowrap transition-colors ${
                            metric === m.key ? 'text-primary bg-primary/[0.04]' : 'uppercase text-gray-400'
                          }`}
                        >
                          {m.shortLabel}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="text-center py-12 text-sm text-gray-400">
                          {hasPeriod && !filterLine && !hasAlarmFilter && !search
                            ? 'No assets in this date range'
                            : 'No assets match your filters'}
                        </td>
                      </tr>
                    ) : visibleRows.map((row, i) => (
                      <tr key={row.pointId} className="border-b border-gray-50 hover:bg-gray-50/60 transition-colors">
                        <td className="px-3 py-2.5 text-gray-300 text-xs tabular-nums">{i + 1}</td>
                        <td className="px-3 py-2.5 font-mono text-xs font-semibold text-gray-800 whitespace-nowrap">{row.equipment}</td>
                        <td className="px-3 py-2.5 text-xs text-gray-500 whitespace-nowrap">{row.component}</td>
                        <td className="px-3 py-2.5 text-xs text-gray-400 whitespace-nowrap">{row.point}</td>
                        <td className="px-3 py-2.5 text-xs text-gray-500 whitespace-nowrap tabular-nums">{fmtDate(row.measuredAt)}</td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold ${ALARM_BADGE_BG[row.alarmLevel]}`}
                            title={row.override ? overrideSummary(row.override) : undefined}>
                            {row.alarmLevel}{row.override && ' *'}
                          </span>
                        </td>
                        <td className={`px-3 py-2.5 text-center tabular-nums text-xs ${metric === 'rms'    ? 'font-bold text-gray-900' : 'text-gray-400'}`}>{fmt(row.rms)}</td>
                        <td className={`px-3 py-2.5 text-center tabular-nums text-xs ${metric === 'maxRms' ? 'font-bold text-gray-900' : 'text-gray-400'}`}>{fmt(row.maxRms)}</td>
                        <td className={`px-3 py-2.5 text-center tabular-nums text-xs ${metric === 'peak'   ? 'font-bold text-gray-900' : 'text-gray-400'}`}>{fmt(row.peak)}</td>
                        <td className={`px-3 py-2.5 text-center tabular-nums text-xs ${metric === 'crest'  ? 'font-bold text-gray-900' : 'text-gray-400'}`}>{fmt(row.crest)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}

        {/* Empty state */}
        {!loading && allRows.length === 0 && (
          <div className="flex flex-col items-center justify-center py-14 text-gray-400 gap-2 bg-white border border-gray-100 rounded-2xl shadow-sm">
            <FileBarChart2 size={26} className="opacity-25" />
            <p className="text-sm">No measurements for this selection</p>
          </div>
        )}

      </section>
    </div>
  );
}
