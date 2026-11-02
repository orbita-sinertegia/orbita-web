import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import logoImg from '../assets/logo.png'

export interface ReportTask {
  title: string
  responsable: string
  priority: string
  date: string | null
}

const SLATE = '#323A44'
const SLATE_D = '#262C34'
const RED = '#D8232A'
const YELLOW = '#F2C20A'
const INK = '#2B313A'
const MUTED = '#8A93A0'
const CARD = '#FFFFFF'
const LINE = '#E7EBEF'
const GREEN = '#2E9E5B'
const PALETTE = [RED, SLATE, YELLOW, '#5B6470', '#E07A2B', GREEN, '#7A5BD8', '#C0392B']

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function colorFor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0
  return PALETTE[Math.abs(hash) % PALETTE.length]
}

function initials(name: string): string {
  const parts = name.split(' ').filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

function avatar(name: string, size = 18): string {
  return `<span style="width:${size}px;height:${size}px;border-radius:50%;background:${colorFor(name)};color:#fff;font-size:${size * 0.45}px;font-weight:600;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;">${esc(initials(name))}</span>`
}

function prioPill(p: string): string {
  if (p === 'alta' || p === 'critica') return `<span style="font-size:9.5px;line-height:1.6;font-weight:600;padding:4px 10px;border-radius:20px;white-space:nowrap;background:#FBE3E4;color:${RED};">● ${p === 'critica' ? 'Crítica' : 'Alta'}</span>`
  if (p === 'media') return `<span style="font-size:9.5px;line-height:1.6;font-weight:600;padding:4px 10px;border-radius:20px;white-space:nowrap;background:#FBF0CC;color:#9A7B0A;">● Media</span>`
  return `<span style="font-size:9.5px;line-height:1.6;font-weight:600;padding:4px 10px;border-radius:20px;white-space:nowrap;background:#E5EAEF;color:${SLATE};">● Baja</span>`
}

function dateChip(d: string | null): string {
  if (!d) return `<span style="font-size:9.5px;line-height:1.6;padding:4px 10px;border-radius:20px;white-space:nowrap;background:#F0F2F4;color:${MUTED};">Sin fecha</span>`
  return `<span style="font-size:9.5px;line-height:1.6;padding:4px 10px;border-radius:20px;white-space:nowrap;background:#EAF4FF;color:#2C6FB0;">📅 ${esc(d)}</span>`
}

function taskRow(t: ReportTask, idx: number): string {
  return `<div data-pdf-avoid="true" style="display:flex;align-items:center;gap:16px;background:${CARD};border:1px solid ${LINE};border-radius:14px;padding:14px 18px;margin-bottom:11px;box-shadow:0 2px 6px rgba(40,50,65,.04);">
    <div style="font-size:11.5px;font-weight:700;color:${MUTED};width:24px;flex:0 0 auto;text-align:center;">${String(idx).padStart(2, '0')}</div>
    <div style="flex:1;min-width:0;">
      <div style="font-size:12.5px;font-weight:500;color:${INK};line-height:1.3;">${esc(t.title)}</div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:7px;">${avatar(t.responsable)}<span style="font-size:10.5px;color:${MUTED};font-weight:300;">${esc(t.responsable)}</span></div>
    </div>
    <div style="display:flex;align-items:center;gap:9px;flex:0 0 auto;">${prioPill(t.priority)}${dateChip(t.date)}</div>
  </div>`
}

function section(title: string, items: ReportTask[], accent: string, icon: string): string {
  const body = items.length === 0
    ? `<div style="font-size:12px;color:${MUTED};padding:18px;text-align:center;background:${CARD};border:1px dashed ${LINE};border-radius:14px;">Sin tareas en esta categoría.</div>`
    : items.map((t, i) => taskRow(t, i + 1)).join('')
  return `<section style="margin-bottom:30px;">
    <div data-pdf-avoid="true" style="display:flex;align-items:center;gap:13px;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid ${accent};">
      <span style="width:28px;height:28px;border-radius:9px;color:#fff;font-size:15px;display:flex;align-items:center;justify-content:center;background:${accent};">${icon}</span>
      <h2 style="font-size:16px;font-weight:700;color:${SLATE};flex:1;letter-spacing:-.2px;margin:0;">${esc(title)}</h2>
      <span style="color:#fff;font-size:11.5px;font-weight:700;padding:4px 13px;border-radius:20px;background:${accent};">${items.length}</span>
    </div>
    <div>${body}</div>
  </section>`
}

function buildReportHtml(opts: {
  titulo: string
  subtitulo: string
  fecha: string
  pie: string
  completadas: ReportTask[]
  enProgreso: ReportTask[]
  pendientes: ReportTask[]
}): string {
  const { titulo, subtitulo, fecha, pie, completadas, enProgreso, pendientes } = opts
  const all = [...completadas, ...enProgreso, ...pendientes]
  const total = Math.max(all.length, 1)
  const nComp = completadas.length, nProg = enProgreso.length, nPend = pendientes.length
  const pct = Math.round((nComp / total) * 100)

  const totalByResp = new Map<string, number>()
  const doneByResp = new Map<string, number>()
  all.forEach(t => totalByResp.set(t.responsable, (totalByResp.get(t.responsable) || 0) + 1))
  completadas.forEach(t => doneByResp.set(t.responsable, (doneByResp.get(t.responsable) || 0) + 1))
  const maxc = Math.max(...totalByResp.values(), 1)
  const respRows = [...totalByResp.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, c]) => {
      const done = doneByResp.get(name) || 0
      const w = Math.round((c / maxc) * 100)
      const wd = c ? Math.round((done / c) * 100) : 0
      return `<div data-pdf-avoid="true" style="display:flex;align-items:center;gap:14px;margin-bottom:16px;">
        <div style="width:230px;flex:0 0 230px;font-size:11.5px;line-height:1.6;font-weight:500;color:${INK};display:flex;align-items:center;gap:9px;white-space:nowrap;">
          ${avatar(name, 20)}<span style="white-space:nowrap;">${esc(name)}</span>
        </div>
        <div style="flex:1;height:14px;background:#EEF2F5;border-radius:8px;overflow:hidden;">
          <div style="height:100%;border-radius:8px;position:relative;width:${w}%;background:${colorFor(name)};">
            <div style="position:absolute;left:0;top:0;height:100%;background:rgba(255,255,255,.45);width:${wd}%;"></div>
          </div>
        </div>
        <div style="width:44px;text-align:right;font-size:11.5px;font-weight:600;color:${MUTED};">${done}/${c}</div>
      </div>`
    }).join('')

  return `<div style="width:850px;font-family:'Poppins','Segoe UI',sans-serif;color:${INK};background:#F4F6F8;">
    <div style="position:relative;background:linear-gradient(135deg,${SLATE} 0%,${SLATE_D} 100%);color:#fff;padding:42px 44px;overflow:hidden;">
      <div style="display:flex;align-items:center;gap:24px;position:relative;z-index:2;">
        <div style="width:86px;height:86px;background:#fff;border-radius:22px;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 22px rgba(0,0,0,.25);flex:0 0 auto;">
          <img src="${logoImg}" style="width:68px;height:68px;object-fit:contain;" />
        </div>
        <div>
          <span style="display:inline-block;font-size:11px;letter-spacing:2.5px;font-weight:600;color:${YELLOW};text-transform:uppercase;margin-bottom:10px;">Reporte de Tareas</span>
          <h1 style="font-size:28px;font-weight:700;letter-spacing:-.3px;line-height:1.15;margin:0;">${esc(titulo)}</h1>
          <div style="font-size:13.5px;color:#C7CDD6;margin-top:6px;font-weight:300;">${esc(subtitulo)} · Generado el ${esc(fecha)}</div>
        </div>
      </div>
    </div>
    <div style="height:5px;width:100%;background:linear-gradient(90deg,${RED} 0 60%,${YELLOW} 60% 100%);"></div>

    <div style="display:flex;gap:20px;padding:32px 44px 10px;">
      ${[
        { cap: 'Completadas', num: nComp, foot: `${pct}% del total`, color: GREEN, numColor: SLATE },
        { cap: 'En progreso', num: nProg, foot: 'activas ahora', color: YELLOW, numColor: SLATE },
        { cap: 'Pendientes', num: nPend, foot: 'por arrancar', color: RED, numColor: RED },
        { cap: 'Total', num: all.length, foot: 'tareas del proyecto', color: SLATE, numColor: SLATE },
      ].map(k => `
      <div style="flex:1;background:${CARD};border-radius:18px;padding:22px 22px 20px;box-shadow:0 4px 14px rgba(40,50,65,.06);border:1px solid ${LINE};position:relative;overflow:hidden;">
        <div style="position:absolute;top:0;left:0;width:5px;height:100%;background:${k.color};"></div>
        <div style="font-size:10.5px;font-weight:600;letter-spacing:.6px;text-transform:uppercase;color:${MUTED};">${k.cap}</div>
        <div style="font-size:36px;font-weight:700;line-height:1;margin-top:10px;color:${k.numColor};">${k.num}</div>
        <div style="font-size:11px;color:${MUTED};margin-top:6px;font-weight:300;">${k.foot}</div>
      </div>`).join('')}
    </div>

    <div style="padding:14px 44px 6px;">
      <div style="background:${CARD};border:1px solid ${LINE};border-radius:18px;padding:22px 24px;box-shadow:0 4px 14px rgba(40,50,65,.06);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
          <span style="font-size:13px;font-weight:600;color:${SLATE};">Avance general del proyecto</span>
          <span style="font-size:14px;font-weight:700;color:${GREEN};">${pct}% completado</span>
        </div>
        <div style="height:16px;background:#EAEFF3;border-radius:10px;overflow:hidden;display:flex;">
          <div style="background:linear-gradient(90deg,${GREEN},#37b86b);width:${(nComp / total * 100).toFixed(1)}%;"></div>
          <div style="background:repeating-linear-gradient(45deg,#F3D6D7,#F3D6D7 6px,#fae4e5 6px,#fae4e5 12px);width:${(nPend / total * 100).toFixed(1)}%;"></div>
        </div>
        <div style="display:flex;gap:22px;margin-top:13px;font-size:11px;color:${MUTED};">
          <span><i style="width:9px;height:9px;border-radius:3px;display:inline-block;margin-right:6px;vertical-align:middle;background:${GREEN};"></i>Completadas (${nComp})</span>
          <span><i style="width:9px;height:9px;border-radius:3px;display:inline-block;margin-right:6px;vertical-align:middle;background:${YELLOW};"></i>En progreso (${nProg})</span>
          <span><i style="width:9px;height:9px;border-radius:3px;display:inline-block;margin-right:6px;vertical-align:middle;background:#F3D6D7;"></i>Pendientes (${nPend})</span>
        </div>
      </div>
    </div>

    <div style="padding:18px 44px 6px;">
      <div style="background:${CARD};border:1px solid ${LINE};border-radius:18px;padding:22px 24px 20px;box-shadow:0 4px 14px rgba(40,50,65,.06);">
        <h3 style="font-size:13px;font-weight:600;color:${SLATE};margin-bottom:18px;display:flex;align-items:center;gap:9px;">
          <span style="width:8px;height:8px;border-radius:50%;background:${RED};display:inline-block;"></span>
          Carga por responsable <span style="font-weight:300;color:${MUTED};font-size:11px;">(completadas / total)</span>
        </h3>
        ${respRows}
      </div>
    </div>

    <div style="padding:24px 44px 36px;">
      ${section('Completadas', completadas, GREEN, '✓')}
      ${section('En progreso', enProgreso, YELLOW, '◐')}
      ${section('Faltantes / Pendientes', pendientes, RED, '!')}
    </div>

    <div data-pdf-avoid="true" style="position:relative;height:24mm;padding:0 44px;display:flex;align-items:center;justify-content:space-between;background:${SLATE};color:#fff;font-size:10.5px;font-weight:300;">
      <div style="position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,${RED} 0 60%,${YELLOW} 60% 100%);"></div>
      <div><b>${esc(pie)}</b></div>
      <div style="color:#C7CDD6;">Generado el ${esc(fecha)}</div>
    </div>
  </div>`
}

interface PdfBlock {
  top: number
  bottom: number
}

function findSafePageBreaks(root: HTMLElement, pageHeightPx: number): number[] {
  const rootRect = root.getBoundingClientRect()
  const contentHeight = root.scrollHeight
  const blocks: PdfBlock[] = Array.from(root.querySelectorAll<HTMLElement>('[data-pdf-avoid="true"]'))
    .map(element => {
      const rect = element.getBoundingClientRect()
      return { top: rect.top - rootRect.top, bottom: rect.bottom - rootRect.top }
    })
    .filter(block => block.bottom > block.top)

  const breaks = [0]
  let pageStart = 0
  const minimumPageFill = pageHeightPx * 0.45

  while (pageStart + pageHeightPx < contentHeight) {
    const idealBreak = pageStart + pageHeightPx
    const intersecting = blocks.find(block => block.top < idealBreak && block.bottom > idealBreak)
    let pageEnd = intersecting?.top ?? idealBreak

    if (pageEnd - pageStart < minimumPageFill && intersecting && intersecting.bottom - pageStart <= pageHeightPx) {
      pageEnd = intersecting.bottom
    }
    if (pageEnd <= pageStart + 1) pageEnd = idealBreak

    breaks.push(Math.min(pageEnd, contentHeight))
    pageStart = pageEnd
  }

  if (breaks[breaks.length - 1] < contentHeight) breaks.push(contentHeight)
  return breaks
}

function canvasSlice(source: HTMLCanvasElement, top: number, height: number): HTMLCanvasElement {
  const slice = document.createElement('canvas')
  slice.width = source.width
  slice.height = Math.max(1, Math.ceil(height))
  const context = slice.getContext('2d')
  if (!context) throw new Error('No se pudo preparar una página del PDF')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, slice.width, slice.height)
  context.drawImage(source, 0, top, source.width, height, 0, 0, source.width, height)
  return slice
}

export async function generateClientReportPdf(opts: {
  titulo: string
  subtitulo: string
  fecha: string
  pie: string
  completadas: ReportTask[]
  enProgreso: ReportTask[]
  pendientes: ReportTask[]
  filename: string
}) {
  const html = buildReportHtml(opts)

  const container = document.createElement('div')
  container.style.position = 'fixed'
  container.style.left = '-9999px'
  container.style.top = '0'
  container.innerHTML = html
  document.body.appendChild(container)

  try {
    const reportElement = container.firstElementChild as HTMLElement
    const canvas = await html2canvas(reportElement, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
    })

    const pageWidthMm = 210
    const pageHeightMm = 297
    const imgHeightMm = (canvas.height * pageWidthMm) / canvas.width

    if (imgHeightMm <= pageHeightMm) {
      // Cabe en una sola hoja: la hoja se hace del tamaño exacto del contenido, sin espacio sobrante.
      const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: [pageWidthMm, imgHeightMm] })
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, pageWidthMm, imgHeightMm)
      pdf.save(opts.filename)
      return
    }

    // No cabe en una sola hoja: se reparte en hojas A4 normales.
    const pdf = new jsPDF('p', 'mm', 'a4')
    const cssPageHeight = (pageHeightMm * reportElement.scrollWidth) / pageWidthMm
    const breaks = findSafePageBreaks(reportElement, cssPageHeight)
    const canvasPerCssPixel = canvas.height / reportElement.scrollHeight

    for (let index = 0; index < breaks.length - 1; index++) {
      const top = Math.round(breaks[index] * canvasPerCssPixel)
      const bottom = Math.round(breaks[index + 1] * canvasPerCssPixel)
      const slice = canvasSlice(canvas, top, bottom - top)
      const sliceHeightMm = (slice.height * pageWidthMm) / slice.width
      if (index > 0) pdf.addPage()
      pdf.addImage(slice.toDataURL('image/png'), 'PNG', 0, 0, pageWidthMm, sliceHeightMm)
    }

    pdf.save(opts.filename)
  } finally {
    document.body.removeChild(container)
  }
}
